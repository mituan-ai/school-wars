// 把 docs/01_原版机制考证.md 中的【确认】条目逐条写成断言
import { describe, expect, it } from 'vitest';
import { BSIZE, PS, SSIZE, mappat } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { check_add_people } from '../src/core/spawn.ts';
import { check_top, people_action, start_sit, start_walk } from '../src/core/unit.ts';
import { com_orders } from '../src/core/ai-classic.ts';
import { step } from '../src/core/sim.ts';
import { addArea, blankGame, place } from './helpers.ts';

describe('地图生成（862/f1）', () => {
  it('四个本部在四角，各阵营恰好一个，开局各 3 人', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = createGame({ seed, userCol: 0 });
      const corners = [0, BSIZE - 1, (BSIZE - 1) * BSIZE, BSIZE * BSIZE - 1];
      const cols = corners.map((i) => mappat(g.bmap_pat[i])).map((m) => (m.areatype === 1 ? m.col : -1));
      expect([...cols].sort()).toEqual([0, 1, 2, 3]);
      for (const pl of g.player) expect(pl.people_cnt).toBe(3);
    }
  });

  it('特殊地块互不相邻，也不贴着本部', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const g = createGame({ seed, userCol: 0 });
      for (const a of g.area) {
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          const nx = a.bx + dx;
          const ny = a.by + dy;
          if (nx < 0 || ny < 0 || nx >= BSIZE || ny >= BSIZE) continue;
          if (a.areatype !== 1) expect(g.bmap_pat[ny * BSIZE + nx]).toBe(0);
        }
      }
    }
  });

  it('特殊地块数量分布：平均约 20 块，♠ 约占 2/3', () => {
    let total = 0;
    let spade = 0;
    const n = 2000;
    for (let seed = 1; seed <= n; seed++) {
      const g = createGame({ seed, userCol: 0 });
      for (const a of g.area) {
        if (a.areatype === 2) spade++;
        if (a.areatype >= 2) total++;
      }
    }
    expect(total / n).toBeGreaterThan(19.5);
    expect(total / n).toBeLessThan(20.7);
    expect(spade / total).toBeGreaterThan(0.63);
    expect(spade / total).toBeLessThan(0.7);
  });

  it('相同种子生成完全相同的对局', () => {
    const a = createGame({ seed: 42, userCol: 1 });
    const b = createGame({ seed: 42, userCol: 1 });
    expect(a).toEqual(b);
  });
});

describe('刷兵（862/f2）', () => {
  function spawnTicks(g: ReturnType<typeof blankGame>, col: number, n: number): number[] {
    const ticks: number[] = [];
    for (let t = 1; ticks.length < n && t < 10000; t++) {
      const before = g.player[col].people_cnt;
      check_add_people(g);
      if (g.player[col].people_cnt > before) ticks.push(t);
    }
    return ticks;
  }

  it('无 ♠ 时：绿方第 251 帧刷出第一人，之后每 250 帧一人；其他阵营 750 帧', () => {
    expect(spawnTicks(blankGame(), 1, 3)).toEqual([251, 501, 751]);
    expect(spawnTicks(blankGame(), 0, 2)).toEqual([751, 1501]);
  });

  it('每持有一个 ♠，每帧刷兵计数多 +1；♥ 不加速', () => {
    const g = blankGame();
    addArea(g, 5, 5, 2, 0);
    addArea(g, 7, 7, 2, 0);
    addArea(g, 9, 9, 2, 0);
    addArea(g, 3, 9, 3, 0);
    // 每帧 +5，超过 1500 需要 301 帧
    expect(spawnTicks(g, 0, 1)).toEqual([301]);
  });

  it('人满 12 人时计数照扣，这次刷兵机会作废', () => {
    const g = blankGame();
    g.player[1].people_cnt = 12;
    for (let t = 0; t < 251; t++) check_add_people(g);
    expect(g.player[1].appear_cnt).toBe(2);
    expect(g.people.every((p) => p.stat === 0)).toBe(true);
  });

  it('新兵出现在本部大格内', () => {
    const g = createGame({ seed: 7, userCol: 0 });
    for (const p of g.people.filter((q) => q.stat)) {
      const pl = g.player[p.col];
      expect(Math.floor(p.cx / 4)).toBe(pl.basex);
      expect(Math.floor(p.cy / 4)).toBe(pl.basey);
      expect(p.stat).toBe(PS.STAND);
    }
  });
});

