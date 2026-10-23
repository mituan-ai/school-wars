// 校园景物（docs/04 §5）：操场外是草地，种着树和灌木，开着小花；四所校舍各有一小片院子。
// 景物按 160×100 的世界格子用哈希摆放，只画视野内的格子；位置固定，与对局无关，也不进存档。
// 树和灌木都不会挡住操场：树冠顶端也必须在操场之外。
import { BSIZE } from '../core/constants.ts';
import type { Game } from '../core/types.ts';

const BW = BSIZE * 48;
const BH = BSIZE * 48;
const CELL_W = 160;
const CELL_H = 100;
/** 四个棋盘外角（校舍所在），周围留空 */
const CORNERS: [number, number][] = [[0, 0], [-BW, BH / 2], [BW, BH / 2], [0, BH]];

function hash(x: number, y: number, k: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 点到操场菱形的"距离"：0 在边上，负数在里面（以菱形半高为单位缩放过） */
function boardDist(x: number, y: number): number {
  return (Math.abs(x) / 2 + Math.abs(y - BH / 2) - BH / 2) / 1.118;
}

function nearCorner(x: number, y: number, r: number): boolean {
  return CORNERS.some(([cx, cy]) => Math.abs(x - cx) / 2 + Math.abs(y - cy) < r);
}

interface Prop {
  x: number;
  y: number;
  kind: 'tree' | 'pine' | 'bush';
  s: number;
  v: number;
}

export function drawScenery(ctx: CanvasRenderingContext2D, _g: Game, x0: number, y0: number, x1: number, y1: number, now: number): void {
  const cx0 = Math.floor(x0 / CELL_W) - 1;
  const cx1 = Math.floor(x1 / CELL_W) + 1;
  const cy0 = Math.floor(y0 / CELL_H) - 1;
  const cy1 = Math.floor(y1 / CELL_H) + 1;
  const props: Prop[] = [];
  const tuftsDark = new Path2D();
  const tuftsLight = new Path2D();
  const flowers: [number, number, string][] = [];
  const petals = ['#fff6e0', '#ffe066', '#ff9ec4', '#c9b8ff'];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      // 小草
      for (let i = 0; i < 4; i++) {
        const x = (cx + hash(cx, cy, i)) * CELL_W;
        const y = (cy + hash(cx, cy, i + 10)) * CELL_H;
        if (boardDist(x, y) < 8) continue;
        const p = i % 2 ? tuftsDark : tuftsLight;
        p.moveTo(x - 3, y);
        p.lineTo(x - 1.5, y - 5);
        p.moveTo(x, y);
        p.lineTo(x + 0.5, y - 6.5);
        p.moveTo(x + 3, y);
        p.lineTo(x + 2, y - 4.5);
      }
      // 小花
      if (hash(cx, cy, 20) < 0.55) {
        const x = (cx + hash(cx, cy, 21)) * CELL_W;
        const y = (cy + hash(cx, cy, 22)) * CELL_H;
        if (boardDist(x, y) > 10 && !nearCorner(x, y, 70)) {
          const c = petals[Math.floor(hash(cx, cy, 23) * petals.length)];
          for (let j = 0; j < 4; j++) flowers.push([x + (hash(cx, cy, 30 + j) - 0.5) * 22, y + (hash(cx, cy, 40 + j) - 0.5) * 12, c]);
        }
      }
      // 树和灌木：离操场越远越密，太远就稀疏
      const x = (cx + 0.15 + hash(cx, cy, 50) * 0.7) * CELL_W;
      const y = (cy + 0.15 + hash(cx, cy, 51) * 0.7) * CELL_H;
      const d = boardDist(x, y);
      const r = hash(cx, cy, 52);
      if (d < 26 || nearCorner(x, y, 130)) continue;
      const dense = d < 260 ? 0.75 : d < 600 ? 0.45 : 0.2;
      if (r > dense) continue;
      const s = 0.8 + hash(cx, cy, 53) * 0.5;
      // 树冠顶端也要在操场外面
      const tall = boardDist(x, y - 62 * s) > 6;
      const kind: Prop['kind'] = !tall ? 'bush' : hash(cx, cy, 54) < 0.3 ? 'pine' : 'tree';
      if (kind === 'bush' && boardDist(x, y - 16 * s) < 6) continue;
      props.push({ x, y, kind, s, v: hash(cx, cy, 55) });
    }
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(48,104,40,0.55)';
  ctx.stroke(tuftsDark);
  ctx.strokeStyle = 'rgba(150,205,110,0.55)';
  ctx.stroke(tuftsLight);
  for (const [x, y, c] of flowers) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  props.sort((a, b) => a.y - b.y);
  for (const p of props) {
    if (p.kind === 'bush') bush(ctx, p.x, p.y, p.s, p.v);
    else if (p.kind === 'pine') pine(ctx, p.x, p.y, p.s);
    else tree(ctx, p.x, p.y, p.s, p.v, now);
  }
}

