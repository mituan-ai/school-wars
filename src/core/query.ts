// 规则层的小查询，供单位、刷兵和 AI 共用
import {
  BSIZE, REMAKE_APPEAR, REMAKE_HP, REMAKE_PUNCH, SPEC_APPEAR, SPEC_HP, SPEC_PUNCH, STAR_KILLS, STAR_MAX,
} from './constants.ts';
import type { Game, RuleSet } from './types.ts';

/** 阵营数值（按规则集） */
export function factionSpec(ruleset: RuleSet, col: number): { hp: number; punch: number; appear: number } {
  if (ruleset === 'remake') return { hp: REMAKE_HP[col], punch: REMAKE_PUNCH[col], appear: REMAKE_APPEAR[col] };
  return { hp: SPEC_HP[col], punch: SPEC_PUNCH[col], appear: SPEC_APPEAR[col] };
}

/** 头顶星级：每击倒 3 人一颗，最多 3 颗（仅"校园战争"规则显示） */
export function stars(lev: number): number {
  return Math.min(STAR_MAX, Math.floor(lev / STAR_KILLS));
}

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
/** 由玩家控制的阵营：单机的 user_col，或联机局里标为 'human' 的阵营 */
export function isHuman(g: Game, col: number): boolean {
  return col === g.user_col || g.rules.ai[col] === 'human';
}

export function topBlocks(g: Game, col: number, targetCol: number): boolean {
  if (g.top < 0 || col === g.top || targetCol === g.top) return false;
  if (g.rules.ruleset === 'remake' && targetCol >= 0 && baseFallen(g, targetCol)) return false;
  return true;
}
