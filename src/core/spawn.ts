// 刷兵 ← 862/f2:1-118
import { AREA, PEOPLE_CAP, PMAX, PS, SPEC_APPEAR, SPEC_HP, SPEC_PUNCH, SSIZE } from './constants.ts';
import { random } from './rng.ts';
import type { Game } from './types.ts';

// 862/f2:1
export function appear_people(g: Game, pn: number, cx: number, cy: number, col: number): void {
  const p = g.people[pn];
  g.smap[cy * SSIZE + cx] = pn;
  p.stat = PS.STAND;
  p.cx = cx;
  p.cy = cy;
  p.cnt = 10 + random(g.rng) * 20;
  p.dir = Math.floor(random(g.rng) * 4);
  p.hp = p.mhp = SPEC_HP[col];
  p.punch = SPEC_PUNCH[col];
  p.lev = 0;
  p.col = col;
  p.px = cx * 12 - cy * 12;
  p.py = cy * 6 + cx * 6;
  // 原版显示第 col*100 + 11 + dir*25 帧，即站立姿势；pat 本身不重置
  p.show = 10;
  // 注意：fs、target_pn、hc、donothing 等字段沿用槽位上一任主人的值，与原版一致
  g.player[col].people_cnt++;
  g.events.push({ kind: 'appear', pn, col });
}

// 862/f2:28
export function add_people(g: Game, col: number): void {
  if (!g.player[col].exist) return;
  if (g.player[col].people_cnt >= PEOPLE_CAP) return;
  let slot = -1;
  for (let i = 0; i < PMAX; i++) {
    if (g.people[i].stat === PS.EMPTY) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return;
  const bx = g.player[col].basex;
  const by = g.player[col].basey;
  const free: { cx: number; cy: number }[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = bx * 4 + j;
      const cy = by * 4 + i;
      if (g.smap[cy * SSIZE + cx] < 0) free.push({ cx, cy });
    }
  }
  if (free.length === 0) return;
  const r = Math.floor(random(g.rng) * free.length);
  appear_people(g, slot, free[r].cx, free[r].cy, col);
}

// 862/f2:87
export function check_add_people(g: Game): void {
  for (const a of g.area) {
    if (a.areatype === AREA.SPADE && a.col >= 0) {
      g.player[a.col].appear_cnt++;
    }
  }
  for (let i = 0; i < 4; i++) {
    const pl = g.player[i];
    if (pl.exist) {
      pl.appear_cnt += 2;
      if (pl.appear_cnt > SPEC_APPEAR[i]) {
        pl.appear_cnt -= SPEC_APPEAR[i];
        add_people(g, i);
      }
    }
  }
}

/** 距离下一个新兵还需多少帧（界面提示用，不影响规则） */
export function ticksToNextSpawn(g: Game, col: number): number {
  const pl = g.player[col];
  let spades = 0;
  for (const a of g.area) if (a.areatype === AREA.SPADE && a.col === col) spades++;
  const need = SPEC_APPEAR[col] - pl.appear_cnt;
  return Math.max(0, Math.floor(need / (2 + spades)) + 1);
}
