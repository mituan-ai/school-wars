// 画面绘制：Canvas 2D。世界坐标与原版 mcStage 内坐标一致（大格菱形 96×48，小格 24×12）。
// 分层：棋盘（离屏缓存）→ 地面（地块、光标）→ 按深度排序的学生与立体物件 → 特效 → 屏幕空间（框选、小地图）
import { BSIZE, CAPTURE_VALUE, PMAX, PS, RECOVER_VALUE, SIEGE_VALUE } from '../core/constants.ts';
import { factionSpec, stars } from '../core/query.ts';
import type { Area, Game } from '../core/types.ts';
import { getLang, t } from '../i18n/index.ts';
import { settings } from '../settings.ts';
import { FACTION, NEUTRAL } from './palette.ts';
import { drawStudent } from './student.ts';

export const BOARD_W = BSIZE * 48; // 菱形半宽
export const BOARD_H = BSIZE * 48; // 菱形高
const SLAB = 16; // 棋盘厚度

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
  /** 选中了己方本部（设置集结点） */
  baseSelected?: boolean;
}

export interface Fx {
  levelups: { pn: number; t0: number }[];
  impacts: { x: number; y: number; t0: number; big: boolean }[];
  blink: { bx: number; by: number; pn: number; t0: number } | null;
  /** 飘字（挥空的"闪"等） */
  texts: { x: number; y: number; t0: number; text: string }[];
  /** 每个槽位最后一次挨打的时间（受击闪白、后仰） */
  hitAt: Float64Array;
  /** 击倒时冒出的星星 */
  kos: { x: number; y: number; t0: number }[];
  /** 地块被占领的时间（升旗动画） */
  raised: Map<number, number>;
  /** 小地图上的警报光圈 */
  pings: { bx: number; by: number; t0: number; color: string }[];
}

export function newFx(): Fx {
  return {
    levelups: [], impacts: [], blink: null, texts: [], hitAt: new Float64Array(PMAX).fill(-1e9), kos: [],
    raised: new Map(), pings: [],
  };
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

/** 大格中心的世界坐标 */
export function tileCenter(bx: number, by: number): [number, number] {
  return [bx * 48 - by * 48, by * 24 + bx * 24 + 24];
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
  // 夜空背景由 .game-canvas 的 CSS 渐变提供，画布只需清空
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (W / 2 - cam.x * cam.zoom), dpr * (H / 2 - cam.y * cam.zoom));

  paintBoard(ctx);
  drawGround(ctx, g, now);
  if (g.rules.ruleset === 'remake') drawRally(ctx, g, view, now);

  // 下令光标
  if (view.cursorTile) drawTileCursor(ctx, view.cursorTile.bx, view.cursorTile.by, 'rgba(255,255,255,0.9)');
  if (fx.blink && fx.blink.pn < 0) {
    const k = Math.floor((now - fx.blink.t0) / (1000 / 18));
    if (k < 7 && k % 2 === 1) drawTileCursor(ctx, fx.blink.bx, fx.blink.by, '#ffe066');
  }

  // 校舍在棋盘外角：上、左、右三角的在一切之后方，下角的在一切之前
  const front: Area[] = [];
  for (const a of g.area) {
    if (a.areatype !== 1) continue;
    if (a.bx === BSIZE - 1 && a.by === BSIZE - 1) front.push(a);
    else drawSchool(ctx, g, a, now);
  }

  // 学生与标牌按深度排序（原版按小格 swapDepths；标牌插在所在大格中心那一排）
  const items: { key: number; pn: number; area: number }[] = [];
  for (let i = 0; i < PMAX; i++) {
    const p = g.people[i];
    if (p.stat !== PS.EMPTY) items.push({ key: (p.cx + p.cy) * 1000 + p.cx, pn: i, area: -1 });
  }
  g.area.forEach((a, n) => {
    if (a.areatype !== 1) items.push({ key: (a.bx * 4 + a.by * 4 + 3) * 1000 + 999, pn: -1, area: n });
  });
  items.sort((a, b) => a.key - b.key);
  const remake = g.rules.ruleset === 'remake';
  for (const it of items) {
    if (it.area >= 0) {
      drawSign(ctx, g, it.area, fx, now);
      continue;
    }
    const pn = it.pn;
    const p = g.people[pn];
    let [x, y] = unitPos(g, ip, pn);
    // 受击：闪白并向后一仰
    const since = now - fx.hitAt[pn];
    const flash = since < 160 ? 1 - since / 160 : 0;
    if (flash > 0 && p.stat > PS.DEAD) {
      const back = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]][p.dir];
      x += back[0] * 2 * flash;
      y += back[1] * 2 * flash;
    }
    if (view.selected.has(pn) && p.stat > PS.DEAD) {
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,255,200,0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    drawStudent(ctx, x, y + 6, p.col, p.dir, p.show, flash);
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
      const n = remake ? stars(p.lev) : 0;
      for (let i = 0; i < n; i++) star(ctx, x + (i - (n - 1) / 2) * 6, by - 4, 2.6, '#ffd84a');
    }
  }
  for (const a of front) drawSchool(ctx, g, a, now);

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

  drawEffects(ctx, g, ip, fx, now);

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
  return { mm: withMinimap ? drawMinimap(ctx, g, cam, fx, now) : null };
}

