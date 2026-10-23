// 画面绘制：Canvas 2D。世界坐标与原版 mcStage 内坐标一致（大格菱形 96×48，小格 24×12）。
import { BSIZE, CAPTURE_VALUE, PMAX, PS, SPEC_APPEAR } from '../core/constants.ts';
import type { Game } from '../core/types.ts';
import { getLang, t } from '../i18n/index.ts';
import { settings } from '../settings.ts';
import { FACTION, NEUTRAL } from './palette.ts';
import { drawStudent } from './student.ts';

export const BOARD_W = BSIZE * 48; // 菱形半宽
export const BOARD_H = BSIZE * 48; // 菱形高

export class Camera {
  x = 0;
  y = BOARD_H / 2;
  zoom = 1.6;
  w = 640;
  h = 400;

  toScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.w / 2, (wy - this.y) * this.zoom + this.h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.zoom + this.x, (sy - this.h / 2) / this.zoom + this.y];
  }

  clamp(): void {
    this.zoom = Math.min(3.5, Math.max(0.6, this.zoom));
    this.x = Math.min(BOARD_W, Math.max(-BOARD_W, this.x));
    this.y = Math.min(BOARD_H, Math.max(0, this.y));
  }

  /** 世界坐标点是否在当前视野内（原版 is_inside，用于决定是否播放音效） */
  inside(wx: number, wy: number): boolean {
    const [sx, sy] = this.toScreen(wx, wy);
    return sx >= 0 && sx < this.w && sy >= 0 && sy < this.h;
  }
}

export interface ViewState {
  selected: Set<number>;
  /** 下令状态下鼠标所指的大格 */
  cursorTile: { bx: number; by: number } | null;
  /** 下令状态下鼠标所指的敌人 */
  arrowPn: number;
  /** 框选矩形（屏幕坐标） */
  rect: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface Fx {
  levelups: { pn: number; t0: number }[];
  impacts: { x: number; y: number; t0: number; big: boolean }[];
  blink: { bx: number; by: number; pn: number; t0: number } | null;
}

export function newFx(): Fx {
  return { levelups: [], impacts: [], blink: null };
}

export interface Interp {
  prevX: Float64Array;
  prevY: Float64Array;
  alpha: number;
}

export function newInterp(): Interp {
  return { prevX: new Float64Array(PMAX), prevY: new Float64Array(PMAX), alpha: 1 };
}

export function unitPos(g: Game, ip: Interp, pn: number): [number, number] {
  const p = g.people[pn];
  const a = ip.alpha;
  return [ip.prevX[pn] + (p.px - ip.prevX[pn]) * a, ip.prevY[pn] + (p.py - ip.prevY[pn]) * a];
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, hw: number, hh: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
}

/** 进入"贴地"坐标系：在其中画的图形会被压扁成等距投影，朝上即屏幕上方 */
function groundSpace(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.translate(x, y);
  ctx.transform(1, 0.5, -1, 0.5, 0, 0);
  ctx.rotate(-Math.PI / 4);
}

export function render(
  ctx: CanvasRenderingContext2D,
  g: Game,
  cam: Camera,
  ip: Interp,
  view: ViewState,
  fx: Fx,
  now: number,
  dpr: number,
  withMinimap = true,
): { mm: MinimapRect | null } {
  const W = cam.w;
  const H = cam.h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04060d');
  bg.addColorStop(0.55, '#0b2558');
  bg.addColorStop(1, '#1d56b8');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (W / 2 - cam.x * cam.zoom), dpr * (H / 2 - cam.y * cam.zoom));

  drawBoard(ctx);
  drawAreas(ctx, g, now);

  // 下令光标
  if (view.cursorTile) drawTileCursor(ctx, view.cursorTile.bx, view.cursorTile.by, 'rgba(255,255,255,0.9)');
  if (fx.blink && fx.blink.pn < 0) {
    const k = Math.floor((now - fx.blink.t0) / (1000 / 18));
    if (k < 7 && k % 2 === 1) drawTileCursor(ctx, fx.blink.bx, fx.blink.by, '#ffe066');
  }

