// 联机客户端（docs/05 §2）：只应用权威发来的帧得到"已确认状态"；画面放在"权威当前帧 + 单程延迟 + 余量"，
// 从已确认状态往前预测几帧，自己尚未确认的指令算在里面 —— 所以自己的指令下一帧就动。
// 别人的指令到达后，预测被纠正，纠正量用逐渐衰减的位置偏移化开。
import { cloneGame } from '../core/clone.ts';
import { PMAX, PS } from '../core/constants.ts';
import { deserializeGame, hashGame } from '../core/save.ts';
import { step } from '../core/sim.ts';
import type { Command, Game, GameEvent } from '../core/types.ts';
import type { Link, Scheduler } from './link.ts';
import {
  HASH_EVERY, MAX_PREDICT, TICK_MS, type Batch, type PendingCmd, type SeatState, type ToAuthority, type ToClient,
} from './protocol.ts';

/** 这些事件只取自已确认状态：预测错了也不会误报沦陷、出局 */
const KEY_EVENTS = new Set<GameEvent['kind']>(['fallen', 'recovered', 'annihilated', 'capture']);
const TAIL_KEEP = 400;
const PING_MS = 1000;
/** 纠正偏移的衰减时间常数（ms） */
const SMOOTH_MS = 90;

export interface NetView {
  game: Game;
  prevX: Float64Array;
  prevY: Float64Array;
  alpha: number;
  offX: Float64Array;
  offY: Float64Array;
}

export interface NetStats {
  /** 到权威的往返延迟与抖动（ms） */
  rtt: number;
  jitter: number;
  /** 画面领先已确认状态多少帧 */
  ahead: number;
  /** 迟到（被权威推后执行）的指令数 */
  late: number;
  /** 收到快照纠正的次数（不含开局和重连） */
  resyncs: number;
  /** 预测到了上限，在等网络 */
  stalled: boolean;
  /** 权威暂停中（开局等人、换房主） */
  held: boolean;
  /** 最近一次指令从下达到被确认的时间（ms） */
  confirmMs: number;
}

export interface ClientOptions {
  /** 座位（学校），-1 为观战 */
  seat: number;
  sched: Scheduler;
  /** 关掉预测：画面停在已确认状态之后（只用于对比测试） */
  predict?: boolean;
}

export class NetClient {
  readonly seat: number;
  confirmed: Game | null = null;
  seats: SeatState[] = ['cpu', 'cpu', 'cpu', 'cpu'];
  held = false;
  /** 链路断开（由会话层负责重连） */
  onLinkClosed: () => void = () => {};
  private sched: Scheduler;
  private predict: boolean;
  private link: Link | null = null;
  private tail: Batch[] = [];
  private pending: PendingCmd[] = [];
  private issuedAt = new Map<number, number>();
  private seq: number;
  private pendVer = 0;
  // 对时：权威时间 ≈ now - off
  private off = NaN;
  private bound = Infinity;
  private samples: { rtt: number; off: number }[] = [];
  private rtt = 0;
  private jitter = 0;
  private hasRtt = false;
  private pings = new Map<number, number>();
  private pingId = 0;
  private lastPing = -Infinity;
  /** 最近一次收到权威消息的时间 */
  private lastHeard = -Infinity;
  private lateBoost = 0;
  private lastX = -Infinity;
  // 画面
  private cPrevX = new Float64Array(PMAX);
  private cPrevY = new Float64Array(PMAX);
  private pred: Game | null = null;
  private predKey = '';
  private predD = -1;
  private pPrevX = new Float64Array(PMAX);
  private pPrevY = new Float64Array(PMAX);
  private offX = new Float64Array(PMAX);
  private offY = new Float64Array(PMAX);
  private lastFrame = NaN;
  private fxTick = -1;
  private fxOut: GameEvent[] = [];
  private keyOut: GameEvent[] = [];
  private expectSnap = true;
  private st = { late: 0, resyncs: 0, confirmMs: 0, ahead: 0, stalled: false };

