// 画面绘制：Canvas 2D，像素风（docs/06 §7）。世界坐标与原版 mcStage 内坐标一致（大格菱形 96×48，小格 24×12）。
// 整个世界先画在一张低分辨率的美术画布上（1 美术像素 = 2 世界单位，精灵都对齐像素格），
// 再按最近邻放大到不超过目标倍率的整数倍，最后用双线性缩放到任意倍率——缩放可以随意，像素仍然方正。
// 分层：背景（草地、操场、景物）→ 地面层（地盘、涂色、迷雾）→ 地块标记、路线 → 按深度排序的学生与物件 → 特效 → 屏幕空间（框选、小地图）
import { AREA, BSIZE, CAPTURE_VALUE, PMAX, PS, RECOVER_VALUE, SIEGE_VALUE, SSIZE } from '../core/constants.ts';
import { factionSpec, stars } from '../core/query.ts';
import { isLeader } from '../core/squad.ts';
import type { Area, Game } from '../core/types.ts';
import { getLang, t } from '../i18n/index.ts';
import { settings } from '../settings.ts';
import { BACK_X0, BACK_Y0, backdrop } from './backdrop.ts';
import { FOG, type FogView } from './fogview.ts';
import { BOARD_H, BOARD_W, schoolAnchor, SCHOOL_D, SCHOOL_H, SCHOOL_W, tileCenter, worldToCell } from './geom.ts';
import { GroundLayer } from './ground.ts';
import { FACTION } from './palette.ts';
import { ART, blit, pxDiamond, pxDiamondEdge, pxRect, rgb, SpriteCache, textSprite, type Sprite } from './pixel.ts';
import { studentSprite } from './pixel-student.ts';
import {
  arrowIcon, bellIcon, CHIMNEY, chevronIcon, crossIcon, crownIcon, plusIcon, schoolSprite, springSprite, starIcon, tentSprite,
  type SchoolState,
} from './props.ts';
import { RACE } from './student.ts';

export { BOARD_H, BOARD_W, schoolAnchor, tileCenter } from './geom.ts';

/** 像素字体（public/fonts，界面同用） */
export const PIXEL_FONT = '"Fusion Pixel", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 视野能看到的范围（世界坐标 x0, y0, x1, y1）：操场外留一格宽的草地，顶上多留出校舍的高度 */
const VIEW_BOUNDS = [-BOARD_W - 96, -130, BOARD_W + 96, BOARD_H + 96] as const;

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

  /**
   * 视野只在操场周围一圈之内移动：最小缩放时整个操场正好放得下，平移时屏幕边缘不越过这一圈，
   * 不会出现大半屏草地
   */
  clamp(): void {
    const [x0, y0, x1, y1] = VIEW_BOUNDS;
    const fit = Math.min(this.w / (x1 - x0), this.h / (y1 - y0));
    this.zoom = Math.min(3.5, Math.max(Math.min(1, Math.max(0.6, fit)), this.zoom));
    const hw = this.w / 2 / this.zoom;
    const hh = this.h / 2 / this.zoom;
    this.x = hw * 2 >= x1 - x0 ? (x0 + x1) / 2 : Math.min(x1 - hw, Math.max(x0 + hw, this.x));
    this.y = hh * 2 >= y1 - y0 ? (y0 + y1) / 2 : Math.min(y1 - hh, Math.max(y0 + hh, this.y));
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
  /** 鼠标悬停的己方学生（点下去就会选中它） */
  hoverPn?: number;
  /** 已按 A，下一次点地面是进攻移动 */
  amove?: boolean;
  /** 本机玩家的阵营（联机局的共享状态里 user_col 固定为 4）；省略时用 g.user_col */
  me?: number;
  /** 本机玩家眼中的迷雾；省略表示全部可见 */
  fog?: FogView | null;
}

export interface Fx {
  /** 升级：gain 为生命上限增加量；star 表示这次得了一颗星 */
  levelups: { pn: number; t0: number; gain: number; star: boolean }[];
  impacts: { x: number; y: number; t0: number; big: boolean }[];
  blink: { bx: number; by: number; pn: number; t0: number } | null;
  /** 飘字（挥空的"闪"、夹击、班长等） */
  texts: { x: number; y: number; t0: number; text: string; color?: string }[];
  /** 每个槽位最后一次挨打的时间（受击闪白、后仰） */
  hitAt: Float64Array;
  /** 击倒时冒出的星星 */
  kos: { x: number; y: number; t0: number }[];
  /** 地块被占领的时间（升旗动画） */
  raised: Map<number, number>;
  /** 小地图上的警报光圈 */
  pings: { bx: number; by: number; t0: number; color: string }[];
  /** 刚涂好的大格（闪一下边框） */
  painted: { t: number; col: number; t0: number }[];
}

export function newFx(): Fx {
  return {
    levelups: [], impacts: [], blink: null, texts: [], hitAt: new Float64Array(PMAX).fill(-1e9), kos: [],
    raised: new Map(), pings: [], painted: [],
  };
}

export interface Interp {
  prevX: Float64Array;
  prevY: Float64Array;
  alpha: number;
  /** 联机预测被纠正时的画面偏移（逐渐收回） */
  offX?: Float64Array;
  offY?: Float64Array;
}

export function newInterp(): Interp {
  return { prevX: new Float64Array(PMAX), prevY: new Float64Array(PMAX), alpha: 1 };
}

export function unitPos(g: Game, ip: Interp, pn: number): [number, number] {
  const p = g.people[pn];
  const a = ip.alpha;
  const ox = ip.offX ? ip.offX[pn] : 0;
  const oy = ip.offY ? ip.offY[pn] : 0;
  return [ip.prevX[pn] + (p.px - ip.prevX[pn]) * a + ox, ip.prevY[pn] + (p.py - ip.prevY[pn]) * a + oy];
}

