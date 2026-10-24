// 对局画面：固定 18 tick/s 推进模拟，按显示器刷新率插值绘制；处理操作、HUD、菜单
import { play } from '../audio/sfx.ts';
import {
  AREA, CAPTURE_VALUE, FPS, KILL_MHP, PMAX, PS, RECOVER_VALUE, SIEGE_VALUE, STAR_KILLS, STAR_MAX, TOP_RATIO,
} from '../core/constants.ts';
import { step, spadeCount } from '../core/sim.ts';
import type { Command, Game, GameEvent } from '../core/types.ts';
import { factionName, formatTime, t, type TextKey } from '../i18n/index.ts';
import {
  Camera, hitSchool, minimapToWorld, newFx, newInterp, render, tileCenter, unitPos, type Fx, type MinimapRect, type ViewState,
} from '../render/renderer.ts';
import { FACTION } from '../render/palette.ts';
import { writeSlot } from '../save/storage.ts';
import type { NetClient } from '../net/client.ts';
import { saveSettings, settings } from '../settings.ts';
import { h, modal } from './dom.ts';
import { openSaveLoad, openSettings } from './panels.ts';

const TICK_MS = 1000 / FPS;
const AUTOSAVE_TICKS = 60 * FPS;
/** 双击 / 连按的判定间隔 */
const DOUBLE_MS = 350;
/** 同一地块的警报至少间隔多久 */
const ALERT_COOLDOWN = 15_000;

export interface GameScreenHooks {
  onQuit: () => void;
  onRestart: (sameMap: boolean) => void;
  onLoad: (g: Game) => void;
}

/** 联机对局（docs/05）：模拟由 NetClient 驱动，没有暂停、倍速和存档 */
export interface NetGame {
  client: NetClient;
  /** 每个座位的玩家名（电脑座位为空串） */
  names: string[];
  /** 连接状态一行字，以及是否要醒目提示 */
  status(): { text: string; warn: boolean };
  /** 离开对局（回到房间大厅） */
  leave(): void;
}

export class GameScreen {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam = new Camera();
  private ip = newInterp();
  private fx: Fx = newFx();
  private view: ViewState = { selected: new Set(), cursorTile: null, arrowPn: -1, rect: null, hoverPn: -1, amove: false };
  private pending: Command[] = [];
  private acc = 0;
  private last = 0;
  private raf = 0;
  private zoomInit = false;
  private menuOpen = false;
  private speed = 1;
  private dpr = 1;
  private mm: MinimapRect | null = null;
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private drag: { kind: 'select' | 'pan' | 'minimap'; sx: number; sy: number; camX: number; camY: number; add: boolean } | null = null;
  private resultShown = false;
  private resultAt = 0;
  private lastAutosave = 0;
  private hud: {
    chips: HTMLElement[];
    clock: HTMLElement;
    speed: HTMLButtonElement;
    netLine: HTMLElement;
    selbar: HTMLElement;
    selText: HTMLElement;
    selHint: HTMLElement;
    banner: HTMLElement;
    tips: HTMLElement | null;
    power: HTMLElement;
    alerts: HTMLElement;
    tooltip: HTMLElement;
  };
  private lastGroupKey = { n: -1, t: 0 };
  private lastClick = { pn: -1, t: 0 };
  /** 己方各地块上一帧的敌方进度总和、上次报警时间 */
  private threatSeen = new Map<number, number>();
  private alertAt = new Map<number, number>();
  private tipKey = '';
  private bannerTimer = 0;
  private game: Game;
  private hooks: GameScreenHooks;
  /** 本机玩家的阵营（4 为观战）；联机局的共享状态里 user_col 固定为 4 */
  private me: number;
  private net: NetGame | null;
  /** 编队：单机随存档保存在 g.groups；联机只存在本机 */
  private groups: number[][];
  private lastThreatTick = -1;

  constructor(game: Game, hooks: GameScreenHooks, net: NetGame | null = null) {
    this.game = game;
    this.hooks = hooks;
    this.net = net;
    this.me = net ? (net.client.seat >= 0 ? net.client.seat : 4) : game.user_col;
    this.groups = net ? Array.from({ length: 10 }, () => []) : game.groups;
    this.view.me = this.me;
    this.canvas = h('canvas', { class: 'game-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    const chips = [0, 1, 2, 3].map(() => h('div', { class: 'chip' }));
    const clock = h('span', { class: 'clock' });
    const speed = h('button', { class: `btn small ghost${net ? ' hidden' : ''}`, title: t('hud.speed'), onClick: () => this.toggleSpeed() });
    const netLine = h('span', { class: `net-line${net ? '' : ' hidden'}` });
    const selText = h('span', { class: 'sel-text' });
    const selHint = h('span', { class: 'sel-hint' });
    const selbar = h('div', { class: 'selbar hidden' }, selText, selHint, h('button', { class: 'btn small', onClick: () => this.cancelSelection(true) }, t('hud.cancel')));
    const banner = h('div', { class: 'banner' });
    const power = h('div', { class: 'power', title: t('power.tip') });
    const alerts = h('div', { class: 'alerts' });
    const tooltip = h('div', { class: 'tooltip hidden' });
    const top = h(
      'div',
      { class: 'hud-top' },
      h('div', { class: 'hud-left' }, h('div', { class: 'chips' }, ...chips), power),
      h('div', { class: 'hud-right' }, netLine, clock, speed, h('button', { class: 'btn small ghost', title: t(net ? 'hud.menu' : 'hud.pause'), onClick: () => this.openPause() }, net ? '☰' : '❚❚')),
    );
    let tips: HTMLElement | null = null;
    if (!settings.tipsSeen && this.me < 4) {
      tips = h(
        'div',
        { class: 'tips' },
        h('div', { class: 'tips-title' }, t('tips.title')),
        h('div', { class: 'tips-body' }, t(game.rules.ruleset === 'remake' ? 'tips.body.remake' : 'tips.body')),
        h('button', {
          class: 'btn small',
          onClick: () => {
            settings.tipsSeen = true;
            saveSettings();
            tips?.remove();
          },
        }, t('tips.ok')),
      );
    }
    this.root = h('div', { class: 'game-screen' }, this.canvas, h('div', { class: 'hud' }, top, alerts, selbar, banner, tips), tooltip);
    this.hud = { chips, clock, speed, netLine, selbar, selText, selHint, banner, tips, power, alerts, tooltip };
    this.updateSpeedLabel();
    this.initCamera();
    this.snapInterp();
    this.lastAutosave = game.tick;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.autosave);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    this.canvas.addEventListener('mouseenter', () => (this.mouse.inside = true));
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.autosave);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.root.remove();
  }

