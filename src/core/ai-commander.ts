// "校园战争"电脑指挥官（docs/03 §3）。
// 只替换战略层：看到的信息与玩家相同，对世界的影响只通过与玩家相同的 order 指令。
// 单位身上的 task / task_area 是指挥官自己的备忘，不参与单位层规则。
import { AREA, FPS, PEOPLE_CAP, PS, REMAKE_APPEAR, REMAKE_HP, REMAKE_PUNCH, SSIZE } from './constants.ts';
import { fogOn, vision } from './fog.ts';
import { newArea } from './mapgen.ts';
import { suppliedSpades } from './territory.ts';
import { baseFallen, topBlocks } from './query.ts';
import type { AiLevel, Area, Command, Game, OrderCommand } from './types.ts';

export const TASK = { NONE: 0, RETREAT: 1, DEFEND: 2, EXPAND: 3, ATTACK: 4 } as const;

/** 各校性格：只是参数不同 */
interface Persona {
  /** 扩张地块的价值倍率 */
  expand: number;
  /** 兵力达到对方多少倍才去攻本部 */
  attackRatio: number;
  /** 血量低于多少比例考虑撤退 */
  retreat: number;
  /** 扩张小队人数 */
  squad: number;
  /** 偷袭敌方地块的价值倍率 */
  raid: number;
  /** 防守时比来犯敌人多派几人 */
  defendExtra: number;
}

const PERSONA: Persona[] = [
  { expand: 1, attackRatio: 1.25, retreat: 0.35, squad: 2, raid: 1, defendExtra: 1 }, // 黑曜：均衡
  { expand: 1.3, attackRatio: 1, retreat: 0.15, squad: 3, raid: 1, defendExtra: 2 }, // 绿林：人海
  { expand: 0.8, attackRatio: 1.5, retreat: 0.25, squad: 2, raid: 0.8, defendExtra: 2 }, // 金刚：稳守反击
  { expand: 1, attackRatio: 1.1, retreat: 0.4, squad: 2, raid: 1.5, defendExtra: 0 }, // 紫电：突袭
];

/** 难度：反应间隔、每次最多下几道命令、是否检查局部优劣、是否集火 */
interface Level {
  interval: number;
  maxOrders: number;
  localCheck: boolean;
  focus: boolean;
  /** 攻本部门槛的额外倍率 */
  boldness: number;
  /** 是否回防 ♠ / ♥（否则只守本部） */
  guard: boolean;
  /** 是否会撤退疗伤 */
  retreat: boolean;
}

const LEVELS: Partial<Record<AiLevel, Level>> = {
  easy: { interval: 54, maxOrders: 1, localCheck: false, focus: false, boldness: 1.4, guard: false, retreat: false },
  normal: { interval: 36, maxOrders: 2, localCheck: false, focus: false, boldness: 1, guard: false, retreat: true },
  hard: { interval: 9, maxOrders: 12, localCheck: true, focus: true, boldness: 0.9, guard: true, retreat: true },
};

interface Goal {
  kind: number;
  area: number;
  cx: number;
  cy: number;
  want: number;
  have: number;
  value: number;
  /** 集火对象（-1 表示走向地块） */
  target: number;
  /** 每格距离扣多少分 */
  distW: number;
}

const THREAT_RANGE = 6;
/** 兵力估算计入多少帧内的增援 */
const REINFORCE_HORIZON = 30 * FPS;
/** 人满时攻本部的兵力门槛倍率 */
const CAPPED_RATIO = 0.85;
/** 开局多久之后才会攻本部 */
const SIEGE_AFTER = 5 * 60 * FPS;
/** 攻本部至少凑齐几人才出发 */
const SIEGE_SQUAD = 6;
const LOCAL_RANGE = 5;

