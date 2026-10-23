// 存档位：自动存档 + 3 个手动档位，保存在 localStorage，可导出为文件
import { deserializeGame, serializeGame } from '../core/save.ts';
import type { Game } from '../core/types.ts';

export type SlotId = 'auto' | '1' | '2' | '3';
export const SLOTS: SlotId[] = ['auto', '1', '2', '3'];

export interface SlotMeta {
  userCol: number;
  tick: number;
  savedAt: number;
  result: Game['result'];
}

const key = (id: SlotId) => `schoolwars.save.${id}`;
const metaKey = (id: SlotId) => `schoolwars.meta.${id}`;

export function writeSlot(id: SlotId, g: Game): void {
  const meta: SlotMeta = { userCol: g.user_col, tick: g.tick, savedAt: Date.now(), result: g.result };
  localStorage.setItem(key(id), serializeGame(g));
  localStorage.setItem(metaKey(id), JSON.stringify(meta));
}

export function readSlot(id: SlotId): Game | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? deserializeGame(raw) : null;
  } catch {
    return null;
  }
}

export function slotMeta(id: SlotId): SlotMeta | null {
  try {
    const raw = localStorage.getItem(metaKey(id));
    return raw ? (JSON.parse(raw) as SlotMeta) : null;
  } catch {
    return null;
  }
}

export function exportFile(g: Game): void {
  const blob = new Blob([serializeGame(g)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `school-wars-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importFile(): Promise<Game> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('no file'));
      try {
        resolve(deserializeGame(await file.text()));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    input.click();
  });
}
