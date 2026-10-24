// 静态背景：草地、操场（砖面、砖缝、路沿）、校舍院子、树木。与对局无关，开局时烘焙成一张像素图，每帧整张贴上。
import { BOARD_H, BOARD_W, CURB, schoolAnchor, SCHOOL_D, SCHOOL_W, worldToCell } from './geom.ts';
import { ART, bake, rgb, type Sprite } from './pixel.ts';
import { drawProp, sceneryLayout } from './scenery.ts';

/** 背景覆盖的世界矩形（比视野范围大一圈，缩到最小时也不露底） */
export const BACK_X0 = -BOARD_W - 420;
export const BACK_Y0 = -260;
const BACK_X1 = BOARD_W + 420;
const BACK_Y1 = BOARD_H + 260;

function hash(x: number, y: number, k: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pack(c: [number, number, number], k = 0): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return ((255 << 24) | (f(c[2]) << 16) | (f(c[1]) << 8) | f(c[0])) >>> 0;
}

const GRASS = [rgb('#5f9d46'), rgb('#58953f'), rgb('#66a64c')];
const TILE_A = rgb('#ddd6c6');
const TILE_B = rgb('#d2cab8');
const CURB_TOP = rgb('#c9c1ae');
const CURB_L = rgb('#a39c8c');
const CURB_R = rgb('#8f887a');

/** 点在以 (0, cy) 为中心、半宽 hw、半高 hh 的菱形内 */
const inDiamond = (x: number, y: number, cy: number, hw: number, hh: number) => Math.abs(x) / hw + Math.abs(y - cy) / hh <= 1;

let cached: HTMLCanvasElement | null = null;

export function backdrop(): HTMLCanvasElement {
  if (cached) return cached;
  const w = Math.round((BACK_X1 - BACK_X0) * ART);
  const h = Math.round((BACK_Y1 - BACK_Y0) * ART);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  const hw = BOARD_W;
  const hh = BOARD_H / 2;
  const cy = BOARD_H / 2;
  for (let Y = 0; Y < h; Y++) {
    for (let X = 0; X < w; X++) {
      const wx = (X + 0.5) / ART + BACK_X0;
      const wy = (Y + 0.5) / ART + BACK_Y0;
      let c: number;
      if (inDiamond(wx, wy, cy, hw, hh)) {
        // 操场砖面：大格棋盘格，大格缝深、小格缝浅，零星斑点
        const [ux, uy] = worldToCell(wx, wy);
        const [dx, dy] = worldToCell(wx, wy + 1 / ART);
        const bx = Math.floor(ux / 4);
        const by = Math.floor(uy / 4);
        const base = (bx + by) % 2 ? TILE_B : TILE_A;
        let k = 0;
        if (Math.floor(dx / 4) !== bx || Math.floor(dy / 4) !== by) k = -0.13;
        else if (Math.floor(dx) !== Math.floor(ux) || Math.floor(dy) !== Math.floor(uy)) k = -0.045;
        else {
          const r = hash(X, Y, 7);
          if (r < 0.035) k = -0.07;
          else if (r > 0.985) k = 0.12;
        }
        c = pack(base, k);
      } else if (inDiamond(wx, wy, cy, hw + 4, hh + 2)) {
        c = pack(CURB_TOP);
      } else if (wy > cy && inDiamond(wx, wy - CURB, cy, hw + 4, hh + 2)) {
        c = pack(wx > 0 ? CURB_R : CURB_L);
      } else {
        // 草地：4×4 像素的块状杂色，操场外一圈有阴影
        const n = hash(X >> 2, Y >> 2, 3);
        const g = GRASS[n < 0.6 ? 0 : n < 0.8 ? 1 : 2];
        const shade = inDiamond(wx - 3, wy - CURB - 4, cy, hw + 12, hh + 7) ? -0.16 : 0;
        c = pack(g, shade);
      }
      out[Y * w + X] = c;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 以下在世界坐标下作画
  ctx.setTransform(ART, 0, 0, ART, -BACK_X0 * ART, -BACK_Y0 * ART);
  ctx.imageSmoothingEnabled = false;
  const lay = sceneryLayout(BACK_X0, BACK_Y0, BACK_X1, BACK_Y1);
  for (const [x, y, dark] of lay.tufts) {
    const px = Math.round(x * ART) / ART;
    const py = Math.round(y * ART) / ART;
    ctx.fillStyle = dark ? '#3d7a33' : '#86c463';
    ctx.fillRect(px - 2, py - 4, 2, 4);
    ctx.fillRect(px + 2, py - 6, 2, 6);
    ctx.fillRect(px + 6, py - 2, 2, 2);
  }
  for (const [x, y, col] of lay.flowers) {
    const px = Math.round(x * ART) / ART;
    const py = Math.round(y * ART) / ART;
    ctx.fillStyle = col;
    ctx.fillRect(px - 2, py, 6, 2);
    ctx.fillRect(px, py - 2, 2, 6);
    ctx.fillStyle = '#e8a33a';
    ctx.fillRect(px, py, 2, 2);
  }
  for (let col = 0; col < 4; col++) {
    const [bx, by] = [[0, 0], [15, 0], [15, 15], [0, 15]][col];
    const [x, y] = schoolAnchor(bx, by);
    const ys = yardSprite(col);
    ctx.drawImage(ys.canvas, (Math.round(x * ART) - ys.ax) / ART, (Math.round(y * ART) - ys.ay) / ART, ys.canvas.width / ART, ys.canvas.height / ART);
  }
  for (const p of lay.props) {
    const s = propSprite(p.kind, p.s, p.v);
    const px = Math.round(p.x * ART);
    const py = Math.round(p.y * ART);
    // 影子
    const r = Math.round((p.kind === 'tree' ? 16 : p.kind === 'pine' ? 12 : 11) * p.s * ART);
    ctx.fillStyle = 'rgba(20,50,15,0.32)';
    for (let k = -Math.ceil(r / 2); k <= Math.ceil(r / 2); k++) {
      const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (k / (r / 2)) ** 2)));
      if (half > 0) ctx.fillRect((px + Math.round(r * 0.3) - half) / ART, (py + k) / ART, (2 * half) / ART, 1 / ART);
    }
    ctx.drawImage(s.canvas, (px - s.ax) / ART, (py - s.ay) / ART, s.canvas.width / ART, s.canvas.height / ART);
  }
  cached = canvas;
  return canvas;
}

