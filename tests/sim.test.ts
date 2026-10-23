// 整局模拟：不变量、确定性、存读档、单挑统计
import { describe, expect, it } from 'vitest';
import { PS } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { deserializeGame, hashGame, serializeGame } from '../src/core/save.ts';
import { step } from '../src/core/sim.ts';
import { people_action, start_walk } from '../src/core/unit.ts';
import { blankGame, checkInvariants, place } from './helpers.ts';

describe('整局不变量（四 AI 观战局）', () => {
  it('60 局 × 4000 帧，每帧占格表、计数、血量都一致', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = createGame({ seed, userCol: 4 });
      for (let t = 0; t < 4000; t++) {
        step(g);
        const errs = checkInvariants(g);
        if (errs.length) throw new Error(`seed ${seed} tick ${g.tick}: ${errs.join('; ')}`);
      }
    }
  });
});

describe('确定性与存读档', () => {
  it('相同种子跑出完全相同的结果', () => {
    const a = createGame({ seed: 123, userCol: 4 });
    const b = createGame({ seed: 123, userCol: 4 });
    for (let t = 0; t < 3000; t++) {
      step(a);
      step(b);
    }
    expect(hashGame(a)).toBe(hashGame(b));
  });

  it('存档 → 读档后继续跑，与不读档的走向完全一致（含 NaN 字段）', () => {
    const a = createGame({ seed: 77, userCol: 2 });
    for (let t = 0; t < 600; t++) step(a);
    const text = serializeGame(a);
    expect(text).toContain('__NaN__');
    const b = deserializeGame(text);
    expect(hashGame(b)).toBe(hashGame(a));
    for (let t = 0; t < 3000; t++) {
      step(a);
      step(b);
    }
    expect(hashGame(b)).toBe(hashGame(a));
  });

  it('拒绝无效或更新版本的存档', () => {
    expect(() => deserializeGame('{"x":1}')).toThrow();
    expect(() => deserializeGame('{"v":999,"game":{}}')).toThrow();
  });
});

describe('1v1 单挑统计（与考证文档第 6 节对照）', () => {
  // 槽位 0 先手，双方同时进入战斗
  function duel(a: number, b: number, seed: number): { win: boolean; ticks: number } {
    const g = blankGame(seed);
    place(g, 0, a, 30, 30);
    place(g, 1, b, 31, 30);
    start_walk(g, 0, 0, 0, 1);
    for (let t = 1; t < 20000; t++) {
      people_action(g);
      if (g.people[1].stat === PS.DEAD) return { win: true, ticks: t };
      if (g.people[0].stat === PS.DEAD) return { win: false, ticks: t };
    }
    throw new Error('单挑没有结束');
  }

  function stats(a: number, b: number, n = 3000) {
    let w = 0;
    let t = 0;
    for (let s = 1; s <= n; s++) {
      const r = duel(a, b, s * 7919);
      if (r.win) w++;
      t += r.ticks;
    }
    return { rate: w / n, sec: t / n / 18 };
  }

  it('黑 vs 紫 ≈ 55%，约 5.3 秒', () => {
    const s = stats(0, 3);
    expect(s.rate).toBeGreaterThan(0.51);
    expect(s.rate).toBeLessThan(0.6);
    expect(s.sec).toBeGreaterThan(4.9);
    expect(s.sec).toBeLessThan(5.7);
  });

  it('绿方单挑几乎必败', () => {
    expect(stats(1, 0, 1000).rate).toBeLessThan(0.02);
    expect(stats(2, 1, 1000).rate).toBeGreaterThan(0.98);
  });

  it('黄 vs 黄 ≈ 53%，约 13.6 秒', () => {
    const s = stats(2, 2);
    expect(s.rate).toBeGreaterThan(0.49);
    expect(s.rate).toBeLessThan(0.58);
    expect(s.sec).toBeGreaterThan(12.8);
    expect(s.sec).toBeLessThan(14.4);
  });
});
