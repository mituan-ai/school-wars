// 下课铃（docs/06 §5，仅"校园战争"规则）：定时在地图中部开一个"小卖部"大格，
// 开着的时候，只有一所学校的人站在上面，这所学校就按人数（最多 3 人）每帧加经验。
import { BELL_CREW, BELL_EVERY, BELL_EXP, BELL_OPEN, BSIZE, PS } from './constants.ts';
import { addExp } from './growth.ts';
import { random } from './rng.ts';
import type { Game } from './types.ts';

export function bellTick(g: Game): void {
  const b = g.bell;
  if (b.bx < 0) {
    if (g.tick < b.next) return;
    // 中部 8×8 里的空白格，四邻也不能是营地 / 泉水（免得和占领混在一起）
    const cand: number[] = [];
    for (let y = 4; y < BSIZE - 4; y++) {
      for (let x = 4; x < BSIZE - 4; x++) {
        if (g.bmap_n[y * BSIZE + x] >= 0) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.bmap_n[(y + dy) * BSIZE + x + dx] >= 0)) continue;
        cand.push(y * BSIZE + x);
      }
    }
    if (cand.length === 0) {
      b.next = g.tick + BELL_EVERY;
      return;
    }
    const t = cand[Math.floor(random(g.rng) * cand.length)];
    b.bx = t % BSIZE;
    b.by = Math.floor(t / BSIZE);
    b.until = g.tick + BELL_OPEN;
    b.gain = [0, 0, 0, 0];
    g.events.push({ kind: 'bell', bx: b.bx, by: b.by });
    return;
  }
  const n = [0, 0, 0, 0];
  for (const p of g.people) {
    if (p.stat <= PS.DEAD || p.cx >> 2 !== b.bx || p.cy >> 2 !== b.by) continue;
    n[p.col]++;
  }
  const sides = n.filter((v) => v > 0).length;
  if (sides === 1) {
    const col = n.findIndex((v) => v > 0);
    const gain = Math.min(BELL_CREW, n[col]) * BELL_EXP;
    b.gain[col] += gain;
    addExp(g, col, gain);
  }
  if (g.tick >= b.until) {
    let best = -1;
    for (let c = 0; c < 4; c++) if (b.gain[c] > 0 && (best < 0 || b.gain[c] > b.gain[best])) best = c;
    g.events.push({ kind: 'bellend', col: best });
    b.bx = -1;
    b.by = -1;
    b.next = g.tick + BELL_EVERY - BELL_OPEN;
  }
}
