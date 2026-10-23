// 原版数值。出处均为 School_Wars_decompiled_AS/scripts/ 下的文件，
// "862/f1:208" 表示 DefineSprite_862/frame_1/DoAction.as 第 208 行。

/** SWF 帧率；所有逻辑按帧（tick）计数 */
export const FPS = 18;

/** 大格边长（862/f1:11） */
export const BSIZE = 16;
/** 小格边长 = 每大格 4×4（862/f1:139） */
export const SSIZE = BSIZE * 4;
/** 单位槽位总数（862/f2:126） */
export const PMAX = 48;
/** 每阵营在场上限 = pmax / 4（862/f2:34） */
export const PEOPLE_CAP = PMAX / 4;
/** 开局每阵营人数（862/f2:149） */
export const INITIAL_PEOPLE = 3;

/** 阵营属性（862/f1:208-210）：0 黑、1 绿、2 黄、3 紫 */
export const SPEC_APPEAR = [1500, 500, 1500, 1500];
export const SPEC_HP = [20, 10, 25, 15];
export const SPEC_PUNCH = [4, 2, 3, 5];

/** 方向：0 = +x（屏幕右下）、1 = +y（左下）、2 = -x（左上）、3 = -y（右上）（862/f1:14-17） */
export const ADDX = [1, 0, -1, 0];
export const ADDY = [0, 1, 0, -1];
/** 行走时每帧的画面位移（x 方向再乘 2） */
export const MOVEX = [1, -1, -1, 1];
export const MOVEY = [1, 1, -1, -1];

/** 单位状态（862/f2:119-125） */
export const PS = {
  EMPTY: 0,
  DEAD: 1,
  WALK: 2,
  STAND: 3,
  SIT: 4,
  WAIT: 5,
  FIGHT: 6,
} as const;

/** 地块类型 */
export const AREA = {
  NONE: 0,
  BASE: 1,
  SPADE: 2,
  HEART: 3,
} as const;

/** 观战模式下的 user_col（标题画面隐藏按钮 click_button(4)） */
export const WATCH_COL = 4;

/** 地块图案号 p → 类型与归属（862/f1:18-34） */
export function mappat(p: number): { areatype: number; col: number } {
  if (p === 0) return { areatype: AREA.NONE, col: -1 };
  return { areatype: 1 + Math.floor(p / 5), col: (p % 5) - 1 };
}

/** 占领所需的累计坐下帧数（862/f3:119） */
export const CAPTURE_VALUE = 300;
/** 坐在己方本部或 ♥ 上每帧回血量（862/f3:144） */
export const HEAL_PER_TICK = 0.1;
/** 自动索敌的曼哈顿距离（小格）（862/f3:78） */
export const AGGRO_RANGE = 10;
/** 电脑单位累计坐下多少帧后才接受新命令（862/f4:17） */
export const AI_IDLE_TICKS = 400;
/** "领先者"判定阈值（862/f3:680） */
export const TOP_RATIO = 0.4;
