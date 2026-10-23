// "校园战争"电脑指挥官（docs/03 §3）。只产出与玩家相同的指令。
import type { Command, Game } from './types.ts';

export function commander(_g: Game, _col: number): Command[] {
  return [];
}