  constructor(o: ClientOptions) {
    this.seat = o.seat;
    this.sched = o.sched;
    this.predict = o.predict ?? true;
    // 页面刷新后序号从随机位置开始，不会和上一次的撞上（权威按序号去重）
    this.seq = Math.floor(Math.random() * 2 ** 30);
  }

  get linkKind(): string {
    return this.link?.isOpen() ? this.link.kind : 'none';
  }

  get connected(): boolean {
    return !!this.link?.isOpen();
  }

  /** 接上（或换到）一条通往权威的链路：报告已确认到哪一帧，重发尚未确认的指令 */
  attach(link: Link): void {
    this.link = link;
    link.onMessage = (m) => this.onMessage(m as ToClient);
    link.onClose = () => {
      if (this.link !== link) return;
      this.link = null;
      this.onLinkClosed();
    };
    // 新权威可能换了时间基准
    this.off = NaN;
    this.bound = Infinity;
    this.samples = [];
    this.lastX = -Infinity;
    this.lastPing = -Infinity;
    this.lastHeard = this.sched.now();
    this.pings.clear();
    this.expectSnap = true;
    this.send({ t: 'sync', f: this.confirmed ? this.confirmed.tick : -1, tail: this.tail.slice(-120), pend: this.pending });
  }

  /** 最近收到的帧（换房主时交给新权威） */
  recentBatches(): Batch[] {
    return this.tail.slice();
  }

  /** 主动离开：权威立即交给电脑，不等宽限期 */
  leave(): void {
    this.send({ t: 'bye' });
    this.link?.close();
    this.link = null;
  }

  /** 下令：先记入本机预测，再发给权威 */
  issue(cmd: Command): void {
    if (this.seat < 0 || !this.confirmed) return;
    const now = this.sched.now();
    const c = { ...cmd, col: this.seat } as Command;
    const w = Math.max(this.confirmed.tick, Math.floor(this.displayTime(now)) + 1);
    const s = this.seq++;
    this.pending.push({ s, w, c });
    this.issuedAt.set(s, now);
    this.pendVer++;
    this.send({ t: 'cmd', s, w, c });
  }

  /** 取走自上次以来的事件：fx 来自预测（及时），key 来自已确认状态（可靠） */
  takeEvents(): { fx: GameEvent[]; key: GameEvent[] } {
    const out = { fx: this.fxOut, key: this.keyOut };
    this.fxOut = [];
    this.keyOut = [];
    return out;
  }

  stats(): NetStats {
    return {
      rtt: this.rtt,
      jitter: this.jitter,
      ahead: this.st.ahead,
      late: this.st.late,
      resyncs: this.st.resyncs,
      stalled: this.st.stalled,
      held: this.held,
      confirmMs: this.st.confirmMs,
    };
  }

  /**
   * 由定时器调用（后台标签页里 frame() 不跑）：保持测速，返回权威已经多久没有消息。
   * 经 LA 中转的链路没有断开通知，房主那边的权威没了只能靠这个发现
   */
  heartbeat(now: number): number {
    if (now - this.lastPing >= PING_MS) this.ping(now);
    return now - this.lastHeard;
  }

  /** 每帧调用：返回要画的状态 */
  frame(now: number): NetView | null {
    const g = this.confirmed;
    if (!g) return null;
    if (now - this.lastPing >= PING_MS) this.ping(now);
    const dt = Number.isNaN(this.lastFrame) ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    const k = Math.exp(-dt / SMOOTH_MS);
    for (let i = 0; i < PMAX; i++) {
      this.offX[i] = Math.abs(this.offX[i]) < 0.05 ? 0 : this.offX[i] * k;
      this.offY[i] = Math.abs(this.offY[i]) < 0.05 ? 0 : this.offY[i] * k;
    }
    const F = g.tick;
    const X = this.displayTime(now);
    const base = Math.floor(X);
    const d = base + 1;
    const alpha = X - base;
    this.st.ahead = Math.max(0, d - F);
    if (d <= F) {
      this.pred = null;
      this.predKey = '';
      return { game: g, prevX: this.cPrevX, prevY: this.cPrevY, alpha: d === F ? alpha : 1, offX: this.offX, offY: this.offY };
    }
    const key = `${F}:${d}:${this.pendVer}`;
    if (key !== this.predKey) this.repredict(F, d, key);
    return { game: this.pred!, prevX: this.pPrevX, prevY: this.pPrevY, alpha, offX: this.offX, offY: this.offY };
  }

