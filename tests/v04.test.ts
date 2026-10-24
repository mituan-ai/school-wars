// v0.4 大更新（docs/06）：地盘与补给线、基地经验与升级、班长小队、夹击、下课铃、战争迷雾
import { describe, expect, it } from 'vitest';
import {
  AREA, BELL_EXP, BELL_FIRST, BELL_OPEN, BSIZE, EXP_COST_BASE, EXP_KILL, FPS, PAINT_ENEMY_MUL, PAINT_NEED, PS, REMAKE_HP,
  SIGHT_UNIT, SSIZE,
} from '../src/core/constants.ts';
import { bellTick } from '../src/core/bell.ts';
import { vision } from '../src/core/fog.ts';
import { addExp, expCost, UP } from '../src/core/growth.ts';
import { createGame } from '../src/core/mapgen.ts';
import { deserializeGame, hashGame, serializeGame } from '../src/core/save.ts';
import { applyCommand, step } from '../src/core/sim.ts';
import { add_people, ticksToNextSpawn } from '../src/core/spawn.ts';
import { isLeader, squads } from '../src/core/squad.ts';
import { paint, supplied, suppliedSpades } from '../src/core/territory.ts';
import { people_action, start_sit, start_walk } from '../src/core/unit.ts';
import type { Game, Rules } from '../src/core/types.ts';
import { addArea, blankGame, checkInvariants, connect, place } from './helpers.ts';

/** 四个座位都标成玩家：没有电脑插手 */
const H: Rules = { ruleset: 'remake', ai: ['human', 'human', 'human', 'human'] };

function hold(g: Game, pn: number): void {
  g.people[pn].cnt = 1e9;
}

function tile(cx: number, cy: number): number {
  return (cy >> 2) * BSIZE + (cx >> 2);
}

describe('地盘与补给线', () => {
  it('一个人站在空白格上 1 秒就涂成自己的颜色；敌方的格子要 3 倍时间', () => {
    const g = blankGame(1, 4, H);
    place(g, 0, 0, 29, 29);
    hold(g, 0);
    const t = tile(29, 29);
    for (let i = 0; i < PAINT_NEED - 1; i++) paint(g);
    expect(g.terr[t]).toBe(-1);
    paint(g);
    expect(g.terr[t]).toBe(0);
    g.terr[t] = 1;
    for (let i = 0; i < PAINT_NEED * PAINT_ENEMY_MUL - 1; i++) paint(g);
    expect(g.terr[t]).toBe(1);
    paint(g);
    expect(g.terr[t]).toBe(0);
  });

  it('两所学校的人站在同一格上：谁也涂不动', () => {
    const g = blankGame(1, 4, H);
    place(g, 0, 0, 29, 29);
    place(g, 1, 1, 30, 30);
    for (let i = 0; i < 200; i++) paint(g);
    expect(g.terr[tile(29, 29)]).toBe(-1);
  });

  it('营地连不回本部就没有补给：不加快增援；接通后恢复', () => {
    const g = blankGame(1, 4, H);
    const pl = g.player[0];
    const bx = pl.basex === 0 ? 4 : BSIZE - 5;
    const by = pl.basey === 0 ? 4 : BSIZE - 5;
    addArea(g, bx, by, AREA.SPADE, 0);
    expect(suppliedSpades(g, 0)).toBe(0);
    const slow = ticksToNextSpawn(g, 0);
    connect(g, 0, bx, by);
    g.tick++;
    expect(suppliedSpades(g, 0)).toBe(1);
    expect(ticksToNextSpawn(g, 0)).toBeLessThan(slow);
    // 中间一格被敌人涂掉：补给断了
    const mid = pl.basey * BSIZE + (pl.basex + bx) / 2;
    g.terr[Math.round(mid)] = 1;
    g.tick++;
    expect(suppliedSpades(g, 0)).toBe(0);
  });

  it('断了补给的泉水不回血', () => {
    const g = blankGame(1, 4, H);
    addArea(g, 7, 7, AREA.HEART, 2);
    place(g, 0, 2, 29, 29);
    g.people[0].hp = 5;
    start_sit(g, 0);
    for (let i = 0; i < 10; i++) {
      hold(g, 0);
      people_action(g);
      g.tick++;
    }
    expect(g.people[0].hp).toBe(5);
  });

  it('本部沦陷后，原来的地盘全都断了补给', () => {
    const g = blankGame(1, 4, H);
    const pl = g.player[0];
    connect(g, 0, 7, 7);
    g.tick++;
    expect(supplied(g, 7 * BSIZE + 7, 0)).toBe(true);
    const a = g.area[g.bmap_n[pl.basey * BSIZE + pl.basex]];
    a.fallen = true;
    a.holder = 1;
    g.tick++;
    expect(supplied(g, 7 * BSIZE + 7, 0)).toBe(false);
  });
});

