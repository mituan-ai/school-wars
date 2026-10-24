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
export const REMAKE_APPEAR = [1500, 750, 1500, 1500];
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
export const TRAIT_HIT_TAKEN = [0.5, 0.5, 0.5, 0.38];

/** 寻路：下一格暂时有人时最多原地等几次 */
export const STUCK_TRIES = 5;
/** 进攻移动：行进中发现多少小格内的敌人就去打 */
export const AMOVE_RANGE = 6;

// ---- v0.4 大更新（docs/06_v0.4玩法.md）：地盘、基地经验、班长小队、夹击、下课铃、战争迷雾 ----

/** 涂地：一个人站在空白大格上，这么多帧后这一格归他的学校；敌方的格子要这么多倍 */
export const PAINT_NEED = 18;
export const PAINT_ENEMY_MUL = 3;
/** 同一格里最多算几个人的涂地速度 */
export const PAINT_CREW = 3;

/** 基地经验：坐在己方（连通补给的）营地上每帧 +1；每秒按己方空白地盘数 / 2 加；每击倒一人加 */
export const EXP_SIT = 1;
export const EXP_KILL = 60;
/** 第 n 次升级（n 从 0 起）所需经验 */
export const EXP_COST_BASE = 2400;
export const EXP_COST_STEP = 1200;
/** 升级项：0 生命、1 攻击、2 移速、3 增援；每项最多几级 */
export const UPGRADES = 4;
export const UPGRADE_MAX = 3;
/** 每级：生命 +15%（按种族基础值取整）、攻击 +1、移速 +1/6、增援间隔 −15% */
export const UP_HP = 0.15;
export const UP_SPEED_STEP = 1;
export const UP_REIN = 0.15;

/** 班长：几颗星以上；身边几格内的己方学生（含自己）出手更准 */
export const LEADER_STARS = 3;
export const LEADER_AURA = 4;
/** 班长带的小队最多几人（不含班长）、从多远内招人、多远内找仗打 */
export const SQUAD_SIZE = 3;
export const SQUAD_RECRUIT = 8;
export const SQUAD_SEEK = 16;
/** 小队多久想一次（帧） */
export const SQUAD_THINK = 18;

/**
 * 命中率倍率：被两个方向 / 三个以上方向同时围攻（夹击）、出手的人身边有己方班长。
 * 按倍率乘在种族的被命中率上，精灵"难被打中"的相对优势不会被抵消
 */
export const FLANK_MUL = 0.3;
export const FLANK3_MUL = 0.5;
export const AURA_MUL = 0.2;

/** 下课铃：开局多久第一次响，之后每隔多久响一次；小卖部开多久；每个占着的人每帧加多少经验（最多算几人） */
export const BELL_FIRST = 90 * FPS;
export const BELL_EVERY = 120 * FPS;
export const BELL_OPEN = 40 * FPS;
export const BELL_EXP = 2;
export const BELL_CREW = 3;

/** 迷雾：学生、本部、己方地盘的视野（小格，切比雪夫距离）；看过的地方多久后重新被迷雾盖住 */
export const SIGHT_UNIT = 7;
export const SIGHT_BASE = 9;
export const REFOG = 20 * FPS;