  // ---- 内部 ----

  private send(m: ToAuthority): void {
    if (this.link?.isOpen()) this.link.send(m);
  }

  private ping(now: number): void {
    this.lastPing = now;
    const i = ++this.pingId;
    this.pings.set(i, now);
    if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
    this.send({ t: 'ping', i });
  }

  /**
   * 画面时间（帧，可带小数）：显示第 floor(X) 帧到第 floor(X)+1 帧之间。
   * 权威时间 a 对应的最新状态是第 floor(a / TICK) 帧，所以"与权威同步"就是 X = a / TICK - 1。
   */
  private displayTime(now: number): number {
    const g = this.confirmed!;
    const F = g.tick;
    const hi = F + MAX_PREDICT - 1 + 0.999;
    const lo = F - 1;
    let X: number;
    if (this.held) {
      X = Math.min(Number.isFinite(this.lastX) ? this.lastX : lo, hi);
    } else {
      const off = Math.min(Number.isNaN(this.off) ? Infinity : this.off, this.bound);
      const a = Number.isFinite(off) ? now - off : F * TICK_MS;
      const oneWay = this.hasRtt ? this.rtt / 2 : 100;
      const margin = Math.max(15, 2 * this.jitter) + this.lateBoost;
      const lead = this.predict ? oneWay + margin : -(oneWay + margin + TICK_MS);
      X = (a + lead) / TICK_MS - 1;
      if (Number.isFinite(this.lastX)) X = Math.max(X, this.lastX);
      X = Math.min(X, hi);
    }
    this.st.stalled = !this.held && X >= hi;
    if (X < lo) X = lo;
    this.lastX = X;
    return X;
  }

  private onMessage(m: ToClient): void {
    const now = this.sched.now();
    this.lastHeard = now;
    switch (m.t) {
      case 'snap':
        this.onSnap(m.k, m.g, m.seen);
        break;
      case 'b':
        this.onBatch({ k: m.k, c: m.c }, now);
        break;
      case 'pong':
        this.onPong(m.i, m.a, now);
        break;
      case 'seats':
        this.seats = m.s;
        break;
      case 'hold':
        this.held = m.on;
        break;
    }
  }

  private onSnap(k: number, text: string, seen: number[]): void {
    let g: Game;
    try {
      g = deserializeGame(text);
    } catch {
      return;
    }
    // 接上链路后的第一条快照是开局 / 重连；之后再来的快照都是指纹不一致后的纠正
    if (!this.expectSnap) this.st.resyncs++;
    this.expectSnap = false;
    this.confirmed = g;
    for (let i = 0; i < PMAX; i++) {
      this.cPrevX[i] = g.people[i].px;
      this.cPrevY[i] = g.people[i].py;
    }
    this.tail = [];
    const done = new Set(seen);
    this.pending = this.pending.filter((p) => !done.has(p.s));
    this.pendVer++;
    this.pred = null;
    this.predKey = '';
    this.fxTick = Math.max(this.fxTick, k - 1);
    this.bound = Math.min(this.bound, this.sched.now() - k * TICK_MS);
  }