// ---- 美术画布 ----

let art: HTMLCanvasElement | null = null;
let artCtx: CanvasRenderingContext2D;
let up: HTMLCanvasElement;
let upCtx: CanvasRenderingContext2D;
let ground: GroundLayer | null = null;

function surfaces(aw: number, ah: number, k: number): void {
  if (!art) {
    art = document.createElement('canvas');
    artCtx = art.getContext('2d')!;
    up = document.createElement('canvas');
    upCtx = up.getContext('2d')!;
  }
  if (art.width !== aw || art.height !== ah) {
    art.width = aw;
    art.height = ah;
  }
  if (up.width !== aw * k || up.height !== ah * k) {
    up.width = aw * k;
    up.height = ah * k;
  }
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
  const devW = ctx.canvas.width;
  const devH = ctx.canvas.height;
  // 每个美术像素占多少设备像素
  const P = (cam.zoom * dpr) / ART;
  const aw = Math.ceil(devW / P) + 2;
  const ah = Math.ceil(devH / P) + 2;
  const k = Math.max(1, Math.floor(P));
  surfaces(aw, ah, k);
  const left = (cam.x - cam.w / 2 / cam.zoom) * ART;
  const top = (cam.y - cam.h / 2 / cam.zoom) * ART;
  const ix = Math.floor(left);
  const iy = Math.floor(top);
  const a = artCtx;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, aw, ah);
  a.imageSmoothingEnabled = false;
  a.setTransform(ART, 0, 0, ART, -ix, -iy);
  drawWorld(a, g, ip, view, fx, now);

  // 最近邻放大到整数倍，再平滑缩放到实际倍率
  upCtx.imageSmoothingEnabled = false;
  upCtx.clearRect(0, 0, up.width, up.height);
  upCtx.drawImage(art!, 0, 0, aw, ah, 0, 0, aw * k, ah * k);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, devW, devH);
  ctx.imageSmoothingEnabled = Math.abs(P - k) > 0.001;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(up, 0, 0, aw * k, ah * k, (ix - left) * P, (iy - top) * P, aw * P, ah * P);
  ctx.imageSmoothingEnabled = true;

  // 屏幕空间：框选框、小地图
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (view.rect) {
    const r = view.rect;
    ctx.fillStyle = 'rgba(120,255,200,0.12)';
    ctx.strokeStyle = 'rgba(120,255,200,0.9)';
    ctx.lineWidth = 1;
    const x = Math.round(Math.min(r.x1, r.x2));
    const y = Math.round(Math.min(r.y1, r.y2));
    const w = Math.round(Math.abs(r.x2 - r.x1));
    const hh = Math.round(Math.abs(r.y2 - r.y1));
    ctx.fillRect(x, y, w, hh);
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, hh);
    ctx.setLineDash([]);
  }
  return { mm: withMinimap ? drawMinimap(ctx, g, cam, fx, now, view.me ?? g.user_col, view.fog ?? null, dpr) : null };
}

function drawWorld(a: CanvasRenderingContext2D, g: Game, ip: Interp, view: ViewState, fx: Fx, now: number): void {
  const bd = backdrop();
  a.drawImage(bd, BACK_X0, BACK_Y0, bd.width / ART, bd.height / ART);
  const fog = view.fog && view.fog.enabled ? view.fog : null;
  if (!ground) ground = new GroundLayer();
  ground.update(g, fog);
  ground.draw(a);
  drawPainted(a, fx, now);
  drawGround(a, g, now, fog);
  if (g.rules.ruleset === 'remake') {
    drawBell(a, g, now);
    drawRally(a, g, view, now);
  }
  drawRoutes(a, g, ip, view, now);

  // 下令光标：进攻移动为红色
  if (view.cursorTile) {
    const [x, y] = tileCenter(view.cursorTile.bx, view.cursorTile.by);
    pxDiamondEdge(a, x, y, 46, 23, view.amove ? '#ff6a5a' : '#ffffff', 3);
  }
  if (fx.blink && fx.blink.pn < 0) {
    const k = Math.floor((now - fx.blink.t0) / (1000 / 18));
    if (k < 7 && k % 2 === 1) {
      const [x, y] = tileCenter(fx.blink.bx, fx.blink.by);
      pxDiamondEdge(a, x, y, 46, 23, '#ffe066', 3);
    }
  }

  // 校舍在棋盘外角：上、左、右三角的在一切之后方，下角的在一切之前
  const front: Area[] = [];
  for (const ar of g.area) {
    if (ar.areatype !== AREA.BASE) continue;
    if (ar.bx === BSIZE - 1 && ar.by === BSIZE - 1) front.push(ar);
    else drawSchool(a, g, ar, now);
  }

  // 学生与标牌按深度排序（原版按小格 swapDepths；标牌插在所在大格中心那一排）
  const items: { key: number; pn: number; area: number }[] = [];
  for (let i = 0; i < PMAX; i++) {
    const p = g.people[i];
    if (p.stat === PS.EMPTY) continue;
    if (fog && !fog.unit(g, i)) continue;
    items.push({ key: (p.cx + p.cy) * 1000 + p.cx, pn: i, area: -1 });
  }
  g.area.forEach((ar, n) => {
    if (ar.areatype !== AREA.BASE) items.push({ key: (ar.bx * 4 + ar.by * 4 + 3) * 1000 + 999, pn: -1, area: n });
  });
  items.sort((x, y) => x.key - y.key);
  const remake = g.rules.ruleset === 'remake';
  for (const it of items) {
    if (it.area >= 0) {
      const ar = g.area[it.area];
      const tIdx = ar.by * BSIZE + ar.bx;
      const known = fog ? fog.owner(g, tIdx) : ar.col;
      const dim = !!fog && fog.tile(tIdx) !== FOG.SEEN;
      if (ar.areatype === AREA.SPADE) drawCamp(a, g, it.area, known, dim, fx, now);
      else drawSpring(a, g, it.area, known, dim, fx, now);
      continue;
    }
    drawUnit(a, g, ip, view, fx, now, it.pn, remake);
  }
  for (const ar of front) drawSchool(a, g, ar, now);

  // 攻击目标箭头
  const arrowPn = view.arrowPn >= 0 ? view.arrowPn : fx.blink && fx.blink.pn >= 0 ? fx.blink.pn : -1;
  if (arrowPn >= 0 && g.people[arrowPn].stat > PS.DEAD && (!fog || fog.unit(g, arrowPn))) {
    let show = true;
    if (view.arrowPn < 0 && fx.blink) {
      const k = Math.floor((now - fx.blink.t0) / (1000 / 18));
      show = k < 7 && k % 2 === 1;
    }
    if (show) {
      const [x, y] = unitPos(g, ip, arrowPn);
      blit(a, arrowIcon(), x, y - 64 + (Math.floor(now / 160) % 2) * 2);
    }
  }

  drawEffects(a, g, ip, fx, now, fog);
}

