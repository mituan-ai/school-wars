// "校园战争"规则（docs/03 §2）的逐条断言
import { describe, expect, it } from 'vitest';
import { FPS, PS, SPEC_APPEAR, SSIZE } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { deserializeGame, hashGame, serializeGame } from '../src/core/save.ts';
import { applyCommand, step } from '../src/core/sim.ts';
import { check_add_people } from '../src/core/spawn.ts';
import { check_top, decay_areas, people_action, start_sit, start_walk } from '../src/core/unit.ts';
import type { Game, Rules } from '../src/core/types.ts';
import { addArea, blankGame, checkInvariants, place } from './helpers.ts';

/** 新规则 + 原版 AI：单位层规则单独可测 */
const R: Rules = { ruleset: 'remake', ai: ['classic', 'classic', 'classic', 'classic'] };

function baseArea(g: Game, col: number): number {
  const pl = g.player[col];
  return g.bmap_n[pl.basey * 16 + pl.basex];
}

/** 让一个单位一直坐着：把重新索敌的倒计时调大 */
function sitFor(g: Game, pn: number, ticks: number): void {
  start_sit(g, pn);
  for (let t = 0; t < ticks; t++) {
    g.people[pn].cnt = 1e9;
    people_action(g);
    g.tick++;
  }
}

describe('攻陷本部', () => {
  it('敌人坐满 600 帧本部沦陷；沦陷后不回血、不增援；己方坐 300 帧夺回', () => {
    const g = blankGame(1, 4, R);
    const n = baseArea(g, 2);
    const a = g.area[n];
    place(g, 0, 0, a.bx * 4 + 1, a.by * 4 + 1);
    sitFor(g, 0, 599);
    expect(a.fallen).toBe(false);
    sitFor(g, 0, 1);
    expect(a.fallen).toBe(true);
    expect(a.holder).toBe(0);
    expect(a.col).toBe(2);

    // 不增援：计数冻结
    const before = g.player[2].appear_cnt;
    for (let t = 0; t < 3000; t++) check_add_people(g);
    expect(g.player[2].people_cnt).toBe(0);
    expect(g.player[2].appear_cnt).toBe(before);

    // 不回血（先撤走攻方，免得打起来）
    g.people[0].stat = PS.EMPTY;
    g.smap[g.people[0].cy * SSIZE + g.people[0].cx] = -1;
    g.player[0].people_cnt--;
    place(g, 1, 2, a.bx * 4 + 2, a.by * 4 + 2);
    g.people[1].hp = 5;
    sitFor(g, 1, 299);
    expect(g.people[1].hp).toBe(5);
    sitFor(g, 1, 1);
    expect(a.fallen).toBe(false);
    sitFor(g, 1, 10);
    expect(g.people[1].hp).toBeGreaterThan(5);
  });

  it('已灭亡学校的本部不会被攻陷', () => {
    const g = blankGame(1, 4, R);
    g.player[2].exist = false;
    const a = g.area[baseArea(g, 2)];
    place(g, 0, 0, a.bx * 4, a.by * 4);
    sitFor(g, 0, 700);
    expect(a.fallen).toBe(false);
  });
});

describe('众矢之的', () => {
  it('只剩两所学校时不再有领先者', () => {
    const g = blankGame(1, 4, R);
    g.player[0].people_cnt = 9;
    g.player[2].people_cnt = 1;
    g.player[1].exist = g.player[3].exist = false;
    g.player[1].people_cnt = g.player[3].people_cnt = 0;
    check_top(g);
    expect(g.top).toBe(-1);
  });

  it('本部已沦陷的学校不受保护', () => {
    const g = blankGame(1, 4, R);
    g.player[0].people_cnt = 9;
    for (const c of [1, 2, 3]) g.player[c].people_cnt = 1;
    check_top(g);
    expect(g.top).toBe(0);
    place(g, 0, 2, 30, 30);
    place(g, 1, 3, 33, 30);
    start_sit(g, 0);
    expect(g.people[0].stat).toBe(PS.SIT);
    g.area[baseArea(g, 3)].fallen = true;
    start_sit(g, 0);
    expect(g.people[0].target_pn).toBe(1);
  });
});

