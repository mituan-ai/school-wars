// 世界坐标几何：与原版 mcStage 内坐标一致（大格菱形 96×48，小格 24×12）
import { BSIZE } from '../core/constants.ts';

export const BOARD_W = BSIZE * 48; // 菱形半宽
export const BOARD_H = BSIZE * 48; // 菱形高
export const CURB = 5; // 操场路沿的高度

export const SCHOOL_W = 30;
export const SCHOOL_D = 15;
export const SCHOOL_H = 24;

/** 大格中心的世界坐标 */
export function tileCenter(bx: number, by: number): [number, number] {
  return [bx * 48 - by * 48, by * 24 + bx * 24 + 24];
}

/** 世界坐标 → 连续的小格坐标（整数部分即所在小格） */
export function worldToCell(wx: number, wy: number): [number, number] {
  return [(wx / 12 + wy / 6) / 2, (wy / 6 - wx / 12) / 2];
}

/** 校舍立在本部所在的棋盘外角之外；返回地基中心 */
export function schoolAnchor(bx: number, by: number): [number, number] {
  const ox = bx === by ? 0 : bx > by ? 1 : -1;
  const oy = bx === by ? (bx === 0 ? -1 : 1) : 0;
  const vx = ox * BOARD_W;
  const vy = BOARD_H / 2 + oy * (BOARD_H / 2);
  return [vx + ox * (SCHOOL_W + 8), vy + oy * (SCHOOL_D + 8) + (oy > 0 ? CURB : 0)];
}