export function commander(g: Game, col: number): Command[] {
  const lv = LEVELS[g.rules.ai[col]];
  if (!lv) return [];
  if ((g.tick + col * 4) % lv.interval) return [];
  const ps = PERSONA[col];

  const mine: number[] = [];
  const foes: number[] = [];
  const power = [0, 0, 0, 0];
  // 迷雾：只知道看得见的敌人在哪（兵力对比仍按全局估算，相当于情报）
  const seen = fogOn(g) ? vision(g, col) : null;
  for (let pn = 0; pn < g.people.length; pn++) {
    const p = g.people[pn];
    if (p.stat <= PS.DEAD) continue;
    power[p.col] += p.hp * p.punch;
    if (p.col === col) mine.push(pn);
    else if (!seen || seen[p.cy * SSIZE + p.cx]) foes.push(pn);
  }
  // 下课铃的小卖部当作一个临时地块，排在所有地块之后
  const bell = g.bell;
  const sites: Area[] = bell.bx >= 0 ? [...g.area, newArea(bell.bx, bell.by, AREA.NONE, -1)] : g.area;
  if (mine.length === 0) return [];
  // 兵力估算要算上增援：出兵快的学校（绿林）死了也补得快
  const spades = [0, 1, 2, 3].map((c) => (g.player[c].exist ? suppliedSpades(g, c) : 0));
  for (let c = 0; c < 4; c++) {
    if (!g.player[c].exist || baseFallen(g, c)) continue;
    const per = REMAKE_HP[c] * REMAKE_PUNCH[c];
    power[c] += (per * REINFORCE_HORIZON * (2 + spades[c])) / REMAKE_APPEAR[c];
  }

  const orders = new Map<string, OrderCommand>();
  let budget = lv.maxOrders;
  const issue = (pn: number, bx: number, by: number, target: number): void => {
    const key = `${bx},${by},${target}`;
    let c = orders.get(key);
    if (!c) {
      c = { type: 'order', col, units: [], bx, by, target };
      orders.set(key, c);
    }
    c.units.push(pn);
    budget--;
  };
  const near = (list: number[], cx: number, cy: number, r: number): number => {
    let n = 0;
    for (const i of list) {
      const o = g.people[i];
      if (Math.abs(o.cx - cx) + Math.abs(o.cy - cy) <= r) n++;
    }
    return n;
  };
  const healSpots: number[] = [];
  g.area.forEach((a, n) => {
    if (a.col !== col) return;
    if (a.areatype === AREA.HEART || (a.areatype === AREA.BASE && !a.fallen)) healSpots.push(n);
  });
  const onArea = (pn: number, n: number): boolean => {
    const p = g.people[pn];
    const a = sites[n];
    return Math.floor(p.cx / 4) === a.bx && Math.floor(p.cy / 4) === a.by;
  };
  const distTo = (pn: number, n: number): number => {
    const p = g.people[pn];
    const a = sites[n];
    return Math.abs(p.cx - (a.bx * 4 + 1.5)) + Math.abs(p.cy - (a.by * 4 + 1.5));
  };

  // 1. 撤退：血少且局部不占优时回最近的己方 ♥ 或本部；回满九成再出来
  for (const pn of mine) {
    const p = g.people[pn];
    if (p.task === TASK.RETREAT) {
      if (p.hp < p.mhp * 0.9 && healSpots.includes(p.task_area)) {
        // 被自动迎战拉走过：打完再回去
        const idle = p.stat !== PS.WALK && p.stat !== PS.FIGHT;
        if (idle && !onArea(pn, p.task_area) && budget > 0) issue(pn, sites[p.task_area].bx, sites[p.task_area].by, -1);
        continue;
      }
      p.task = TASK.NONE;
    }
    if (!lv.retreat || p.hp >= p.mhp * ps.retreat || healSpots.length === 0 || budget <= 0) continue;
    if (lv.localCheck && p.hp > p.mhp * 0.15) {
      if (near(mine, p.cx, p.cy, LOCAL_RANGE) > near(foes, p.cx, p.cy, LOCAL_RANGE)) continue;
    }
    let best = -1;
    let bd = Infinity;
    for (const n of healSpots) {
      const d = distTo(pn, n);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    p.task = TASK.RETREAT;
    p.task_area = best;
    if (!onArea(pn, best)) issue(pn, sites[best].bx, sites[best].by, -1);
  }

  // 2. 目标：防守己方地块、扩张中立地块、夺取敌方地块、攻打敌方本部
  const goals: Goal[] = [];
  const myCount = mine.length;
  const base = g.player[col];
  // 开局一分钟只占"自己这半边"的地块，不急着和别人撞上
  const opening = g.tick < 60 * FPS;
  const ownSide = (bx: number, by: number): boolean => {
    const d = Math.abs(bx - base.basex) + Math.abs(by - base.basey);
    return g.player.every((pl, i) => i === col || !pl.exist || Math.abs(bx - pl.basex) + Math.abs(by - pl.basey) >= d);
  };
  g.area.forEach((a, n) => {
    const cx = a.bx * 4 + 1.5;
    const cy = a.by * 4 + 1.5;
    const threat = near(foes, cx, cy, THREAT_RANGE);
    const goal = (kind: number, want: number, value: number, distW = 1.2): void => {
      let target = -1;
      if (lv.focus && threat > 0 && kind !== TASK.EXPAND) target = weakestNear(g, foes, cx, cy);
      goals.push({ kind, area: n, cx, cy, want, have: 0, value, target, distW });
    };
    if (a.col === col) {
      if (a.areatype === AREA.BASE && a.fallen) goal(TASK.DEFEND, threat + 2, 150);
      else if (threat > 0 && (lv.guard || a.areatype === AREA.BASE)) {
        const value = a.areatype === AREA.BASE ? 120 : a.areatype === AREA.SPADE ? 70 : 40;
        goal(TASK.DEFEND, threat + ps.defendExtra, value);
      }
      return;
    }
    // "众矢之的"：存在领先者时优先打它，打别人的价值打折；快被打垮的学校值得收尾
    const bias = a.col < 0 ? 1 : (topBlocks(g, col, a.col) ? 0.6 : 1) * (g.player[a.col].people_cnt <= 3 ? 1.3 : 1);
    if (a.areatype !== AREA.BASE) {
      if (opening && !ownSide(a.bx, a.by)) return;
      const worth = a.areatype === AREA.SPADE ? 60 : healSpots.length <= 1 ? 40 : 25;
      if (a.col < 0) goal(TASK.EXPAND, Math.max(ps.squad, threat + 1), worth * ps.expand);
      else goal(TASK.ATTACK, Math.max(ps.squad, threat + 1), worth * 0.9 * ps.raid * bias);
      return;
    }
    // 敌方本部：已沦陷的派人看住，防止对方夺回；未沦陷的兵力占优才去攻
    if (!g.player[a.col].exist) return;
    if (a.fallen) {
      goal(TASK.ATTACK, 2, 45);
      return;
    }
    // 兵力占优才攻（人满时门槛降低：再等也不会更强）
    const capped = myCount >= PEOPLE_CAP - 1;
    const ratio = ps.attackRatio * lv.boldness * (capped ? CAPPED_RATIO : 1);
    const enough = g.tick >= SIEGE_AFTER && myCount >= 5 && power[col] >= power[a.col] * ratio;
    // 已经出发的进攻坚持到底，不因兵力对比的起伏半途而废
    const committed = mine.some((pn) => g.people[pn].task === TASK.ATTACK && g.people[pn].task_area === n);
    if (enough || committed) {
      const value = (70 + (g.top === a.col ? 30 : 0) + (capped ? 10 : 0)) * bias;
      goal(TASK.ATTACK, Math.max(4, threat + 2), value, 0.8);
    }
  });

  if (bell.bx >= 0) {
    const n = g.area.length;
    const cx = bell.bx * 4 + 1.5;
    const cy = bell.by * 4 + 1.5;
    goals.push({ kind: TASK.EXPAND, area: n, cx, cy, want: Math.max(3, near(foes, cx, cy, THREAT_RANGE) + 1), have: 0, value: 75 * ps.expand, target: -1, distW: 1.2 });
  }

  // 3. 哪些人空闲：在打架、在赶路、正在执行仍然有效的任务的人都不动
  const goalOf = (kind: number, area: number): Goal | undefined =>
    goals.find((q) => q.kind === kind && q.area === area);
  const free: number[] = [];
  for (const pn of mine) {
    const p = g.people[pn];
    // 班长小队里的队员听班长的
    if (p.task === TASK.RETREAT || p.stat === PS.FIGHT || p.squad >= 0) continue;
    if (p.task !== TASK.NONE) {
      const q = goalOf(p.task, p.task_area);
      if (q) {
        q.have++;
        if (p.stat !== PS.WALK && !onArea(pn, q.area) && budget > 0) {
          issue(pn, sites[q.area].bx, sites[q.area].by, q.target);
        }
        continue;
      }
      p.task = TASK.NONE;
    }
    if (p.stat === PS.WALK) continue;
    free.push(pn);
  }

  // 攻本部要成队出发，凑不齐就先不去
  for (const q of goals) {
    if (q.kind === TASK.ATTACK && sites[q.area].areatype === AREA.BASE && !sites[q.area].fallen) {
      const capped = mine.length >= PEOPLE_CAP - 1;
      if (q.have === 0 && !capped && free.length < Math.min(q.want, SIEGE_SQUAD)) q.want = 0;
    }
  }

  // 4. 分配：按"价值 − 距离"从高到低配对
  const pairs: { pn: number; q: Goal; s: number }[] = [];
  for (const pn of free) {
    for (const q of goals) {
      if (q.have >= q.want) continue;
      const s = q.value - distTo(pn, q.area) * q.distW;
      if (s > -40) pairs.push({ pn, q, s });
    }
  }
  pairs.sort((x, y) => y.s - x.s || x.pn - y.pn || x.q.area - y.q.area);
  const used = new Set<number>();
  for (const { pn, q } of pairs) {
    if (budget <= 0) break;
    if (used.has(pn) || q.have >= q.want) continue;
    used.add(pn);
    q.have++;
    const p = g.people[pn];
    p.task = q.kind;
    p.task_area = q.area;
    if (!onArea(pn, q.area) || q.target >= 0) issue(pn, sites[q.area].bx, sites[q.area].by, q.target);
  }

  return [...orders.values()];
}

function weakestNear(g: Game, foes: number[], cx: number, cy: number): number {
  let best = -1;
  let bh = Infinity;
  for (const i of foes) {
    const o = g.people[i];
    if (Math.abs(o.cx - cx) + Math.abs(o.cy - cy) > THREAT_RANGE) continue;
    if (o.hp < bh) {
      bh = o.hp;
      best = i;
    }
  }
  return best;
}