// ---- 学生 ----

const shadows = new SpriteCache();

function shadowSprite(col: number, lying: boolean): Sprite {
  return shadows.get(`${col}/${lying}`, () => {
    const sx = (RACE[col] ?? RACE[0]).body[0];
    const rx = Math.round((lying ? 15 : 9) * sx * ART);
    const ry = lying ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = rx * 2 + 1;
    canvas.height = ry * 2 + 1;
    const c = canvas.getContext('2d')!;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    for (let r = -ry; r <= ry; r++) {
      const half = Math.round(rx * Math.sqrt(1 - (r / (ry + 0.6)) ** 2));
      c.fillRect(rx - half, ry + r, half * 2 + 1, 1);
    }
    return { canvas, ax: rx - (lying ? 1 : 0), ay: ry };
  });
}

function drawUnit(
  a: CanvasRenderingContext2D, g: Game, ip: Interp, view: ViewState, fx: Fx, now: number, pn: number, remake: boolean,
): void {
  const p = g.people[pn];
  let [x, y] = unitPos(g, ip, pn);
  // 受击：闪白并向后一仰
  const since = now - fx.hitAt[pn];
  const flash = since < 160 ? 1 - since / 160 : 0;
  if (flash > 0 && p.stat > PS.DEAD) {
    const back = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]][p.dir];
    x += back[0] * 3 * flash;
    y += back[1] * 3 * flash;
  }
  const alive = p.stat > PS.DEAD;
  const sel = alive && view.selected.has(pn);
  const hover = alive && !sel && view.hoverPn === pn;
  const nStars = remake ? stars(p.lev) : 0;
  // 升级时向上弹一下
  const lu = fx.levelups.find((f) => f.pn === pn);
  let hop = 0;
  if (lu && alive) {
    const k = (now - lu.t0) / 420;
    if (k < 1) hop = Math.round(Math.sin(k * Math.PI) * (lu.star ? 4 : 3)) / ART;
  }
  const feetY = y + 6;
  const lying = p.show >= 23;
  if (p.show !== 24) blit(a, shadowSprite(p.col, lying), x, feetY);
  // 老兵脚下常驻淡金色光环；选中时一圈青色
  if (nStars > 0 && alive) pxEllipse(a, x, feetY, 11 + nStars, 5 + nStars / 2, `rgba(255,214,90,${0.25 + 0.1 * nStars})`, 1);
  if (sel) pxEllipse(a, x, feetY, 13 + (Math.floor(now / 250) % 2) * 2, 6.5 + (Math.floor(now / 250) % 2), '#78ffc8', 1);
  const sp = studentSprite(p.col, p.dir, p.show, {
    flash: flash > 0.25,
    outline: sel ? '#78ffc8' : hover ? '#ffffff' : undefined,
  });
  blit(a, sp, x, feetY - hop);
  if (!alive) return;
  if (p.stat === PS.SIT && p.hp < p.mhp && healsHere(g, pn)) {
    const k = ((now + pn * 233) % 1100) / 1100;
    if (k < 0.7) blit(a, plusIcon(), x + 10, y - 40 - k * 24);
  }
  // 血条宽度 = 生命值（原版 mcHP），所以老兵的血条更长；一个美术像素对两点生命
  const bw = Math.max(4, Math.round(p.mhp * ART));
  const bx = Math.round(x * ART) - (bw >> 1);
  const by = Math.round((feetY - 62) * ART);
  a.fillStyle = '#140c10';
  a.fillRect((bx - 1) / ART, (by - 1) / ART, (bw + 2) / ART, 4 / ART);
  a.fillStyle = '#6b1d1d';
  a.fillRect(bx / ART, by / ART, bw / ART, 2 / ART);
  a.fillStyle = p.hp / p.mhp > 0.35 ? '#5fe36f' : '#ffcf3a';
  a.fillRect(bx / ART, by / ART, Math.max(0, Math.round((p.hp / p.mhp) * bw)) / ART, 2 / ART);
  // 星、班长王冠、队员小箭头
  const iconY = (by - 4) / ART;
  if (remake && isLeader(p)) {
    blit(a, crownIcon(), x, iconY - 2 / ART);
  } else if (nStars > 0) {
    for (let i = 0; i < nStars; i++) blit(a, starIcon(), x + ((i - (nStars - 1) / 2) * 6) / ART, iconY);
  }
  if (p.squad >= 0) blit(a, chevronIcon(), (bx - 4) / ART, (by + 1) / ART);
}

