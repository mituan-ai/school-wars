import './style.css';
import { createGame } from './core/mapgen.ts';
import { randomSeed } from './core/rng.ts';
import type { Game } from './core/types.ts';
import { setLang } from './i18n/index.ts';
import { Online, wasInRoom, type NetSession } from './net/session.ts';
import { newGameRules, settings } from './settings.ts';
import { GameScreen } from './ui/game-screen.ts';
import { LobbyScreen } from './ui/lobby-screen.ts';
import { TitleScreen } from './ui/title-screen.ts';

const app = document.getElementById('app')!;
setLang(settings.lang);
// 画布上的像素字要等字体到位，否则先画出来的是系统字体
void document.fonts?.load('12px "Fusion Pixel"').catch(() => {});

let current: { destroy(): void } | null = null;
/** 联机连接：进入联机大厅时建立，回到标题画面时关闭 */
let online: Online | null = null;

function showTitle(): void {
  current?.destroy();
  online?.shutdown();
  online = null;
  const title = new TitleScreen({
    onPick: (col) => startGame(createGame({ seed: randomSeed(), userCol: col, rules: newGameRules() })),
    onLoad: startGame,
    onOnline: () => showLobby(),
  });
  title.mount(app);
  current = title;
}

function startGame(g: Game): void {
  current?.destroy();
  online?.shutdown();
  online = null;
  const screen: GameScreen = new GameScreen(g, {
    onQuit: showTitle,
    onLoad: startGame,
    // 再来一局沿用这局的规则；想换规则就回标题改设置
    onRestart: (sameMap) => startGame(createGame({ seed: sameMap ? g.seed : randomSeed(), userCol: g.user_col, rules: g.rules })),
  });
  screen.mount(app);
  current = screen;
  // 开发调试与端到端测试用
  (window as unknown as { __sw?: GameScreen }).__sw = screen;
}

function showLobby(code = ''): void {
  current?.destroy();
  online ??= new Online();
  const lobby = new LobbyScreen(online, { onBack: showTitle, onGame: startNetGame }, code);
  lobby.mount(app);
  current = lobby;
  (window as unknown as { __online?: Online }).__online = online;
}

function startNetGame(s: NetSession): void {
  current?.destroy();
  const screen: GameScreen = new GameScreen(s.client.confirmed!, {
    onQuit: () => showLobby(),
    onLoad: startGame,
    onRestart: () => showLobby(),
  }, s);
  screen.mount(app);
  current = screen;
  (window as unknown as { __sw?: GameScreen }).__sw = screen;
}

// 邀请链接 ?room=ABCD 直接进入联机大厅并加入；联机中刷新页面也回到大厅
const invite = new URLSearchParams(location.search).get('room');
if (invite) showLobby(invite.toUpperCase());
else if (wasInRoom()) showLobby();
else showTitle();
