// 权威（docs/05 §2）：按自己的时钟每 55.6 ms 关闭一帧，把这一帧的指令广播出去；不等任何玩家。
// 自己也跑一份模拟，用来比对指纹、给重连或不一致的玩家发快照、处理掉线托管。
// 不依赖浏览器和 Node：服务器模式跑在 LA，玩家主机模式跑在房主的浏览器里。
import { hashGame, serializeGame } from '../core/save.ts';
import { step } from '../core/sim.ts';
import type { AiLevel, Command, Game } from '../core/types.ts';
import type { Link, Scheduler } from './link.ts';
import {
  CMD_RATE, GRACE_MS, MAX_LEAD, TICK_MS, sanitizeCommand,
  type Batch, type PendingCmd, type SeatState, type Stamped, type ToAuthority, type ToClient,
} from './protocol.ts';

interface Conn {
  link: Link;
  /** 座位（学校），-1 为观战 */
  col: number;
  synced: boolean;
  /** 对方已确认到第几帧（权威暂停期间用来补发） */
  f: number;
  tokens: number;
  refill: number;
  bye: boolean;
}

export interface AuthorityOptions {
  /** 起始状态（会被权威持有并推进） */
  game: Game;
  sched: Scheduler;
  /** 掉线托管用的电脑难度 */
  dropAi: AiLevel;
  /** 哪些座位属于人类玩家（即使此刻由电脑托管） */
  humanSeats: boolean[];
  /** 已知的帧记录（换房主时由新房主带来） */
  log?: Batch[];
  /** 开局 / 换房主时先暂停，等这些座位都连上，最多等 waitMs */
  waitFor?: number[];
  waitMs?: number;
  onEnded?: () => void;
}

/** 每个座位最多记住多少个已定帧的指令序号（去重用） */
const SEEN_KEEP = 4000;
/** 指纹保留多久（帧） */
const HASH_KEEP = 90 * 40;

export class Authority {
  readonly game: Game;
  private sched: Scheduler;
  private dropAi: AiLevel;
  private humanSeats: boolean[];
  private log = new Map<number, Batch>();
  private future = new Map<number, Stamped[]>();
  private conns = new Set<Conn>();
  private seen: Set<number>[] = [new Set(), new Set(), new Set(), new Set()];
  private hashes = new Map<number, string>();
  private awaySince: number[];
  /** 权威时间 = now - t0（ms）；第 k 帧在 (k+1) × TICK_MS 时关闭 */
  private t0 = 0;
  private held = false;
  private waitFor: Set<number> | null = null;
  private waitUntil = 0;
  private ended = false;
  private onEnded?: () => void;
  private lastSeats = '';
  /** 发现状态不一致、发了快照纠正的次数 */
  desyncs = 0;

  constructor(o: AuthorityOptions) {
    this.game = o.game;
    this.sched = o.sched;
    this.dropAi = o.dropAi;
    this.humanSeats = o.humanSeats.slice();
    this.onEnded = o.onEnded;
    for (const b of o.log ?? []) this.log.set(b.k, b);
    const now = this.sched.now();
    // 一开始都算"刚掉线"：开局等不到的人，过了宽限期由电脑接管
    this.awaySince = [0, 1, 2, 3].map(() => now);
    for (const col of this.game.rules.ai.keys()) this.seedSeen(col);
    this.hashes.set(this.game.tick, hashGame(this.game));
    if (o.waitFor && o.waitFor.length > 0) {
      this.held = true;
      this.waitFor = new Set(o.waitFor);
      this.waitUntil = now + (o.waitMs ?? 8000);
    }
    this.t0 = now - this.game.tick * TICK_MS;
  }