/** 单位坐着的地方能不能给它回血（己方泉水，或未沦陷的己方本部） */
function healsHere(g: Game, pn: number): boolean {
  const p = g.people[pn];
  const n = g.bmap_n[Math.floor(p.cy / 4) * BSIZE + Math.floor(p.cx / 4)];
  if (n < 0) return false;
  const ar = g.area[n];
  return ar.col === p.col && (ar.areatype === AREA.HEART || (ar.areatype === AREA.BASE && !ar.fallen && g.rules.ruleset === 'remake') || (ar.areatype === AREA.BASE && g.rules.ruleset === 'classic'));
}

// ---- 像素小工具 ----

/** 椭圆：mode 0 实心，1 为 1 美术像素宽的边（只画从正上方顺时针 from–to 这一段） */
function pxEllipse(a: CanvasRenderingContext2D, wx: number, wy: number, rx: number, ry: number, color: string, mode: 0 | 1, from = 0, to = 1): void {
  a.fillStyle = color;
  const cx = Math.round(wx * ART);
  const cy = Math.round(wy * ART);
  const RX = Math.max(1, Math.round(rx * ART));
  const RY = Math.max(1, Math.round(ry * ART));
  if (mode === 0) {
    for (let r = -RY; r <= RY; r++) {
      const half = Math.round(RX * Math.sqrt(Math.max(0, 1 - (r / (RY + 0.5)) ** 2)));
      a.fillRect((cx - half) / ART, (cy + r) / ART, (2 * half + 1) / ART, 1 / ART);
    }
    return;
  }
  const n = Math.ceil((RX + RY) * 4);
  let lx = 1e9;
  let ly = 1e9;
  for (let i = 0; i <= n; i++) {
    const k = from + ((to - from) * i) / n;
    const ang = -Math.PI / 2 + k * Math.PI * 2;
    const px = cx + Math.round(Math.cos(ang) * RX);
    const py = cy + Math.round(Math.sin(ang) * RY);
    if (px === lx && py === ly) continue;
    lx = px;
    ly = py;
    a.fillRect(px / ART, py / ART, 1 / ART, 1 / ART);
  }
}

/** 像素直线（Bresenham）；dash 为虚线周期（美术像素），phase 让虚线流动 */
function pxLine(a: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, dash = 0, phase = 0): void {
  a.fillStyle = color;
  let X0 = Math.round(x0 * ART);
  let Y0 = Math.round(y0 * ART);
  const X1 = Math.round(x1 * ART);
  const Y1 = Math.round(y1 * ART);
  const dx = Math.abs(X1 - X0);
  const dy = -Math.abs(Y1 - Y0);
  const sx = X0 < X1 ? 1 : -1;
  const sy = Y0 < Y1 ? 1 : -1;
  let err = dx + dy;
  let i = 0;
  for (let guard = 0; guard < 4000; guard++) {
    if (!dash || (((i + phase) % dash) + dash) % dash < dash / 2) a.fillRect(X0 / ART, Y0 / ART, 1 / ART, 1 / ART);
    if (X0 === X1 && Y0 === Y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      X0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      Y0 += sy;
    }
    i++;
  }
}

/** 像素字（美术画布上 12 像素高）：底边中点（align 为 left 时左端）对准世界坐标 */
function pxText(a: CanvasRenderingContext2D, text: string, wx: number, wy: number, color: string, outline: string | null = '#140c10', align: 'center' | 'left' = 'center'): void {
  const s = textSprite(text, color, outline || null, PIXEL_FONT);
  blit(a, align === 'left' ? { ...s, ax: 2 } : s, wx, wy);
}

// ---- 地块 ----

const EMBLEM_ZH = ['人', '兽', '矮', '精'];
const EMBLEM_EN = ['H', 'O', 'D', 'E'];

export function emblem(col: number): string {
  return (getLang() === 'zh' ? EMBLEM_ZH : EMBLEM_EN)[col] ?? '';
}

/** 地面上的地块标记：本部校徽与出兵进度、占领进度圈（地盘底色在地面层里） */
function drawGround(a: CanvasRenderingContext2D, g: Game, now: number, fog: FogView | null): void {
  for (const ar of g.area) {
    const [x, y] = tileCenter(ar.bx, ar.by);
    const tIdx = ar.by * BSIZE + ar.bx;
    const seen = !fog || fog.tile(tIdx) === FOG.SEEN;
    if (ar.areatype === AREA.BASE) {
      const alive = g.player[ar.col].exist;
      pxDiamondEdge(a, x, y, 40, 20, ar.fallen ? 'rgba(60,0,0,0.5)' : 'rgba(255,255,255,0.45)', ar.fallen ? 3 : 0);
      pxText(a, emblem(ar.col), x, y + 10, alive ? '#ffffff' : '#c8c8c8', null);
      if (alive && !ar.fallen && settings.showSpawn && (!fog || ar.col === fog.me)) {
        const need = factionSpec(g.rules.ruleset, ar.col).appear;
        const k = Math.min(1, g.player[ar.col].appear_cnt / need);
        pxEllipse(a, x, y, 34, 17, 'rgba(255,255,255,0.85)', 1, 0, k);
      }
      if (settings.showCapture && seen) {
        // 攻陷进度（敌方）或夺回进度（己方）
        const need = ar.fallen ? RECOVER_VALUE : SIEGE_VALUE;
        let best = -1;
        for (let c2 = 0; c2 < 4; c2++) {
          if (ar.val[c2] <= 0) continue;
          if (ar.fallen ? c2 !== ar.col : c2 === ar.col) continue;
          if (best < 0 || ar.val[c2] > ar.val[best]) best = c2;
        }
        if (best >= 0) progressRing(a, x, y, 40, ar.val[best] / need, FACTION[best].ui, now);
      }
      continue;
    }
    if (settings.showCapture && seen) {
      const owner = ar.col;
      let best = -1;
      for (let c = 0; c < 4; c++) if (c !== owner && ar.val[c] > 0 && (best < 0 || ar.val[c] > ar.val[best])) best = c;
      if (best >= 0) progressRing(a, x, y, 36, ar.val[best] / CAPTURE_VALUE, FACTION[best].ui, now);
    }
  }
}