function drawEffects(ctx: CanvasRenderingContext2D, g: Game, ip: Interp, fx: Fx, now: number): void {
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

  // 击倒：头上转圈的星星
  fx.kos = fx.kos.filter((f) => now - f.t0 < 1400);
  for (const f of fx.kos) {
    const k = (now - f.t0) / 1400;
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    for (let i = 0; i < 3; i++) {
      const a = now / 220 + (i * Math.PI * 2) / 3;
      star(ctx, f.x + Math.cos(a) * 9, f.y - 14 + Math.sin(a) * 3, 2.4, '#ffe14d');
    }
    ctx.globalAlpha = 1;
  }

  const font = getComputedFontFamily();
  ctx.textAlign = 'center';
  // 飘字（"闪"）
  fx.texts = fx.texts.filter((f) => now - f.t0 < 700);
  ctx.font = `900 8px ${font}`;
  for (const f of fx.texts) {
    const k = (now - f.t0) / 700;
    ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(10,20,40,0.85)';
    ctx.strokeText(f.text, f.x + 6, f.y - 30 - k * 10);
    ctx.fillStyle = '#bfe6ff';
    ctx.fillText(f.text, f.x + 6, f.y - 30 - k * 10);
  }
  ctx.globalAlpha = 1;

  // 升级字样
  fx.levelups = fx.levelups.filter((f) => now - f.t0 < 950);
  ctx.font = `bold 9px ${font}`;
  for (const f of fx.levelups) {
    if (g.people[f.pn].stat === PS.EMPTY) continue;
    const k = (now - f.t0) / 950;
    const [x, y] = unitPos(g, ip, f.pn);
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#3a1b00';
    ctx.strokeText(t('msg.levelup'), x, y - 48 - k * 14);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(t('msg.levelup'), x, y - 48 - k * 14);
    ctx.globalAlpha = 1;
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,0,0.8)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

let fontFamily = '';
function getComputedFontFamily(): string {
  if (!fontFamily) fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
  return fontFamily;
}

// ---- 棋盘：直接矢量绘制。实测比离屏缓存再缩放贴图更快（软件渲染 1080p：0.6 ms 对 4.4 ms） ----

function paintBoard(ctx: CanvasRenderingContext2D): void {
  // 厚度侧面
  ctx.fillStyle = '#7f858c';
  ctx.beginPath();
  ctx.moveTo(-BOARD_W, BOARD_H / 2);
  ctx.lineTo(0, BOARD_H);
  ctx.lineTo(0, BOARD_H + SLAB);
  ctx.lineTo(-BOARD_W, BOARD_H / 2 + SLAB);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5e646b';
  ctx.beginPath();
  ctx.moveTo(BOARD_W, BOARD_H / 2);
  ctx.lineTo(0, BOARD_H);
  ctx.lineTo(0, BOARD_H + SLAB);
  ctx.lineTo(BOARD_W, BOARD_H / 2 + SLAB);
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

export function emblem(col: number): string {
  return (getLang() === 'zh' ? EMBLEM_ZH : EMBLEM_EN)[col] ?? '';
}

/** 地面层：本部场地、♠ / ♥ 地块的底色与进度环 */
function drawGround(ctx: CanvasRenderingContext2D, g: Game, now: number): void {
  const font = getComputedFontFamily();
  for (const a of g.area) {
    const [x, y] = tileCenter(a.bx, a.by);
    if (a.areatype === 1) {
      const c = FACTION[a.col];
      const alive = g.player[a.col].exist;
      diamond(ctx, x, y, 48, 24);
      ctx.fillStyle = !alive ? '#8d9196' : a.fallen ? mix(c.ui, '#8d9196', 0.6) : c.ui;
      ctx.fill();
      diamond(ctx, x, y, 40, 20);
      ctx.strokeStyle = a.fallen ? 'rgba(40,0,0,0.35)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(a.fallen ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      groundSpace(ctx, x, y);
      ctx.font = `900 30px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillText(emblem(a.col), 0, 1);
      if (alive && !a.fallen && settings.showSpawn) {
        const need = factionSpec(g.rules.ruleset, a.col).appear;
        const k = Math.min(1, g.player[a.col].appear_cnt / need);
        ctx.beginPath();
        ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (settings.showCapture) {
        // 攻陷进度（敌方）或夺回进度（己方）
        const need = a.fallen ? RECOVER_VALUE : SIEGE_VALUE;
        let best = -1;
        for (let c2 = 0; c2 < 4; c2++) {
          if (a.val[c2] <= 0) continue;
          if (a.fallen ? c2 !== a.col : c2 === a.col) continue;
          if (best < 0 || a.val[c2] > a.val[best]) best = c2;
        }
        if (best >= 0) progressRing(ctx, 31, a.val[best] / need, FACTION[best].ui, now);
      }
      ctx.restore();
      continue;
    }
    const owner = a.col;
    diamond(ctx, x, y, 44, 22);
    ctx.fillStyle = owner >= 0 ? mix('#f6f7f4', FACTION[owner].ui, 0.3) : '#f3f4f1';
    ctx.fill();
    ctx.strokeStyle = owner >= 0 ? FACTION[owner].ui : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = owner >= 0 ? 2 : 1;
    ctx.stroke();
    ctx.save();
    groundSpace(ctx, x, y);
    // 地面上的淡淡符号，远看也能分辨地块种类
    if (a.areatype === 2) spadePath(ctx, 14);
    else heartPath(ctx, 15);
    ctx.fillStyle = owner >= 0 ? FACTION[owner].ui : NEUTRAL;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    // 占领进度：显示进度最高的非持有阵营
    if (settings.showCapture) {
      let best = -1;
      for (let c = 0; c < 4; c++) if (c !== owner && a.val[c] > 0 && (best < 0 || a.val[c] > a.val[best])) best = c;
      if (best >= 0) progressRing(ctx, 27, a.val[best] / CAPTURE_VALUE, FACTION[best].ui, now);
    }
    ctx.restore();
  }
}

function progressRing(ctx: CanvasRenderingContext2D, r: number, k: number, color: string, now: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, k) * Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 150);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** ♠ / ♥ 的立牌：立在大格中央，占领时升旗 */
function drawSign(ctx: CanvasRenderingContext2D, g: Game, n: number, fx: Fx, now: number): void {
  const a = g.area[n];
  const [x, y] = tileCenter(a.bx, a.by);
  const owner = a.col;
  const color = owner >= 0 ? FACTION[owner].ui : NEUTRAL;
  // 影子与立柱
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 1.1, y - 18, 2.2, 18);
  // 牌子
  const bw = 18;
  const bh = 13;
  const top = y - 18;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(20,14,12,0.7)';
  ctx.lineWidth = 1;
  roundRect(ctx, x - bw / 2, top - bh, bw, bh, 3);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.translate(x, top - bh / 2);
  if (a.areatype === 2) spadePath(ctx, 4.6);
  else heartPath(ctx, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  if (settings.colorblind && owner >= 0) {
    ctx.font = `900 6px ${getComputedFontFamily()}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(emblem(owner), x + bw / 2 - 3, top - 2);
  }
  // 小旗：占领后 0.6 秒升到顶
  if (owner >= 0) {
    const t0 = fx.raised.get(n);
    const k = t0 === undefined ? 1 : Math.min(1, (now - t0) / 600);
    const fy = top - bh - 1 - 7 * k;
    ctx.strokeStyle = '#4b3a2a';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2 + 2, top - bh);
    ctx.lineTo(x - bw / 2 + 2, top - bh - 10);
    ctx.stroke();
    const wave = Math.sin(now / 200 + n) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x - bw / 2 + 2, fy);
    ctx.lineTo(x - bw / 2 + 10, fy + 1.5 + wave);
    ctx.lineTo(x - bw / 2 + 2, fy + 4);
    ctx.closePath();
    ctx.fillStyle = FACTION[owner].ui;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();
  }
}

const SCHOOL_W = 30;
const SCHOOL_D = 15;
const SCHOOL_H = 24;

/** 校舍立在本部所在的棋盘外角之外；返回地基中心 */
export function schoolAnchor(bx: number, by: number): [number, number] {
  const ox = bx === by ? 0 : bx > by ? 1 : -1;
  const oy = bx === by ? (bx === 0 ? -1 : 1) : 0;
  const vx = ox * BOARD_W;
  const vy = BOARD_H / 2 + oy * (BOARD_H / 2);
  return [vx + ox * (SCHOOL_W + 6), vy + oy * (SCHOOL_D + 6) + (oy > 0 ? SLAB : 0)];
}

/** 世界坐标点是否落在校舍上（含屋顶和旗杆） */
export function hitSchool(bx: number, by: number, wx: number, wy: number): boolean {
  const [cx, cy] = schoolAnchor(bx, by);
  return Math.abs(wx - cx) <= SCHOOL_W + 2 && wy >= cy - SCHOOL_H - 31 && wy <= cy + SCHOOL_D;
}

/** 校舍：屋顶是阵营色；沦陷时插上攻陷方的旗子 */
function drawSchool(ctx: CanvasRenderingContext2D, g: Game, a: Area, now: number): void {
  const c = FACTION[a.col];
  const alive = g.player[a.col].exist;
  const w = SCHOOL_W;
  const d = SCHOOL_D;
  const hgt = SCHOOL_H;
  const [cx, cy] = schoolAnchor(a.bx, a.by);
  const grey = !alive || a.fallen;
  const wallL = grey ? '#9a9ea3' : '#e9e4d8';
  const wallR = grey ? '#7d8186' : '#cfc8b8';
  const roof = alive ? (a.fallen ? mix(c.ui, '#666', 0.55) : c.ui) : '#777b80';
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  diamond(ctx, cx + 4, cy + 2, w + 2, d + 1);
  ctx.fill();
  // 左墙、右墙
  ctx.strokeStyle = 'rgba(20,14,12,0.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.lineTo(cx, cy + d);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.lineTo(cx - w, cy - hgt);
  ctx.closePath();
  ctx.fillStyle = wallL;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + d);
  ctx.lineTo(cx + w, cy);
  ctx.lineTo(cx + w, cy - hgt);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.closePath();
  ctx.fillStyle = wallR;
  ctx.fill();
  ctx.stroke();
  // 窗户：每面两层
  ctx.fillStyle = grey ? '#5d6166' : '#5d86b8';
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 3; i++) {
      const k = (i + 0.5) / 3;
      const wy = -hgt + 6 + row * 9;
      win(ctx, cx - w + w * k, cy + d * k + wy, -1);
      win(ctx, cx + w * k, cy + d - d * k + wy, 1);
    }
  }
  // 屋顶（四坡）
  const ry = cy - hgt;
  const apexY = ry - 13;
  ctx.fillStyle = mix(roof, '#000000', 0.25);
  ctx.beginPath();
  ctx.moveTo(cx - w - 2, ry);
  ctx.lineTo(cx, ry - d - 1);
  ctx.lineTo(cx + w + 2, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w - 2, ry);
  ctx.lineTo(cx, ry + d + 1);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, ry + d + 1);
  ctx.lineTo(cx + w + 2, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = mix(roof, '#000000', 0.15);
  ctx.fill();
  ctx.stroke();
  // 校徽字
  ctx.font = `900 9px ${getComputedFontFamily()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(emblem(a.col), cx - w / 2, ry + d / 2 - 3);
  ctx.textBaseline = 'alphabetic';
  // 旗杆与旗子：平时是自己的校旗，沦陷时换成攻陷方的
  const flagCol = a.fallen && a.holder >= 0 ? a.holder : alive ? a.col : -1;
  if (flagCol >= 0) {
    ctx.strokeStyle = '#3d3a36';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, apexY);
    ctx.lineTo(cx, apexY - 18);
    ctx.stroke();
    const wave = Math.sin(now / 180) * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, apexY - 18);
    ctx.quadraticCurveTo(cx + 7, apexY - 18 + wave, cx + 13, apexY - 15);
    ctx.lineTo(cx, apexY - 11);
    ctx.closePath();
    ctx.fillStyle = FACTION[flagCol].ui;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  }
}

/** 墙面上的平行四边形小窗；side < 0 为左墙（向右下倾斜），否则为右墙 */
function win(ctx: CanvasRenderingContext2D, x: number, y: number, side: number): void {
  const slope = side < 0 ? 0.5 : -0.5;
  ctx.beginPath();
  ctx.moveTo(x - 2.5, y - 2.5 * slope);
  ctx.lineTo(x + 2.5, y + 2.5 * slope);
  ctx.lineTo(x + 2.5, y + 2.5 * slope + 4);
  ctx.lineTo(x - 2.5, y - 2.5 * slope + 4);
  ctx.closePath();
  ctx.fill();
}

/** 集结点：从本部到集结点的虚线和一面小旗 */
function drawRally(ctx: CanvasRenderingContext2D, g: Game, view: ViewState, now: number): void {
  const pl = g.player[g.user_col];
  if (!pl || pl.rally_bx < 0) {
    if (view.baseSelected && pl) {
      const [x, y] = tileCenter(pl.basex, pl.basey);
      diamond(ctx, x, y, 47, 23.5);
      ctx.strokeStyle = 'rgba(120,255,200,0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    return;
  }
  const [x0, y0] = tileCenter(pl.basex, pl.basey);
  const [x1, y1] = tileCenter(pl.rally_bx, pl.rally_by);
  const color = FACTION[g.user_col].ui;
  ctx.save();
  ctx.globalAlpha = view.baseSelected ? 0.95 : 0.45;
  ctx.setLineDash([5, 5]);
  ctx.lineDashOffset = -now / 60;
  ctx.strokeStyle = view.baseSelected ? 'rgba(120,255,200,0.95)' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  if (view.baseSelected) {
    diamond(ctx, x0, y0, 47, 23.5);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#3d3a36';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1, y1 - 20);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1 - 20);
  ctx.lineTo(x1 + 10, y1 - 17 + Math.sin(now / 200));
  ctx.lineTo(x1, y1 - 13);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

function mix(a: string, b: string, k: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (i: number) => Math.round(pa[i] * (1 - k) + pb[i] * k);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function parseHex(c: string): [number, number, number] {
  if (c.startsWith('rgb')) {
    const m = c.match(/\d+/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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

function drawMinimap(ctx: CanvasRenderingContext2D, g: Game, cam: Camera, fx: Fx, now: number): MinimapRect {
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
  ctx.font = `900 ${Math.max(7, Math.round(40 * s))}px ${getComputedFontFamily()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of g.area) {
    const cx = ox + (a.bx * 48 - a.by * 48) * s;
    const cy = oy + (a.by * 24 + a.bx * 24 + 24) * s;
    diamond(ctx, cx, cy, 48 * s, 24 * s);
    ctx.fillStyle = a.col >= 0 ? FACTION[a.col].ui : '#8b9097';
    ctx.globalAlpha = a.areatype === 1 ? (a.fallen ? 0.45 : 0.9) : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (settings.colorblind && a.col >= 0) {
      ctx.fillStyle = '#fff';
      ctx.fillText(emblem(a.col), cx, cy + 0.5);
    }
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
  // 警报光圈
  fx.pings = fx.pings.filter((f) => now - f.t0 < 3000);
  for (const f of fx.pings) {
    const k = ((now - f.t0) % 1000) / 1000;
    const cx = ox + (f.bx * 48 - f.by * 48) * s;
    const cy = oy + (f.by * 24 + f.bx * 24 + 24) * s;
    ctx.beginPath();
    ctx.arc(cx, cy, 3 + k * 12, 0, Math.PI * 2);
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
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