  /** 下一个要关闭的帧 */
  get open(): number {
    return this.game.tick;
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** 权威时间（ms） */
  time(): number {
    return this.held ? this.game.tick * TICK_MS : this.sched.now() - this.t0;
  }

  attach(link: Link, col: number): void {
    const conn: Conn = { link, col, synced: false, f: -1, tokens: CMD_RATE, refill: this.sched.now(), bye: false };
    this.conns.add(conn);
    link.onMessage = (m) => this.onMessage(conn, m);
    link.onClose = () => this.detach(conn);
  }

  /** 推进时钟：到点的帧全部关闭并广播。由外部定时调用（服务器 setInterval、房主的 Worker） */
  pump(): void {
    const now = this.sched.now();
    if (this.held) {
      if (this.waitFor && (this.waitFor.size === 0 || now >= this.waitUntil)) this.resume();
      else return;
    }
    for (let col = 0; col < 4; col++) {
      if (this.game.rules.ai[col] === 'human' && !this.online(col) && now - this.awaySince[col] >= GRACE_MS) {
        this.queueControl(col, this.dropAi);
      }
    }
    const t = this.time();
    let n = 0;
    while (t >= (this.game.tick + 1) * TICK_MS && n < 2000) {
      this.closeBatch();
      n++;
    }
    this.broadcastSeats();
  }

  /** 暂停（换房主时由外部决定，平时不用） */
  hold(): void {
    this.held = true;
  }

  resume(): void {
    this.held = false;
    this.waitFor = null;
    this.t0 = this.sched.now() - this.game.tick * TICK_MS;
    for (const c of this.conns) if (c.synced) this.catchUp(c);
    this.sendAll({ t: 'hold', on: false });
  }

  /** 关闭所有链路（换房主后旧房主退位、房间解散） */
  shutdown(): void {
    for (const c of [...this.conns]) c.link.close();
    this.conns.clear();
  }

  seatStates(): SeatState[] {
    return [0, 1, 2, 3].map((col) => {
      if (!this.humanSeats[col]) return 'cpu';
      if (this.game.rules.ai[col] !== 'human' && !this.pendingControl(col, 'human')) return 'ai';
      return this.online(col) ? 'online' : 'away';
    });
  }

  // ---- 内部 ----

  private online(col: number): boolean {
    for (const c of this.conns) if (c.col === col && c.synced && c.link.isOpen()) return true;
    return false;
  }

  private onMessage(conn: Conn, raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const m = raw as ToAuthority;
    switch (m.t) {
      case 'sync':
        this.onSync(conn, m);
        break;
      case 'cmd':
        if (conn.synced) this.onCmd(conn, m);
        break;
      case 'ping':
        if (typeof m.i === 'number') this.send(conn, { t: 'pong', i: m.i, a: this.time() });
        break;
      case 'hash': {
        const h = this.hashes.get(m.k);
        if (h !== undefined && h !== m.h) {
          this.desyncs++;
          this.sendSnap(conn);
        }
        break;
      }
      case 'bye':
        conn.bye = true;
        break;
    }
  }

  private onSync(conn: Conn, m: Extract<ToAuthority, { t: 'sync' }>): void {
    // 暂停中（换房主）：对方手里可能有比我们新的帧，补进来。帧来自同一个旧权威，内容一致
    if (this.held && Array.isArray(m.tail)) {
      const tail = new Map<number, Batch>();
      for (const b of m.tail) if (b && typeof b.k === 'number' && Array.isArray(b.c)) tail.set(b.k, b);
      while (tail.has(this.game.tick)) this.applyBatch(tail.get(this.game.tick)!);
    }
    conn.synced = true;
    conn.f = typeof m.f === 'number' ? m.f : -1;
    if (!this.held) this.catchUp(conn);
    if (conn.col >= 0) {
      this.awaySince[conn.col] = Infinity;
      this.waitFor?.delete(conn.col);
      if (this.humanSeats[conn.col] && this.game.rules.ai[conn.col] !== 'human') this.queueControl(conn.col, 'human');
    }
    if (Array.isArray(m.pend)) for (const p of m.pend) this.onCmd(conn, p as PendingCmd);
    // 座位状态只在变化时广播，新接上的这一条要单独补发一份
    this.broadcastSeats();
    this.send(conn, { t: 'seats', s: this.seatStates() });
  }

  private onCmd(conn: Conn, m: { s: number; w: number; c: unknown }): void {
    if (conn.col < 0 || !this.humanSeats[conn.col] || typeof m.s !== 'number') return;
    const now = this.sched.now();
    conn.tokens = Math.min(CMD_RATE, conn.tokens + ((now - conn.refill) / 1000) * CMD_RATE);
    conn.refill = now;
    if (conn.tokens < 1) return;
    const seen = this.seen[conn.col];
    if (seen.has(m.s)) return;
    const c = sanitizeCommand(m.c, conn.col);
    if (!c) return;
    conn.tokens--;
    remember(seen, m.s);
    const open = this.game.tick;
    const w = typeof m.w === 'number' && Number.isFinite(m.w) ? Math.floor(m.w) : open;
    this.queue(Math.min(open + MAX_LEAD, Math.max(open, w)), { s: m.s, c });
  }

  private queue(k: number, st: Stamped): void {
    const list = this.future.get(k);
    if (list) list.push(st);
    else this.future.set(k, [st]);
  }

  private queueControl(col: number, ai: AiLevel): void {
    if (this.pendingControl(col, ai)) return;
    this.queue(this.game.tick, { s: -1, c: { type: 'control', col, ai } });
  }

  private pendingControl(col: number, ai: AiLevel): boolean {
    for (const list of this.future.values()) {
      for (const st of list) if (st.c.type === 'control' && st.c.col === col && st.c.ai === ai) return true;
    }
    return false;
  }

  private closeBatch(): void {
    const k = this.game.tick;
    const b: Batch = { k, c: this.future.get(k) ?? [] };
    this.future.delete(k);
    this.applyBatch(b);
    const msg: ToClient = { t: 'b', k: b.k, c: b.c };
    for (const c of this.conns) if (c.synced) this.send(c, msg);
  }

  private applyBatch(b: Batch): void {
    this.log.set(b.k, b);
    for (const st of b.c) {
      const col = colOf(st.c);
      if (st.s >= 0 && col >= 0 && col < 4) remember(this.seen[col], st.s);
    }
    step(this.game, b.c.map((st) => st.c));
    const k = this.game.tick;
    if (k % 90 === 0) {
      this.hashes.set(k, hashGame(this.game));
      this.hashes.delete(k - HASH_KEEP);
    }
    if (!this.ended && this.game.player.filter((p) => p.exist).length <= 1) {
      this.ended = true;
      this.onEnded?.();
    }
  }

  /** 补发对方缺的帧；缺得太多或记录不全就发快照 */
  private catchUp(conn: Conn): void {
    const from = conn.f;
    const open = this.game.tick;
    if (from >= 0 && from <= open) {
      let ok = true;
      for (let k = from; k < open; k++) if (!this.log.has(k)) ok = false;
      if (ok) {
        for (let k = from; k < open; k++) this.send(conn, { t: 'b', k, c: this.log.get(k)!.c });
        conn.f = open;
        if (this.held) this.send(conn, { t: 'hold', on: true });
        return;
      }
    }
    this.sendSnap(conn);
  }

  private sendSnap(conn: Conn): void {
    const seen = conn.col >= 0 ? [...this.seen[conn.col]].slice(-400) : [];
    this.send(conn, { t: 'snap', k: this.game.tick, g: serializeGame(this.game), seen });
    conn.f = this.game.tick;
    if (this.held) this.send(conn, { t: 'hold', on: true });
  }

  private detach(conn: Conn): void {
    this.conns.delete(conn);
    const col = conn.col;
    if (col < 0 || this.online(col)) return;
    this.awaySince[col] = this.sched.now();
    // 主动离开的人不等宽限期
    if (conn.bye && this.game.rules.ai[col] === 'human') this.queueControl(col, this.dropAi);
    this.broadcastSeats();
  }

  private broadcastSeats(): void {
    const s = this.seatStates();
    const key = s.join(',');
    if (key === this.lastSeats) return;
    this.lastSeats = key;
    this.sendAll({ t: 'seats', s });
  }

  private sendAll(msg: ToClient): void {
    for (const c of this.conns) if (c.synced) this.send(c, msg);
  }

  private send(conn: Conn, msg: ToClient): void {
    conn.link.send(msg);
  }

  private seedSeen(col: number): void {
    for (const b of this.log.values()) {
      for (const st of b.c) if (st.s >= 0 && colOf(st.c) === col) remember(this.seen[col], st.s);
    }
  }
}

/** 玩家指令的阵营；电脑托管指令不算 */
function colOf(c: Command): number {
  return c.type === 'control' ? -1 : (c.col ?? -1);
}

function remember(set: Set<number>, s: number): void {
  set.add(s);
  if (set.size > SEEN_KEEP) set.delete(set.values().next().value!);
}