  /** 供语言切换后刷新静态文字 */
  refreshTexts(): void {
    this.hud.tips?.remove();
    this.updateSpeedLabel();
  }

  get state(): Game {
    return this.game;
  }

  /** 端到端测试用：把镜头移到世界坐标 */
  debugFocus(wx: number, wy: number): void {
    this.cam.x = wx;
    this.cam.y = wy;
  }

  /** 端到端测试用：世界坐标 → 屏幕坐标 */
  debugToScreen(wx: number, wy: number): [number, number] {
    return this.cam.toScreen(wx, wy);
  }

  // ---- 循环 ----

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.net) {
      this.netFrame(now);
      this.scrollCamera(dt);
    } else if (!this.menuOpen) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= TICK_MS && n < 12) {
        this.tick(now);
        this.acc -= TICK_MS;
        n++;
      }
      if (n === 12) this.acc = 0;
      this.scrollCamera(dt);
    }
    if (!this.net) this.ip.alpha = Math.min(1, this.acc / TICK_MS);
    this.updateHover();
    this.updateTooltip();
    const out = render(this.ctx, this.game, this.cam, this.ip, this.view, this.fx, now, this.dpr);
    this.mm = out.mm;
    this.updateHud();
    if (this.outcome() !== 'playing' && !this.resultShown && now - this.resultAt > 2500 && this.resultAt > 0) {
      this.showResult();
    }
  };

  /** 联机：画 NetClient 给出的状态（预测或已确认），事件分两路处理 */
  private netFrame(now: number): void {
    const net = this.net!;
    const view = net.client.frame(now);
    if (!view) return;
    this.game = view.game;
    this.ip.prevX = view.prevX;
    this.ip.prevY = view.prevY;
    this.ip.offX = view.offX;
    this.ip.offY = view.offY;
    this.ip.alpha = view.alpha;
    const { fx, key } = net.client.takeEvents();
    for (const e of fx) this.onEvent(e, now);
    for (const e of key) this.onEvent(e, now);
    const g = this.game;
    for (const pn of this.view.selected) if (g.people[pn].stat <= PS.DEAD) this.view.selected.delete(pn);
    if (Math.floor(g.tick / 9) !== Math.floor(this.lastThreatTick / 9)) {
      this.lastThreatTick = g.tick;
      this.checkThreats(now);
    }
    if (this.outcome() !== 'playing' && this.resultAt === 0) this.resultAt = now;
  }

  /** 本机视角的胜负：联机局的共享状态不知道"我"是谁 */
  private outcome(): Game['result'] {
    const g = this.game;
    if (!this.net) return g.result;
    const alive = g.player.filter((p) => p.exist).length;
    if (this.me < 4 && !g.player[this.me].exist) return 'lose';
    if (alive <= 1) return this.me < 4 ? 'win' : 'over';
    return 'playing';
  }

  /** 下令：单机排进下一帧，联机交给 NetClient（本机立即预测） */
  private send(c: Command): void {
    if (this.net) this.net.client.issue(c);
    else this.pending.push(c);
  }

  private tick(now: number): void {
    const g = this.game;
    for (let i = 0; i < PMAX; i++) {
      this.ip.prevX[i] = g.people[i].px;
      this.ip.prevY[i] = g.people[i].py;
    }
    const events = step(g, this.pending.splice(0));
    for (const e of events) this.onEvent(e, now);
    // 已死亡单位从选择中移除
    for (const pn of this.view.selected) if (g.people[pn].stat <= PS.DEAD) this.view.selected.delete(pn);
    if (g.tick - this.lastAutosave >= AUTOSAVE_TICKS) this.autosave();
    if (g.tick % 9 === 0) this.checkThreats(now);
  }

  /** 己方地块的敌方占领进度在增长 → 屏幕边缘提示，小地图闪烁 */
  private checkThreats(now: number): void {
    const g = this.game;
    const me = this.me;
    if (me >= 4 || g.rules.ruleset !== 'remake' || !g.player[me].exist) return;
    g.area.forEach((a, n) => {
      if (a.col !== me) return;
      let enemy = 0;
      for (let c = 0; c < 4; c++) if (c !== me) enemy += a.val[c];
      const before = this.threatSeen.get(n) ?? 0;
      this.threatSeen.set(n, enemy);
      if (enemy <= before || a.fallen) return;
      if (now - (this.alertAt.get(n) ?? -Infinity) < ALERT_COOLDOWN) return;
      this.alertAt.set(n, now);
      const key: TextKey = a.areatype === AREA.BASE ? 'alert.base' : a.areatype === AREA.SPADE ? 'alert.spade' : 'alert.heart';
      this.pushAlert(t(key), a.bx, a.by, now, a.areatype === AREA.BASE);
    });
  }

  private pushAlert(text: string, bx: number, by: number, now: number, urgent: boolean): void {
    this.fx.pings.push({ bx, by, t0: now, color: urgent ? '#ff5a4a' : '#ffd84a' });
    play('message');
    const el = h('button', {
      class: `alert${urgent ? ' urgent' : ''}`,
      onClick: () => {
        const [x, y] = tileCenter(bx, by);
        this.cam.x = x;
        this.cam.y = y;
        this.cam.clamp();
        el.remove();
      },
    }, text);
    this.hud.alerts.prepend(el);
    while (this.hud.alerts.childElementCount > 4) this.hud.alerts.lastElementChild?.remove();
    window.setTimeout(() => el.remove(), 7000);
  }

  private onEvent(e: GameEvent, now: number): void {
    const g = this.game;
    switch (e.kind) {
      case 'appear':
        if (this.net) break;
        this.ip.prevX[e.pn] = g.people[e.pn].px;
        this.ip.prevY[e.pn] = g.people[e.pn].py;
        break;
      case 'punch':
        this.fx.impacts.push({ x: e.px, y: e.py, t0: now, big: false });
        this.fx.hitAt[e.pn] = now;
        if (this.cam.inside(e.px, e.py)) play('punch');
        break;
      case 'miss':
        this.fx.texts.push({ x: e.px, y: e.py, t0: now, text: t('msg.miss') });
        break;
      case 'dead':
        this.fx.impacts.push({ x: e.px, y: e.py, t0: now, big: true });
        this.fx.hitAt[e.pn] = now;
        this.fx.kos.push({ x: e.px, y: e.py, t0: now });
        if (this.cam.inside(e.px, e.py)) play('dead');
        break;
      case 'capture':
        this.fx.raised.set(e.area, now);
        break;
      case 'fallen': {
        const a = g.area[e.area];
        if (e.col === this.me) {
          this.showBanner(t('msg.fallen.you'), false);
          this.pushAlert(t('alert.fallen'), a.bx, a.by, now, true);
        } else {
          this.showBanner(t('msg.fallen', { name: factionName(e.col), by: factionName(e.by) }), false);
          this.fx.pings.push({ bx: a.bx, by: a.by, t0: now, color: '#ffffff' });
        }
        break;
      }
      case 'recovered':
        this.showBanner(t('msg.recovered', { name: factionName(e.col) }), false);
        break;
      case 'levelup': {
        const p = g.people[e.pn];
        const remake = g.rules.ruleset === 'remake';
        const star = remake && p.lev % STAR_KILLS === 0 && p.lev / STAR_KILLS <= STAR_MAX;
        this.fx.levelups = this.fx.levelups.filter((f) => f.pn !== e.pn);
        this.fx.levelups.push({ pn: e.pn, t0: now, gain: remake ? KILL_MHP : 1, star });
        if (this.cam.inside(p.px, p.py)) play(star ? 'star' : 'levelup');
        break;
      }
      case 'annihilated': {
        let text = t('msg.annihilated', { name: factionName(e.col) });
        if (e.result === 'win') text = t('msg.win');
        if (e.result === 'lose') text = t('msg.lose');
        if (this.net && e.col === this.me) text = t('msg.lose.net');
        this.showBanner(text, e.persistent || (!!this.net && e.col === this.me));
        if (this.outcome() !== 'playing' && this.resultAt === 0) this.resultAt = now;
        break;
      }
    }
  }

  private snapInterp(): void {
    for (let i = 0; i < PMAX; i++) {
      this.ip.prevX[i] = this.game.people[i].px;
      this.ip.prevY[i] = this.game.people[i].py;
    }
  }

  autosave = (): void => {
    if (this.net) return;
    this.lastAutosave = this.game.tick;
    try {
      writeSlot('auto', this.game);
    } catch {
      // 存储已满或被禁用
    }
  };

  // ---- 镜头 ----

  private initCamera(): void {
    const g = this.game;
    const pl = g.player[this.me];
    if (pl && this.me < 4) {
      // 对准本部；视野不越过操场周围一圈（Camera.clamp），本部会落在靠屏幕边的位置
      this.cam.x = pl.basex * 48 - pl.basey * 48;
      this.cam.y = pl.basey * 24 + pl.basex * 24 + 24;
    } else {
      this.cam.x = 0;
      this.cam.y = 384;
    }
  }

  private onResize = (): void => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(hgt * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
    this.cam.w = w;
    this.cam.h = hgt;
    // 默认缩放：视野高度约 430 世界像素（原版 400）
    if (!this.zoomInit) {
      this.zoomInit = true;
      this.cam.zoom = Math.max(1, hgt / 430);
    }
    this.cam.clamp();
  };

  private scrollCamera(dt: number): void {
    const sp = (600 / this.cam.zoom) * (dt / 1000);
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= sp;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += sp;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= sp;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += sp;
    if (settings.edgeScroll && this.mouse.inside && !this.drag) {
      const m = 12;
      if (this.mouse.x < m) dx -= sp;
      if (this.mouse.x > this.cam.w - m) dx += sp;
      if (this.mouse.y < m) dy -= sp;
      if (this.mouse.y > this.cam.h - m) dy += sp;
    }
    if (dx || dy) {
      this.cam.x += dx;
      this.cam.y += dy;
      this.cam.clamp();
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const [wx, wy] = this.cam.toWorld(e.offsetX, e.offsetY);
    this.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
    this.cam.clamp();
    const [nx, ny] = this.cam.toWorld(e.offsetX, e.offsetY);
    this.cam.x += wx - nx;
    this.cam.y += wy - ny;
    this.cam.clamp();
  };

  // ---- 选择与下令 ----

  /**
   * 鼠标所指的单位：命中框内离鼠标最近的那个（以身体中心计），距离相同取画面靠前的。
   * who：'own' 只找己方，'enemy' 只找敌方，'any' 都找
   */
  private pointedUnit(wx: number, wy: number, who: 'own' | 'enemy' | 'any'): number {
    const g = this.game;
    let pn = -1;
    let best = Infinity;
    for (let i = 0; i < PMAX; i++) {
      const p = g.people[i];
      if (p.stat <= PS.DEAD) continue;
      if (who === 'own' && p.col !== this.me) continue;
      if (who === 'enemy' && p.col === this.me) continue;
      const [px, py] = unitPos(g, this.ip, i);
      if (wx < px - 12 || wx >= px + 12 || wy < py - 34 || wy >= py + 10) continue;
      const d = Math.hypot(wx - px, (wy - (py - 13)) * 0.8) - py * 1e-4;
      if (d < best) {
        best = d;
        pn = i;
      }
    }
    return pn;
  }

  private tileAt(wx: number, wy: number): { bx: number; by: number } {
    return { bx: Math.floor((wy + wx / 2) / 48), by: Math.floor((wy - wx / 2) / 48) };
  }

  private updateHover(): void {
    this.view.cursorTile = null;
    this.view.arrowPn = -1;
    this.view.hoverPn = -1;
    if (this.view.selected.size === 0) this.view.amove = false;
    if (!this.mouse.inside || this.drag || this.menuOpen) return;
    if (this.inMinimap(this.mouse.x, this.mouse.y)) return;
    const [wx, wy] = this.cam.toWorld(this.mouse.x, this.mouse.y);
    // 悬停的己方学生描一圈细边：点下去就选中它
    if (this.me < 4) this.view.hoverPn = this.pointedUnit(wx, wy, 'own');
    if (this.view.selected.size === 0) return;
    const target = this.pointedUnit(wx, wy, 'enemy');
    if (target >= 0) this.view.arrowPn = target;
    else this.view.cursorTile = this.tileAt(wx, wy);
  }

  private issueOrder(sx: number, sy: number): void {
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const target = this.pointedUnit(wx, wy, 'enemy');
    const tile = this.tileAt(wx, wy);
    const amove = this.view.amove && target < 0;
    this.view.amove = false;
    this.send({ type: 'order', units: [...this.view.selected], bx: tile.bx, by: tile.by, target, amove });
    this.fx.blink = { bx: tile.bx, by: tile.by, pn: target, t0: performance.now() };
    play('move');
    if (settings.controls === 'classic') this.cancelSelection(false);
  }

  private cancelSelection(withSound: boolean): void {
    if (withSound && (this.view.selected.size || this.view.baseSelected)) play('cancel');
    this.view.selected.clear();
    this.view.baseSelected = false;
    this.view.amove = false;
  }

  /**
   * 撤退回血：选中的人里没满血的各自走向最近的己方泉水或未沦陷的本部（满血的不动）；没选人时撤回所有生命不到一半的人。
   * 只是替玩家下几道普通移动指令。
   */
  private retreat(): void {
    const g = this.game;
    const me = this.me;
    if (me >= 4 || !g.player[me].exist) return;
    let units = [...this.view.selected];
    if (units.length === 0) {
      for (let i = 0; i < PMAX; i++) {
        const p = g.people[i];
        if (p.stat > PS.DEAD && p.col === me && p.hp < p.mhp * 0.5) units.push(i);
      }
    }
    // 满血的人不用回去，留在原地
    units = units.filter((pn) => g.people[pn].stat > PS.DEAD && g.people[pn].hp < g.people[pn].mhp);
    const spots = g.area.filter((a) => a.col === me && (a.areatype === AREA.HEART || (a.areatype === AREA.BASE && !a.fallen)));
    if (units.length === 0 || spots.length === 0) {
      this.showBanner(t(spots.length ? 'hud.retreat.none' : 'hud.retreat.nospot'), false, true);
      return;
    }
    const byTile = new Map<number, number[]>();
    for (const pn of units) {
      const p = g.people[pn];
      let best = spots[0];
      let bd = Infinity;
      for (const a of spots) {
        const d = Math.abs(p.cx - (a.bx * 4 + 1.5)) + Math.abs(p.cy - (a.by * 4 + 1.5));
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      const key = best.by * 16 + best.bx;
      byTile.set(key, [...(byTile.get(key) ?? []), pn]);
    }
    for (const [key, list] of byTile) this.send({ type: 'order', units: list, bx: key % 16, by: Math.floor(key / 16), target: -1 });
    play('move');
    this.showBanner(t('hud.retreat', { n: units.length }), false, true);
  }

  /** 选中全部生命不到一半的己方学生 */
  private selectWounded(): void {
    const g = this.game;
    this.view.selected.clear();
    this.view.baseSelected = false;
    for (let i = 0; i < PMAX; i++) {
      const p = g.people[i];
      if (p.stat > PS.DEAD && p.col === this.me && p.hp < p.mhp * 0.5) this.view.selected.add(i);
    }
    if (this.view.selected.size) play('select');
  }

  /** 只有"校园战争"规则有集结点 */
  private isOwnBase(tile: { bx: number; by: number }): boolean {
    const g = this.game;
    const pl = g.player[this.me];
    return g.rules.ruleset === 'remake' && !!pl && pl.exist && tile.bx === pl.basex && tile.by === pl.basey;
  }

  private setRally(sx: number, sy: number): void {
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const tile = this.tileAt(wx, wy);
    if (tile.bx < 0 || tile.by < 0 || tile.bx >= 16 || tile.by >= 16) return;
    const clear = this.isOwnBase(tile);
    this.send({ type: 'rally', bx: clear ? -1 : tile.bx, by: clear ? -1 : tile.by });
    if (!clear) this.fx.blink = { bx: tile.bx, by: tile.by, pn: -1, t0: performance.now() };
    play(clear ? 'cancel' : 'move');
    this.showBanner(t(clear ? 'hud.rally.clear' : 'hud.rally.set'), false, true);
  }

  /** 编队：Ctrl/Shift + 数字保存，数字选中，连按两次镜头跳过去 */
  private groupKey(n: number, assign: boolean): void {
    const g = this.game;
    if (this.me >= 4) return;
    if (assign) {
      this.groups[n] = [...this.view.selected].map((pn) => g.people[pn].uid);
      this.showBanner(t('hud.group.saved', { n, m: this.groups[n].length }), false, true);
      return;
    }
    const uids = new Set(this.groups[n] ?? []);
    const sel = new Set<number>();
    for (let i = 0; i < PMAX; i++) {
      const p = g.people[i];
      if (p.stat > PS.DEAD && p.col === this.me && uids.has(p.uid)) sel.add(i);
    }
    const now = performance.now();
    if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < DOUBLE_MS && sel.size) {
      let sx = 0;
      let sy = 0;
      for (const pn of sel) {
        sx += g.people[pn].px;
        sy += g.people[pn].py;
      }
      this.cam.x = sx / sel.size;
      this.cam.y = sy / sel.size;
      this.cam.clamp();
    }
    this.lastGroupKey = { n, t: now };
    this.view.selected = sel;
    this.view.baseSelected = false;
    if (sel.size) play('select');
  }

  private selectAll(): void {
    const g = this.game;
    this.view.selected.clear();
    for (let i = 0; i < PMAX; i++) if (g.people[i].stat > PS.DEAD && g.people[i].col === this.me) this.view.selected.add(i);
    if (this.view.selected.size) play('select');
  }

  /** add：按住 Shift，点击加入 / 移出选择，拖框追加选择 */
  private finishSelect(x1: number, y1: number, x2: number, y2: number, add: boolean): void {
    const g = this.game;
    const sel = new Set<number>(add ? this.view.selected : []);
    this.view.baseSelected = false;
    this.view.amove = false;
    if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
      const [wx, wy] = this.cam.toWorld(x2, y2);
      const pn = this.pointedUnit(wx, wy, 'own');
      if (add) {
        if (pn >= 0) {
          if (sel.has(pn)) sel.delete(pn);
          else sel.add(pn);
          play('select');
        }
        this.view.selected = sel;
        return;
      }
      const now = performance.now();
      const pl = g.player[this.me];
      if (pl && this.isOwnBase({ bx: pl.basex, by: pl.basey }) && hitSchool(pl.basex, pl.basey, wx, wy)) {
        // 点校舍选中本部
        this.view.baseSelected = true;
        this.view.selected = sel;
        play('select');
        return;
      }
      if (pn >= 0) {
        if (this.lastClick.pn === pn && now - this.lastClick.t < DOUBLE_MS) {
          // 双击：选中屏幕内全部己方学生
          for (let i = 0; i < PMAX; i++) {
            const p = g.people[i];
            if (p.stat > PS.DEAD && p.col === this.me && this.cam.inside(...unitPos(g, this.ip, i))) sel.add(i);
          }
        } else {
          sel.add(pn);
        }
        this.lastClick = { pn, t: now };
      } else if (pn < 0 && this.isOwnBase(this.tileAt(wx, wy))) {
        this.view.baseSelected = true;
        this.view.selected = sel;
        play('select');
        return;
      }
    } else {
      // 原版框选判定：框向左右各扩 12、向上扩 12、向下扩 32（862/f5:211-214）
      const [ax, ay] = this.cam.toWorld(Math.min(x1, x2), Math.min(y1, y2));
      const [bx, by] = this.cam.toWorld(Math.max(x1, x2), Math.max(y1, y2));
      for (let i = 0; i < PMAX; i++) {
        const p = g.people[i];
        if (p.stat <= PS.DEAD || p.col !== this.me) continue;
        const [px, py] = unitPos(g, this.ip, i);
        if (px >= ax - 12 && px <= bx + 12 && py >= ay - 12 && py <= by + 32) sel.add(i);
      }
    }
    this.view.selected = sel;
    if (sel.size) play('select');
  }

  private inMinimap(x: number, y: number): boolean {
    const m = this.mm;
    return !!m && x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h;
  }

  private moveToMinimap(x: number, y: number): void {
    if (!this.mm) return;
    const [wx, wy] = minimapToWorld(this.mm, x, y);
    this.cam.x = wx;
    this.cam.y = wy;
    this.cam.clamp();
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (this.menuOpen) return;
    const x = e.offsetX;
    const y = e.offsetY;
    if (e.button === 2) {
      if (this.inMinimap(x, y)) return;
      if (this.view.selected.size) this.issueOrder(x, y);
      else if (this.view.baseSelected) this.setRally(x, y);
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { kind: 'pan', sx: x, sy: y, camX: this.cam.x, camY: this.cam.y, add: false };
      return;
    }
    if (e.button !== 0) return;
    if (this.inMinimap(x, y)) {
      this.drag = { kind: 'minimap', sx: x, sy: y, camX: 0, camY: 0, add: false };
      this.moveToMinimap(x, y);
      return;
    }
    if (this.keys.has(' ')) {
      this.drag = { kind: 'pan', sx: x, sy: y, camX: this.cam.x, camY: this.cam.y, add: false };
      return;
    }
    // 按过 A 之后左键也能下进攻移动（与常见即时战略游戏一致）
    if ((settings.controls === 'classic' || this.view.amove) && this.view.selected.size) {
      this.issueOrder(x, y);
      return;
    }
    this.drag = { kind: 'select', sx: x, sy: y, camX: 0, camY: 0, add: e.shiftKey };
  };

  private onMouseMove = (e: MouseEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      this.cam.x = d.camX - (this.mouse.x - d.sx) / this.cam.zoom;
      this.cam.y = d.camY - (this.mouse.y - d.sy) / this.cam.zoom;
      this.cam.clamp();
    } else if (d.kind === 'minimap') {
      this.moveToMinimap(this.mouse.x, this.mouse.y);
    } else {
      this.view.rect = { x1: d.sx, y1: d.sy, x2: this.mouse.x, y2: this.mouse.y };
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    const d = this.drag;
    if (!d || (e.button !== 0 && e.button !== 1)) return;
    this.drag = null;
    this.view.rect = null;
    if (d.kind === 'select') this.finishSelect(d.sx, d.sy, this.mouse.x, this.mouse.y, d.add);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.menuOpen) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      this.groupKey(Number(digit[1]), e.ctrlKey || e.metaKey || e.shiftKey);
      return;
    }
    if (k === 'escape') {
      if (this.view.amove) this.view.amove = false;
      else if (this.view.selected.size || this.view.baseSelected) this.cancelSelection(true);
      else this.openPause();
      return;
    }
    if (k === 'p') {
      this.openPause();
      return;
    }
    if (k === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.shiftKey) this.selectWounded();
      else this.retreat();
      return;
    }
    // 有选中的人时，A 键准备进攻移动（不再滚动镜头）；再点一次地面下令
    if (k === 'a' && this.view.selected.size && this.game.rules.ruleset === 'remake' && !e.ctrlKey && !e.metaKey) {
      if (!e.repeat) this.view.amove = !this.view.amove;
      return;
    }
    if (k === '+' || k === '=') this.cam.zoom *= 1.15;
    if (k === '-') this.cam.zoom /= 1.15;
    this.cam.clamp();
    this.keys.add(k);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.drag = null;
    this.view.rect = null;
  };

  private onVisibility = (): void => {
    if (document.hidden && !this.net) {
      this.autosave();
      if (!this.menuOpen && this.game.result === 'playing' && this.me < 4) this.openPause();
    }
  };

  // ---- HUD 与菜单 ----

  private toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
    this.updateSpeedLabel();
  }

  private updateSpeedLabel(): void {
    this.hud.speed.textContent = `${this.speed}×`;
  }

  private hudCache = '';

  private updateHud(): void {
    const g = this.game;
    const parts: string[] = [];
    for (let c = 0; c < 4; c++) {
      parts.push(`${g.player[c].exist}|${g.player[c].people_cnt}|${spadeCount(g, c)}|${g.top === c}`);
    }
    const net = this.net;
    const ns = net ? net.status() : null;
    const seatStates = net ? net.client.seats.join(',') : '';
    const key = parts.join(',') + `|${this.view.selected.size}|${this.view.baseSelected}|${this.view.amove}|${settings.controls}|${Math.floor(g.tick / FPS)}|${settings.lang}|${ns?.text}|${seatStates}`;
    if (key === this.hudCache) return;
    if (ns) {
      this.hud.netLine.textContent = ns.text;
      this.hud.netLine.classList.toggle('warn', ns.warn);
    }
    this.hudCache = key;
    for (let c = 0; c < 4; c++) {
      const pl = g.player[c];
      const chip = this.hud.chips[c];
      chip.className = `chip${c === this.me ? ' you' : ''}${pl.exist ? '' : ' out'}${g.top === c ? ' top' : ''}`;
      chip.style.setProperty('--fc', FACTION[c].ui);
      chip.title = g.top === c ? t(g.rules.ruleset === 'remake' ? 'hud.top.tip.remake' : 'hud.top.tip', { name: factionName(c) }) : '';
      const parts: (HTMLElement | null)[] = [
        h('span', { class: 'dot' }),
        h('span', { class: 'name' }, factionName(c, true)),
        net && net.names[c] && c !== this.me ? h('span', { class: 'player' }, net.names[c]) : null,
        c === this.me ? h('span', { class: 'you-tag' }, t('hud.you')) : null,
        net && pl.exist && net.client.seats[c] === 'away' ? h('span', { class: 'state-tag' }, t('hud.seat.away')) : null,
        net && pl.exist && net.client.seats[c] === 'ai' ? h('span', { class: 'state-tag' }, t('hud.seat.ai')) : null,
        h('span', { class: 'num' }, t('hud.count', { n: pl.people_cnt })),
        h('span', { class: 'num camp', title: t('hud.camps') }, String(spadeCount(g, c))),
        g.top === c ? h('span', { class: 'top-tag' }, t('hud.top')) : null,
      ];
      chip.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
    }
    this.hud.clock.textContent = this.me >= 4 ? `${t('hud.watching')} ${formatTime(g.tick)}` : formatTime(g.tick);
    const n = this.view.selected.size;
    const base = !!this.view.baseSelected;
    this.hud.selbar.classList.toggle('hidden', n === 0 && !base);
    this.hud.selText.textContent = base ? t('hud.base.selected') : t('hud.selected', { n });
    this.hud.selHint.textContent = base
      ? t('hud.base.hint')
      : this.view.amove
        ? t('hud.hint.amove')
        : settings.controls === 'classic'
          ? t('hud.hint.classic')
          : t(this.game.rules.ruleset === 'remake' ? 'hud.hint.remake' : 'hud.hint.modern');
    this.hud.selbar.classList.toggle('amove', this.view.amove);
    this.updatePower();
  }

  /** 势力比例条：与"众矢之的"的判定口径相同（人数 + 营地，兽人减半），标出 40% 线 */
  private updatePower(): void {
    const g = this.game;
    const v = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) v[c] = g.player[c].people_cnt;
    for (const a of g.area) if (a.areatype === AREA.SPADE && a.col >= 0 && g.player[a.col].exist) v[a.col]++;
    v[1] /= 2;
    const sum = v.reduce((x, y) => x + y, 0) || 1;
    const alive = g.player.filter((p) => p.exist).length;
    const active = g.rules.ruleset === 'classic' || alive >= 3;
    const segs = v.map((x, c) =>
      h('div', { class: `seg-${c}${g.top === c ? ' top' : ''}`, style: `width:${(100 * x) / sum}%;background:${FACTION[c].ui}` }),
    );
    this.hud.power.replaceChildren(
      ...segs,
      h('div', { class: `line${active ? '' : ' off'}`, style: `left:${TOP_RATIO * 100}%` }),
    );
  }

  /** 悬停信息：学生的生命与击倒数；地块的作用与占领进度 */
  private updateTooltip(): void {
    const tip = this.hud.tooltip;
    const g = this.game;
    let lines: string[] = [];
    if (this.mouse.inside && !this.drag && !this.menuOpen && !this.inMinimap(this.mouse.x, this.mouse.y)) {
      const [wx, wy] = this.cam.toWorld(this.mouse.x, this.mouse.y);
      const pn = this.pointedUnit(wx, wy, 'any');
      if (pn >= 0) {
        const p = g.people[pn];
        lines = [t('hover.unit', { name: factionName(p.col, true), hp: Math.ceil(p.hp), mhp: p.mhp, kills: p.lev })];
      } else {
        const { bx, by } = this.tileAt(wx, wy);
        const n = bx >= 0 && by >= 0 && bx < 16 && by < 16 ? g.bmap_n[by * 16 + bx] : -1;
        if (n >= 0) lines = this.areaLines(n);
      }
    }
    const key = lines.join('\n');
    if (key !== this.tipKey) {
      this.tipKey = key;
      tip.replaceChildren(...lines.map((l) => h('div', {}, l)));
      tip.classList.toggle('hidden', lines.length === 0);
    }
    if (lines.length) tip.style.transform = `translate(${this.mouse.x + 16}px, ${this.mouse.y + 18}px)`;
  }

  private areaLines(n: number): string[] {
    const g = this.game;
    const a = g.area[n];
    const lines: string[] = [];
    const pct = (v: number, need: number) => Math.min(99, Math.floor((100 * v) / need));
    if (a.areatype === AREA.BASE) {
      if (a.fallen) lines.push(t('hover.base.fallen', { name: factionName(a.col, true), by: a.holder >= 0 ? factionName(a.holder, true) : '?' }));
      else lines.push(t('hover.base', { name: factionName(a.col, true) }));
      if (g.rules.ruleset === 'remake') {
        for (let c = 0; c < 4; c++) {
          if (a.val[c] <= 0) continue;
          if (a.fallen && c === a.col) lines.push(t('hover.recover', { pct: pct(a.val[c], RECOVER_VALUE) }));
          else if (!a.fallen && c !== a.col) lines.push(t('hover.siege', { name: factionName(c, true), pct: pct(a.val[c], SIEGE_VALUE) }));
        }
      }
      return lines;
    }
    lines.push(t(a.areatype === AREA.SPADE ? 'hover.spade' : 'hover.heart'));
    lines.push(a.col >= 0 ? t('hover.owner', { name: factionName(a.col, true) }) : t('hover.neutral'));
    for (let c = 0; c < 4; c++) {
      if (c !== a.col && a.val[c] > 0) lines.push(t('hover.progress', { name: factionName(c, true), pct: pct(a.val[c], CAPTURE_VALUE) }));
    }
    return lines;
  }

  /** minor：操作回执之类的小提示，字小、不响 */
  private showBanner(text: string, persistent: boolean, minor = false): void {
    if (!minor) play('message');
    const b = this.hud.banner;
    b.textContent = text;
    b.classList.toggle('minor', minor);
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (!persistent) this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), minor ? 1600 : 5000);
  }

  private openPause(): void {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.keys.clear();
    this.drag = null;
    let close = () => {};
    const done = () => {
      this.menuOpen = false;
      this.last = performance.now();
    };
    const btn = (label: string, fn: () => void, cls = 'btn') => h('button', { class: cls, onClick: fn }, label);
    if (this.net) {
      // 联机不能暂停：菜单开着，对局照常进行
      const net = this.net;
      close = modal(h(
        'div',
        { class: 'panel menu' },
        h('h2', {}, t('menu.online')),
        h('div', { class: 'menu-note' }, t('menu.online.note')),
        btn(t('menu.resume'), () => close()),
        btn(t('menu.settings'), () => openSettings(() => this.refreshTexts()), 'btn ghost'),
        btn(t('menu.leave'), () => { close(); net.leave(); this.hooks.onQuit(); }, 'btn ghost danger'),
      ), done);
      return;
    }
    const content = h(
      'div',
      { class: 'panel menu' },
      h('h2', {}, t('menu.paused')),
      btn(t('menu.resume'), () => close()),
      this.me < 4 ? btn(t('menu.save'), () => openSaveLoad('save', this.game, () => {}), 'btn ghost') : null,
      btn(t('menu.load'), () => openSaveLoad('load', null, (g) => { close(); this.hooks.onLoad(g); }), 'btn ghost'),
      btn(t('menu.settings'), () => openSettings(() => this.refreshTexts()), 'btn ghost'),
      btn(t('menu.restart'), () => { close(); this.hooks.onRestart(true); }, 'btn ghost'),
      btn(t('menu.quit'), () => { close(); this.autosave(); this.hooks.onQuit(); }, 'btn ghost'),
    );
    close = modal(content, done);
  }

  private showResult(): void {
    this.resultShown = true;
    const g = this.game;
    const winner = g.player.findIndex((p) => p.exist);
    const result = this.outcome();
    const title = result === 'win' ? t('result.win') : result === 'lose' ? t('result.lose') : t('result.over');
    let close = () => {};
    if (this.net) {
      const net = this.net;
      const over = g.player.filter((p) => p.exist).length <= 1;
      close = modal(h(
        'div',
        { class: `panel menu result ${result}` },
        h('h2', {}, title),
        over && winner >= 0 ? h('div', { class: 'result-line' }, t('result.winner', { name: factionName(winner) })) : null,
        h('div', { class: 'result-line' }, t('result.time', { time: formatTime(g.tick) })),
        this.me < 4 ? h('div', { class: 'result-line' }, t('result.kills', { n: g.kills[this.me] })) : null,
        over ? null : h('div', { class: 'menu-note' }, t('result.net.going')),
        h('button', { class: 'btn', onClick: () => { close(); net.leave(); this.hooks.onQuit(); } }, t('menu.backroom')),
        h('button', { class: 'btn ghost', onClick: () => close() }, t('menu.keepwatching')),
      ), () => {});
      return;
    }
    this.menuOpen = true;
    const content = h(
      'div',
      { class: `panel menu result ${g.result}` },
      h('h2', {}, title),
      winner >= 0 && g.player.filter((p) => p.exist).length === 1 ? h('div', { class: 'result-line' }, t('result.winner', { name: factionName(winner) })) : null,
      h('div', { class: 'result-line' }, t('result.time', { time: formatTime(g.tick) })),
      this.me < 4 ? h('div', { class: 'result-line' }, t('result.kills', { n: g.kills[this.me] })) : null,
      h('button', { class: 'btn', onClick: () => { close(); this.hooks.onRestart(true); } }, t('menu.restart')),
      h('button', { class: 'btn ghost', onClick: () => { close(); this.hooks.onRestart(false); } }, t('menu.newmap')),
      h('button', { class: 'btn ghost', onClick: () => close() }, t('menu.keepwatching')),
      h('button', { class: 'btn ghost', onClick: () => { close(); this.hooks.onQuit(); } }, t('menu.quit')),
    );
    close = modal(content, () => {
      this.menuOpen = false;
      this.last = performance.now();
    });
  }
}

