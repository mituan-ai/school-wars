// 地面层（docs/06 §1、§6）：地盘填色（三国志 14 式，各校颜色铺满自己的格子，交界处描边）、
// 断了补给的地盘画成斜纹、正在涂的格子从中心向外长出颜色，最上面盖迷雾。
// 逐像素算在一张操场大小的美术画布上，每帧最多重算一次。
import { AREA, BSIZE, PAINT_ENEMY_MUL, PAINT_NEED, SSIZE } from '../core/constants.ts';
import { supplyMask } from '../core/territory.ts';
import type { Game } from '../core/types.ts';
import { FOG, type FogView } from './fogview.ts';
import { BOARD_H, BOARD_W, worldToCell } from './geom.ts';
import { FACTION } from './palette.ts';
import { ART, rgb } from './pixel.ts';

const W = Math.round(BOARD_W * 2 * ART);
const H = Math.round(BOARD_H * ART);
const N = W * H;
const TILES = BSIZE * BSIZE;

let tileOf: Int16Array | null = null;
let cellOf: Int16Array;
let upT: Int16Array;
let downT: Int16Array;
let rad: Uint8Array;

function precompute(): void {
  tileOf = new Int16Array(N).fill(-1);
  cellOf = new Int16Array(N).fill(-1);
  rad = new Uint8Array(N);
  const tAt = (X: number, Y: number): number => {
    const [ux, uy] = worldToCell((X + 0.5) / ART - BOARD_W, (Y + 0.5) / ART);
    if (ux < 0 || uy < 0 || ux >= SSIZE || uy >= SSIZE) return -1;
    return Math.floor(uy / 4) * BSIZE + Math.floor(ux / 4);
  };
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const [ux, uy] = worldToCell((X + 0.5) / ART - BOARD_W, (Y + 0.5) / ART);
      if (ux < 0 || uy < 0 || ux >= SSIZE || uy >= SSIZE) continue;
      const i = Y * W + X;
      tileOf[i] = Math.floor(uy / 4) * BSIZE + Math.floor(ux / 4);
      cellOf[i] = Math.floor(uy) * SSIZE + Math.floor(ux);
      const fu = ux / 4 - Math.floor(ux / 4) - 0.5;
      const fv = uy / 4 - Math.floor(uy / 4) - 0.5;
      rad[i] = Math.min(255, Math.round(Math.max(Math.abs(fu), Math.abs(fv)) * 2 * 255));
    }
  }
  upT = new Int16Array(N).fill(-1);
  downT = new Int16Array(N).fill(-1);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const i = Y * W + X;
      if (tileOf[i] < 0) continue;
      upT[i] = Y > 0 ? tileOf[i - W] : tAt(X, Y - 1);
      downT[i] = Y < H - 1 ? tileOf[i + W] : -1;
    }
  }
}

const FOG_RGB = rgb('#101a33');
const UI_RGB = FACTION.map((f) => rgb(f.ui));
const FOG_A = [0.52, 0.3, 0];

