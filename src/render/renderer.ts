// 画面绘制：Canvas 2D。世界坐标与原版 mcStage 内坐标一致（大格菱形 96×48，小格 24×12）。
// 分层：校园景物 → 操场 → 地面（地块、光标、行进路线）→ 按深度排序的学生与立体物件 → 特效 → 屏幕空间（框选、小地图）
import { AREA, BSIZE, CAPTURE_VALUE, PMAX, PS, RECOVER_VALUE, SIEGE_VALUE, SSIZE } from '../core/constants.ts';
import { factionSpec, stars } from '../core/query.ts';
import type { Area, Game } from '../core/types.ts';
import { getLang, t } from '../i18n/index.ts';
import { settings } from '../settings.ts';
import { FACTION, NEUTRAL } from './palette.ts';
import { drawOutlined } from './outline.ts';
import { drawScenery, schoolYard } from './scenery.ts';
import { drawStudent, drawStudentShadow } from './student.ts';

export const BOARD_W = BSIZE * 48; // 菱形半宽
export const BOARD_H = BSIZE * 48; // 菱形高
const CURB = 5; // 操场路沿的高度
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
}

export interface Fx {
  /** 升级：gain 为生命上限增加量；star 表示这次得了一颗星 */
  levelups: { pn: number; t0: number; gain: number; star: boolean }[];
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

  const [vx0, vy0] = cam.toWorld(0, 0);
  const [vx1, vy1] = cam.toWorld(W, H);
  drawScenery(ctx, g, vx0, vy0, vx1, vy1, now);
  paintBoard(ctx);
  drawGround(ctx, g, now);
  if (g.rules.ruleset === 'remake') drawRally(ctx, g, view, now);
  drawRoutes(ctx, g, ip, view, now);

