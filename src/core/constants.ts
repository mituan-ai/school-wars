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

// ---- "校园战争"优化规则（docs/03_优化方案.md）----

/** 攻陷敌方本部所需的累计坐下帧数 */
export const SIEGE_VALUE = 600;
/** 夺回己方本部所需的累计坐下帧数 */
export const RECOVER_VALUE = 300;
/** 无人推进多少帧后占领进度开始回退（5 秒） */
export const DECAY_DELAY = 90;
/** 自动迎战的追击距离上限（小格） */
export const LEASH_RANGE = 12;
/** 击倒对手：回复最大生命的比例、生命上限增加量 */
export const KILL_HEAL = 0.3;
export const KILL_MHP = 2;
/** "校园战争"规则的阵营数值（按锦标赛结果调整，docs/03 §2.3；加入种族特性后重调，docs/04 §3） */
export const REMAKE_APPEAR = [1500, 500, 1500, 1500];
export const REMAKE_HP = [17, 12, 28, 12];
export const REMAKE_PUNCH = [4, 4, 3, 5];

/** 每多少次击倒得一颗星，最多几颗 */
export const STAR_KILLS = 3;
export const STAR_MAX = 3;

// ---- v0.2 体验升级（docs/04_体验升级方案.md）----

/**
 * 种族特性（仅"校园战争"规则，docs/04 §3）。0 人族、1 兽人、2 矮人、3 精灵。
 * 占领 / 攻陷 / 夺回的推进倍率（人族"团结"）、坐下回血倍率（矮人"皮实"）、被打中的概率（精灵"灵巧"）。
 * 兽人的"人海"就是 REMAKE_APPEAR 里更短的增援间隔。
 */
export const TRAIT_CAPTURE = [1.3, 1, 1, 1];
export const TRAIT_HEAL = [1, 1, 2, 1];
export const TRAIT_HIT_TAKEN = [0.5, 0.5, 0.5, 0.42];

/** 寻路：下一格暂时有人时最多原地等几次 */
export const STUCK_TRIES = 5;
/** 进攻移动：行进中发现多少小格内的敌人就去打 */
export const AMOVE_RANGE = 6;
