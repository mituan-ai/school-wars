// v0.2 体验升级（docs/04）：寻路、种族特性、进攻移动
import { describe, expect, it } from 'vitest';
import { HEAL_PER_TICK, PS } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { deserializeGame, serializeGame } from '../src/core/save.ts';
import { applyCommand, step } from '../src/core/sim.ts';
import { people_action, start_sit, start_walk, walk_to_cell } from '../src/core/unit.ts';
import type { Game, Rules } from '../src/core/types.ts';
import { addArea, blankGame, checkInvariants, place } from './helpers.ts';

const R: Rules = { ruleset: 'remake', ai: ['classic', 'classic', 'classic', 'classic'] };

/** 推进若干帧；keepSitting 里的单位一直坐着不动 */
function run(g: Game, ticks: number, keepSitting: number[] = []): void {
  for (let t = 0; t < ticks; t++) {
    for (const pn of keepSitting) g.people[pn].cnt = 1e9;
    people_action(g);
    g.tick++;
  }
}

function sitWall(g: Game, first: number, col: number, cells: [number, number][]): number[] {
  return cells.map(([cx, cy], k) => {
    place(g, first + k, col, cx, cy);
    start_sit(g, first + k);
    return first + k;
  });
}

describe('寻路', () => {
  it('一排坐着的人挡在正前方时绕过去，而不是停在墙前', () => {
    const g = blankGame(1, 0, R);
    const wall = sitWall(g, 1, 0, [26, 27, 28, 29, 30, 31, 32].map((y) => [30, y] as [number, number]));
    place(g, 0, 0, 26, 29);
    applyCommand(g, { type: 'order', units: [0], bx: 8, by: 7, target: -1 });
    run(g, 400, wall);
    const p = g.people[0];
    expect(Math.floor(p.cx / 4)).toBe(8);
    expect(Math.floor(p.cy / 4)).toBe(7);
    expect(checkInvariants(g)).toEqual([]);
  });

  it('经典规则仍是原版贪心寻路：同样的墙会把人挡住', () => {
    const g = blankGame(1, 0);
    const wall = sitWall(g, 1, 0, [26, 27, 28, 29, 30, 31, 32].map((y) => [30, y] as [number, number]));
    place(g, 0, 0, 26, 29);
    start_walk(g, 0, 8, 7, -1);
    run(g, 400, wall);
    expect(g.people[0].cx).toBeLessThan(30);
  });

  it('两队人迎面对穿，都能到达', () => {
    const g = blankGame(3, 0, R);
    const left = [0, 1, 2, 3, 4, 5];
    const right = [6, 7, 8, 9, 10, 11];
    left.forEach((pn, k) => place(g, pn, 0, 12, 26 + k));
    right.forEach((pn, k) => place(g, pn, 0, 44, 26 + k));
    applyCommand(g, { type: 'order', units: left, bx: 10, by: 7, target: -1 });
    applyCommand(g, { type: 'order', units: right, bx: 3, by: 7, target: -1 });
    run(g, 900);
    for (const pn of left) expect(Math.abs(Math.floor(g.people[pn].cx / 4) - 10)).toBeLessThanOrEqual(1);
    for (const pn of right) expect(Math.abs(Math.floor(g.people[pn].cx / 4) - 3)).toBeLessThanOrEqual(1);
    expect(checkInvariants(g)).toEqual([]);
  });

  it('目的地被人坐着时停在旁边最近的空格', () => {
    const g = blankGame(1, 0, R);
    const wall = sitWall(g, 1, 0, [[40, 40]]);
    place(g, 0, 0, 30, 40);
    g.people[0].ordered = true;
    walk_to_cell(g, 0, 40, 40);
    run(g, 200, wall);
    const p = g.people[0];
    expect(Math.abs(p.cx - 40) + Math.abs(p.cy - 40)).toBe(1);
    expect(p.stat === PS.STAND || p.stat === PS.SIT).toBe(true);
  });

  it('整队移动：到达前没卷入战斗的人全部到达', () => {
    let sent = 0;
    let arrived = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = createGame({ seed, userCol: 0, rules: R });
      for (let t = 0; t < 1500; t++) step(g);
      const mine = g.people.map((p, i) => (p.stat > PS.DEAD && p.col === 0 ? i : -1)).filter((i) => i >= 0);
      if (mine.length < 2) continue;
      const bx = 4 + (seed % 8);
      const by = 11 - (seed % 6);
      applyCommand(g, { type: 'order', units: mine, bx, by, target: -1 });
      const uids = mine.map((pn) => g.people[pn].uid);
      const near = (pn: number) =>
        Math.abs(Math.floor(g.people[pn].cx / 4) - bx) <= 1 && Math.abs(Math.floor(g.people[pn].cy / 4) - by) <= 1;
      const reached = new Set<number>();
      const engaged = new Set<number>();
      for (let t = 0; t < 1200; t++) {
        step(g);
        for (const [k, pn] of mine.entries()) {
          const p = g.people[pn];
          if (p.uid !== uids[k] || reached.has(pn)) continue;
          if (near(pn)) reached.add(pn);
          else if (p.target_pn >= 0 || p.leash) engaged.add(pn);
        }
      }
      mine.forEach((pn, k) => {
        // 到达前被打倒、或者去迎战了的人不算
        const lost = g.people[pn].uid !== uids[k] || g.people[pn].stat <= PS.DEAD;
        if (!reached.has(pn) && (lost || engaged.has(pn))) return;
        sent++;
        if (reached.has(pn)) arrived++;
      });
    }
    expect(sent).toBeGreaterThan(20);
    expect(arrived).toBe(sent);
  });
});

