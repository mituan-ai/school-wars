// 电脑指挥官：只通过指令行动，撤退 / 防守 / 扩张 / 进攻的基本判断，以及锦标赛回归门槛
import { describe, expect, it } from 'vitest';
import { FPS } from '../src/core/constants.ts';
import { TASK, commander } from '../src/core/ai-commander.ts';
import { createGame } from '../src/core/mapgen.ts';
import { serializeGame } from '../src/core/save.ts';
import { step } from '../src/core/sim.ts';
import type { AiLevel, Game, OrderCommand, Rules } from '../src/core/types.ts';
import { addArea, blankGame, place } from './helpers.ts';

const rules = (level: AiLevel): Rules => ({ ruleset: 'remake', ai: [level, level, level, level] });

/** 推进到指挥官下一次下令为止（最多 3 秒） */
function decide(g: Game, col: number): OrderCommand[] {
  for (let i = 0; i < 3 * FPS; i++) {
    const cmds = commander(g, col);
    if (cmds.length) return cmds as OrderCommand[];
    g.tick++;
  }
  return [];
}

function stripTasks(g: Game): string {
  const s = JSON.parse(serializeGame(g));
  for (const p of s.game.people) {
    delete p.task;
    delete p.task_area;
  }
  return JSON.stringify(s);
}

describe('电脑指挥官', () => {
  it('只产出指令、只指挥自己的人，不直接改动对局状态', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const g = createGame({ seed, userCol: 4, rules: rules('hard') });
      for (let t = 0; t < 3000; t++) {
        for (let col = 0; col < 4; col++) {
          if ((g.tick + col * 4) % 9) continue;
          const before = stripTasks(g);
          const cmds = commander(g, col);
          expect(stripTasks(g)).toBe(before);
          for (const c of cmds) {
            expect(c.type).toBe('order');
            if (c.type !== 'order') continue;
            expect(c.col).toBe(col);
            for (const pn of c.units) expect(g.people[pn].col).toBe(col);
          }
        }
        step(g);
      }
    }
  });

  it('血少且寡不敌众时撤回最近的己方 ♥', () => {
    const g = blankGame(1, 4, rules('hard'));
    const heart = addArea(g, 6, 6, 3, 0);
    place(g, 0, 0, 30, 30);
    place(g, 1, 2, 32, 30);
    place(g, 2, 2, 30, 32);
    g.people[0].hp = 3;
    const cmds = decide(g, 0);
    const mine = cmds.find((c) => c.units.includes(0));
    expect(mine).toBeDefined();
    expect([mine!.bx, mine!.by]).toEqual([6, 6]);
    expect(g.people[0].task).toBe(TASK.RETREAT);
    expect(g.people[0].task_area).toBe(heart);
  });

  it('本部有敌人时派人回防', () => {
    const g = blankGame(1, 4, rules('normal'));
    const b = g.player[1];
    place(g, 0, 1, 30, 30);
    place(g, 1, 1, 31, 30);
    place(g, 2, 3, b.basex * 4 + 1, b.basey * 4 + 1);
    const cmds = decide(g, 1);
    const sent = cmds.filter((c) => c.bx === b.basex && c.by === b.basey).flatMap((c) => c.units);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('空闲时去占附近的中立 ♠', () => {
    const g = blankGame(1, 4, rules('hard'));
    const b = g.player[2];
    const tx = b.basex === 0 ? 2 : 13;
    const ty = b.basey === 0 ? 2 : 13;
    addArea(g, tx, ty, 2);
    place(g, 0, 2, b.basex * 4 + 1, b.basey * 4 + 1);
    place(g, 1, 2, b.basex * 4 + 2, b.basey * 4 + 2);
    const cmds = decide(g, 2);
    expect(cmds.some((c) => c.bx === tx && c.by === ty)).toBe(true);
  });
});

describe('锦标赛回归门槛', () => {
  // 两种 AI 各控制两所学校，统计胜者属于哪一方
  function versus(a: AiLevel, b: AiLevel, games: number): number {
    let wa = 0;
    let decided = 0;
    for (let seed = 1; seed <= games; seed++) {
      const ai = [0, 1, 2, 3].map((i) => ((i + (seed >> 1)) % 2 === seed % 2 ? a : b));
      const g = createGame({ seed, userCol: 4, rules: { ruleset: 'remake', ai } });
      while (g.tick < 40 * 60 * FPS && g.player.filter((p) => p.exist).length > 1) step(g);
      const alive = g.player.findIndex((p) => p.exist);
      if (g.player.filter((p) => p.exist).length === 1) {
        decided++;
        if (g.rules.ai[alive] === a) wa++;
      }
    }
    return wa / decided;
  }

  it('困难 AI 对原版 AI 胜率 > 75%', () => {
    expect(versus('hard', 'classic', 40)).toBeGreaterThan(0.75);
  });

  it('简单 < 普通 < 困难', () => {
    expect(versus('normal', 'easy', 40)).toBeGreaterThan(0.55);
    expect(versus('hard', 'normal', 40)).toBeGreaterThan(0.55);
  });

  it('四家普通 AI：40 分钟内基本都能分出胜负', () => {
    let late = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame({ seed, userCol: 4, rules: rules('normal') });
      while (g.tick < 40 * 60 * FPS && g.player.filter((p) => p.exist).length > 1) step(g);
      if (g.player.filter((p) => p.exist).length > 1) late++;
    }
    expect(late).toBeLessThanOrEqual(4);
  });
});

