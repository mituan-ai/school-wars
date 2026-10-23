// 标题画面：背景是一局实时进行的四 AI 观战局
import { FPS, WATCH_COL } from '../core/constants.ts';
import { createGame } from '../core/mapgen.ts';
import { factionSpec } from '../core/query.ts';
import { randomSeed } from '../core/rng.ts';
import { step } from '../core/sim.ts';
import { remakeRules, type Game } from '../core/types.ts';
import { factionName, t, type TextKey } from '../i18n/index.ts';
import { Camera, newFx, newInterp, render } from '../render/renderer.ts';
import { FACTION } from '../render/palette.ts';
import { drawStudent } from '../render/student.ts';
import { readSlot, slotMeta } from '../save/storage.ts';
import { settings } from '../settings.ts';
import { h } from './dom.ts';
import { openSaveLoad, openSettings } from './panels.ts';

export interface TitleHooks {
  onPick: (col: number) => void;
  onLoad: (g: Game) => void;
}

export class TitleScreen {
  readonly root: HTMLElement;
  private canvas = h('canvas', { class: 'game-canvas' });
  private ctx = this.canvas.getContext('2d')!;
  private game = TitleScreen.attract();
  private cam = new Camera();
  private ip = newInterp();
  private fx = newFx();
  private raf = 0;
  private acc = 0;
  private last = 0;
  private dpr = 1;
  private panel = h('div', { class: 'title-panel' });
  private portraits: { canvas: HTMLCanvasElement; col: number; hover: boolean }[] = [];
  private hooks: TitleHooks;

  constructor(hooks: TitleHooks) {
    this.hooks = hooks;
    this.root = h('div', { class: 'title-screen' }, this.canvas, h('div', { class: 'title-shade' }), this.panel);
    this.build();
  }

  /** 背景观战局：新规则、困难电脑，节奏明快 */
  private static attract(): Game {
    return createGame({ seed: randomSeed(), userCol: WATCH_COL, rules: remakeRules('hard') });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private build(): void {
    this.portraits = [];
    const cards = [0, 1, 2, 3].map((col) => {
      const pc = h('canvas', { class: 'portrait', width: 168, height: 168 });
      const entry = { canvas: pc, col, hover: false };
      this.portraits.push(entry);
      const spec = factionSpec(settings.ruleset, col);
      const fast = spec.appear < 1000;
      return h(
        'button',
        {
          class: 'card',
          style: `--fc:${FACTION[col].ui}`,
          onMouseenter: () => (entry.hover = true),
          onMouseleave: () => (entry.hover = false),
          onClick: () => this.hooks.onPick(col),
        },
        pc,
        h('div', { class: 'card-name' }, factionName(col)),
        h('div', { class: 'card-trait' }, t(`faction.trait.${col}` as TextKey)),
        settings.ruleset === 'remake' ? h('div', { class: 'card-perk' }, t(`faction.perk.${col}` as TextKey)) : null,
        h(
          'div',
          { class: 'card-stats' },
          h('span', {}, `${t('stat.hp')} ${spec.hp}`),
          h('span', {}, `${t('stat.atk')} ${spec.punch}`),
          h('span', { class: fast ? 'fast' : '' }, `${t('stat.spawn')} ${fast ? t('stat.spawn.fast') : t('stat.spawn.slow')}`),
        ),
      );
    });
    const auto = slotMeta('auto');
    const canContinue = auto !== null && auto.result === 'playing';
    this.panel.replaceChildren(
      h('h1', { class: 'logo' }, t('game.title')),
      h('div', { class: 'logo-sub' }, t('game.subtitle')),
      h('div', { class: 'pick-label' }, t('title.pick')),
      h('button', { class: 'rules-line', onClick: () => openSettings(() => this.build()) },
        settings.ruleset === 'classic'
          ? t('title.rules.classic')
          : t('title.rules', { rules: t('rules.remake'), difficulty: t(`difficulty.${settings.difficulty}`) })),
      h('div', { class: 'cards' }, ...cards),
      h(
        'div',
        { class: 'title-actions' },
        canContinue
          ? h('button', {
              class: 'btn',
              onClick: () => {
                const g = readSlot('auto');
                if (g) this.hooks.onLoad(g);
              },
            }, t('title.continue'))
          : null,
        h('button', { class: 'btn ghost', onClick: () => openSaveLoad('load', null, (g) => this.hooks.onLoad(g)) }, t('title.load')),
        h('button', { class: 'btn ghost', onClick: () => this.hooks.onPick(WATCH_COL) }, t('title.watch')),
        h('button', { class: 'btn ghost', onClick: () => openSettings(() => this.build()) }, t('title.settings')),
      ),
      h('div', { class: 'credit' }, t('game.credit')),
    );
  }

  private onResize = (): void => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.cam.w = window.innerWidth;
    this.cam.h = window.innerHeight;
    this.cam.zoom = Math.max(1.1, window.innerHeight / 520);
  };

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.acc += dt;
    const g = this.game;
    while (this.acc >= 1000 / FPS) {
      this.acc -= 1000 / FPS;
      for (let i = 0; i < g.people.length; i++) {
        this.ip.prevX[i] = g.people[i].px;
        this.ip.prevY[i] = g.people[i].py;
      }
      for (const e of step(g)) {
        if (e.kind === 'appear') {
          this.ip.prevX[e.pn] = g.people[e.pn].px;
          this.ip.prevY[e.pn] = g.people[e.pn].py;
        }
      }
      if (g.player.filter((p) => p.exist).length <= 1 || g.tick > 20 * 60 * FPS) {
        this.game = TitleScreen.attract();
      }
    }
    this.ip.alpha = this.acc / (1000 / FPS);
    // 镜头缓慢巡游
    const k = now / 1000;
    this.cam.x = Math.sin(k * 0.05) * 420;
    this.cam.y = 384 + Math.sin(k * 0.037) * 200;
    render(this.ctx, this.game, this.cam, this.ip, { selected: new Set(), cursorTile: null, arrowPn: -1, rect: null }, this.fx, now, this.dpr, false);
    this.drawPortraits(now);
  };

  private drawPortraits(now: number): void {
    for (const p of this.portraits) {
      const c = p.canvas.getContext('2d')!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, p.canvas.width, p.canvas.height);
      c.setTransform(3.4, 0, 0, 3.4, 0, 0);
      const pat = p.hover ? Math.floor(now / 80) % 10 : [10, 13, 16, 14][p.col];
      drawStudent(c, 24, 47, p.col, 0, pat);
    }
  }
}