function progressRing(a: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, color: string, now: number): void {
  pxEllipse(a, x, y, r, r / 2, 'rgba(0,0,0,0.25)', 1);
  pxEllipse(a, x, y, r, r / 2, Math.floor(now / 150) % 2 ? color : '#ffffff', 1, 0, Math.min(1, k));
  pxEllipse(a, x, y, r - 2, r / 2 - 1, color, 1, 0, Math.min(1, k));
}

/** 刚涂好的大格：边框闪两下 */
function drawPainted(a: CanvasRenderingContext2D, fx: Fx, now: number): void {
  fx.painted = fx.painted.filter((f) => now - f.t0 < 600);
  for (const f of fx.painted) {
    if (Math.floor((now - f.t0) / 150) % 2) continue;
    const [x, y] = tileCenter(f.t % BSIZE, Math.floor(f.t / BSIZE));
    pxDiamondEdge(a, x, y, 47, 23.5, '#ffffff');
  }
}

/** 下课铃：小卖部所在的大格金边闪烁，上方一口晃动的铃铛和剩余秒数 */
function drawBell(a: CanvasRenderingContext2D, g: Game, now: number): void {
  const b = g.bell;
  if (b.bx < 0 || g.tick >= b.until) return;
  const [x, y] = tileCenter(b.bx, b.by);
  const on = Math.floor(now / 300) % 2 === 0;
  pxDiamondEdge(a, x, y, 47, 23.5, on ? '#ffd84a' : '#fff3a0');
  pxDiamondEdge(a, x, y, 43, 21.5, 'rgba(255,216,74,0.6)', 2);
  const swing = [0, 1, 0, -1][Math.floor(now / 180) % 4];
  blit(a, bellIcon(), x + swing / ART, y - 26);
  const left = Math.ceil((b.until - g.tick) / 18);
  pxText(a, `${left}`, x, y - 50, '#fff3a0');
}

/** 地块上方的小旗：占领后 0.6 秒升到顶 */
function siteFlag(a: CanvasRenderingContext2D, x: number, top: number, owner: number, n: number, fx: Fx, now: number): void {
  if (owner < 0) return;
  const t0 = fx.raised.get(n);
  const k = t0 === undefined ? 1 : Math.min(1, (now - t0) / 600);
  const X = Math.round(x * ART);
  const T = Math.round(top * ART);
  a.fillStyle = '#3a2a1c';
  a.fillRect(X / ART, (T - 7) / ART, 1 / ART, 8 / ART);
  const fy = T - 2 - Math.round(4 * k);
  const wave = Math.floor(now / 250 + n) % 2;
  a.fillStyle = FACTION[owner].ui;
  a.fillRect((X + 1) / ART, (fy - 1) / ART, 4 / ART, 1 / ART);
  a.fillRect((X + 1) / ART, fy / ART, (5 - wave) / ART, 1 / ART);
  a.fillRect((X + 1) / ART, (fy + 1) / ART, 3 / ART, 1 / ART);
}

function drawCamp(a: CanvasRenderingContext2D, g: Game, n: number, owner: number, dim: boolean, fx: Fx, now: number): void {
  const ar = g.area[n];
  const [x, y] = tileCenter(ar.bx, ar.by);
  const o = owner === -2 ? -1 : owner;
  blit(a, tentSprite(o, dim), x, y);
  if (!dim) siteFlag(a, x, y - 22, o, n, fx, now);
  if (settings.colorblind && o >= 0) pxText(a, emblem(o), x + 12, y + 2, '#ffffff');
}

function drawSpring(a: CanvasRenderingContext2D, g: Game, n: number, owner: number, dim: boolean, fx: Fx, now: number): void {
  const ar = g.area[n];
  const [x, y] = tileCenter(ar.bx, ar.by);
  const o = owner === -2 ? -1 : owner;
  blit(a, springSprite(o, dim), x, y);
  if (!dim) {
    // 水面上一闪一闪的高光
    const ph = Math.floor(now / 400 + n) % 3;
    a.fillStyle = '#ffffff';
    a.fillRect((Math.round(x * ART) - 2 + ph * 2) / ART, (Math.round(y * ART) - 1) / ART, 1 / ART, 1 / ART);
    const bob = Math.floor(now / 400 + n) % 2;
    blit(a, crossIcon(o >= 0), x, y - 30 - bob / ART);
    siteFlag(a, x - 12, y - 4, o, n, fx, now);
  }
  if (settings.colorblind && o >= 0) pxText(a, emblem(o), x + 14, y + 6, '#ffffff');
}

// ---- 校舍 ----

/** 世界坐标点是否落在校舍上（含屋顶和旗杆） */
export function hitSchool(bx: number, by: number, wx: number, wy: number): boolean {
  const [cx, cy] = schoolAnchor(bx, by);
  return Math.abs(wx - cx) <= SCHOOL_W + 2 && wy >= cy - SCHOOL_H - 56 && wy <= cy + SCHOOL_D;
}