describe('占领与回血（862/f3:108）', () => {
  it('1 人坐在中立 ♠ 上，恰好第 300 帧坐下时占领', () => {
    const g = blankGame();
    const n = addArea(g, 6, 6, 2);
    place(g, 0, 1, 25, 25);
    start_sit(g, 0);
    expect(g.people[0].stat).toBe(PS.SIT);
    for (let t = 0; t < 299; t++) people_action(g);
    expect(g.area[n].col).toBe(-1);
    people_action(g);
    expect(g.area[n].col).toBe(1);
  });

  it('2 人同时坐，150 帧占领；占领后清零其他阵营进度', () => {
    const g = blankGame();
    const n = addArea(g, 6, 6, 2);
    g.area[n].val[3] = 120;
    place(g, 0, 2, 25, 25);
    place(g, 1, 2, 26, 25);
    start_sit(g, 0);
    start_sit(g, 1);
    for (let t = 0; t < 149; t++) people_action(g);
    expect(g.area[n].col).toBe(-1);
    people_action(g);
    expect(g.area[n].col).toBe(2);
    expect(g.area[n].val[3]).toBe(0);
  });

  it('本部不能被占领', () => {
    const g = blankGame();
    const base = g.player[0];
    const n = g.bmap_n[base.basey * BSIZE + base.basex];
    place(g, 0, 2, base.basex * 4 + 1, base.basey * 4 + 1);
    g.player[0].exist = false; // 避免索敌干扰
    start_sit(g, 0);
    for (let t = 0; t < 1000; t++) people_action(g);
    expect(g.area[n].col).toBe(0);
  });

  it('坐在己方 ♥ 上每帧回 0.1 生命，不超过上限', () => {
    const g = blankGame();
    addArea(g, 6, 6, 3, 0);
    place(g, 0, 0, 25, 25);
    g.people[0].hp = 10;
    start_sit(g, 0);
    for (let t = 0; t < 20; t++) people_action(g);
    expect(g.people[0].hp).toBeCloseTo(12, 5);
    for (let t = 0; t < 200; t++) people_action(g);
    expect(g.people[0].hp).toBe(20);
  });

  it('坐在别人的 ♥ 上不回血', () => {
    const g = blankGame();
    addArea(g, 6, 6, 3, 2);
    place(g, 0, 0, 25, 25);
    g.people[0].hp = 10;
    start_sit(g, 0);
    for (let t = 0; t < 50; t++) people_action(g);
    expect(g.people[0].hp).toBe(10);
  });
});

describe('索敌与战斗（862/f3）', () => {
  it('曼哈顿距离 10 以内的敌人会被自动锁定，11 则不会', () => {
    const g = blankGame();
    place(g, 0, 0, 20, 20);
    place(g, 1, 2, 25, 25);
    start_sit(g, 0);
    expect(g.people[0].target_pn).toBe(1);
    const h = blankGame();
    place(h, 0, 0, 20, 20);
    place(h, 1, 2, 26, 25);
    start_sit(h, 0);
    expect(h.people[0].stat).toBe(PS.SIT);
  });

  it('出拳循环 15 帧；被打中后 9–10 帧才能再出拳', () => {
    const g = blankGame(3);
    place(g, 0, 2, 30, 30);
    place(g, 1, 0, 31, 30);
    g.people[0].hp = g.people[0].mhp = 1e6;
    g.people[1].hp = g.people[1].mhp = 1e6;
    start_walk(g, 0, 0, 0, 1);
    expect(g.people[0].stat).toBe(PS.FIGHT);
    expect(g.people[1].stat).toBe(PS.FIGHT);
    const strikes: number[][] = [[], []];
    const hits: number[][] = [[], []];
    for (let t = 1; t <= 3000; t++) {
      const before = [g.people[0].hp, g.people[1].hp];
      const prevShow = [g.people[0].show, g.people[1].show];
      people_action(g);
      for (const i of [0, 1]) {
        if (g.people[i].show === 19 && prevShow[i] !== 19) strikes[i].push(t);
        if (g.people[i].hp < before[i]) hits[i].push(t);
      }
    }
    let clean = 0;
    for (const i of [0, 1]) {
      for (let k = 1; k < strikes[i].length; k++) {
        const a = strikes[i][k - 1];
        const b = strikes[i][k];
        const lastHit = hits[i].filter((h) => h >= a && h < b).pop();
        if (lastHit === undefined) {
          expect(b - a).toBe(15);
          clean++;
        } else {
          expect([9, 10]).toContain(b - lastHit);
        }
      }
    }
    expect(clean).toBeGreaterThan(20);
    // 命中率 50%
    const totalStrikes = strikes[0].length + strikes[1].length;
    const totalHits = hits[0].length + hits[1].length;
    expect(totalHits / totalStrikes).toBeGreaterThan(0.45);
    expect(totalHits / totalStrikes).toBeLessThan(0.55);
  });

  it('击杀后最大生命 +1，当前生命和攻击力不变；尸体约 29 帧后消失并释放占格', () => {
    const g = blankGame(5);
    place(g, 0, 3, 30, 30);
    place(g, 1, 1, 31, 30);
    g.people[1].hp = 1;
    g.people[0].hp = g.people[0].mhp = 1e6;
    const hp0 = g.people[0].hp;
    start_walk(g, 0, 0, 0, 1);
    let deadAt = -1;
    let goneAt = -1;
    for (let t = 1; t < 500 && goneAt < 0; t++) {
      people_action(g);
      if (deadAt < 0 && g.people[1].stat === PS.DEAD) deadAt = t;
      if (deadAt > 0 && g.people[1].stat === PS.EMPTY) goneAt = t;
    }
    expect(g.people[0].mhp).toBe(1e6 + 1);
    expect(g.people[0].hp).toBe(hp0);
    expect(g.people[0].punch).toBe(5);
    expect(goneAt - deadAt).toBeGreaterThanOrEqual(26);
    expect(goneAt - deadAt).toBeLessThanOrEqual(30);
    expect(g.smap[30 * SSIZE + 31]).toBe(-1);
  });
});