  // 单位按小格深度排序（原版 swapDepths(smap.prio)）
  const order: number[] = [];
  for (let i = 0; i < PMAX; i++) if (g.people[i].stat !== PS.EMPTY) order.push(i);
  order.sort((a, b) => {
    const pa = g.people[a];
    const pb = g.people[b];
    return (pa.cx + pa.cy) * 64 + pa.cx - ((pb.cx + pb.cy) * 64 + pb.cx);
  });
  for (const pn of order) {
    const p = g.people[pn];
    const [x, y] = unitPos(g, ip, pn);
    if (view.selected.has(pn) && p.stat > PS.DEAD) {
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,255,200,0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    drawStudent(ctx, x, y + 6, p.col, p.dir, p.show);
    if (p.stat > PS.DEAD) {
      // 血条宽度 = 生命值（原版 mcHP），所以老兵的血条更长
      const bw = p.mhp;
      const bx = x - Math.floor(p.mhp / 2);
      const by = y - 38;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 0.6, by - 0.6, bw + 1.2, 3.2);
      ctx.fillStyle = '#6b1d1d';
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillStyle = p.hp / p.mhp > 0.35 ? '#5fe36f' : '#ffcf3a';
      ctx.fillRect(bx, by, Math.max(0, p.hp), 2);
    }
  }

  // 攻击目标箭头
  const arrowPn = view.arrowPn >= 0 ? view.arrowPn : fx.blink && fx.blink.pn >= 0 ? fx.blink.pn : -1;
  if (arrowPn >= 0 && g.people[arrowPn].stat > PS.DEAD) {
    let show = true;
    if (view.arrowPn < 0 && fx.blink) {
      const k = Math.floor((now - fx.blink.t0) / (1000 / 18));
      show = k < 7 && k % 2 === 1;
    }
    if (show) {
      const [x, y] = unitPos(g, ip, arrowPn);
      const bob = Math.sin(now / 120) * 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 41 + bob);
      ctx.lineTo(x - 5, y - 49 + bob);
      ctx.lineTo(x + 5, y - 49 + bob);
      ctx.closePath();
      ctx.fillStyle = '#ff4a3d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 出拳火花
  fx.impacts = fx.impacts.filter((f) => now - f.t0 < 260);
  for (const f of fx.impacts) {
    const k = (now - f.t0) / 260;
    ctx.save();
    ctx.translate(f.x, f.y - 18);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = f.big ? '#ffffff' : '#ffe680';
    ctx.lineWidth = 1.4;
    const r0 = 3 + k * 4;
    const r1 = r0 + (f.big ? 7 : 4);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 升级字样
  fx.levelups = fx.levelups.filter((f) => now - f.t0 < 950);
  ctx.font = `bold 9px ${getComputedFontFamily()}`;
  ctx.textAlign = 'center';
  for (const f of fx.levelups) {
    if (g.people[f.pn].stat === PS.EMPTY) continue;
    const k = (now - f.t0) / 950;
    const [x, y] = unitPos(g, ip, f.pn);
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#3a1b00';
    ctx.strokeText(t('msg.levelup'), x, y - 44 - k * 14);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(t('msg.levelup'), x, y - 44 - k * 14);
    ctx.globalAlpha = 1;
  }

  // 屏幕空间：框选框、小地图
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (view.rect) {
    const r = view.rect;
    ctx.fillStyle = 'rgba(120,255,200,0.12)';
    ctx.strokeStyle = 'rgba(120,255,200,0.9)';
    ctx.lineWidth = 1;
    const x = Math.min(r.x1, r.x2);
    const y = Math.min(r.y1, r.y2);
    ctx.fillRect(x, y, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1));
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1));
  }
  return { mm: withMinimap ? drawMinimap(ctx, g, cam) : null };
}

