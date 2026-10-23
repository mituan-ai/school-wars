// 对局画面：固定 18 tick/s 推进模拟，按显示器刷新率插值绘制；处理操作、HUD、菜单
import { play } from '../audio/sfx.ts';
import { FPS, PMAX, PS } from '../core/constants.ts';
import { step, spadeCount } from '../core/sim.ts';
import type { Command, Game, GameEvent } from '../core/types.ts';
import { factionName, formatTime, t } from '../i18n/index.ts';
import { Camera, minimapToWorld, newFx, newInterp, render, unitPos, type Fx, type MinimapRect, type ViewState } from '../render/renderer.ts';
import { FACTION } from '../render/palette.ts';
import { writeSlot } from '../save/storage.ts';
import { saveSettings, settings } from '../settings.ts';
import { h, modal } from './dom.ts';
import { openSaveLoad, openSettings } from './panels.ts';

const TICK_MS = 1000 / FPS;
const AUTOSAVE_TICKS = 60 * FPS;

export interface GameScreenHooks {
  onQuit: () => void;
  onRestart: (sameMap: boolean) => void;
  onLoad: (g: Game) => void;
}

export class GameScreen {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam = new Camera();
  private ip = newInterp();
  private fx: Fx = newFx();
  private view: ViewState = { selected: new Set(), cursorTile: null, arrowPn: -1, rect: null };
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
  private drag: { kind: 'select' | 'pan' | 'minimap'; sx: number; sy: number; camX: number; camY: number } | null = null;
  private resultShown = false;
  private resultAt = 0;
  private lastAutosave = 0;
  private hud: {
    chips: HTMLElement[];
    clock: HTMLElement;
    speed: HTMLButtonElement;
    selbar: HTMLElement;
    selText: HTMLElement;
    selHint: HTMLElement;
    banner: HTMLElement;
    tips: HTMLElement | null;
  };
  private bannerTimer = 0;
  private game: Game;
  private hooks: GameScreenHooks;