describe('增援与占领进度', () => {
  it('人满时增援进度停在满格，一有空位立即补上', () => {
    const g = blankGame(1, 4, R);
    const pl = g.player[0];
    for (let i = 0; i < 12; i++) place(g, i, 0, 20 + i, 20);
    for (let t = 0; t < 2000; t++) check_add_people(g);
    expect(pl.people_cnt).toBe(12);
    expect(pl.appear_cnt).toBe(SPEC_APPEAR[0] + 1);
    pl.people_cnt = 11;
    g.people[11].stat = PS.EMPTY;
    g.smap[20 * SSIZE + 31] = -1;
    check_add_people(g);
    expect(pl.people_cnt).toBe(12);
    expect(pl.appear_cnt).toBeLessThan(SPEC_APPEAR[0]);
  });

  it('5 秒没人推进后，占领进度缓慢回退', () => {
    const g = blankGame(1, 4, R);
    const n = addArea(g, 7, 7, 2);
    place(g, 0, 0, 29, 29);
    sitFor(g, 0, 100);
    expect(g.area[n].val[0]).toBe(100);
    g.people[0].stat = PS.EMPTY;
    for (let t = 0; t < 5 * FPS; t++, g.tick++) decay_areas(g);
    expect(g.area[n].val[0]).toBe(100);
    for (let t = 0; t < 100; t++, g.tick++) decay_areas(g);
    expect(g.area[n].val[0]).toBeLessThan(100);
    expect(g.area[n].val[0]).toBeGreaterThan(40);
  });
});

describe('战斗手感', () => {
  it('自动迎战选最近的敌人，并优先打正在打我方的人', () => {
    const g = blankGame(1, 4, R);
    place(g, 0, 0, 30, 30);
    place(g, 1, 2, 38, 30);
    place(g, 2, 2, 30, 33);
    start_sit(g, 0);
    expect(g.people[0].target_pn).toBe(2);

    const h = blankGame(1, 4, R);
    place(h, 0, 0, 30, 30);
    place(h, 1, 2, 30, 34);
    place(h, 2, 2, 30, 32);
    h.people[1].stat = PS.FIGHT;
    h.people[1].target_pn = 0;
    start_sit(h, 0);
    expect(h.people[0].target_pn).toBe(1);
  });

  it('走动中也会被打中；执行指令的人不回头，空闲的人走完一步就还手', () => {
    for (const ordered of [true, false]) {
      let hitWhileWalking = false;
      let turned = false;
      for (let seed = 1; seed <= 20 && !hitWhileWalking; seed++) {
        const g = blankGame(seed, 4, R);
        place(g, 0, 3, 30, 30);
        place(g, 1, 0, 31, 30);
        g.people[0].hp = g.people[0].mhp = 1e6;
        // 单位 1 沿 y 方向远离，单位 0 原地出拳
        start_walk(g, 0, 0, 0, 1);
        if (ordered) applyCommand(g, { type: 'order', col: 0, units: [1], bx: 7, by: 15, target: -1 });
        else start_walk(g, 1, 7, 15, -1);
        for (let t = 0; t < 40; t++) {
          const hp = g.people[1].hp;
          const walking = g.people[1].stat === PS.WALK;
          people_action(g);
          if (walking && g.people[1].hp < hp) hitWhileWalking = true;
          if (g.people[1].target_pn === 0) turned = true;
        }
      }
      expect(hitWhileWalking).toBe(true);
      expect(turned).toBe(!ordered);
    }
  });

  it('自动追击离开原位 12 格就放弃，回到原位', () => {
    const g = blankGame(1, 4, R);
    place(g, 0, 0, 20, 20);
    place(g, 1, 2, 25, 20);
    start_sit(g, 0);
    expect(g.people[0].target_pn).toBe(1);
    // 让目标一直往远处跑
    applyCommand(g, { type: 'order', col: 2, units: [1], bx: 15, by: 5, target: -1 });
    let gaveUp = false;
    for (let t = 0; t < 600; t++) {
      people_action(g);
      const p = g.people[0];
      expect(Math.abs(p.cx - 20) + Math.abs(p.cy - 20)).toBeLessThanOrEqual(13);
      if (p.target_pn < 0 && p.stat === PS.WALK) gaveUp = true;
    }
    expect(gaveUp).toBe(true);
    expect([g.people[0].cx, g.people[0].cy]).toEqual([20, 20]);
  });

  it('玩家的攻击指令不受追击距离限制', () => {
    const g = blankGame(1, 0, R);
    place(g, 0, 0, 20, 20);
    place(g, 1, 2, 22, 20);
    applyCommand(g, { type: 'order', units: [0], bx: 0, by: 0, target: 1 });
    applyCommand(g, { type: 'order', col: 2, units: [1], bx: 15, by: 5, target: -1 });
    for (let t = 0; t < 400; t++) people_action(g);
    const p = g.people[0];
    expect(Math.abs(p.cx - 20) + Math.abs(p.cy - 20)).toBeGreaterThan(20);
  });

  it('倒地立即让出格子；击倒对手回复 30% 生命、上限 +2', () => {
    const g = blankGame(5, 4, R);
    place(g, 0, 3, 30, 30);
    place(g, 1, 1, 31, 30);
    g.people[1].hp = 1;
    g.people[0].hp = 10;
    start_walk(g, 0, 0, 0, 1);
    for (let t = 0; t < 200 && g.people[1].stat !== PS.DEAD; t++) people_action(g);
    expect(g.people[1].stat).toBe(PS.DEAD);
    expect(g.smap[30 * SSIZE + 31]).toBe(-1);
    expect(g.people[0].mhp).toBe(17);
    expect(g.people[0].hp).toBeCloseTo(10 + 0.3 * 17);
    expect(g.people[0].lev).toBe(1);
    expect(checkInvariants(g)).toEqual([]);
  });

  it('挥空时发出 miss 事件', () => {
    const g = blankGame(3, 4, R);
    place(g, 0, 2, 30, 30);
    place(g, 1, 0, 31, 30);
    g.people[0].hp = g.people[0].mhp = 1e6;
    g.people[1].hp = g.people[1].mhp = 1e6;
    start_walk(g, 0, 0, 0, 1);
    let miss = 0;
    for (let t = 0; t < 300; t++) {
      g.events = [];
      people_action(g);
      miss += g.events.filter((e) => e.kind === 'miss').length;
    }
    expect(miss).toBeGreaterThan(5);
  });
});

