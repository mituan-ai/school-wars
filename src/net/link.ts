// 消息管道：一条有序、可靠的双向链路。WebSocket、WebRTC DataChannel、经服务器中转、本机回环都包装成它，
// 权威和客户端不关心底下是哪一种。

export interface Link {
  /** direct：WebRTC 直连；relay：经 LA 中转；server：连 LA 上的权威；local：房主自己 */
  readonly kind: string;
  send(msg: unknown): void;
  close(): void;
  isOpen(): boolean;
  onMessage: (msg: any) => void;
  onClose: () => void;
}

/** 时间来源与定时器；测试里换成虚拟时钟 */
export interface Scheduler {
  now(): number;
  after(ms: number, fn: () => void): void;
}

export const realScheduler: Scheduler = {
  now: () => performance.now(),
  after: (ms, fn) => {
    if (ms <= 0) queueMicrotask(fn);
    else setTimeout(fn, ms);
  },
};

/** 链路的公共部分：收到的消息、关闭事件都转给使用者 */
export class BaseLink implements Link {
  onMessage: (msg: any) => void = () => {};
  onClose: () => void = () => {};
  protected open = true;
  readonly kind: string;
  private sender: (text: string) => void;
  private closer: () => void;

  constructor(kind: string, sender: (text: string) => void, closer: () => void = () => {}) {
    this.kind = kind;
    this.sender = sender;
    this.closer = closer;
  }

  send(msg: unknown): void {
    if (this.open) this.sender(JSON.stringify(msg));
  }

  /** 底层收到一条消息 */
  deliver(text: string): void {
    if (!this.open) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    this.onMessage(msg);
  }

  /** 底层收到一条已经解析好的消息（WebSocket 外层信封里取出来的） */
  receive(msg: unknown): void {
    if (this.open) this.onMessage(msg);
  }

  /** 底层断开 */
  ended(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.closer();
  }

  isOpen(): boolean {
    return this.open;
  }
}

/**
 * 一对互通的链路（房主自己连自己的权威、测试用的模拟网络）。
 * oneWay / jitter：单程延迟与抖动（ms）；保持顺序，抖动只会推迟、不会乱序。
 */
export function linkPair(sched: Scheduler, kind = 'local', oneWay = 0, jitter = 0, rand: () => number = Math.random): [BaseLink, BaseLink] {
  let lastAB = 0;
  let lastBA = 0;
  let a!: BaseLink;
  let b!: BaseLink;
  /** 安排一次投递；断开事件也排在已发出的消息之后 */
  const ship = (ab: boolean, fn: () => void, jit: boolean): void => {
    const now = sched.now();
    let at = now + oneWay + (jit && jitter > 0 ? rand() * jitter : 0);
    if (ab) at = lastAB = Math.max(lastAB, at);
    else at = lastBA = Math.max(lastBA, at);
    sched.after(at - now, fn);
  };
  a = new BaseLink(kind, (text) => ship(true, () => b.deliver(text), true), () => ship(true, () => b.ended(), false));
  b = new BaseLink(kind, (text) => ship(false, () => a.deliver(text), true), () => ship(false, () => a.ended(), false));
  return [a, b];
}

// ---- 大消息分片：WebRTC 各浏览器之间只保证 64 KB 以内的单条消息，快照约 50 KB，统一切成 16 KB ----

const CHUNK = 16_000;
let chunkSeq = 0;

export function toChunks(text: string): string[] {
  if (text.length <= CHUNK) return [text];
  const id = (chunkSeq = (chunkSeq + 1) % 1e9);
  const n = Math.ceil(text.length / CHUNK);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`~${id}|${n}|${i}|${text.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  return out;
}

export class Reassembler {
  private parts = new Map<number, string[]>();

  /** 返回完整消息；分片还没收齐时返回 null */
  push(text: string): string | null {
    if (text[0] !== '~') return text;
    const m = /^~(\d+)\|(\d+)\|(\d+)\|/.exec(text);
    if (!m) return null;
    const id = Number(m[1]);
    const n = Number(m[2]);
    const i = Number(m[3]);
    if (n > 64 || i >= n) return null;
    let arr = this.parts.get(id);
    if (!arr) {
      arr = new Array<string>(n);
      this.parts.set(id, arr);
      // 只留最近几条，防止残缺的分片越积越多
      if (this.parts.size > 8) this.parts.delete(this.parts.keys().next().value!);
    }
    arr[i] = text.slice(m[0].length);
    for (let j = 0; j < n; j++) if (arr[j] === undefined) return null;
    this.parts.delete(id);
    return arr.join('');
  }
}