let fontFamily = '';
function getComputedFontFamily(): string {
  if (!fontFamily) fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
  return fontFamily;
}

function drawBoard(ctx: CanvasRenderingContext2D): void {
  // 厚度侧面
  const T = 16;
  ctx.fillStyle = '#7f858c';
  ctx.beginPath();
  ctx.moveTo(-BOARD_W, BOARD_H / 2);
  ctx.lineTo(0, BOARD_H);
  ctx.lineTo(0, BOARD_H + T);
  ctx.lineTo(-BOARD_W, BOARD_H / 2 + T);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5e646b';
  ctx.beginPath();
  ctx.moveTo(BOARD_W, BOARD_H / 2);
  ctx.lineTo(0, BOARD_H);
  ctx.lineTo(0, BOARD_H + T);
  ctx.lineTo(BOARD_W, BOARD_H / 2 + T);
  ctx.closePath();
  ctx.fill();

  diamond(ctx, 0, BOARD_H / 2, BOARD_W, BOARD_H / 2);
  ctx.fillStyle = '#d3d6d8';
  ctx.fill();
  // 棋盘格
  ctx.fillStyle = '#cbced1';
  for (let by = 0; by < BSIZE; by++) {
    for (let bx = 0; bx < BSIZE; bx++) {
      if ((bx + by) % 2) continue;
      diamond(ctx, bx * 48 - by * 48, by * 24 + bx * 24 + 24, 48, 24);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i <= BSIZE; i++) {
    ctx.moveTo(-i * 48, i * 24);
    ctx.lineTo(BOARD_W - i * 48, BOARD_H / 2 + i * 24);
    ctx.moveTo(i * 48, i * 24);
    ctx.lineTo(-BOARD_W + i * 48, BOARD_H / 2 + i * 24);
  }
  ctx.stroke();
}

function drawTileCursor(ctx: CanvasRenderingContext2D, bx: number, by: number, color: string): void {
  diamond(ctx, bx * 48 - by * 48, by * 24 + bx * 24 + 24, 46, 23);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function spadePath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.35, -s * 0.55, s * 1.05, -s * 0.2, s * 0.85, s * 0.3);
  ctx.bezierCurveTo(s * 0.7, s * 0.7, s * 0.2, s * 0.65, s * 0.08, s * 0.35);
  ctx.lineTo(s * 0.3, s);
  ctx.lineTo(-s * 0.3, s);
  ctx.lineTo(-s * 0.08, s * 0.35);
  ctx.bezierCurveTo(-s * 0.2, s * 0.65, -s * 0.7, s * 0.7, -s * 0.85, s * 0.3);
  ctx.bezierCurveTo(-s * 1.05, -s * 0.2, -s * 0.35, -s * 0.55, 0, -s);
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.9);
  ctx.bezierCurveTo(-s * 1.1, 0, -s * 0.9, -s, 0, -s * 0.45);
  ctx.bezierCurveTo(s * 0.9, -s, s * 1.1, 0, 0, s * 0.9);
  ctx.closePath();
}

const EMBLEM_ZH = ['黑', '绿', '金', '紫'];
const EMBLEM_EN = ['B', 'G', 'Y', 'P'];

