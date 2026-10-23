// "校园战争"规则的寻路（docs/04 §2.1）。
// 每走一步前，从目的地反向做一次 A*（启发值为到起点的曼哈顿距离），再从起点的四个邻格里挑总代价最小的一步。
// 有人的格子不是墙，只是代价高：坐着、站着、打架的人能绕就绕；走动中的人马上会让开，代价低一些。
// 搜索用的数组是模块级的草稿区，不进存档；结果只取决于对局状态和对局内的随机数，所以仍是确定性的。
import { ADDX, ADDY, PS, SSIZE } from './constants.ts';
import { random } from './rng.ts';
import type { Game } from './types.ts';

/** 下一格暂时有人，应原地稍等再走 */
export const STEP_WAIT = -2;

const COST_FREE = 1;
const COST_WALKER = 3;
const COST_BLOCKER = 24;
/** 搜索展开的格子数上限（全图 4096 格）；超过就退回贪心 */
const MAX_EXPAND = 2500;

const N = SSIZE * SSIZE;
const dist = new Float64Array(N);
const seen = new Uint32Array(N);
const closed = new Uint32Array(N);
let stamp = 0;

const CAP = MAX_EXPAND * 4 + 8;
const heapCell = new Int32Array(CAP);
const heapKey = new Float64Array(CAP);
let heapLen = 0;

function push(cell: number, key: number): void {
  let i = heapLen++;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (heapKey[up] <= key) break;
    heapCell[i] = heapCell[up];
    heapKey[i] = heapKey[up];
    i = up;
  }
  heapCell[i] = cell;
  heapKey[i] = key;
}

function pop(): number {
  const top = heapCell[0];
  const cell = heapCell[--heapLen];
  const key = heapKey[heapLen];
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= heapLen) break;
    if (c + 1 < heapLen && heapKey[c + 1] < heapKey[c]) c++;
    if (heapKey[c] >= key) break;
    heapCell[i] = heapCell[c];
    heapKey[i] = heapKey[c];
    i = c;
  }
  heapCell[i] = cell;
  heapKey[i] = key;
  return top;
}

/** 走进一格的代价。patient：已经等过一次，走动中的人也按障碍计，免得两人迎面互等 */
function cost(g: Game, cell: number, patient: boolean): number {
  const o = g.smap[cell];
  if (o < 0) return COST_FREE;
  return g.people[o].stat === PS.WALK && !patient ? COST_WALKER : COST_BLOCKER;
}

/**
 * 单位 pn 从当前小格走向 (tx, ty) 的下一步方向。
 * 返回 0–3 为方向；-1 表示已经在目的地；STEP_WAIT 表示最好的下一格暂时有人。
 * 目的地格本身不计占用（追击时那里站着目标）。
 */
export function nextDir(g: Game, pn: number, tx: number, ty: number, patient: boolean): number {
  const p = g.people[pn];
  const sx = p.cx;
  const sy = p.cy;
  if (sx === tx && sy === ty) return -1;
  const start = sy * SSIZE + sx;
  const goal = ty * SSIZE + tx;
  stamp++;
  heapLen = 0;
  dist[goal] = 0;
  seen[goal] = stamp;
  push(goal, Math.abs(tx - sx) + Math.abs(ty - sy));
  let expanded = 0;
  while (heapLen > 0) {
    const u = pop();
    if (closed[u] === stamp) continue;
    closed[u] = stamp;
    if (u === start || ++expanded > MAX_EXPAND) break;
    const ux = u % SSIZE;
    const uy = (u - ux) / SSIZE;
    // 从邻格 v 走进 u 要付 u 的代价
    const nd = dist[u] + (u === goal ? COST_FREE : cost(g, u, patient));
    for (let d = 0; d < 4; d++) {
      const vx = ux + ADDX[d];
      const vy = uy + ADDY[d];
      if (vx < 0 || vx >= SSIZE || vy < 0 || vy >= SSIZE) continue;
      const v = vy * SSIZE + vx;
      if (closed[v] === stamp) continue;
      if (seen[v] === stamp && dist[v] <= nd) continue;
      seen[v] = stamp;
      dist[v] = nd;
      push(v, nd + Math.abs(vx - sx) + Math.abs(vy - sy));
    }
  }

  // 在起点的四个邻格里挑"走进去的代价 + 剩余距离"最小的；最优的格子都有人就原地等，并列的空格随机挑一个
  const val = [Infinity, Infinity, Infinity, Infinity];
  let best = Infinity;
  for (let d = 0; d < 4; d++) {
    const vx = sx + ADDX[d];
    const vy = sy + ADDY[d];
    if (vx < 0 || vx >= SSIZE || vy < 0 || vy >= SSIZE) continue;
    const v = vy * SSIZE + vx;
    if (seen[v] !== stamp) continue;
    val[d] = dist[v] + (v === goal ? COST_FREE : cost(g, v, patient));
    best = Math.min(best, val[d]);
  }
  if (best === Infinity) return greedy(g, sx, sy, tx, ty);
  const ties: number[] = [];
  for (let d = 0; d < 4; d++) {
    if (val[d] === best && g.smap[(sy + ADDY[d]) * SSIZE + sx + ADDX[d]] < 0) ties.push(d);
  }
  if (ties.length === 0) return STEP_WAIT;
  return ties.length === 1 ? ties[0] : ties[Math.floor(random(g.rng) * ties.length)];
}

/** 搜索被截断时的退路：不远离目标的空邻格 */
function greedy(g: Game, sx: number, sy: number, tx: number, ty: number): number {
  let best = -1;
  let bd = Infinity;
  for (let d = 0; d < 4; d++) {
    const vx = sx + ADDX[d];
    const vy = sy + ADDY[d];
    if (vx < 0 || vx >= SSIZE || vy < 0 || vy >= SSIZE || g.smap[vy * SSIZE + vx] >= 0) continue;
    const dd = Math.abs(tx - vx) + Math.abs(ty - vy);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best < 0 ? STEP_WAIT : best;
}

/**
 * 目的地被别人占着（不是走动中的人）时，换成离它最近的空格；距离相同的取离单位近的。
 * 找不到就返回 null。
 */
export function freeCellNear(g: Game, pn: number, tx: number, ty: number, maxR = 4): [number, number] | null {
  const p = g.people[pn];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      const rest = r - Math.abs(dx);
      for (const dy of rest ? [-rest, rest] : [0]) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || x >= SSIZE || y < 0 || y >= SSIZE) continue;
        const o = g.smap[y * SSIZE + x];
        if (o >= 0 && o !== pn) continue;
        const d = Math.abs(x - p.cx) + Math.abs(y - p.cy);
        if (d < bd) {
          bd = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}
