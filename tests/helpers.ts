import { BSIZE, PMAX, SSIZE, mappat } from '../src/core/constants.ts';
import { createGame, emptyPerson, newArea } from '../src/core/mapgen.ts';
import { appear_people } from '../src/core/spawn.ts';
import type { Game, Rules } from '../src/core/types.ts';

/** 只保留四个本部、没有任何单位和特殊地块的对局，用来搭建可控场景 */
export function blankGame(seed = 1, userCol = 4, rules?: Rules): Game {
  const g = createGame({ seed, userCol, rules });
  for (let i = 0; i < BSIZE * BSIZE; i++) {
    if (mappat(g.bmap_pat[i]).areatype !== 1) g.bmap_pat[i] = 0;
  }
  g.area = [];
  g.bmap_n.fill(-1);
  for (let i = 0; i < BSIZE; i++) {
    for (let j = 0; j < BSIZE; j++) {
      const p = g.bmap_pat[i * BSIZE + j];
      if (p) {
        const mp = mappat(p);
        g.bmap_n[i * BSIZE + j] = g.area.length;
        g.area.push(newArea(j, i, mp.areatype, mp.col));
      }
    }
  }
  g.people = Array.from({ length: PMAX }, emptyPerson);
  g.smap.fill(-1);
  for (const pl of g.player) {
    pl.people_cnt = 0;
    pl.appear_cnt = 0;
  }
  g.events = [];
  return g;
}

/** 在大格 (bx, by) 放置一个特殊地块，返回地块号 */
export function addArea(g: Game, bx: number, by: number, areatype: 2 | 3, col = -1): number {
  const n = g.area.length;
  g.area.push(newArea(bx, by, areatype, col));
  g.bmap_n[by * BSIZE + bx] = n;
  g.bmap_pat[by * BSIZE + bx] = (areatype - 1) * 5 + col + 1;
  return n;
}

/** 在指定槽位、指定小格放一个单位（走原版 appear_people） */
export function place(g: Game, pn: number, col: number, cx: number, cy: number): void {
  appear_people(g, pn, cx, cy, col);
}

/** 检查模拟的一致性，返回发现的问题 */
export function checkInvariants(g: Game): string[] {
  const errs: string[] = [];
  const counts = [0, 0, 0, 0];
  let occupied = 0;
  let held = 0;
  const remake = g.rules.ruleset === 'remake';
  for (let pn = 0; pn < PMAX; pn++) {
    const p = g.people[pn];
    if (p.stat === 0) continue;
    counts[p.col]++;
    // "校园战争"规则下倒地的单位立即让出格子
    const holdsCell = !(remake && p.stat === 1);
    if (holdsCell) held++;
    if (p.cx < 0 || p.cx >= SSIZE || p.cy < 0 || p.cy >= SSIZE) errs.push(`#${pn} 越界`);
    else if (holdsCell && g.smap[p.cy * SSIZE + p.cx] !== pn) errs.push(`#${pn} 不在占格表中`);
    if (p.stat > 1 && p.hp > p.mhp + 1e-9) errs.push(`#${pn} hp>mhp`);
    if (p.stat >= 3 && p.stat <= 5) {
      if (p.px !== p.cx * 12 - p.cy * 12 || p.py !== p.cy * 6 + p.cx * 6) errs.push(`#${pn} 画面位置偏离`);
    }
  }
  for (const v of g.smap) if (v >= 0) occupied++;
  if (occupied !== held) errs.push(`占格数 ${occupied} ≠ 单位数 ${held}`);
  for (let c = 0; c < 4; c++) {
    if (counts[c] !== g.player[c].people_cnt) errs.push(`阵营 ${c} 计数不一致`);
    if (counts[c] > 12) errs.push(`阵营 ${c} 超过 12 人`);
    if (!g.player[c].exist && counts[c] > 0) errs.push(`阵营 ${c} 已淘汰却还有单位`);
  }
  return errs;
}