export class GroundLayer {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private lastGame: Game | null = null;
  private lastTick = -1;
  private lastFog = -1;
  private owner = new Int8Array(TILES);

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(W, H);
  }

  update(g: Game, fog: FogView | null): void {
    const fv = fog ? fog.version : 0;
    if (g === this.lastGame && g.tick === this.lastTick && fv === this.lastFog) return;
    this.lastGame = g;
    this.lastTick = g.tick;
    this.lastFog = fv;
    if (!tileOf) precompute();
    const tiles = tileOf!;
    const remake = g.rules.ruleset === 'remake';
    const mask = remake ? supplyMask(g) : null;
    const own = this.owner;
    const kind = new Int8Array(TILES).fill(-1);
    for (const a of g.area) kind[a.by * BSIZE + a.bx] = a.areatype;
    for (let t = 0; t < TILES; t++) {
      if (fog && fog.enabled) own[t] = fog.owner(g, t);
      else {
        const n = g.bmap_n[t];
        own[t] = n >= 0 ? (g.area[n].areatype === AREA.BASE && g.area[n].fallen ? g.area[n].holder : g.area[n].col) : remake ? g.terr[t] : -1;
      }
    }
    // 每格的填色
    const tr = new Float32Array(TILES * 4);
    const br = new Float32Array(TILES * 3);
    for (let t = 0; t < TILES; t++) {
      const o = own[t];
      if (o < 0) continue;
      const c = UI_RGB[o];
      const supplied = !mask || (mask[t] & (1 << o)) !== 0;
      tr[t * 4] = c[0];
      tr[t * 4 + 1] = c[1];
      tr[t * 4 + 2] = c[2];
      tr[t * 4 + 3] = kind[t] === AREA.BASE ? 0.6 : supplied ? 0.3 : -0.3; // 负数：斜纹
      br[t * 3] = c[0] * 0.72;
      br[t * 3 + 1] = c[1] * 0.72;
      br[t * 3 + 2] = c[2] * 0.72;
    }
    // 涂色进度（只画看得见的格子）
    const paintCol = new Int8Array(TILES).fill(-1);
    const paintK = new Uint8Array(TILES);
    if (remake) {
      for (let t = 0; t < TILES; t++) {
        const pc = g.paint_col[t];
        if (pc < 0 || g.paint_val[t] <= 0 || (fog && fog.enabled && fog.tile(t) !== FOG.SEEN)) continue;
        const need = g.terr[t] < 0 ? PAINT_NEED : PAINT_NEED * PAINT_ENEMY_MUL;
        paintCol[t] = pc;
        paintK[t] = Math.min(255, Math.round((g.paint_val[t] / need) * 255));
      }
    }
    const fogA = new Float32Array(SSIZE * SSIZE);
    if (fog && fog.enabled) for (let i = 0; i < fogA.length; i++) fogA[i] = FOG_A[fog.cell(i)];
    const d = this.img.data;
    d.fill(0);
    for (let i = 0; i < N; i++) {
      const t = tiles[i];
      if (t < 0) continue;
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      const o = own[t];
      if (o >= 0) {
        const up = upT[i];
        const dn = downT[i];
        if (up < 0 || dn < 0 || own[up] !== o || own[dn] !== o) {
          r = br[t * 3];
          gg = br[t * 3 + 1];
          b = br[t * 3 + 2];
          a = 0.85;
        } else {
          let ta = tr[t * 4 + 3];
          if (ta < 0) {
            const X = i % W;
            const Y = (i - X) / W;
            ta = ((X - 2 * Y) >> 3) & 1 ? 0.28 : 0.05;
          }
          r = tr[t * 4];
          gg = tr[t * 4 + 1];
          b = tr[t * 4 + 2];
          a = ta;
        }
      }
      const pc = paintCol[t];
      if (pc >= 0 && rad[i] <= paintK[t]) {
        const c = UI_RGB[pc];
        const pa = rad[i] > paintK[t] - 12 ? 0.75 : 0.42;
        r = r * a * (1 - pa) + c[0] * pa;
        gg = gg * a * (1 - pa) + c[1] * pa;
        b = b * a * (1 - pa) + c[2] * pa;
        a = pa + a * (1 - pa);
        if (a > 0) {
          r /= a;
          gg /= a;
          b /= a;
        }
      }
      // 迷雾边缘按棋盘格错开取样，过渡处是一圈抖动的像素
      const j = i & 1 ? i - W - 1 : i + W + 1;
      const fa = fogA[j >= 0 && j < N && cellOf[j] >= 0 && ((i % W) + ((i / W) | 0)) & 1 ? cellOf[j] : cellOf[i]];
      if (fa > 0) {
        const na = fa + a * (1 - fa);
        r = (FOG_RGB[0] * fa + r * a * (1 - fa)) / na;
        gg = (FOG_RGB[1] * fa + gg * a * (1 - fa)) / na;
        b = (FOG_RGB[2] * fa + b * a * (1 - fa)) / na;
        a = na;
      }
      if (a <= 0) continue;
      d[i * 4] = r;
      d[i * 4 + 1] = gg;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = a * 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  /** 在美术画布（世界坐标变换）上贴出地面层 */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.canvas, -BOARD_W, 0, W / ART, H / ART);
  }
}
