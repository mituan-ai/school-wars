import type { Rng } from './rng.ts';

/** 一个单位槽位。字段名沿用原版 people[pn] 的命名，方便与 AS 源码对照。 */
export interface Person {
  /** 每次出生递增的编号（槽位会被复用，编队靠它识别同一个人） */
  uid: number;
  stat: number;
  col: number;
  /** 小格坐标（逻辑位置；起步时即写入目标格） */
  cx: number;
  cy: number;
  /** 画面位置（原版 mc._x / mc._y）。行走时逐帧累加，点选与音效判定都用它 */
  px: number;
  py: number;
  cnt: number;
  dir: number;
  /** 姿势计数（逻辑用） */
  pat: number;
  /** 当前显示的姿势帧（原版 people_pat 调用时写入 mcPat 的帧；行走时比 pat 慢一拍） */
  show: number;
  hp: number;
  mhp: number;
  punch: number;
  lev: number;
  fs: number;
  target_pn: number;
  dest_sx: number;
  dest_sy: number;
  /** 防打转用的足迹（862/f3:206-249） */
  hx: number[];
  hy: number[];
  hc: number;
  /** 所在大格与地块号（坐下时记录） */
  bx: number;
  by: number;
  area_num: number;
  /**
   * 累计坐下帧数，供电脑 AI 判断是否发呆。
   * 原版只在 start_stand 里清零，新槽位从未赋值时是 undefined，
   * 在 AS2（SWF7+）中 undefined++ 得到 NaN，而 NaN < 400 为假 —— 所以用 NaN 表示"未赋值"。
   */
  donothing: number;

  // ---- 以下字段只在"校园战争"规则下使用 ----
  /** 正在执行玩家或指挥官下达的指令：被打时不还手，继续前往目的地 */
  ordered: boolean;
  /** 自动迎战时的出发点；追出 LEASH_RANGE 以外就放弃 */
  leash: boolean;
  anchor_x: number;
  anchor_y: number;
  /** 行走中被打：走完这一步后回头反击的对象 */
  retaliate: number;
  /** 指挥官分配的任务与目标地块 */
  task: number;
  task_area: number;
}

export interface Area {
  bx: number;
  by: number;
  areatype: number;
  col: number;
  /** 各阵营的占领进度 */
  val: number[];
  /** 各阵营最后一次推进进度的 tick（进度衰减用） */
  touch: number[];
  /** 本部是否沦陷（仅本部） */
  fallen: boolean;
  /** 攻陷本部的阵营 */
  holder: number;
}

export interface Player {
  exist: boolean;
  basex: number;
  basey: number;
  people_cnt: number;
  appear_cnt: number;
  /** 集结点大格（-1 表示未设置；仅"校园战争"规则） */
  rally_bx: number;
  rally_by: number;
}

/** 模拟向界面层发出的事件（不存档） */
export type GameEvent =
  | { kind: 'punch'; pn: number; px: number; py: number }
  | { kind: 'dead'; pn: number; px: number; py: number }
  | { kind: 'levelup'; pn: number }
  | { kind: 'capture'; area: number; col: number }
  | { kind: 'appear'; pn: number; col: number }
  | { kind: 'miss'; pn: number; px: number; py: number }
  | { kind: 'fallen'; area: number; col: number; by: number }
  | { kind: 'recovered'; area: number; col: number }
  | { kind: 'annihilated'; col: number; result: 'none' | 'win' | 'lose'; persistent: boolean };

export type RuleSet = 'classic' | 'remake';
export type AiLevel = 'classic' | 'easy' | 'normal' | 'hard';

/** 规则。classic + classic AI 与原版完全一致；remake 为"校园战争"优化规则（docs/03）。 */
export interface Rules {
  ruleset: RuleSet;
  /** 每个阵营的电脑 AI（玩家阵营忽略） */
  ai: AiLevel[];
}

export const CLASSIC_RULES: Rules = { ruleset: 'classic', ai: ['classic', 'classic', 'classic', 'classic'] };

export function remakeRules(level: Exclude<AiLevel, 'classic'> = 'normal'): Rules {
  return { ruleset: 'remake', ai: [level, level, level, level] };
}

export interface Game {
  seed: number;
  rng: Rng;
  tick: number;
  rules: Rules;
  /** 0–3 为玩家阵营，4 为观战 */
  user_col: number;
  /** bmap[by][bx].pat / .n 展平为 by * BSIZE + bx */
  bmap_pat: number[];
  bmap_n: number[];
  area: Area[];
  /** smap[cy][cx].pn 展平为 cy * SSIZE + cx */
  smap: number[];
  player: Player[];
  people: Person[];
  top: number;
  pn_com: number;
  next_uid: number;
  /** 玩家编队：每组保存成员 uid（界面功能，随存档保存） */
  groups: number[][];
  /** 击杀统计（重制版新增，只用于结算显示，不影响规则） */
  kills: number[];
  /** 胜负结果（重制版新增，供结算界面使用） */
  result: 'playing' | 'win' | 'lose' | 'over';
  events: GameEvent[];
}

/** 玩家指令：对应原版 onMouseDown 中 operation_status == 2 的分支（862/f5:99-133） */
export interface OrderCommand {
  type: 'order';
  /** 下令的阵营；省略时为玩家阵营 */
  col?: number;
  units: number[];
  bx: number;
  by: number;
  target: number;
}

/** 设置集结点（bx < 0 表示取消） */
export interface RallyCommand {
  type: 'rally';
  bx: number;
  by: number;
}

export type Command = OrderCommand | RallyCommand;
