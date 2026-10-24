// 战争迷雾的视野（docs/06 §6）：哪些小格此刻能看见。只依赖对局状态，电脑和画面用同一套。
// 学生看得见周围 SIGHT_UNIT 格，本部 SIGHT_BASE 格，己方地盘（营地、泉水、涂过的格子）看得见自己和周围一格。
import { BSIZE, PS, SIGHT_BASE, SIGHT_UNIT, SSIZE } from './constants.ts';
import { tileOwner } from './territory.ts';
import type { Game } from './types.ts';

function square(v: Uint8Array, cx: number, cy: number, r: number): void {
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(SSIZE - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(SSIZE - 1, cy + r);
  for (let y = y0; y <= y1; y++) v.fill(1, y * SSIZE + x0, y * SSIZE + x1 + 1);
}

/** col 此刻看得见的小格（1 可见） */
export function vision(g: Game, col: number, out = new Uint8Array(SSIZE * SSIZE)): Uint8Array {
  out.fill(0);
  for (const p of g.people) if (p.stat > PS.DEAD && p.col === col) square(out, p.cx, p.cy, SIGHT_UNIT);
  const pl = g.player[col];
  if (pl.exist) square(out, pl.basex * 4 + 1, pl.basey * 4 + 1, SIGHT_BASE);
  for (let t = 0; t < BSIZE * BSIZE; t++) {
    if (tileOwner(g, t) !== col) continue;
    const bx = t % BSIZE;
    const by = (t - bx) / BSIZE;
    // 大格中心向外 3 格：盖住这一格和外面一圈小格
    square(out, bx * 4 + 1, by * 4 + 1, 3);
    square(out, bx * 4 + 2, by * 4 + 2, 3);
  }
  return out;
}

export function fogOn(g: Game): boolean {
  return g.rules.ruleset === 'remake' && !!g.rules.fog;
}
