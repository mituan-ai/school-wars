import './style.css';
import { createGame } from './core/mapgen.ts';
import { randomSeed } from './core/rng.ts';
import type { Game } from './core/types.ts';
import { setLang } from './i18n/index.ts';
import { settings } from './settings.ts';
import { GameScreen } from './ui/game-screen.ts';
import { TitleScreen } from './ui/title-screen.ts';

const app = document.getElementById('app')!;
setLang(settings.lang);

let current: { destroy(): void } | null = null;

function showTitle(): void {
  current?.destroy();
  const title = new TitleScreen({ onPick: (col) => startGame(createGame({ seed: randomSeed(), userCol: col })), onLoad: startGame });
  title.mount(app);
  current = title;
}

function startGame(g: Game): void {
  current?.destroy();
  const screen: GameScreen = new GameScreen(g, {
    onQuit: showTitle,
    onLoad: startGame,
    onRestart: (sameMap) => startGame(createGame({ seed: sameMap ? g.seed : randomSeed(), userCol: g.user_col })),
  });
  screen.mount(app);
  current = screen;
  // 开发调试与端到端测试用
  (window as unknown as { __sw?: GameScreen }).__sw = screen;
}

showTitle();