function drawSchool(a: CanvasRenderingContext2D, g: Game, ar: Area, now: number): void {
  const col = ar.col;
  const alive = g.player[col].exist;
  const state: SchoolState = !alive ? 'dead' : ar.fallen ? 'fallen' : 'ok';
  const [cx, cy] = schoolAnchor(ar.bx, ar.by);
  pxDiamond(a, cx + 4, cy + 2, SCHOOL_W + 2, SCHOOL_D + 1, 'rgba(0,0,0,0.25)');
  const { sprite, apexY } = schoolSprite(col, state);
  blit(a, sprite, cx, cy);
  // 矮人烟囱冒烟
  if (col === 2 && state === 'ok') {
    for (let i = 0; i < 3; i++) {
      const k = (now / 2200 + i / 3) % 1;
      const r = 1 + Math.round(k * 2);
      a.fillStyle = `rgba(232,232,232,${(0.6 * (1 - k)).toFixed(2)})`;
      const X = Math.round((cx + CHIMNEY[0] + k * 6) * ART);
      const Y = Math.round((cy + CHIMNEY[1] - 14 - k * 16) * ART);
      a.fillRect((X - r) / ART, (Y - r + 1) / ART, (2 * r) / ART, (2 * r - 2) / ART);
      a.fillRect((X - r + 1) / ART, (Y - r) / ART, (2 * r - 2) / ART, (2 * r) / ART);
    }
  }
  // 旗杆与旗子：平时是自己的校旗，沦陷时换成攻陷方的
  const flagCol = ar.fallen && ar.holder >= 0 ? ar.holder : alive ? col : -1;
  if (flagCol < 0) return;
  const X = Math.round(cx * ART);
  const top = Math.round((cy + apexY) * ART);
  a.fillStyle = '#3d3a36';
  a.fillRect(X / ART, (top - 10) / ART, 1 / ART, 10 / ART);
  const wave = Math.floor(now / 220) % 2;
  a.fillStyle = '#140c10';
  a.fillRect((X + 1) / ART, (top - 11) / ART, 7 / ART, 6 / ART);
  a.fillStyle = FACTION[flagCol].ui;
  a.fillRect((X + 1) / ART, (top - 10) / ART, 6 / ART, (2 + wave) / ART);
  a.fillRect((X + 1) / ART, (top - 8 + wave) / ART, (5 - wave) / ART, (2 - wave) / ART);
  a.fillRect((X + 1) / ART, (top - 7) / ART, 3 / ART, 1 / ART);
}

// ---- 路线与集结点 ----

/** 选中的人的行进路线：一条通往目的地的流动虚线（进攻移动为红色），终点画个落点 */
function drawRoutes(a: CanvasRenderingContext2D, g: Game, ip: Interp, view: ViewState, now: number): void {
  if (view.selected.size === 0) return;
  const phase = -Math.floor(now / 80);
  for (const pn of view.selected) {
    const p = g.people[pn];
    if (p.stat !== PS.WALK && p.stat !== PS.WAIT) continue;
    let tx: number;
    let ty: number;
    if (p.target_pn >= 0) {
      const tp = g.people[p.target_pn];
      tx = tp.px;
      ty = tp.py + 6;
    } else {
      const dx = p.amove ? p.goal_x : p.dest_sx;
      const dy = p.amove ? p.goal_y : p.dest_sy;
      tx = dx * 12 - dy * 12;
      ty = dy * 6 + dx * 6 + 6;
    }
    const [x, y] = unitPos(g, ip, pn);
    const color = p.target_pn >= 0 || p.amove ? 'rgba(255,110,90,0.9)' : 'rgba(150,255,210,0.85)';
    pxLine(a, x, y + 6, tx, ty, color, 6, phase);
    if (p.target_pn < 0) pxDiamondEdge(a, tx, ty, 8, 4, color);
  }
}

/** 集结点：从本部到集结点的虚线和一面小旗 */
function drawRally(a: CanvasRenderingContext2D, g: Game, view: ViewState, now: number): void {
  const me = view.me ?? g.user_col;
  const pl = g.player[me];
  if (!pl) return;
  if (view.baseSelected) {
    const [x, y] = tileCenter(pl.basex, pl.basey);
    pxDiamondEdge(a, x, y, 47, 23.5, '#78ffc8');
  }
  if (pl.rally_bx < 0) return;
  const [x0, y0] = tileCenter(pl.basex, pl.basey);
  const [x1, y1] = tileCenter(pl.rally_bx, pl.rally_by);
  pxLine(a, x0, y0, x1, y1, view.baseSelected ? '#78ffc8' : 'rgba(255,255,255,0.55)', 8, -Math.floor(now / 90));
  const X = Math.round(x1 * ART);
  const Y = Math.round(y1 * ART);
  a.fillStyle = '#3d3a36';
  a.fillRect(X / ART, (Y - 11) / ART, 1 / ART, 11 / ART);
  const wave = Math.floor(now / 220) % 2;
  a.fillStyle = '#ffffff';
  a.fillRect((X + 1) / ART, (Y - 12) / ART, 6 / ART, 6 / ART);
  a.fillStyle = FACTION[me].ui;
  a.fillRect((X + 1) / ART, (Y - 11) / ART, (5 - wave) / ART, 4 / ART);
}

// ---- 特效 ----

const SPARK = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];