function drawAreas(ctx: CanvasRenderingContext2D, g: Game, now: number): void {
  for (const a of g.area) {
    const x = a.bx * 48 - a.by * 48;
    const y = a.by * 24 + a.bx * 24 + 24;
    if (a.areatype === 1) {
      const c = FACTION[a.col];
      const alive = g.player[a.col].exist;
      diamond(ctx, x, y, 48, 24);
      ctx.fillStyle = alive ? c.ui : '#8d9196';
      ctx.fill();
      diamond(ctx, x, y, 40, 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.save();
      groundSpace(ctx, x, y);
      ctx.font = `900 30px ${getComputedFontFamily()}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText((getLang() === 'zh' ? EMBLEM_ZH : EMBLEM_EN)[a.col], 0, 1);
      if (alive && settings.showSpawn) {
        const k = Math.min(1, g.player[a.col].appear_cnt / SPEC_APPEAR[a.col]);
        ctx.beginPath();
        ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    const owner = a.col;
    diamond(ctx, x, y, 44, 22);
    ctx.fillStyle = owner >= 0 ? mix('#f6f7f4', FACTION[owner].ui, 0.18) : '#f3f4f1';
    ctx.fill();
    ctx.strokeStyle = owner >= 0 ? FACTION[owner].ui : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = owner >= 0 ? 1.6 : 1;
    ctx.stroke();
    ctx.save();
    groundSpace(ctx, x, y);
    if (a.areatype === 2) spadePath(ctx, 17);
    else heartPath(ctx, 19);
    ctx.fillStyle = owner >= 0 ? FACTION[owner].ui : NEUTRAL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 占领进度：显示进度最高的非持有阵营
    if (settings.showCapture) {
      let best = -1;
      for (let c = 0; c < 4; c++) if (c !== owner && a.val[c] > 0 && (best < 0 || a.val[c] > a.val[best])) best = c;
      if (best >= 0) {
        const k = a.val[best] / CAPTURE_VALUE;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 27, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.strokeStyle = FACTION[best].ui;
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 150);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  ox: number;
  oy: number;
}

function drawMinimap(ctx: CanvasRenderingContext2D, g: Game, cam: Camera): MinimapRect {
  const w = Math.round(Math.min(260, Math.max(170, cam.w * 0.2)));
  const s = w / (BOARD_W * 2 + 40);
  const h = Math.round((BOARD_H + 40) * s);
  const x0 = cam.w - w - 14;
  const y0 = cam.h - h - 14;
  ctx.fillStyle = 'rgba(6,10,20,0.78)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  roundRect(ctx, x0, y0, w, h, 8);
  ctx.fill();
  ctx.stroke();
  const ox = x0 + w / 2;
  const oy = y0 + 20 * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  diamond(ctx, ox, oy + (BOARD_H / 2) * s, BOARD_W * s, (BOARD_H / 2) * s);
  ctx.fillStyle = '#4a4f57';
  ctx.fill();
  for (const a of g.area) {
    const cx = ox + (a.bx * 48 - a.by * 48) * s;
    const cy = oy + (a.by * 24 + a.bx * 24 + 24) * s;
    diamond(ctx, cx, cy, 48 * s, 24 * s);
    ctx.fillStyle = a.col >= 0 ? FACTION[a.col].ui : '#8b9097';
    ctx.globalAlpha = a.areatype === 1 ? 0.9 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const p of g.people) {
    if (p.stat <= PS.DEAD) continue;
    const dx = ox + p.px * s;
    const dy = oy + (p.py + 6) * s;
    ctx.fillStyle = p.col === g.user_col ? '#ffffff' : FACTION[p.col].ui;
    ctx.fillRect(dx - 1.5, dy - 1.5, 3, 3);
    if (p.col === g.user_col) {
      ctx.fillStyle = FACTION[p.col].ui;
      ctx.fillRect(dx - 0.8, dy - 0.8, 1.6, 1.6);
    }
  }
  const [wx0, wy0] = cam.toWorld(0, 0);
  const [wx1, wy1] = cam.toWorld(cam.w, cam.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + wx0 * s, oy + wy0 * s, (wx1 - wx0) * s, (wy1 - wy0) * s);
  ctx.restore();
  return { x: x0, y: y0, w, h, s, ox, oy };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 小地图坐标 → 世界坐标 */
export function minimapToWorld(mm: { ox: number; oy: number; s: number }, sx: number, sy: number): [number, number] {
  return [(sx - mm.ox) / mm.s, (sy - mm.oy) / mm.s];
}