  constructor(game: Game, hooks: GameScreenHooks) {
    this.game = game;
    this.hooks = hooks;
    this.canvas = h('canvas', { class: 'game-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    const chips = [0, 1, 2, 3].map(() => h('div', { class: 'chip' }));
    const clock = h('span', { class: 'clock' });
    const speed = h('button', { class: 'btn small ghost', title: t('hud.speed'), onClick: () => this.toggleSpeed() });
    const selText = h('span', { class: 'sel-text' });
    const selHint = h('span', { class: 'sel-hint' });
    const selbar = h('div', { class: 'selbar hidden' }, selText, selHint, h('button', { class: 'btn small', onClick: () => this.cancelSelection(true) }, t('hud.cancel')));
    const banner = h('div', { class: 'banner' });
    const top = h(
      'div',
      { class: 'hud-top' },
      h('div', { class: 'chips' }, ...chips),
      h('div', { class: 'hud-right' }, clock, speed, h('button', { class: 'btn small ghost', title: t('hud.pause'), onClick: () => this.openPause() }, '❚❚')),
    );
    let tips: HTMLElement | null = null;
    if (!settings.tipsSeen && game.user_col < 4) {
      tips = h(
        'div',
        { class: 'tips' },
        h('div', { class: 'tips-title' }, t('tips.title')),
        h('div', { class: 'tips-body' }, t('tips.body')),
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
    this.root = h('div', { class: 'game-screen' }, this.canvas, h('div', { class: 'hud' }, top, selbar, banner, tips));
    this.hud = { chips, clock, speed, selbar, selText, selHint, banner, tips };
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
    if (!this.menuOpen) {
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
    this.ip.alpha = Math.min(1, this.acc / TICK_MS);
    this.updateHover();
    const out = render(this.ctx, this.game, this.cam, this.ip, this.view, this.fx, now, this.dpr);
    this.mm = out.mm;
    this.updateHud();
    if (this.game.result !== 'playing' && !this.resultShown && now - this.resultAt > 2500 && this.resultAt > 0) {
      this.showResult();
    }
  };

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
  }

  private onEvent(e: GameEvent, now: number): void {
    const g = this.game;
    switch (e.kind) {
      case 'appear':
        this.ip.prevX[e.pn] = g.people[e.pn].px;
        this.ip.prevY[e.pn] = g.people[e.pn].py;
        break;
      case 'punch':
        this.fx.impacts.push({ x: e.px, y: e.py, t0: now, big: false });
        if (this.cam.inside(e.px, e.py)) play('punch');
        break;
      case 'dead':
        this.fx.impacts.push({ x: e.px, y: e.py, t0: now, big: true });
        if (this.cam.inside(e.px, e.py)) play('dead');
        break;
      case 'levelup':
        this.fx.levelups.push({ pn: e.pn, t0: now });
        break;
      case 'annihilated': {
        let text = t('msg.annihilated', { name: factionName(e.col) });
        if (e.result === 'win') text = t('msg.win');
        if (e.result === 'lose') text = t('msg.lose');
        this.showBanner(text, e.persistent);
        if (g.result !== 'playing' && this.resultAt === 0) this.resultAt = now;
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
    const pl = g.player[g.user_col];
    if (pl && g.user_col < 4) {
      // 以本部为中心，再向地图中央偏移 30%，少露一些棋盘外的空白
      const bx = pl.basex * 48 - pl.basey * 48;
      const by = pl.basey * 24 + pl.basex * 24 + 24;
      this.cam.x = bx * 0.7;
      this.cam.y = by * 0.7 + 384 * 0.3;
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

  /** 原版 get_pointed_pn：取命中框内、画面最靠前的单位。own=false 时排除己方 */
  private pointedUnit(wx: number, wy: number, own: boolean): number {
    const g = this.game;
    let pn = -1;
    let maxY = -Infinity;
    for (let i = 0; i < PMAX; i++) {
      const p = g.people[i];
      if (p.stat <= PS.DEAD) continue;
      if (!own && p.col === g.user_col) continue;
      const [px, py] = unitPos(g, this.ip, i);
      if (py >= maxY && wx >= px - 12 && wx < px + 12 && wy >= py - 32 && wy < py + 12) {
        pn = i;
        maxY = py;
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
    if (!this.mouse.inside || this.view.selected.size === 0 || this.drag || this.menuOpen) return;
    if (this.inMinimap(this.mouse.x, this.mouse.y)) return;
    const [wx, wy] = this.cam.toWorld(this.mouse.x, this.mouse.y);
    const target = this.pointedUnit(wx, wy, false);
    if (target >= 0) this.view.arrowPn = target;
    else this.view.cursorTile = this.tileAt(wx, wy);
  }

  private issueOrder(sx: number, sy: number): void {
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const target = this.pointedUnit(wx, wy, false);
    const tile = this.tileAt(wx, wy);
    this.pending.push({ type: 'order', units: [...this.view.selected], bx: tile.bx, by: tile.by, target });
    this.fx.blink = { bx: tile.bx, by: tile.by, pn: target, t0: performance.now() };
    play('move');
    if (settings.controls === 'classic') this.cancelSelection(false);
  }

  private cancelSelection(withSound: boolean): void {
    if (withSound && this.view.selected.size) play('cancel');
    this.view.selected.clear();
  }

  private selectAll(): void {
    const g = this.game;
    this.view.selected.clear();
    for (let i = 0; i < PMAX; i++) if (g.people[i].stat > PS.DEAD && g.people[i].col === g.user_col) this.view.selected.add(i);
    if (this.view.selected.size) play('select');
  }

  private finishSelect(x1: number, y1: number, x2: number, y2: number): void {
    const g = this.game;
    const sel = new Set<number>();
    if (Math.abs(x2 - x1) < 4 && Math.abs(y2 - y1) < 4) {
      const [wx, wy] = this.cam.toWorld(x2, y2);
      const pn = this.pointedUnit(wx, wy, true);
      if (pn >= 0 && g.people[pn].col === g.user_col) sel.add(pn);
    } else {
      // 原版框选判定：框向左右各扩 12、向上扩 12、向下扩 32（862/f5:211-214）
      const [ax, ay] = this.cam.toWorld(Math.min(x1, x2), Math.min(y1, y2));
      const [bx, by] = this.cam.toWorld(Math.max(x1, x2), Math.max(y1, y2));
      for (let i = 0; i < PMAX; i++) {
        const p = g.people[i];
        if (p.stat <= PS.DEAD || p.col !== g.user_col) continue;
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
      if (this.view.selected.size) this.issueOrder(x, y);
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { kind: 'pan', sx: x, sy: y, camX: this.cam.x, camY: this.cam.y };
      return;
    }
    if (e.button !== 0) return;
    if (this.inMinimap(x, y)) {
      this.drag = { kind: 'minimap', sx: x, sy: y, camX: 0, camY: 0 };
      this.moveToMinimap(x, y);
      return;
    }
    if (this.keys.has(' ')) {
      this.drag = { kind: 'pan', sx: x, sy: y, camX: this.cam.x, camY: this.cam.y };
      return;
    }
    if (settings.controls === 'classic' && this.view.selected.size) {
      this.issueOrder(x, y);
      return;
    }
    this.drag = { kind: 'select', sx: x, sy: y, camX: 0, camY: 0 };
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
    if (d.kind === 'select') this.finishSelect(d.sx, d.sy, this.mouse.x, this.mouse.y);
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
    if (k === 'escape') {
      if (this.view.selected.size) this.cancelSelection(true);
      else this.openPause();
      return;
    }
    if (k === 'p') {
      this.openPause();
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
    if (document.hidden) {
      this.autosave();
      if (!this.menuOpen && this.game.result === 'playing' && this.game.user_col < 4) this.openPause();
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
    const key = parts.join(',') + `|${this.view.selected.size}|${settings.controls}|${Math.floor(g.tick / FPS)}|${settings.lang}`;
    if (key === this.hudCache) return;
    this.hudCache = key;
    for (let c = 0; c < 4; c++) {
      const pl = g.player[c];
      const chip = this.hud.chips[c];
      chip.className = `chip${c === g.user_col ? ' you' : ''}${pl.exist ? '' : ' out'}${g.top === c ? ' top' : ''}`;
      chip.style.setProperty('--fc', FACTION[c].ui);
      chip.title = g.top === c ? t('hud.top.tip', { name: factionName(c) }) : '';
      const parts: (HTMLElement | null)[] = [
        h('span', { class: 'dot' }),
        h('span', { class: 'name' }, factionName(c, true)),
        c === g.user_col ? h('span', { class: 'you-tag' }, t('hud.you')) : null,
        h('span', { class: 'num' }, t('hud.count', { n: pl.people_cnt })),
        h('span', { class: 'num' }, `♠${spadeCount(g, c)}`),
        g.top === c ? h('span', { class: 'top-tag' }, t('hud.top')) : null,
      ];
      chip.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
    }
    this.hud.clock.textContent = g.user_col >= 4 ? `${t('hud.watching')} ${formatTime(g.tick)}` : formatTime(g.tick);
    const n = this.view.selected.size;
    this.hud.selbar.classList.toggle('hidden', n === 0);
    this.hud.selText.textContent = t('hud.selected', { n });
    this.hud.selHint.textContent = settings.controls === 'classic' ? t('hud.hint.classic') : t('hud.hint.modern');
  }

  private showBanner(text: string, persistent: boolean): void {
    play('message');
    const b = this.hud.banner;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (!persistent) this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), 5000);
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
    const content = h(
      'div',
      { class: 'panel menu' },
      h('h2', {}, t('menu.paused')),
      btn(t('menu.resume'), () => close()),
      this.game.user_col < 4 ? btn(t('menu.save'), () => openSaveLoad('save', this.game, () => {}), 'btn ghost') : null,
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
    const title = g.result === 'win' ? t('result.win') : g.result === 'lose' ? t('result.lose') : t('result.over');
    this.menuOpen = true;
    let close = () => {};
    const content = h(
      'div',
      { class: `panel menu result ${g.result}` },
      h('h2', {}, title),
      winner >= 0 && g.player.filter((p) => p.exist).length === 1 ? h('div', { class: 'result-line' }, t('result.winner', { name: factionName(winner) })) : null,
      h('div', { class: 'result-line' }, t('result.time', { time: formatTime(g.tick) })),
      g.user_col < 4 ? h('div', { class: 'result-line' }, t('result.kills', { n: g.kills[g.user_col] })) : null,
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

