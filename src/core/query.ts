// 规则层的小查询，供单位、刷兵和 AI 共用
import { BSIZE } from './constants.ts';
import type { Game } from './types.ts';

/** 某阵营的本部是否已沦陷（只有"校园战争"规则会出现） */
export function baseFallen(g: Game, col: number): boolean {
  const pl = g.player[col];
  const n = g.bmap_n[pl.basey * BSIZE + pl.basex];
  return n >= 0 && g.area[n].fallen;
}

/**
 * "众矢之的"：存在领先者时，非领先者阵营 col 只能对领先者动手。
 * "校园战争"规则下，本部已沦陷的阵营不受这条保护。
 */
export function topBlocks(g: Game, col: number, targetCol: number): boolean {
  if (g.top < 0 || col === g.top || targetCol === g.top) return false;
  if (g.rules.ruleset === 'remake' && targetCol >= 0 && baseFallen(g, targetCol)) return false;
  return true;
}