function drawEffects(a: CanvasRenderingContext2D, g: Game, ip: Interp, fx: Fx, now: number, fog: FogView | null): void {
  const visible = (x: number, y: number) => {
    if (!fog) return true;
    const [cx, cy] = worldToCell(x, y);
    return fog.point(cx, cy);
  };
  // 出拳火花：一圈向外飞的像素点
  fx.impacts = fx.impacts.filter((f) => now - f.t0 < 260);
  for (const f of fx.impacts) {
    if (!visible(f.x, f.y)) continue;
    const k = (now - f.t0) / 260;
    const r = 3 + k * (f.big ? 14 : 9);
    const X = Math.round(f.x * ART);
    const Y = Math.round((f.y - 22) * ART);
    a.fillStyle = k < 0.5 || f.big ? '#ffffff' : '#ffe680';
    for (let i = 0; i < (f.big ? 8 : 4); i++) {
      const [dx, dy] = SPARK[i];
      const px = X + Math.round(dx * r * ART);
      const py = Y + Math.round(dy * r * ART * 0.8);
      a.fillRect(px / ART, py / ART, (k < 0.5 ? 2 : 1) / ART, (k < 0.5 ? 2 : 1) / ART);
    }
    if (k < 0.3) a.fillRect((X - 1) / ART, (Y - 1) / ART, 3 / ART, 3 / ART);
  }

  // 击倒：头上转圈的星星
  fx.kos = fx.kos.filter((f) => now - f.t0 < 1400);
  for (const f of fx.kos) {
    if (!visible(f.x, f.y)) continue;
    const k = (now - f.t0) / 1400;
    if (k > 0.75 && Math.floor(now / 80) % 2) continue;
    for (let i = 0; i < 3; i++) {
      const ang = now / 220 + (i * Math.PI * 2) / 3;
      blit(a, starIcon(), f.x + Math.cos(ang) * 12, f.y - 18 + Math.sin(ang) * 4);
    }
  }

  // 飘字
  fx.texts = fx.texts.filter((f) => now - f.t0 < 800);
  for (const f of fx.texts) {
    if (!visible(f.x, f.y)) continue;
    const k = (now - f.t0) / 800;
    if (k > 0.7 && Math.floor(now / 70) % 2) continue;
    pxText(a, f.text, f.x + 8, f.y - 52 - Math.round(k * 8) * 2, f.color ?? '#bfe6ff');
  }

  // 升级：脚下光圈扩散、光柱升起、金色碎光上飘、头顶飘字；得星时一颗大星落到头顶
  fx.levelups = fx.levelups.filter((f) => now - f.t0 < 1300);
  for (const f of fx.levelups) {
    if (g.people[f.pn].stat <= PS.DEAD) continue;
    if (fog && !fog.unit(g, f.pn)) continue;
    const k = (now - f.t0) / 1300;
    const [x, y] = unitPos(g, ip, f.pn);
    const fy = y + 6;
    for (const delay of [0, 0.12]) {
      const kk = (k - delay) / 0.45;
      if (kk <= 0 || kk >= 1) continue;
      pxEllipse(a, x, fy, 8 + kk * 22, 4 + kk * 11, f.star ? '#fff3a0' : '#ffd84a', 1);
    }
    if (k < 0.6) {
      const al = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.45;
      const hgt = 56 + (f.star ? 18 : 0);
      for (let i = 0; i < 4; i++) {
        a.fillStyle = `rgba(255,225,110,${(al * (0.25 + i * 0.12)).toFixed(2)})`;
        const X = Math.round(x * ART);
        const top = Math.round((fy - hgt * (1 - i * 0.2)) * ART);
        a.fillRect((X - 4 + i) / ART, top / ART, (8 - 2 * i) / ART, (Math.round(fy * ART) - top) / ART);
      }
    }
    for (let i = 0; i < 8; i++) {
      const ph = (i * 0.618 + f.pn * 0.37) % 1;
      const kk = k * 1.4 - ph * 0.3;
      if (kk <= 0 || kk >= 1) continue;
      const ang = (i / 8) * Math.PI * 2;
      pxRect(a, x + Math.cos(ang) * (8 + kk * 8), fy - 8 - kk * 40 + Math.sin(ang) * 3, 1, 1, '#fff1a8');
    }
    if (k < 0.75 || Math.floor(now / 70) % 2 === 0) {
      const ty = y - 76 - Math.round(Math.min(1, k * 2) * 6) * 2;
      pxText(a, f.star ? t('msg.star') : t('msg.levelup'), x, ty, '#ffd84a', '#3a1b00');
    }
    if (f.star && k < 0.8) {
      const kk = Math.min(1, k / 0.5);
      const ease = 1 - (1 - kk) * (1 - kk);
      blit(a, starIcon(ease < 1), x, y - 100 + ease * 40);
    }
  }
}

// ---- 小地图 ----

export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  s: number;
  ox: number;
  oy: number;
}

/** 小地图：每个大格 12×6 像素的小菱形，按整数倍放大贴到屏幕右下角 */
const MM_TILE = 12;
const MM_PAD = 6;
let mmCanvas: HTMLCanvasElement | null = null;