  private onBatch(b: Batch, now: number): void {
    const g = this.confirmed;
    if (!g || b.k < g.tick) return;
    if (b.k > g.tick) {
      // 链路是有序可靠的，正常不会缺帧；万一缺了，请权威从这里补
      this.send({ t: 'sync', f: g.tick, tail: [], pend: [] });
      return;
    }
    this.expectSnap = false;
    for (let i = 0; i < PMAX; i++) {
      this.cPrevX[i] = g.people[i].px;
      this.cPrevY[i] = g.people[i].py;
    }
    const events = step(g, b.c.map((st) => st.c));
    for (const e of events) {
      if (KEY_EVENTS.has(e.kind)) this.keyOut.push(e);
      else if (b.k > this.fxTick) this.fxOut.push(e);
    }
    this.fxTick = Math.max(this.fxTick, b.k);
    // 自己的指令被确认
    for (const st of b.c) {
      if (st.s < 0 || st.c.type === 'control' || st.c.col !== this.seat) continue;
      const i = this.pending.findIndex((p) => p.s === st.s);
      if (i < 0) continue;
      const p = this.pending[i];
      this.pending.splice(i, 1);
      this.pendVer++;
      const t0 = this.issuedAt.get(p.s);
      this.issuedAt.delete(p.s);
      if (t0 !== undefined) this.st.confirmMs = now - t0;
      if (b.k > p.w) {
        this.st.late++;
        this.lateBoost = Math.min(150, this.lateBoost + 15 * (b.k - p.w));
      }
    }
    this.lateBoost = Math.max(0, this.lateBoost - 0.2);
    this.tail.push(b);
    if (this.tail.length > TAIL_KEEP) this.tail.splice(0, this.tail.length - TAIL_KEEP);
    if (g.tick % HASH_EVERY === 0) this.send({ t: 'hash', k: g.tick, h: hashGame(g) });
    // 第 k 帧在权威时间 (k+1) × TICK 才关闭，收到时权威时间不会更早
    this.bound = Math.min(this.bound, now - (b.k + 1) * TICK_MS);
  }

  private onPong(i: number, a: number, now: number): void {
    const t0 = this.pings.get(i);
    if (t0 === undefined || typeof a !== 'number') return;
    this.pings.delete(i);
    const rtt = now - t0;
    if (!this.hasRtt) {
      this.rtt = rtt;
      this.hasRtt = true;
    } else {
      this.jitter += (Math.abs(rtt - this.rtt) - this.jitter) * 0.2;
      this.rtt += (rtt - this.rtt) * 0.2;
    }
    this.samples.push({ rtt, off: now - (a + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();
    // 延迟最低的那次测量最准
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.off = best.off;
  }

  private repredict(F: number, d: number, key: string): void {
    const old = this.pred;
    const oldD = this.predD;
    const oldX = new Float64Array(PMAX);
    const oldY = new Float64Array(PMAX);
    const oldUid = new Int32Array(PMAX).fill(-1);
    if (old) {
      for (let i = 0; i < PMAX; i++) {
        const p = old.people[i];
        if (p.stat <= PS.DEAD) continue;
        oldX[i] = p.px;
        oldY[i] = p.py;
        oldUid[i] = p.uid;
      }
    }
    const P = cloneGame(this.confirmed!);
    for (let k = F; k < d; k++) {
      if (k === d - 1) {
        for (let i = 0; i < PMAX; i++) {
          this.pPrevX[i] = P.people[i].px;
          this.pPrevY[i] = P.people[i].py;
        }
      }
      const cmds: Command[] = [];
      for (const p of this.pending) if (Math.max(p.w, F) === k) cmds.push(p.c);
      const events = step(P, cmds);
      if (k > this.fxTick) {
        for (const e of events) if (!KEY_EVENTS.has(e.kind)) this.fxOut.push(e);
        this.fxTick = k;
      }
    }
    // 同一时刻新旧预测的位置差 → 记为偏移，画面上慢慢收回，不会一下跳过去
    if (old && (oldD === d || oldD === d - 1)) {
      for (let i = 0; i < PMAX; i++) {
        const p = P.people[i];
        if (oldUid[i] < 0 || p.stat <= PS.DEAD || p.uid !== oldUid[i]) {
          this.offX[i] = 0;
          this.offY[i] = 0;
          continue;
        }
        const nx = oldD === d ? p.px : this.pPrevX[i];
        const ny = oldD === d ? p.py : this.pPrevY[i];
        const dx = oldX[i] - nx;
        const dy = oldY[i] - ny;
        if (Math.abs(dx) < 48 && Math.abs(dy) < 24) {
          this.offX[i] += dx;
          this.offY[i] += dy;
        }
      }
    }
    this.pred = P;
    this.predD = d;
    this.predKey = key;
  }
}