describe('领先者 top（862/f3:644）', () => {
  it('得分超过总分 40% 即成为领先者；绿色得分减半', () => {
    const g = blankGame();
    g.player[0].people_cnt = 5;
    g.player[1].people_cnt = 2;
    g.player[2].people_cnt = 2;
    g.player[3].people_cnt = 2;
    check_top(g);
    expect(g.top).toBe(0); // 5 > 0.4 × 10

    g.player[0].people_cnt = 2;
    g.player[1].people_cnt = 10; // 计 5 分，5 > 0.4 × 11
    check_top(g);
    expect(g.top).toBe(1);

    g.player[1].people_cnt = 6; // 计 3 分，3 < 0.4 × 9
    check_top(g);
    expect(g.top).toBe(-1);
  });

  it('存在领先者时，电脑单位只锁定领先者，玩家单位不受限', () => {
    const g = blankGame(1, 0);
    place(g, 0, 2, 20, 20); // 电脑黄
    place(g, 1, 3, 22, 20); // 紫，不是领先者
    place(g, 2, 0, 20, 22); // 玩家黑
    g.top = 1;
    start_sit(g, 0);
    expect(g.people[0].stat).toBe(PS.SIT);
    g.top = 3;
    start_sit(g, 0);
    expect(g.people[0].target_pn).toBe(1);
    // 玩家单位：无视 top
    g.top = 1;
    start_sit(g, 2);
    expect([0, 1]).toContain(g.people[2].target_pn);
  });
});

describe('电脑 AI（862/f4）', () => {
  function sitter(donothing: number) {
    const g = blankGame(1, 0);
    addArea(g, 8, 8, 2);
    place(g, 0, 2, 30, 30); // 大格 (7,7)，离 (8,8) 的 ♠ 比离任何本部都近
    start_sit(g, 0);
    g.people[0].donothing = donothing;
    g.pn_com = PMAX_MINUS_1;
    com_orders(g);
    return g.people[0];
  }
  const PMAX_MINUS_1 = 47;

  it('累计坐下不足 400 帧不行动，满 400 帧才行动', () => {
    expect(sitter(399).stat).toBe(PS.SIT);
    expect(sitter(400).stat).toBe(PS.WALK);
  });

  it('从未站立过的新槽位（donothing 为 NaN）会立即行动 —— AS2 的 undefined++ 语义', () => {
    expect(sitter(NaN).stat).toBe(PS.WALK);
  });

  it('满血时去最近的非己方地块；受伤时回己方本部或 ♥', () => {
    const p = sitter(400);
    expect([Math.floor(p.dest_sx / 4), Math.floor(p.dest_sy / 4)]).toEqual([8, 8]);
    const g = blankGame(1, 0);
    addArea(g, 3, 3, 2);
    place(g, 0, 2, 10, 10);
    start_sit(g, 0);
    g.people[0].hp = 5;
    g.people[0].donothing = 400;
    g.pn_com = 47;
    com_orders(g);
    const base = g.player[2];
    expect([Math.floor(g.people[0].dest_sx / 4), Math.floor(g.people[0].dest_sy / 4)]).toEqual([base.basex, base.basey]);
  });
});

describe('玩家指令（862/f5）', () => {
  it('只对己方存活单位生效；点地面走向该大格内', () => {
    const g = blankGame(9, 0);
    place(g, 0, 0, 2, 2);
    place(g, 1, 2, 40, 40);
    step(g, [{ type: 'order', units: [0, 1], bx: 5, by: 3, target: -1 }]);
    expect(Math.floor(g.people[0].dest_sx / 4)).toBe(5);
    expect(Math.floor(g.people[0].dest_sy / 4)).toBe(3);
    expect(g.people[1].stat).not.toBe(PS.WALK);
  });
});