const props = new Map<string, Sprite>();

function propSprite(kind: 'tree' | 'pine' | 'bush', s: number, v: number): Sprite {
  // 大小、颜色各分几档，共用精灵
  const sb = Math.round(s * 5) / 5;
  const vb = (Math.floor(v * 3) + 0.5) / 3 + (kind === 'bush' && v > 0.6 ? (v > 0.8 ? 0.25 : 0.05) : 0);
  const key = `${kind}/${sb}/${vb.toFixed(2)}`;
  let sp = props.get(key);
  if (!sp) {
    sp = bake(-30, -80, 30, 6, (c) => drawProp(c, kind, sb, Math.min(0.99, vb)), { outline: '#1f3d1c', colors: 8 });
    props.set(key, sp);
  }
  return sp;
}

/** 校舍院子：人族水泥地、兽人泥地、矮人石板、精灵花圃（像素菱形 + 点缀） */
function yardSprite(col: number): Sprite {
  const yw = SCHOOL_W + 16;
  const yd = SCHOOL_D + 9;
  const fill = ['#c9c5bc', '#9c7b52', '#a8a39b', '#8fcf72'][col];
  const W = Math.round(yw * ART);
  const H = Math.round(yd * ART);
  const canvas = document.createElement('canvas');
  canvas.width = W * 2 + 2;
  canvas.height = H * 2 + 2;
  const ctx = canvas.getContext('2d')!;
  const edge = ['#a9a59c', '#7d6040', '#88837b', '#6fae55'][col];
  for (let r = -H; r < H; r++) {
    const k = r < 0 ? r + H + 0.5 : H - r - 0.5;
    const half = Math.round((k / H) * W);
    if (half <= 0) continue;
    ctx.fillStyle = edge;
    ctx.fillRect(W + 1 - half, H + 1 + r, half * 2, 1);
    ctx.fillStyle = fill;
    ctx.fillRect(W + 1 - half + 2, H + 1 + r, Math.max(0, half * 2 - 4), 1);
  }
  const dots = col === 3 ? ['#ff9ec4', '#c9b8ff', '#fff1a0', '#ffffff'] : col === 1 ? ['#6e5232'] : col === 2 ? ['#8a857d'] : ['#b3afa6'];
  const n = col === 3 ? 26 : col === 0 ? 6 : 16;
  for (let i = 0; i < n; i++) {
    const x = Math.round((hash(i, col, 1) - 0.5) * W * 1.4);
    const y = Math.round((hash(i, col, 2) - 0.5) * H * 1.4);
    if (Math.abs(x) / W + Math.abs(y) / H > 0.8) continue;
    ctx.fillStyle = dots[i % dots.length];
    ctx.fillRect(W + 1 + x, H + 1 + y, col === 2 ? 3 : 1, 1);
  }
  return { canvas, ax: W + 1, ay: H + 1 };
}
