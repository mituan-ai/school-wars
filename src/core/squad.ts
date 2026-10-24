// 班长与小队（docs/06 §3，仅"校园战争"规则）。
// 满三星的学生成为班长：身边的己方学生出手更准（unit.ts），还会从附近闲着的人里招最多 3 人组成小队。
// 班长被玩家派去哪里，队员跟到哪里；班长闲着时带队去打附近的敌人或敌方地盘。
// 玩家单独给队员下令（不带班长），这名队员就离队。
import { AREA, BSIZE, LEADER_STARS, PMAX, PS, SQUAD_RECRUIT, SQUAD_SEEK, SQUAD_SIZE, SQUAD_THINK, SSIZE } from './constants.ts';
import { fogOn, vision } from './fog.ts';
import { stars } from './query.ts';
import { applyCommand } from './sim.ts';
import { tileOwner } from './territory.ts';
import type { Game, Person } from './types.ts';

/** 指挥官的任务：撤退中（与 ai-commander 的 TASK.RETREAT 相同） */
const TASK_RETREAT = 1;

export function isLeader(p: Person): boolean {
  return p.stat > PS.DEAD && stars(p.lev) >= LEADER_STARS;
}

const idle = (p: Person): boolean => p.stat === PS.STAND || p.stat === PS.SIT;
const dist = (a: Person, b: Person): number => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

export function squads(g: Game): void {
  // 班长不在了（倒下、槽位换了人）：队员各自散开
  for (const p of g.people) {
    if (p.squad < 0) continue;
    const l = g.people[p.squad];
    if (p.stat <= PS.DEAD || l.uid !== p.squad_uid || l.col !== p.col || !isLeader(l)) {
      p.squad = -1;
      p.squad_uid = -1;
    }
  }
  for (let pn = 0; pn < PMAX; pn++) {
    const l = g.people[pn];
    if (!isLeader(l) || (g.tick + pn) % SQUAD_THINK) continue;
    if (l.task === TASK_RETREAT) continue;
    const members: number[] = [];
    for (let i = 0; i < PMAX; i++) if (g.people[i].squad === pn && g.people[i].stat > PS.DEAD) members.push(i);
    recruit(g, pn, members);
    if (members.length === 0) continue;
    if (l.stat === PS.WALK) {
      // 班长在赶路：没跟上的闲着的队员跟过去
      const late = members.filter((i) => idle(g.people[i]) && Math.abs(g.people[i].cx - l.dest_sx) + Math.abs(g.people[i].cy - l.dest_sy) > 4);
      if (late.length) order(g, l.col, late, l.dest_sx >> 2, l.dest_sy >> 2, true);
      continue;
    }
    if (!idle(l)) continue;
    // 掉队太远的先归队
    const far = members.filter((i) => idle(g.people[i]) && dist(g.people[i], l) > SQUAD_RECRUIT);
    if (far.length) order(g, l.col, far, l.cx >> 2, l.cy >> 2, false);
    if (l.ordered || l.task !== 0 || l.hp < l.mhp * 0.6 || capturing(g, l)) continue;
    const goal = seek(g, l);
    if (goal < 0) continue;
    order(g, l.col, [pn, ...members.filter((i) => idle(g.people[i]))], goal % BSIZE, Math.floor(goal / BSIZE), true);
  }
}

/** 从班长附近闲着、血量健康、没有别的事的己方学生里招人，近的先招 */
function recruit(g: Game, pn: number, members: number[]): void {
  const l = g.people[pn];
  if (members.length >= SQUAD_SIZE) return;
  const cand: number[] = [];
  for (let i = 0; i < PMAX; i++) {
    const p = g.people[i];
    if (i === pn || p.stat <= PS.DEAD || p.col !== l.col || p.squad >= 0 || isLeader(p)) continue;
    if (p.ordered || p.task !== 0 || !idle(p) || p.hp < p.mhp * 0.6 || dist(p, l) > SQUAD_RECRUIT) continue;
    // 坐在营地、泉水上的人在占领或回血，不拉走（本部上的新兵可以）
    const n = g.bmap_n[(p.cy >> 2) * BSIZE + (p.cx >> 2)];
    if (n >= 0 && g.area[n].areatype !== AREA.BASE) continue;
    cand.push(i);
  }
  cand.sort((a, b) => dist(g.people[a], l) - dist(g.people[b], l) || a - b);
  for (const i of cand) {
    if (members.length >= SQUAD_SIZE) break;
    g.people[i].squad = pn;
    g.people[i].squad_uid = l.uid;
    members.push(i);
  }
}

/** 班长正坐在要占的营地 / 泉水 / 本部上：不走开 */
function capturing(g: Game, l: Person): boolean {
  const n = g.bmap_n[(l.cy >> 2) * BSIZE + (l.cx >> 2)];
  if (n < 0) return false;
  const a = g.area[n];
  return a.col !== l.col || a.fallen;
}

/** 找仗打：最近的看得见的敌人；没有就找最近的敌方地盘（不含本部）。返回大格号，-1 表示没有 */
function seek(g: Game, l: Person): number {
  const seen = fogOn(g) ? vision(g, l.col) : null;
  let best = -1;
  let bd = SQUAD_SEEK + 1;
  for (const o of g.people) {
    if (o.stat <= PS.DEAD || o.col === l.col) continue;
    if (seen && !seen[o.cy * SSIZE + o.cx]) continue;
    const d = dist(o, l);
    if (d < bd) {
      bd = d;
      best = (o.cy >> 2) * BSIZE + (o.cx >> 2);
    }
  }
  if (best >= 0) return best;
  bd = SQUAD_SEEK + 1;
  for (let t = 0; t < BSIZE * BSIZE; t++) {
    const own = tileOwner(g, t);
    if (own < 0 || own === l.col) continue;
    const n = g.bmap_n[t];
    if (n >= 0 && g.area[n].areatype === AREA.BASE) continue;
    const bx = t % BSIZE;
    const by = (t - bx) / BSIZE;
    const d = Math.abs(bx * 4 + 1.5 - l.cx) + Math.abs(by * 4 + 1.5 - l.cy);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

function order(g: Game, col: number, units: number[], bx: number, by: number, amove: boolean): void {
  applyCommand(g, { type: 'order', col, units, bx, by, target: -1, amove, keepSquad: true });
}
