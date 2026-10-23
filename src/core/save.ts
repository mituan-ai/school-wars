// 对局状态的序列化。模拟是确定性的，所以"状态 + 随机数状态"就是完整存档。
import type { Game } from './types.ts';

export const SAVE_VERSION = 1;

interface SaveFile {
  v: number;
  game: Omit<Game, 'events'>;
}

// JSON 不能表示 NaN（donothing 的"未赋值"状态），用字符串占位
const NAN_TOKEN = '__NaN__';

export function serializeGame(g: Game): string {
  const { events: _events, ...rest } = g;
  const file: SaveFile = { v: SAVE_VERSION, game: rest };
  return JSON.stringify(file, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? NAN_TOKEN : v));
}

export function deserializeGame(text: string): Game {
  const file = JSON.parse(text, (_k, v) => (v === NAN_TOKEN ? NaN : v)) as SaveFile;
  if (typeof file !== 'object' || file === null || typeof file.v !== 'number') {
    throw new Error('不是有效的存档');
  }
  if (file.v > SAVE_VERSION) throw new Error(`存档版本 ${file.v} 比当前程序新`);
  // 以后的格式迁移写在这里：if (file.v === 1) { ...; file.v = 2; }
  return { ...file.game, events: [] };
}

/** 状态指纹，用于测试"读档后走向一致" */
export function hashGame(g: Game): string {
  const s = serializeGame(g);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}