describe('种族特性', () => {
  it('人族占领快 30%：一人坐 231 帧占下营地', () => {
    const g = blankGame(1, 4, R);
    const n = addArea(g, 7, 7, 2);
    place(g, 0, 0, 29, 29);
    start_sit(g, 0);
    run(g, 230, [0]);
    expect(g.area[n].col).toBe(-1);
    run(g, 1, [0]);
    expect(g.area[n].col).toBe(0);
  });

  it('矮人在泉水上回血快一倍', () => {
    const g = blankGame(1, 4, R);
    addArea(g, 7, 7, 3, 2);
    place(g, 0, 2, 29, 29);
    g.people[0].hp = 5;
    start_sit(g, 0);
    run(g, 10, [0]);
    expect(g.people[0].hp).toBeCloseTo(5 + 10 * HEAL_PER_TICK * 2);
  });

  it('精灵更难被打中（约 42%），其他种族约 50%', () => {
    const rate = (victim: number): number => {
      let hits = 0;
      let swings = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const g = blankGame(seed, 4, R);
        place(g, 0, 1, 30, 30);
        place(g, 1, victim, 31, 30);
        g.people[1].hp = g.people[1].mhp = 1e9;
        g.people[0].hp = g.people[0].mhp = 1e9;
        start_walk(g, 0, 0, 0, 1);
        for (let t = 0; t < 600; t++) {
          g.events = [];
          people_action(g);
          for (const e of g.events) {
            if (!('pn' in e) || e.pn !== 1) continue;
            if (e.kind === 'miss') swings++;
            if (e.kind === 'punch') {
              swings++;
              hits++;
            }
          }
        }
      }
      return hits / swings;
    };
    expect(rate(3)).toBeGreaterThan(0.37);
    expect(rate(3)).toBeLessThan(0.46);
    expect(rate(2)).toBeGreaterThan(0.45);
  });
});

describe('进攻移动', () => {
  function scene(amove: boolean): Game {
    const g = blankGame(2, 0, R);
    place(g, 0, 0, 10, 30);
    g.people[0].hp = g.people[0].mhp = 1e6;
    g.people[0].punch = 100;
    place(g, 1, 2, 20, 33);
    start_sit(g, 1);
    g.people[1].cnt = 1e9; // 敌人先别主动出手
    applyCommand(g, { type: 'order', units: [0], bx: 8, by: 7, target: -1, amove });
    run(g, 900);
    return g;
  }

  it('路上遇到附近的敌人就打，打完继续前往目的地', () => {
    const g = scene(true);
    expect(g.kills[0]).toBe(1);
    const p = g.people[0];
    expect(Math.floor(p.cx / 4)).toBe(8);
    expect(Math.floor(p.cy / 4)).toBe(7);
    expect(p.amove).toBe(false);
  });

  it('普通移动不理会路边的敌人', () => {
    const g = scene(false);
    expect(g.kills[0]).toBe(0);
    expect(Math.floor(g.people[0].cx / 4)).toBe(8);
  });
});

describe('存档 v3', () => {
  it('v2 存档读入后补上新字段，并能继续跑', () => {
    const a = createGame({ seed: 5, userCol: 0, rules: R });
    for (let t = 0; t < 500; t++) step(a);
    const file = JSON.parse(serializeGame(a));
    file.v = 2;
    for (const p of file.game.people) for (const k of ['stuck', 'amove', 'goal_x', 'goal_y']) delete p[k];
    const b = deserializeGame(JSON.stringify(file));
    expect(b.people.every((p) => p.stuck === 0 && p.amove === false)).toBe(true);
    for (let t = 0; t < 1000; t++) step(b);
    expect(checkInvariants(b)).toEqual([]);
  });
});
