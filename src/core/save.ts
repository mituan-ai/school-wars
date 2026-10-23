// 对局状态的序列化。模拟是确定性的，所以"状态 + 随机数状态"就是完整存档。
import { CLASSIC_RULES, type Game } from './types.ts';

export const SAVE_VERSION = 3;

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
  if (file.v === 1) migrateV1(file.game as unknown as Record<string, unknown>);
  if (file.v <= 2) migrateV2(file.game as unknown as Game);
  return { ...file.game, events: [] };
}

/** v1 → v2：v1 只有原版规则；补上"校园战争"规则新增的字段 */
function migrateV1(game: Record<string, unknown>): void {
  const g = game as unknown as Game;
  g.rules = structuredClone(CLASSIC_RULES);
  let uid = 0;
  for (const p of g.people) {
    Object.assign(p, {
      uid: p.stat ? uid++ : -1,
      ordered: false, leash: false, anchor_x: 0, anchor_y: 0, retaliate: -1, task: 0, task_area: -1,
    });
  }
  for (const a of g.area) Object.assign(a, { touch: [0, 0, 0, 0], fallen: false, holder: -1 });
  for (const pl of g.player) Object.assign(pl, { rally_bx: -1, rally_by: -1 });
  g.next_uid = uid;
  g.groups = Array.from({ length: 10 }, () => []);
}

/** v2 → v3：补上寻路等待计数和进攻移动的字段 */
function migrateV2(g: Game): void {
  for (const p of g.people) Object.assign(p, { stuck: 0, amove: false, goal_x: 0, goal_y: 0 });
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
