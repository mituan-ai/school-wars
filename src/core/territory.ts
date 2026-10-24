// 地盘与补给线（docs/06 §1，仅"校园战争"规则）。
// 空白大格靠站人"涂"成自己的颜色；营地、泉水、本部仍按坐下占领。
// 从未沦陷的本部出发、经由己方格子四向连通的地盘才有补给：只有连上补给的营地加快增援、泉水回血、营地上坐着加经验。
import { ADDX, ADDY, AREA, BSIZE, PAINT_CREW, PAINT_ENEMY_MUL, PAINT_NEED, PS } from './constants.ts';
import type { Game } from './types.ts';

const TILES = BSIZE * BSIZE;

/** 大格 t 的归属：营地 / 泉水看占领者，本部沦陷后归攻陷者，空白格看涂色 */
export function tileOwner(g: Game, t: number): number {
  const n = g.bmap_n[t];
  if (n < 0) return g.terr[t];
  const a = g.area[n];
  if (a.areatype === AREA.BASE && a.fallen) return a.holder;
  return a.col;
}

const cache = new WeakMap<Game, { tick: number; mask: Uint8Array }>();

/**
 * 每个大格对哪些学校有补给（按位：1 << col）。每帧只算一次（取这一帧开始时的地盘），
 * 所以同一帧里先后发生的占领不会让结果依赖执行顺序。
 */
export function supplyMask(g: Game): Uint8Array {
  const hit = cache.get(g);
  if (hit && hit.tick === g.tick) return hit.mask;
  const mask = new Uint8Array(TILES);
  const owner = new Int8Array(TILES);
  for (let t = 0; t < TILES; t++) owner[t] = tileOwner(g, t);
  const queue: number[] = [];
  for (let col = 0; col < 4; col++) {
    const pl = g.player[col];
    if (!pl.exist) continue;
    const start = pl.basey * BSIZE + pl.basex;
    if (owner[start] !== col) continue;
    const bit = 1 << col;
    mask[start] |= bit;
    queue.length = 0;
    queue.push(start);
    while (queue.length) {
      const t = queue.pop()!;
      const x = t % BSIZE;
      const y = (t - x) / BSIZE;
      for (let d = 0; d < 4; d++) {
        const nx = x + ADDX[d];
        const ny = y + ADDY[d];
        if (nx < 0 || ny < 0 || nx >= BSIZE || ny >= BSIZE) continue;
        const nt = ny * BSIZE + nx;
        if (owner[nt] !== col || mask[nt] & bit) continue;
        mask[nt] |= bit;
        queue.push(nt);
      }
    }
  }
  cache.set(g, { tick: g.tick, mask });
  return mask;
}

export function supplied(g: Game, t: number, col: number): boolean {
  return (supplyMask(g)[t] & (1 << col)) !== 0;
}

/** 有补给的己方营地数（增援用） */
export function suppliedSpades(g: Game, col: number): number {
  const mask = supplyMask(g);
  let n = 0;
  for (const a of g.area) if (a.areatype === AREA.SPADE && a.col === col && mask[a.by * BSIZE + a.bx] & (1 << col)) n++;
  return n;
}

/** 有补给的己方空白地盘格数（经验用） */
export function suppliedLand(g: Game, col: number): number {
  const mask = supplyMask(g);
  let n = 0;
  for (let t = 0; t < TILES; t++) if (g.bmap_n[t] < 0 && g.terr[t] === col && mask[t] & (1 << col)) n++;
  return n;
}

const crew = new Int8Array(TILES * 4);

/** 涂地：只有一所学校的人站在某个空白格上时，进度按人数（最多 3 人）推进；无人时慢慢回退 */
export function paint(g: Game): void {
  crew.fill(0);
  for (const p of g.people) {
    if (p.stat <= PS.DEAD) continue;
    crew[((p.cy >> 2) * BSIZE + (p.cx >> 2)) * 4 + p.col]++;
  }
  for (let t = 0; t < TILES; t++) {
    if (g.bmap_n[t] >= 0) continue;
    const own = g.terr[t];
    // 出局的学校留下的地盘变回无主
    if (own >= 0 && !g.player[own].exist) g.terr[t] = -1;
    let col = -1;
    let sides = 0;
    for (let c = 0; c < 4; c++) {
      if (crew[t * 4 + c] > 0) {
        col = c;
        sides++;
      }
    }
    if (sides !== 1) {
      if (sides === 0 && g.paint_val[t] > 0) g.paint_val[t] = Math.max(0, g.paint_val[t] - 1);
      continue;
    }
    if (g.terr[t] === col) {
      g.paint_col[t] = -1;
      g.paint_val[t] = 0;
      continue;
    }
    if (g.paint_col[t] !== col) {
      g.paint_col[t] = col;
      g.paint_val[t] = 0;
    }
    g.paint_val[t] += Math.min(PAINT_CREW, crew[t * 4 + col]);
    const need = g.terr[t] < 0 ? PAINT_NEED : PAINT_NEED * PAINT_ENEMY_MUL;
    if (g.paint_val[t] >= need) {
      g.terr[t] = col;
      g.paint_col[t] = -1;
      g.paint_val[t] = 0;
      g.events.push({ kind: 'paint', bx: t % BSIZE, by: Math.floor(t / BSIZE), col });
    }
  }
}
