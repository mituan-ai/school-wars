// 联机协议（docs/05）。权威与客户端之间只传指令：同样的初始状态 + 同样的"第几帧执行哪些指令"，
// 每台机器算出同一局。两种模式共用这一套消息，区别只在权威跑在 LA 服务器还是房主浏览器里。
import { BSIZE, FPS, PMAX } from '../core/constants.ts';
import type { AiLevel, Command, RuleSet } from '../core/types.ts';

declare const __SW_BUILD__: string | undefined;

/** 协议版本；确定性要求所有人运行同一构建，构建号也要一致 */
export const PROTOCOL = 1;
export const BUILD_ID: string = typeof __SW_BUILD__ === 'string' ? __SW_BUILD__ : 'dev';

export const TICK_MS = 1000 / FPS;
/** 每隔多少帧上报一次状态指纹（5 秒） */
export const HASH_EVERY = 90;
/** 掉线多久之后由电脑接管 */
export const GRACE_MS = 15_000;
/**
 * 预测最多领先已确认状态多少帧，再多就停住等网络。经 LA 中转的玩家主机模式往返可达 450–500 ms，
 * 加上抖动余量要领先 12 帧左右；一帧模拟平均约 0.03 ms，24 帧的重算也不到 1 ms
 */
export const MAX_PREDICT = 24;
/** 权威最多接受玩家把指令排到多少帧之后 */
export const MAX_LEAD = 18;
/** 每条链路每秒最多接受多少条指令 */
export const CMD_RATE = 20;
/** 一个房间最多几人（4 名玩家 + 2 名观战） */
export const ROOM_MAX = 6;

export type NetMode = 'server' | 'host';

/** 权威定好帧的一条指令：s 是下令者的序号（电脑托管等权威自己发的指令为 -1） */
export interface Stamped {
  s: number;
  c: Command;
}

/** 第 k 帧（g.tick === k 时）执行的指令 */
export interface Batch {
  k: number;
  c: Stamped[];
}

export interface PendingCmd {
  s: number;
  w: number;
  c: Command;
}

/** 客户端 → 权威 */
export type ToAuthority =
  | { t: 'sync'; f: number; tail: Batch[]; pend: PendingCmd[] }
  | { t: 'cmd'; s: number; w: number; c: Command }
  | { t: 'ping'; i: number }
  | { t: 'hash'; k: number; h: string }
  | { t: 'bye' };

export type SeatState = 'online' | 'away' | 'ai' | 'cpu';

/** 权威 → 客户端 */
export type ToClient =
  | { t: 'snap'; k: number; g: string; seen: number[] }
  | { t: 'b'; k: number; c: Stamped[] }
  | { t: 'pong'; i: number; a: number }
  | { t: 'seats'; s: SeatState[] }
  | { t: 'hold'; on: boolean };

// ---- 房间（浏览器 ⇄ LA 服务器） ----

export interface MemberInfo {
  id: string;
  name: string;
  /** 0–3 为座位（学校），-1 为观战 */
  seat: number;
  online: boolean;
  /** 到 LA 的往返延迟（ms，客户端自测） */
  srv: number;
  /** 到其他成员的直连情况 */
  peers: Record<string, PeerStat>;
}

export interface PeerStat {
  /** direct：WebRTC 直连；relay：直连失败，经 LA 中转；trying：正在尝试 */
  via: 'direct' | 'relay' | 'trying';
  rtt: number;
}

export interface RoomInfo {
  code: string;
  mode: NetMode;
  owner: string;
  /** 玩家主机模式下的房主（权威所在的成员） */
  host: string;
  ruleset: RuleSet;
  /** 战争迷雾（旧服务器没有这个字段） */
  fog?: boolean;
  /** 空座位的电脑难度 */
  ai: AiLevel[];
  /** 掉线托管用的电脑难度 */
  dropAi: AiLevel;
  status: 'lobby' | 'playing';
  /** 每开一局、每换一次房主加一 */
  epoch: number;
  members: MemberInfo[];
}

export interface StartInfo {
  epoch: number;
  mode: NetMode;
  host: string;
  seed: number;
  ruleset: RuleSet;
  fog?: boolean;
  /** 每个座位：'human' 或电脑难度 */
  ai: AiLevel[];
  dropAi: AiLevel;
  /** 座位 → 成员 id（电脑座位为空串） */
  seats: string[];
}

export type ToServer =
  /** g：本页正在运行权威的那一局的 epoch（没有为 0）。房主刷新页面后权威就没了，服务器据此换人 */
  | { t: 'hello'; v: string; p: number; id: string; name: string; g?: number }
  | { t: 'create'; mode: NetMode; ruleset: RuleSet }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'seat'; seat: number }
  | { t: 'config'; mode?: NetMode; ruleset?: RuleSet; fog?: boolean; ai?: AiLevel[]; dropAi?: AiLevel; host?: string }
  | { t: 'start' }
  | { t: 'ended' }
  /** 离开对局但留在房间里 */
  | { t: 'quitgame' }
  | { t: 'stat'; srv: number; peers: Record<string, PeerStat> }
  | { t: 'signal'; to: string; d: unknown }
  | { t: 'relay'; to: string; d: unknown }
  | { t: 'g'; d: ToAuthority }
  | { t: 'ping'; i: number };

export type FromServer =
  | { t: 'welcome'; id: string }
  | { t: 'error'; code: string }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'start'; info: StartInfo }
  | { t: 'host'; host: string; epoch: number }
  | { t: 'signal'; from: string; d: unknown }
  | { t: 'relay'; from: string; d: unknown }
  | { t: 'g'; d: ToClient }
  | { t: 'pong'; i: number };

// ---- 校验：来自网络的东西一律当作不可信 ----

function int(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/** 玩家发来的指令：只接受移动 / 攻击 / 集结点 / 本部升级，阵营由权威按座位填写 */
export function sanitizeCommand(raw: unknown, col: number): Command | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.type === 'order') {
    if (!Array.isArray(c.units) || c.units.length === 0 || c.units.length > PMAX) return null;
    if (!c.units.every((u) => int(u, 0, PMAX - 1))) return null;
    if (!int(c.bx, 0, BSIZE - 1) || !int(c.by, 0, BSIZE - 1) || !int(c.target, -1, PMAX - 1)) return null;
    const out: Command = { type: 'order', col, units: [...(c.units as number[])], bx: c.bx, by: c.by, target: c.target };
    if (c.amove === true) out.amove = true;
    return out;
  }
  if (c.type === 'rally') {
    if (!int(c.bx, -1, BSIZE - 1) || !int(c.by, -1, BSIZE - 1)) return null;
    return { type: 'rally', col, bx: c.bx, by: c.by };
  }
  if (c.type === 'upgrade') {
    if (!int(c.kind, 0, 3)) return null;
    return { type: 'upgrade', col, kind: c.kind };
  }
  return null;
}

export const AI_LEVELS: readonly AiLevel[] = ['classic', 'easy', 'normal', 'hard'];

export function isAiLevel(v: unknown): v is Exclude<AiLevel, 'human'> {
  return typeof v === 'string' && (AI_LEVELS as readonly string[]).includes(v);
}