function drawMinimap(
  ctx: CanvasRenderingContext2D, g: Game, cam: Camera, fx: Fx, now: number, me: number, fog: FogView | null, dpr: number,
): MinimapRect {
  const bw = BSIZE * MM_TILE;
  const bh = BSIZE * (MM_TILE / 2);
  const w = bw + MM_PAD * 2;
  const h = bh + MM_PAD * 2;
  if (!mmCanvas) {
    mmCanvas = document.createElement('canvas');
    mmCanvas.width = w;
    mmCanvas.height = h;
  }
  const m = mmCanvas.getContext('2d')!;
  m.clearRect(0, 0, w, h);
  m.fillStyle = '#1e3a1a';
  m.fillRect(1, 0, w - 2, h);
  m.fillRect(0, 1, w, h - 2);
  m.fillStyle = '#2c5426';
  m.fillRect(2, 1, w - 4, h - 2);
  m.fillRect(1, 2, w - 2, h - 4);
  const ox = MM_PAD + bw / 2;
  const oy = MM_PAD;
  const half = MM_TILE / 2;
  const q = MM_TILE / 4;
  const on = !!fog && fog.enabled;
  for (let tIdx = 0; tIdx < BSIZE * BSIZE; tIdx++) {
    const bx = tIdx % BSIZE;
    const by = (tIdx - bx) / BSIZE;
    const cx = ox + (bx - by) * half;
    const cy = oy + (bx + by) * q + q;
    const n = g.bmap_n[tIdx];
    const owner = on
      ? fog!.owner(g, tIdx)
      : n >= 0 ? (g.area[n].fallen ? g.area[n].holder : g.area[n].col) : g.rules.ruleset === 'remake' ? g.terr[tIdx] : -1;
    let color = (bx + by) % 2 ? '#7c786e' : '#87837a';
    if (owner >= 0) color = n >= 0 && g.area[n].areatype !== AREA.BASE ? mixRgb(FACTION[owner].ui, '#ffffff', 0.3) : FACTION[owner].ui;
    else if (n >= 0) color = '#b5b9b6';
    if (on) {
      const st = fog!.tile(tIdx);
      if (st === FOG.DARK) color = '#1a1e2a';
      else if (st === FOG.MEMORY) color = mixRgb(color, '#141826', 0.45);
    }
    m.fillStyle = color;
    for (let r = 0; r < MM_TILE / 2; r++) {
      const k = r < q ? r + 1 : MM_TILE / 2 - r;
      m.fillRect(cx - k * 2, cy - q + r, k * 4, 1);
    }
  }
  for (let i = 0; i < PMAX; i++) {
    const p = g.people[i];
    if (p.stat <= PS.DEAD) continue;
    if (on && !fog!.unit(g, i)) continue;
    const dx = Math.round(ox + (p.px * MM_TILE) / 96);
    const dy = Math.round(oy + ((p.py + 6) * MM_TILE) / 96);
    m.fillStyle = '#140c10';
    m.fillRect(dx - 1, dy - 1, 3, 3);
    m.fillStyle = p.col === me ? '#ffffff' : FACTION[p.col].ui;
    if (p.col === me) m.fillRect(dx - 1, dy - 1, 2, 2);
    else m.fillRect(dx, dy, 1, 1);
  }
  // 下课铃
  const b = g.bell;
  if (g.rules.ruleset === 'remake' && b.bx >= 0 && g.tick < b.until && Math.floor(now / 300) % 2 === 0) {
    m.fillStyle = '#ffd84a';
    m.fillRect(ox + (b.bx - b.by) * half - 2, oy + (b.bx + b.by) * q + q - 2, 4, 4);
  }
  // 警报光圈
  fx.pings = fx.pings.filter((f) => now - f.t0 < 3000);
  for (const f of fx.pings) {
    const k = ((now - f.t0) % 1000) / 1000;
    const cx = ox + (f.bx - f.by) * half;
    const cy = oy + (f.bx + f.by) * q + q;
    const r = Math.round(2 + k * 10);
    m.fillStyle = f.color;
    m.globalAlpha = 1 - k;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      m.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r * 0.6), 1, 1);
    }
    m.globalAlpha = 1;
  }
  // 当前视野框
  const s = MM_TILE / 96;
  const [wx0, wy0] = cam.toWorld(0, 0);
  const [wx1, wy1] = cam.toWorld(cam.w, cam.h);
  const rx0 = Math.max(1, Math.round(ox + wx0 * s));
  const ry0 = Math.max(1, Math.round(oy + wy0 * s));
  const rx1 = Math.min(w - 2, Math.round(ox + wx1 * s));
  const ry1 = Math.min(h - 2, Math.round(oy + wy1 * s));
  m.fillStyle = '#ffffff';
  m.fillRect(rx0, ry0, rx1 - rx0 + 1, 1);
  m.fillRect(rx0, ry1, rx1 - rx0 + 1, 1);
  m.fillRect(rx0, ry0, 1, ry1 - ry0 + 1);
  m.fillRect(rx1, ry0, 1, ry1 - ry0 + 1);

  // 屏幕上放大到整数倍（宽度约占屏幕 1/5）
  const zoom = Math.max(1, Math.round(Math.min(260, Math.max(170, cam.w * 0.2)) / w));
  const x0 = Math.round((cam.w - w * zoom - 14) * dpr) / dpr;
  const y0 = Math.round((cam.h - h * zoom - 14) * dpr) / dpr;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mmCanvas, x0, y0, w * zoom, h * zoom);
  ctx.imageSmoothingEnabled = true;
  return { x: x0, y: y0, w: w * zoom, h: h * zoom, s: s * zoom, ox: x0 + ox * zoom, oy: y0 + oy * zoom };
}

function mixRgb(a: string, b: string, k: number): string {
  const pa = rgb(a);
  const pb = rgb(b);
  const ch = (i: number) => Math.round(pa[i] * (1 - k) + pb[i] * k);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

/** 小地图坐标 → 世界坐标 */
export function minimapToWorld(mm: { ox: number; oy: number; s: number }, sx: number, sy: number): [number, number] {
  return [(sx - mm.ox) / mm.s, (sy - mm.oy) / mm.s];
}

/** 这一小格此刻是否看得见（界面判断能不能点到敌人） */
export function cellVisible(fog: FogView | null | undefined, cx: number, cy: number): boolean {
  return !fog || cx < 0 || cy < 0 || cx >= SSIZE || cy >= SSIZE || fog.cellAt(cx, cy) === FOG.SEEN;
}