  // 下令光标：进攻移动为红色
  if (view.cursorTile) drawTileCursor(ctx, view.cursorTile.bx, view.cursorTile.by, view.amove ? '#ff6a5a' : 'rgba(255,255,255,0.9)');
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
      if (g.area[it.area].areatype === AREA.SPADE) drawCamp(ctx, g, it.area, fx, now);
      else drawSpring(ctx, g, it.area, fx, now);
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
    const alive = p.stat > PS.DEAD;
    const sel = alive && view.selected.has(pn);
    const hover = alive && !sel && view.hoverPn === pn;
    const nStars = remake ? stars(p.lev) : 0;
    // 升级时向上弹一下
    const lu = fx.levelups.find((f) => f.pn === pn);
    if (lu && alive) {
      const k = (now - lu.t0) / 420;
      if (k < 1) y -= Math.sin(k * Math.PI) * (lu.star ? 7 : 5);
    }
    // 老兵脚下常驻淡金色光环
    if (nStars > 0 && alive) {
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 10 + nStars, 5 + nStars / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,214,90,${0.12 + 0.06 * nStars})`;
      ctx.fill();
    }
    if (sel) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 12 + pulse, 6 + pulse / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,255,200,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,255,200,0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (sel || hover) {
      drawStudentShadow(ctx, x, y + 6, p.col, p.show);
      drawOutlined(
        ctx, x - 22, y - 50, 44, 62,
        (c) => drawStudent(c, x, y + 6, p.col, p.dir, p.show, flash, false),
        sel ? '#78ffc8' : 'rgba(255,255,255,0.9)',
        (sel ? 1.8 : 1.1) * dpr,
        sel ? 5 * dpr : 0,
      );
    } else {
      drawStudent(ctx, x, y + 6, p.col, p.dir, p.show, flash);
    }
    if (alive && p.stat === PS.SIT && p.hp < p.mhp && healsHere(g, pn)) healPlus(ctx, x, y, now, pn);
    if (alive) {
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
      const n = nStars;
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
  return { mm: withMinimap ? drawMinimap(ctx, g, cam, fx, now, view.me ?? g.user_col) : null };
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

  // 升级：脚下金色光圈扩散、光柱升起、金色碎光上飘、头顶飘字；得星时一颗大星落到头顶
  fx.levelups = fx.levelups.filter((f) => now - f.t0 < 1300);
  for (const f of fx.levelups) {
    if (g.people[f.pn].stat <= PS.DEAD) continue;
    const k = (now - f.t0) / 1300;
    const [x, y] = unitPos(g, ip, f.pn);
    const fy = y + 6;
    ctx.save();
    // 光圈
    for (const delay of [0, 0.12]) {
      const kk = Math.max(0, Math.min(1, (k - delay) / 0.45));
      if (kk <= 0 || kk >= 1) continue;
      ctx.globalAlpha = 1 - kk;
      ctx.beginPath();
      ctx.ellipse(x, fy, 8 + kk * 22, 4 + kk * 11, 0, 0, Math.PI * 2);
      ctx.strokeStyle = f.star ? '#fff3a0' : '#ffd84a';
      ctx.lineWidth = 2.2 * (1 - kk) + 0.5;
      ctx.stroke();
    }
    // 光柱
    if (k < 0.6) {
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.45;
      const hgt = 52 + (f.star ? 18 : 0);
      const gr = ctx.createLinearGradient(0, fy - hgt, 0, fy);
      gr.addColorStop(0, 'rgba(255,240,150,0)');
      gr.addColorStop(0.6, 'rgba(255,225,110,0.45)');
      gr.addColorStop(1, 'rgba(255,215,90,0.7)');
      ctx.globalAlpha = a;
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.ellipse(x, fy, 9, 4.5, 0, 0, Math.PI);
      ctx.lineTo(x - 7, fy - hgt);
      ctx.lineTo(x + 7, fy - hgt);
      ctx.closePath();
      ctx.fill();
    }
    // 上飘的碎光（位置由槽位号和序号决定，不需要存状态）
    for (let i = 0; i < 8; i++) {
      const ph = (i * 0.618 + f.pn * 0.37) % 1;
      const kk = k * 1.4 - ph * 0.3;
      if (kk <= 0 || kk >= 1) continue;
      const ang = (i / 8) * Math.PI * 2;
      ctx.globalAlpha = 1 - kk;
      star(ctx, x + Math.cos(ang) * (6 + kk * 6), fy - 6 - kk * 36 + Math.sin(ang) * 3, 1.6, '#fff1a8');
    }
    ctx.restore();
    // 飘字
    const ta = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    const ty = y - 50 - Math.min(1, k * 2) * 12;
    ctx.globalAlpha = ta;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#3a1b00';
    ctx.font = `900 9px ${font}`;
    const title = f.star ? t('msg.star') : t('msg.levelup');
    ctx.strokeText(title, x, ty);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(title, x, ty);
    ctx.font = `bold 6.5px ${font}`;
    const sub = t('msg.levelup.gain', { n: f.gain });
    ctx.lineWidth = 2;
    ctx.strokeText(sub, x, ty + 8);
    ctx.fillStyle = '#c8ffcf';
    ctx.fillText(sub, x, ty + 8);
    // 大星从光柱顶落到头顶的星位
    if (f.star && k < 0.8) {
      const kk = Math.min(1, k / 0.5);
      const ease = 1 - (1 - kk) * (1 - kk);
      ctx.globalAlpha = 1;
      star(ctx, x, y - 72 + ease * 30, 6 - ease * 3, '#ffe14d');
    }
    ctx.globalAlpha = 1;
  }
}

/** 选中的人的行进路线：一条通往目的地的淡虚线（进攻移动为红色），终点画个落点 */
function drawRoutes(ctx: CanvasRenderingContext2D, g: Game, ip: Interp, view: ViewState, now: number): void {
  if (view.selected.size === 0) return;
  ctx.save();
  ctx.lineWidth = 1.1;
  ctx.setLineDash([3, 4]);
  ctx.lineDashOffset = -now / 50;
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
    const color = p.target_pn >= 0 || p.amove ? 'rgba(255,110,90,0.85)' : 'rgba(150,255,210,0.8)';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (p.target_pn < 0) {
      ctx.setLineDash([]);
      diamond(ctx, tx, ty, 6, 3);
      ctx.stroke();
      ctx.setLineDash([3, 4]);
    }
  }
  ctx.restore();
}

/** 单位坐着的地方能不能给它回血（己方泉水，或未沦陷的己方本部） */
function healsHere(g: Game, pn: number): boolean {
  const p = g.people[pn];
  const n = g.bmap_n[Math.floor(p.cy / 4) * BSIZE + Math.floor(p.cx / 4)];
  if (n < 0) return false;
  const a = g.area[n];
  return a.col === p.col && (a.areatype === AREA.HEART || (a.areatype === AREA.BASE && !a.fallen && g.rules.ruleset === 'remake') || (a.areatype === AREA.BASE && g.rules.ruleset === 'classic'));
}

/** 回血时头顶冒出的绿色"+"，每人错开节拍 */
function healPlus(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, pn: number): void {
  const k = ((now + pn * 233) % 1100) / 1100;
  if (k > 0.7) return;
  const kk = k / 0.7;
  ctx.save();
  ctx.globalAlpha = 1 - kk;
  ctx.translate(x + 7, y - 20 - kk * 14);
  ctx.fillStyle = '#5fe36f';
  ctx.strokeStyle = 'rgba(10,60,20,0.8)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.rect(-0.9, -3, 1.8, 6);
  ctx.rect(-3, -0.9, 6, 1.8);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
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
  // 操场四周的阴影与路沿侧面：操场比草地高一点，而不是悬在空中
  diamond(ctx, 0, BOARD_H / 2 + CURB + 3, BOARD_W + 10, BOARD_H / 2 + 5);
  ctx.fillStyle = 'rgba(20,50,15,0.28)';
  ctx.fill();
  ctx.fillStyle = '#a39c8c';
  ctx.beginPath();
  ctx.moveTo(-BOARD_W - 4, BOARD_H / 2);
  ctx.lineTo(0, BOARD_H + 2);
  ctx.lineTo(BOARD_W + 4, BOARD_H / 2);
  ctx.lineTo(BOARD_W + 4, BOARD_H / 2 + CURB);
  ctx.lineTo(0, BOARD_H + 2 + CURB);
  ctx.lineTo(-BOARD_W - 4, BOARD_H / 2 + CURB);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, BOARD_H + 2);
  ctx.lineTo(BOARD_W + 4, BOARD_H / 2);
  ctx.lineTo(BOARD_W + 4, BOARD_H / 2 + CURB);
  ctx.lineTo(0, BOARD_H + 2 + CURB);
  ctx.closePath();
  ctx.fill();
  // 路沿顶面
  diamond(ctx, 0, BOARD_H / 2, BOARD_W + 4, BOARD_H / 2 + 2);
  ctx.fillStyle = '#c9c1ae';
  ctx.fill();

  // 铺砖的操场
  diamond(ctx, 0, BOARD_H / 2, BOARD_W, BOARD_H / 2);
  ctx.fillStyle = '#ddd6c6';
  ctx.fill();
  ctx.fillStyle = '#d3cbb9';
  for (let by = 0; by < BSIZE; by++) {
    for (let bx = 0; bx < BSIZE; bx++) {
      if ((bx + by) % 2) continue;
      diamond(ctx, bx * 48 - by * 48, by * 24 + bx * 24 + 24, 48, 24);
      ctx.fill();
    }
  }
  // 砖缝：大格的线深一点，小格的线很淡
  ctx.strokeStyle = 'rgba(90,70,40,0.07)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i <= SSIZE; i++) {
    if (i % 4 === 0) continue;
    ctx.moveTo(-i * 12, i * 6);
    ctx.lineTo(BOARD_W - i * 12, BOARD_H / 2 + i * 6);
    ctx.moveTo(i * 12, i * 6);
    ctx.lineTo(-BOARD_W + i * 12, BOARD_H / 2 + i * 6);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,70,40,0.16)';
  ctx.lineWidth = 0.9;
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

/** 营地图标：帐篷剪影（中心在原点，半高 s） */
export function tentPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 1.05, s * 0.8);
  ctx.lineTo(s * 0.22, s * 0.8);
  ctx.lineTo(0, s * 0.18);
  ctx.lineTo(-s * 0.22, s * 0.8);
  ctx.lineTo(-s * 1.05, s * 0.8);
  ctx.closePath();
}

/** 泉水图标：十字（中心在原点，半宽 s） */
export function crossPath(ctx: CanvasRenderingContext2D, s: number): void {
  const w = s * 0.36;
  ctx.beginPath();
  ctx.moveTo(-w, -s);
  ctx.lineTo(w, -s);
  ctx.lineTo(w, -w);
  ctx.lineTo(s, -w);
  ctx.lineTo(s, w);
  ctx.lineTo(w, w);
  ctx.lineTo(w, s);
  ctx.lineTo(-w, s);
  ctx.lineTo(-w, w);
  ctx.lineTo(-s, w);
  ctx.lineTo(-s, -w);
  ctx.lineTo(-w, -w);
  ctx.closePath();
}

const EMBLEM_ZH = ['人', '兽', '矮', '精'];
const EMBLEM_EN = ['H', 'O', 'D', 'E'];

export function emblem(col: number): string {
  return (getLang() === 'zh' ? EMBLEM_ZH : EMBLEM_EN)[col] ?? '';
}

/** 地面层：本部场地、营地 / 泉水地块的底色与进度环 */
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
    // 地面上的淡淡符号，远看也能分辨地块种类：营地是帐篷，泉水是绿十字
    if (a.areatype === AREA.SPADE) {
      tentPath(ctx, 15);
      ctx.fillStyle = owner >= 0 ? FACTION[owner].ui : NEUTRAL;
    } else {
      crossPath(ctx, 14);
      ctx.fillStyle = '#3fbf5a';
    }
    ctx.globalAlpha = 0.32;
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

/** 地块上方的小旗：占领后 0.6 秒升到顶 */
function siteFlag(ctx: CanvasRenderingContext2D, x: number, top: number, owner: number, n: number, fx: Fx, now: number): void {
  if (owner < 0) return;
  const t0 = fx.raised.get(n);
  const k = t0 === undefined ? 1 : Math.min(1, (now - t0) / 600);
  const fy = top - 2 - 8 * k;
  ctx.strokeStyle = '#4b3a2a';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x, top + 1);
  ctx.lineTo(x, top - 11);
  ctx.stroke();
  const wave = Math.sin(now / 200 + n) * 1.2;
  ctx.beginPath();
  ctx.moveTo(x, fy);
  ctx.lineTo(x + 9, fy + 1.5 + wave);
  ctx.lineTo(x, fy + 4);
  ctx.closePath();
  ctx.fillStyle = FACTION[owner].ui;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

/** 营地：一顶帐篷，篷布是占领方的颜色 */
function drawCamp(ctx: CanvasRenderingContext2D, g: Game, n: number, fx: Fx, now: number): void {
  const a = g.area[n];
  const [x, y] = tileCenter(a.bx, a.by);
  const owner = a.col;
  const base = owner >= 0 ? FACTION[owner].ui : '#d8d2bf';
  const w = 13;
  const hgt = 19;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 1, w + 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,12,0.7)';
  ctx.lineWidth = 0.9;
  // 左右两片篷布
  ctx.beginPath();
  ctx.moveTo(x, y - hgt);
  ctx.lineTo(x - w, y);
  ctx.quadraticCurveTo(x - w / 2, y + 4.5, x, y + 5);
  ctx.closePath();
  ctx.fillStyle = mix(base, '#ffffff', 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - hgt);
  ctx.lineTo(x + w, y);
  ctx.quadraticCurveTo(x + w / 2, y + 4.5, x, y + 5);
  ctx.closePath();
  ctx.fillStyle = mix(base, '#000000', 0.18);
  ctx.fill();
  ctx.stroke();
  // 门帘
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y - 8);
  ctx.lineTo(x - 5.5, y + 3.2);
  ctx.lineTo(x + 0.5, y + 4.8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(30,20,15,0.75)';
  ctx.fill();
  // 篷布上的缝线
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y - hgt + 2);
  ctx.lineTo(x - w / 2 - 1, y + 2);
  ctx.moveTo(x, y - hgt + 2);
  ctx.lineTo(x + w / 2 + 1, y + 2);
  ctx.stroke();
  if (settings.colorblind && owner >= 0) {
    ctx.font = `900 6px ${getComputedFontFamily()}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(emblem(owner), x + 6, y - 2);
  }
  siteFlag(ctx, x, y - hgt, owner, n, fx, now);
}