const LEAF = ['#3f8a3a', '#4c9a40', '#5aa84a'];

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.fillStyle = 'rgba(20,50,15,0.3)';
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.3, y, rx, rx / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, now: number): void {
  shadow(ctx, x, y, 16 * s);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 2 * s, y - 22 * s, 4 * s, 22 * s);
  const sway = Math.sin(now / 1400 + v * 6) * 0.8;
  const leaf = LEAF[Math.floor(v * 3)];
  ctx.strokeStyle = 'rgba(20,50,15,0.5)';
  ctx.lineWidth = 0.8;
  for (const [dx, dy, r, k] of [[-7, -28, 10, 0.12], [7, -30, 10, 0.12], [0, -40, 12, 0]] as const) {
    ctx.beginPath();
    ctx.arc(x + (dx + sway) * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fillStyle = k ? shade(leaf, -0.12) : leaf;
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,220,0.18)';
  ctx.beginPath();
  ctx.arc(x + (-3 + sway) * s, y - 45 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  shadow(ctx, x, y, 12 * s);
  ctx.fillStyle = '#5b3f25';
  ctx.fillRect(x - 1.6 * s, y - 10 * s, 3.2 * s, 10 * s);
  ctx.strokeStyle = 'rgba(15,40,20,0.55)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const top = y - (30 + i * 12) * s;
    const w = (15 - i * 3.5) * s;
    ctx.beginPath();
    ctx.moveTo(x, top - 12 * s);
    ctx.lineTo(x + w, top + 8 * s);
    ctx.lineTo(x - w, top + 8 * s);
    ctx.closePath();
    ctx.fillStyle = i === 2 ? '#3b7d48' : '#2f6b3c';
    ctx.fill();
    ctx.stroke();
  }
}

function bush(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, v: number): void {
  shadow(ctx, x, y, 11 * s);
  const leaf = LEAF[Math.floor(v * 3)];
  ctx.strokeStyle = 'rgba(20,50,15,0.5)';
  ctx.lineWidth = 0.8;
  for (const [dx, dy, r] of [[-5, -5, 6], [5, -5, 6], [0, -9, 7]] as const) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fillStyle = leaf;
    ctx.fill();
    ctx.stroke();
  }
  if (v > 0.6) {
    ctx.fillStyle = v > 0.8 ? '#ff8fb8' : '#fff1a0';
    for (const [dx, dy] of [[-4, -8], [3, -11], [5, -5]]) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, 1.3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + k))));
  return `rgb(${ch((v >> 16) & 255)},${ch((v >> 8) & 255)},${ch(v & 255)})`;
}

/** 校舍下面的院子：人族水泥地、兽人泥地、矮人石板、精灵花圃 */
export function schoolYard(ctx: CanvasRenderingContext2D, col: number, cx: number, cy: number, w: number, d: number): void {
  const yw = w + 16;
  const yd = d + 9;
  const fill = ['#c9c5bc', '#9c7b52', '#a8a39b', '#8fcf72'][col] ?? '#c9c5bc';
  ctx.beginPath();
  ctx.moveTo(cx, cy - yd);
  ctx.lineTo(cx + yw, cy);
  ctx.lineTo(cx, cy + yd);
  ctx.lineTo(cx - yw, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,20,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  if (col === 2) {
    // 石板缝
    ctx.strokeStyle = 'rgba(60,55,50,0.3)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = -4; i <= 4; i++) {
      ctx.moveTo(cx + i * 12 - 60, cy - 30);
      ctx.lineTo(cx + i * 12 + 60, cy + 30);
      ctx.moveTo(cx + i * 12 + 60, cy - 30);
      ctx.lineTo(cx + i * 12 - 60, cy + 30);
    }
    ctx.stroke();
  } else if (col === 3) {
    // 花圃
    const petals = ['#ff9ec4', '#c9b8ff', '#fff1a0', '#ffffff'];
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = petals[i % 4];
      ctx.beginPath();
      ctx.arc(cx + (hash(i, col, 1) - 0.5) * yw * 1.8, cy + (hash(i, col, 2) - 0.5) * yd * 1.8, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (col === 1) {
    // 泥地上的石子
    ctx.fillStyle = 'rgba(60,40,20,0.35)';
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + (hash(i, col, 1) - 0.5) * yw * 1.6, cy + (hash(i, col, 2) - 0.5) * yd * 1.6, 1.6, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