describe('集结点', () => {
  it('新兵自动前往集结点', () => {
    const g = blankGame(1, 0, R);
    applyCommand(g, { type: 'rally', bx: 8, by: 8 });
    g.player[0].appear_cnt = SPEC_APPEAR[0];
    check_add_people(g);
    const p = g.people.find((q) => q.stat !== PS.EMPTY)!;
    expect(p.stat).toBe(PS.WALK);
    for (let t = 0; t < 2000; t++) people_action(g);
    expect(Math.floor(p.cx / 4)).toBe(8);
    expect(Math.floor(p.cy / 4)).toBe(8);
  });
});

describe('整局（新规则）', () => {
  it('40 局 × 4000 帧，不变量始终成立', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame({ seed, userCol: 4, rules: seed % 2 ? R : { ruleset: 'remake', ai: ['hard', 'normal', 'easy', 'classic'] } });
      for (let t = 0; t < 4000; t++) {
        step(g);
        const errs = checkInvariants(g);
        if (errs.length) throw new Error(`seed ${seed} tick ${g.tick}: ${errs.join('; ')}`);
      }
    }
  });

  it('存档 → 读档后走向完全一致', () => {
    const a = createGame({ seed: 9, userCol: 1, rules: { ruleset: 'remake', ai: ['hard', 'normal', 'easy', 'normal'] } });
    for (let t = 0; t < 2000; t++) step(a);
    const b = deserializeGame(serializeGame(a));
    for (let t = 0; t < 3000; t++) {
      step(a);
      step(b);
    }
    expect(hashGame(b)).toBe(hashGame(a));
  });

  it('v1 存档读入后按经典规则继续', () => {
    const a = createGame({ seed: 4, userCol: 0 });
    for (let t = 0; t < 500; t++) step(a);
    const v2 = JSON.parse(serializeGame(a));
    const game = v2.game;
    delete game.rules;
    delete game.next_uid;
    delete game.groups;
    for (const p of game.people) for (const k of ['uid', 'ordered', 'leash', 'anchor_x', 'anchor_y', 'retaliate', 'task', 'task_area']) delete p[k];
    for (const ar of game.area) for (const k of ['touch', 'fallen', 'holder']) delete ar[k];
    for (const pl of game.player) for (const k of ['rally_bx', 'rally_by']) delete pl[k];
    game.rules = { ai: 'classic' };
    const b = deserializeGame(JSON.stringify({ v: 1, game }));
    expect(b.rules.ruleset).toBe('classic');
    for (let t = 0; t < 1000; t++) {
      step(a);
      step(b);
    }
    expect(b.people.map((p) => [p.stat, p.cx, p.cy, p.hp])).toEqual(a.people.map((p) => [p.stat, p.cx, p.cy, p.hp]));
  });
});