/** 泉水：一口石砌小泉，水面闪光；上方浮着绿十字，归属看石沿的颜色和小旗 */
function drawSpring(ctx: CanvasRenderingContext2D, g: Game, n: number, fx: Fx, now: number): void {
  const a = g.area[n];
  const [x, y] = tileCenter(a.bx, a.by);
  const owner = a.col;
  const rx = 13;
  const ry = 6.5;
  const h = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 2, rx + 2, ry + 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 石沿侧面与顶面
  ctx.beginPath();
  ctx.ellipse(x, y + h, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(x - rx, y);
  ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = '#8f8a80';
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,12,0.6)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#bdb6a8';
  ctx.fill();
  ctx.lineWidth = owner >= 0 ? 2.2 : 0.8;
  ctx.strokeStyle = owner >= 0 ? FACTION[owner].ui : 'rgba(20,14,12,0.6)';
  ctx.stroke();
  // 水面
  ctx.beginPath();
  ctx.ellipse(x, y, rx - 3, ry - 1.8, 0, 0, Math.PI * 2);
  const wg = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
  wg.addColorStop(0, '#9fe6ff');
  wg.addColorStop(1, '#2f8fd0');
  ctx.fillStyle = wg;
  ctx.fill();
  const sh = (now / 1400 + n * 0.3) % 1;
  ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - sh)})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(x, y, (rx - 4) * sh + 1, (ry - 2.5) * sh + 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 浮在上方的十字
  const bob = Math.sin(now / 400 + n) * 1.5;
  ctx.save();
  ctx.translate(x, y - 15 + bob);
  crossPath(ctx, 5);
  ctx.fillStyle = owner >= 0 ? '#5fe36f' : '#cfd3cf';
  ctx.fill();
  ctx.strokeStyle = owner >= 0 ? 'rgba(10,70,25,0.9)' : 'rgba(60,60,60,0.7)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
  if (settings.colorblind && owner >= 0) {
    ctx.font = `900 6px ${getComputedFontFamily()}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(emblem(owner), x + rx - 2, y + 2);
  }
  siteFlag(ctx, x - rx + 2, y - 3, owner, n, fx, now);
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
  return [vx + ox * (SCHOOL_W + 8), vy + oy * (SCHOOL_D + 8) + (oy > 0 ? CURB : 0)];
}

/** 世界坐标点是否落在校舍上（含屋顶和旗杆） */
export function hitSchool(bx: number, by: number, wx: number, wy: number): boolean {
  const [cx, cy] = schoolAnchor(bx, by);
  return Math.abs(wx - cx) <= SCHOOL_W + 2 && wy >= cy - SCHOOL_H - 56 && wy <= cy + SCHOOL_D;
}

/** 各种族校舍的墙面颜色 */
const WALLS: [string, string][] = [
  ['#e9e4d8', '#cfc8b8'], // 人族：原版教学楼
  ['#9a6638', '#7a4d27'], // 兽人：木屋
  ['#b2b5b9', '#8f9398'], // 矮人：石堡
  ['#f6f3ec', '#dcd8ce'], // 精灵：白墙
];

/** 两面墙（左墙向右下、右墙向右上） */
function walls(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number, hgt: number, l: string, r: string): void {
  ctx.strokeStyle = 'rgba(20,14,12,0.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.lineTo(cx, cy + d);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.lineTo(cx - w, cy - hgt);
  ctx.closePath();
  ctx.fillStyle = l;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + d);
  ctx.lineTo(cx + w, cy);
  ctx.lineTo(cx + w, cy - hgt);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.closePath();
  ctx.fillStyle = r;
  ctx.fill();
  ctx.stroke();
}

/** 墙面上沿等距方向的一条线（k 从 0 到 1 横穿墙面，h 为离地高度） */
function wallLine(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number, h: number, left: boolean): void {
  if (left) {
    ctx.moveTo(cx - w, cy - h);
    ctx.lineTo(cx, cy + d - h);
  } else {
    ctx.moveTo(cx, cy + d - h);
    ctx.lineTo(cx + w, cy - h);
  }
}

/** 校舍：各种族一种风格，屋顶 / 旗帜是阵营色；沦陷时插上攻陷方的旗子 */
function drawSchool(ctx: CanvasRenderingContext2D, g: Game, a: Area, now: number): void {
  const col = a.col;
  const c = FACTION[col];
  const alive = g.player[col].exist;
  const w = SCHOOL_W;
  const d = SCHOOL_D;
  const hgt = col === 3 ? SCHOOL_H + 2 : col === 2 ? SCHOOL_H - 2 : SCHOOL_H;
  const [cx, cy] = schoolAnchor(a.bx, a.by);
  const grey = !alive || a.fallen;
  const tone = (v: string) => (grey ? mix(v, '#8d9196', 0.6) : v);
  const [wl, wr] = WALLS[col];
  const roof = alive ? (a.fallen ? mix(c.ui, '#666', 0.55) : c.ui) : '#777b80';
  schoolYard(ctx, col, cx, cy, w, d);
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  diamond(ctx, cx + 4, cy + 2, w + 2, d + 1);
  ctx.fill();
  walls(ctx, cx, cy, w, d, hgt, tone(wl), tone(wr));

  // 墙面细节
  ctx.save();
  if (col === 1) {
    // 木板缝
    ctx.strokeStyle = 'rgba(40,20,5,0.45)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let h = 5; h < hgt; h += 5) {
      wallLine(ctx, cx, cy, w, d, h, true);
      wallLine(ctx, cx, cy, w, d, h, false);
    }
    ctx.stroke();
  } else if (col === 2) {
    // 石块
    ctx.strokeStyle = 'rgba(40,40,48,0.35)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let h = 5; h < hgt; h += 5) {
      wallLine(ctx, cx, cy, w, d, h, true);
      wallLine(ctx, cx, cy, w, d, h, false);
      const off = (h / 5) % 2 ? 0.5 : 0;
      for (let k = 0.2 + off * 0.2; k < 1; k += 0.2) {
        ctx.moveTo(cx - w + w * k, cy + d * k - h);
        ctx.lineTo(cx - w + w * k, cy + d * k - h + 5);
        ctx.moveTo(cx + w * k, cy + d - d * k - h);
        ctx.lineTo(cx + w * k, cy + d - d * k - h + 5);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  // 窗户
  ctx.fillStyle = grey ? '#5d6166' : col === 1 ? '#2a1a0e' : col === 3 ? '#7fe0c8' : '#5d86b8';
  const rows = col === 2 ? 1 : 2;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < 3; i++) {
      const k = (i + 0.5) / 3;
      const wy = -hgt + 6 + row * 9 + (col === 2 ? 5 : 0);
      win(ctx, cx - w + w * k, cy + d * k + wy, -1, col === 3);
      win(ctx, cx + w * k, cy + d - d * k + wy, 1, col === 3);
    }
  }

  const ry = cy - hgt;
  let apexY = ry - 13;
  if (col === 2) {
    apexY = flatRoof(ctx, cx, ry, w, d, tone('#a1a5ab'), roof, now, grey);
  } else {
    const rise = col === 3 ? 38 : col === 1 ? 17 : 13;
    apexY = ry - rise;
    hipRoof(ctx, cx, ry, w, d, apexY, roof, col === 1 ? 4 : 2);
    if (col === 1) {
      // 兽人：屋脊两端的獠牙
      ctx.strokeStyle = 'rgba(20,14,12,0.7)';
      ctx.lineWidth = 0.7;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * 2, apexY + 2);
        ctx.quadraticCurveTo(cx + sx * 9, apexY - 1, cx + sx * 8, apexY - 9);
        ctx.quadraticCurveTo(cx + sx * 6, apexY - 2, cx + sx * 1, apexY + 4);
        ctx.closePath();
        ctx.fillStyle = '#f3ecd6';
        ctx.fill();
        ctx.stroke();
      }
    } else if (col === 3) {
      // 精灵：墙上的藤蔓
      ctx.fillStyle = grey ? '#7a8a7a' : '#4fae5a';
      for (let i = 0; i < 9; i++) {
        const k = (i + 0.5) / 9;
        const yy = ry + 2 + Math.sin(i * 1.7) * 2.5;
        ctx.beginPath();
        ctx.arc(cx - w + w * k, yy + d * k, 1.5, 0, Math.PI * 2);
        ctx.arc(cx + w * k, yy + d - d * k, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // 校徽字
  ctx.font = `900 9px ${getComputedFontFamily()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  if (col === 2) ctx.fillText(emblem(col), cx - w / 2, cy + d / 2 - hgt + 8);
  else ctx.fillText(emblem(col), cx - w / 2, ry + d / 2 - 3);
  ctx.textBaseline = 'alphabetic';
  // 旗杆与旗子：平时是自己的校旗，沦陷时换成攻陷方的
  const flagCol = a.fallen && a.holder >= 0 ? a.holder : alive ? col : -1;
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

/** 四坡屋顶（人族、兽人）；顶点更高就是精灵的尖塔 */
function hipRoof(ctx: CanvasRenderingContext2D, cx: number, ry: number, w: number, d: number, apexY: number, roof: string, eave: number): void {
  ctx.strokeStyle = 'rgba(20,14,12,0.6)';
  ctx.lineWidth = 0.8;
  ctx.fillStyle = mix(roof, '#000000', 0.25);
  ctx.beginPath();
  ctx.moveTo(cx - w - eave, ry);
  ctx.lineTo(cx, ry - d - 1);
  ctx.lineTo(cx + w + eave, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w - eave, ry);
  ctx.lineTo(cx, ry + d + 1);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, ry + d + 1);
  ctx.lineTo(cx + w + eave, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = mix(roof, '#000000', 0.15);
  ctx.fill();
  ctx.stroke();
}

/** 矮人石堡：平顶加城垛，一侧有冒烟的烟囱，正面挂阵营色的长幡；返回旗杆底部的高度 */
function flatRoof(
  ctx: CanvasRenderingContext2D, cx: number, ry: number, w: number, d: number, stone: string, banner: string, now: number, grey: boolean,
): number {
  diamond(ctx, cx, ry, w, d);
  ctx.fillStyle = mix(stone, '#000000', 0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,12,0.6)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 城垛：沿两条前沿的一排小方块
  ctx.fillStyle = stone;
  for (let i = 0; i <= 6; i++) {
    const k = i / 6;
    for (const [x, y] of [[cx - w + w * k, ry + d * k], [cx + w * k, ry + d - d * k]]) {
      ctx.beginPath();
      ctx.rect(x - 2, y - 4, 4, 4);
      ctx.fill();
      ctx.stroke();
    }
  }
  // 烟囱和烟
  const chx = cx + w * 0.45;
  const chy = ry - d * 0.2;
  ctx.fillStyle = '#7d6a5a';
  ctx.beginPath();
  ctx.rect(chx - 3, chy - 12, 6, 12);
  ctx.fill();
  ctx.stroke();
  if (!grey) {
    for (let i = 0; i < 3; i++) {
      const k = ((now / 2200 + i / 3) % 1);
      ctx.globalAlpha = 0.45 * (1 - k);
      ctx.fillStyle = '#e8e8e8';
      ctx.beginPath();
      ctx.arc(chx + k * 6, chy - 14 - k * 16, 2.5 + k * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 正面长幡
  const bx = cx - w * 0.5;
  const by = ry + d * 0.5;
  ctx.beginPath();
  ctx.moveTo(bx - 4, by + 1);
  ctx.lineTo(bx + 4, by + 5);
  ctx.lineTo(bx + 4, by + 15);
  ctx.lineTo(bx, by + 11);
  ctx.lineTo(bx - 4, by + 11);
  ctx.closePath();
  ctx.fillStyle = banner;
  ctx.fill();
  ctx.stroke();
  return ry - d * 0.15 - 3;
}

/** 墙面上的平行四边形小窗；side < 0 为左墙（向右下倾斜），否则为右墙；arch 为精灵的拱形窗 */
function win(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, arch = false): void {
  const slope = side < 0 ? 0.5 : -0.5;
  ctx.beginPath();
  ctx.moveTo(x - 2.5, y - 2.5 * slope);
  if (arch) ctx.quadraticCurveTo(x, y - 4, x + 2.5, y + 2.5 * slope);
  else ctx.lineTo(x + 2.5, y + 2.5 * slope);
  ctx.lineTo(x + 2.5, y + 2.5 * slope + 4);
  ctx.lineTo(x - 2.5, y - 2.5 * slope + 4);
  ctx.closePath();
  ctx.fill();
}

/** 集结点：从本部到集结点的虚线和一面小旗 */
function drawRally(ctx: CanvasRenderingContext2D, g: Game, view: ViewState, now: number): void {
  const me = view.me ?? g.user_col;
  const pl = g.player[me];
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
  const color = FACTION[me].ui;
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

function drawMinimap(ctx: CanvasRenderingContext2D, g: Game, cam: Camera, fx: Fx, now: number, me: number): MinimapRect {
  const w = Math.round(Math.min(260, Math.max(170, cam.w * 0.2)));
  const s = w / (BOARD_W * 2 + 40);
  const h = Math.round((BOARD_H + 40) * s);
  const x0 = cam.w - w - 14;
  const y0 = cam.h - h - 14;
  ctx.fillStyle = 'rgba(28,58,24,0.85)';
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
  ctx.fillStyle = '#6d6a62';
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
    ctx.fillStyle = p.col === me ? '#ffffff' : FACTION[p.col].ui;
    ctx.fillRect(dx - 1.5, dy - 1.5, 3, 3);
    if (p.col === me) {
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