describe('基地经验与升级', () => {
  it('坐在有补给的己方营地上每帧 +1 经验；没补给的不加', () => {
    const g = blankGame(1, 4, H);
    const pl = g.player[0];
    const bx = pl.basex === 0 ? 3 : BSIZE - 4;
    const by = pl.basey === 0 ? 3 : BSIZE - 4;
    addArea(g, bx, by, AREA.SPADE, 0);
    place(g, 0, 0, bx * 4 + 1, by * 4 + 1);
    start_sit(g, 0);
    const sit = (n: number) => {
      for (let i = 0; i < n; i++) {
        hold(g, 0);
        people_action(g);
        g.tick++;
      }
    };
    sit(10);
    expect(pl.exp).toBe(0);
    connect(g, 0, bx, by);
    sit(10);
    expect(pl.exp).toBe(10);
  });

  it('击倒一人加经验', () => {
    const g = blankGame(3, 4, H);
    place(g, 0, 0, 30, 30);
    place(g, 1, 1, 31, 30);
    g.people[0].hp = g.people[0].mhp = 1e9;
    g.people[1].hp = 1;
    start_walk(g, 0, 0, 0, 1);
    for (let i = 0; i < 600 && g.people[1].stat > PS.DEAD; i++) people_action(g);
    expect(g.people[1].stat).toBeLessThanOrEqual(PS.DEAD);
    expect(g.player[0].exp).toBe(EXP_KILL);
  });

  it('经验攒满得到一次升级；选生命后，之后的新兵生命上限更高；越往后升级越贵', () => {
    const g = blankGame(1, 4, H);
    const pl = g.player[0];
    expect(expCost(pl)).toBe(EXP_COST_BASE);
    addExp(g, 0, EXP_COST_BASE - 1);
    expect(pl.picks).toBe(0);
    addExp(g, 0, 1);
    expect(pl.picks).toBe(1);
    expect(g.events.some((e) => e.kind === 'levelready' && e.col === 0)).toBe(true);
    expect(expCost(pl)).toBeGreaterThan(EXP_COST_BASE);
    // 没攒下的升级、越界的升级项都不生效
    applyCommand(g, { type: 'upgrade', col: 1, kind: UP.HP });
    applyCommand(g, { type: 'upgrade', col: 0, kind: 7 });
    expect(g.player[1].up).toEqual([0, 0, 0, 0]);
    applyCommand(g, { type: 'upgrade', col: 0, kind: UP.HP });
    expect(pl.up[UP.HP]).toBe(1);
    expect(pl.picks).toBe(0);
    add_people(g, 0);
    const p = g.people.find((q) => q.stat > PS.DEAD && q.col === 0)!;
    expect(p.mhp).toBe(Math.round(REMAKE_HP[0] * 1.15));
  });

  it('攻击、移速升级作用在新兵身上；移速 3 级走同样的路快约一半', () => {
    const g = blankGame(1, 4, H);
    g.player[0].up = [0, 2, 3, 0];
    place(g, 0, 0, 2, 30);
    place(g, 1, 1, 2, 34);
    expect(g.people[0].punch).toBe(g.people[0].punch - 2 + 2);
    expect(g.people[0].spd).toBe(3);
    applyCommand(g, { type: 'order', col: 0, units: [0], bx: 15, by: 7, target: -1 });
    applyCommand(g, { type: 'order', col: 1, units: [1], bx: 15, by: 8, target: -1 });
    for (let i = 0; i < 6 * 30; i++) people_action(g);
    const fast = g.people[0].cx - 2;
    const slow = g.people[1].cx - 2;
    expect(fast / slow).toBeGreaterThan(1.35);
    expect(fast / slow).toBeLessThan(1.65);
  });

  it('电脑自己把攒下的升级用掉', () => {
    const g = createGame({ seed: 5, userCol: 4, rules: { ruleset: 'remake', ai: ['normal', 'normal', 'normal', 'normal'] } });
    g.player[1].picks = 3;
    step(g);
    expect(g.player[1].picks).toBe(0);
    expect(g.player[1].up.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('班长与小队', () => {
  function squadGame() {
    const g = blankGame(1, 4, H);
    place(g, 0, 0, 30, 30);
    g.people[0].lev = 9;
    for (let i = 1; i <= 4; i++) {
      place(g, i, 0, 30 + i, 32);
      start_sit(g, i);
    }
    start_sit(g, 0);
    for (let i = 0; i <= 4; i++) hold(g, i);
    // 让 tick 对上班长（槽位 0）的思考时机
    g.tick = 18 * 10;
    return g;
  }

  it('满三星成为班长，从附近闲着的人里招最多 3 人', () => {
    const g = squadGame();
    expect(isLeader(g.people[0])).toBe(true);
    squads(g);
    const members = g.people.filter((p) => p.squad === 0);
    expect(members.length).toBe(3);
    expect(members.every((p) => p.squad_uid === g.people[0].uid)).toBe(true);
  });

  it('单独给队员下令，这名队员离队；连班长一起下令则留在队里', () => {
    const g = squadGame();
    squads(g);
    const [a, b] = g.people.map((p, i) => (p.squad === 0 ? i : -1)).filter((i) => i >= 0);
    applyCommand(g, { type: 'order', col: 0, units: [a], bx: 2, by: 2, target: -1 });
    expect(g.people[a].squad).toBe(-1);
    applyCommand(g, { type: 'order', col: 0, units: [0, b], bx: 2, by: 2, target: -1 });
    expect(g.people[b].squad).toBe(0);
  });

  it('班长闲着、附近有敌人：带着队员一起进攻移动过去', () => {
    const g = squadGame();
    place(g, 10, 1, 38, 36);
    hold(g, 10);
    squads(g);
    const team = g.people.filter((p, i) => i === 0 || p.squad === 0);
    expect(team.length).toBe(4);
    expect(team.every((p) => p.stat === PS.WALK && p.amove)).toBe(true);
    expect(checkInvariants(g)).toEqual([]);
  });

  it('班长倒下，小队解散', () => {
    const g = squadGame();
    squads(g);
    g.people[0].stat = PS.DEAD;
    g.tick++;
    squads(g);
    expect(g.people.filter((p) => p.squad >= 0).length).toBe(0);
  });
});

describe('夹击与班长光环', () => {
  /** victim 被 attackers 围着打 600 帧，返回 attackers[0] 的命中率 */
  function rate(extra: [number, number][], leader = false): number {
    let hits = 0;
    let swings = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = blankGame(seed, 4, H);
      place(g, 0, 1, 30, 30);
      g.people[0].hp = g.people[0].mhp = 1e9;
      const atk = [[31, 30], ...extra];
      atk.forEach(([cx, cy], k) => {
        place(g, 1 + k, 0, cx, cy);
        const p = g.people[1 + k];
        p.hp = p.mhp = 1e9;
        if (leader && k === 0) p.lev = 9;
        start_walk(g, 1 + k, 0, 0, 0);
      });
      for (let t = 0; t < 600; t++) {
        g.events = [];
        people_action(g);
        if (g.people[1].fs === 3 && g.people[1].cnt === 10) {
          swings++;
          if (g.events.some((e) => e.kind === 'punch' && e.pn === 0)) hits++;
        }
      }
    }
    return hits / swings;
  }

  it('两面夹击时更容易打中；班长在旁也更容易打中', () => {
    const solo = rate([]);
    const flank = rate([[29, 30]]);
    const aura = rate([], true);
    expect(solo).toBeGreaterThan(0.4);
    expect(solo).toBeLessThan(0.6);
    expect(flank).toBeGreaterThan(solo + 0.08);
    expect(aura).toBeGreaterThan(solo + 0.04);
  });
});

describe('下课铃', () => {
  it('到点在中部空白格开小卖部；只有一所学校的人站着才加经验；到时关门', () => {
    const g = blankGame(1, 4, H);
    g.tick = BELL_FIRST;
    bellTick(g);
    const b = g.bell;
    expect(b.bx).toBeGreaterThanOrEqual(4);
    expect(b.bx).toBeLessThan(BSIZE - 4);
    expect(g.bmap_n[b.by * BSIZE + b.bx]).toBe(-1);
    expect(g.events.some((e) => e.kind === 'bell')).toBe(true);
    place(g, 0, 2, b.bx * 4, b.by * 4);
    g.tick++;
    bellTick(g);
    expect(g.player[2].exp).toBe(BELL_EXP);
    place(g, 1, 3, b.bx * 4 + 1, b.by * 4);
    g.tick++;
    bellTick(g);
    expect(g.player[2].exp).toBe(BELL_EXP);
    g.events = [];
    g.tick = b.until;
    bellTick(g);
    expect(b.bx).toBe(-1);
    expect(g.events).toContainEqual({ kind: 'bellend', col: 2 });
    expect(b.next).toBeGreaterThan(g.tick);
    expect(BELL_OPEN).toBeGreaterThan(0);
  });
});

describe('战争迷雾', () => {
  it('学生只看得见周围 7 格；本部和己方地盘也提供视野', () => {
    const g = blankGame(1, 4, H);
    place(g, 0, 0, 32, 32);
    const v = vision(g, 0);
    expect(v[32 * SSIZE + 32 + SIGHT_UNIT]).toBe(1);
    expect(v[32 * SSIZE + 32 + SIGHT_UNIT + 1]).toBe(0);
    const pl = g.player[0];
    expect(v[(pl.basey * 4 + 1) * SSIZE + pl.basex * 4 + 1]).toBe(1);
    g.terr[5 * BSIZE + 10] = 0;
    expect(vision(g, 0)[(5 * 4 + 1) * SSIZE + 10 * 4 + 1]).toBe(1);
  });
});

describe('存档与经典规则', () => {
  it('带迷雾的新规则对局：读档后走向与不读档一致', () => {
    const a = createGame({ seed: 9, userCol: 4, rules: { ruleset: 'remake', ai: ['hard', 'normal', 'normal', 'easy'], fog: true } });
    for (let i = 0; i < 4 * 60 * FPS; i++) step(a);
    const b = deserializeGame(serializeGame(a));
    for (let i = 0; i < 60 * FPS; i++) {
      step(a);
      step(b);
    }
    expect(hashGame(b)).toBe(hashGame(a));
    expect(a.terr.filter((c) => c >= 0).length).toBeGreaterThan(20);
  });

  it('v3 存档能读：补上新字段，地盘只有各自本部', () => {
    const g = createGame({ seed: 2, userCol: 0, rules: { ruleset: 'remake', ai: ['normal', 'normal', 'normal', 'normal'] } });
    const file = JSON.parse(serializeGame(g));
    file.v = 3;
    for (const k of ['terr', 'paint_col', 'paint_val', 'bell']) delete file.game[k];
    for (const p of file.game.people) for (const k of ['spd', 'acc', 'squad', 'squad_uid']) delete p[k];
    for (const pl of file.game.player) for (const k of ['exp', 'picks', 'up']) delete pl[k];
    const h = deserializeGame(JSON.stringify(file));
    expect(h.terr.filter((c) => c >= 0).length).toBe(4);
    expect(h.player[0].up).toEqual([0, 0, 0, 0]);
    for (let i = 0; i < 600; i++) step(h);
  });

  it('经典规则不涂地、不攒经验、不开下课铃', () => {
    const g = createGame({ seed: 4, userCol: 4 });
    for (let i = 0; i < 5 * 60 * FPS; i++) step(g);
    expect(g.terr.filter((c) => c >= 0).length).toBe(4);
    expect(g.player.every((p) => p.exp === 0 && p.picks === 0)).toBe(true);
    expect(g.bell.bx).toBe(-1);
  });
});
