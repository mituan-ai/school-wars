// 原版电脑 AI ← 862/f4（每帧只检查一个槽位）
import { AI_IDLE_TICKS, AREA, PMAX, PS } from './constants.ts';
import { random } from './rng.ts';
import { start_walk } from './unit.ts';
import type { Game } from './types.ts';

export function com_orders(g: Game): void {
  g.pn_com++;
  if (g.pn_com >= PMAX) g.pn_com = 0;
  const pn = g.pn_com;
  const p = g.people[pn];
  if (p.col === g.user_col) return;
  if (p.stat !== PS.SIT) return;
  // donothing 为 NaN（新槽位从未站立过）时比较结果为假，会立即行动 —— 与 AS2 语义一致
  if (p.donothing < AI_IDLE_TICKS) return;

  const col = p.col;
  const fullHp = p.hp === p.mhp;
  let best = 999;
  let tx = 0;
  let ty = 0;
  for (const a of g.area) {
    const acol = a.col;
    if (fullHp) {
      if (acol === col) continue;
      if (a.areatype === AREA.BASE && !g.player[acol].exist) continue;
      if (g.top >= 0 && col !== g.top && acol !== g.top) continue;
    } else if (acol !== col || a.areatype === AREA.SPADE) {
      continue;
    }
    const d = Math.abs(a.bx - p.bx) + Math.abs(a.by - p.by) + random(g.rng) * 4;
    if (best > d) {
      best = d;
      tx = a.bx;
      ty = a.by;
    }
  }
  if (best < 999) {
    start_walk(g, pn, tx, ty, -1);
    p.donothing = 0;
    return;
  }

  let target = -1;
  best = 999;
  for (let i = 0; i < PMAX; i++) {
    const o = g.people[i];
    if (o.stat <= PS.DEAD) continue;
    if (o.col === col) continue;
    if (g.top >= 0 && col !== g.top && o.col !== g.top) continue;
    const d = Math.abs(o.cx - p.cx) + Math.abs(o.cy - p.cy) + random(g.rng) * 4;
    if (best > d) {
      best = d;
      target = i;
    }
  }
  if (target >= 0) {
    start_walk(g, pn, 0, 0, target);
    p.donothing = 0;
  }
}
