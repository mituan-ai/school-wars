// 浏览器端联机（docs/05）：连 LA、房间状态、成员两两直连测速；开局后按模式组装通往权威的链路，
// 处理断线重连、直连失败改中转、换房主。
import { cloneGame } from '../core/clone.ts';
import { createGame } from '../core/mapgen.ts';
import { t } from '../i18n/index.ts';
import { Authority } from './authority.ts';
import { NetClient } from './client.ts';
import { BaseLink, linkPair, realScheduler } from './link.ts';
import { BUILD_ID, PROTOCOL, type FromServer, type NetMode, type PeerStat, type RoomInfo, type StartInfo, type ToServer } from './protocol.ts';
import { Peer } from './rtc.ts';
import type { RuleSet } from '../core/types.ts';

const STAT_MS = 2000;
const PING_MS = 2000;
/** 权威这么久没有任何消息（连 pong 都没有），就重新接一次 */
const SILENT_MS = 5000;
/** 发给 LA 的 ping 这么久没回：网络多半已经断了，不等 TCP 超时，直接重连 */
const SERVER_SILENT_MS = 8000;
/** 直连失败后隔多久重试（每次翻倍，最多 60 秒）；由 id 较小、负责发 offer 的一方发起 */
const PEER_RETRY_MS = 15_000;

/** 调试：?netdelay=110 给本页发出的所有联机消息加 110 ms 延迟（两页互相加就是往返 220 ms） */
function debugDelay(): number {
  if (typeof location === 'undefined') return 0;
  const v = Number(new URLSearchParams(location.search).get('netdelay') ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 2000) : 0;
}

function storageGet(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function storageSet(store: 'local' | 'session', key: string, v: string): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, v);
  } catch {
    // 隐私模式等情况下存不了，刷新后会被当成新成员
  }
}

/** 这个标签页刷新前在某个房间里（刷新后直接回联机大厅，由服务器恢复房间和对局） */
export function wasInRoom(): boolean {
  return !!storageGet('session', 'sw.net.room');
}

export type OnlineStatus = 'connecting' | 'online' | 'offline' | 'version';

/** 与 LA 的连接、房间、直连网（每个页面一个） */
export class Online {
  status: OnlineStatus = 'connecting';
  /** 身份令牌按标签页保存：刷新能回到原座位，同一浏览器开两个标签页也是两个人 */
  id = storageGet('session', 'sw.net.id') ?? '';
  name = storageGet('local', 'sw.net.name') ?? '';
  room: RoomInfo | null = null;
  srvRtt = 0;
  readonly peers = new Map<string, Peer>();
  game: NetSession | null = null;
  lastError = '';
  /** 房间、连接状态有变化（界面刷新） */
  onChange: () => void = () => {};
  /** 一局开始，NetClient 收到第一份状态后调用 */
  onGameReady: (s: NetSession) => void = () => {};
  readonly delay = debugDelay();
  private ws: WebSocket | null = null;
  private backoff = 500;
  private timers: number[] = [];
  private pings = new Map<number, number>();
  private pingId = 0;
  /** 自上次收到 pong 以来第一条 ping 的发出时间（0：没有在等的） */
  private waitingSince = 0;
  private closed = false;
  /** 上一次房间状态里在线的其他成员 */
  private onlineIds = new Set<string>();
  /** 每个成员的直连已经重试了几次 */
  private retries = new Map<string, number>();

  constructor() {
    this.connect();
    this.timers.push(window.setInterval(() => this.ping(), PING_MS));
    this.timers.push(window.setInterval(() => {
      this.reportStats();
      this.retryPeers();
    }, STAT_MS));
  }

  get me(): string {
    return this.id;
  }

  send(m: ToServer): void {
    this.sendText(JSON.stringify(m));
  }

  sendText(text: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (this.delay > 0) window.setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(text), this.delay);
    else ws.send(text);
  }

  setName(name: string): void {
    this.name = name.trim().slice(0, 16);
    storageSet('local', 'sw.net.name', this.name);
  }

  create(mode: NetMode, ruleset: RuleSet): void {
    this.lastError = '';
    this.send({ t: 'create', mode, ruleset });
  }

  join(code: string): void {
    this.lastError = '';
    this.send({ t: 'join', code: code.trim().toUpperCase() });
  }

  leaveRoom(): void {
    this.game?.dispose();
    this.game = null;
    this.send({ t: 'leave' });
  }

  /** 关掉联机（回到标题画面） */
  shutdown(): void {
    this.closed = true;
    storageSet('session', 'sw.net.room', '');
    this.game?.dispose();
    this.game = null;
    for (const t of this.timers) clearInterval(t);
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.ws?.close();
  }

  /** 房间里的对局正在进行、自己不在其中（中途离开、刚加入）时，重新进入 */
  rejoinGame(): void {
    const r = this.room;
    if (r?.status === 'playing') this.send({ t: 'join', code: r.code });
  }

  memberName(id: string): string {
    return this.room?.members.find((m) => m.id === id)?.name ?? '';
  }

  // ---- 连接 ----

  private connect(): void {
    if (this.closed) return;
    this.status = this.status === 'version' ? 'version' : 'connecting';
    const override = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('net') : null;
    const url = override ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.waitingSince = 0;
      const g = this.game?.hosting ? this.game.info.epoch : 0;
      ws.send(JSON.stringify({ t: 'hello', v: BUILD_ID, p: PROTOCOL, id: this.id, name: this.name || t('net.defaultName'), g } satisfies ToServer));
    };
    ws.onmessage = (e) => {
      let m: FromServer;
      try {
        m = JSON.parse(String(e.data)) as FromServer;
      } catch {
        return;
      }
      if (this.delay > 0) window.setTimeout(() => this.onMessage(m), this.delay);
      else this.onMessage(m);
    };
    ws.onclose = () => this.lost(ws);
  }

  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    if (this.status !== 'version') this.status = 'offline';
    this.game?.onServerLost();
    this.onChange();
    this.retry();
  }

  private retry(): void {
    if (this.closed || this.status === 'version') return;
    window.setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(5000, this.backoff * 2);
  }

  private ping(): void {
    // 后台标签页的定时器可能一分钟才跑一次，所以看的是"发出去的 ping 多久没回"，而不是"多久没收到 pong"
    const ws = this.ws;
    const now = performance.now();
    if (ws?.readyState === WebSocket.OPEN && this.waitingSince && now - this.waitingSince > SERVER_SILENT_MS) {
      this.lost(ws);
      return;
    }
    if (!this.waitingSince) this.waitingSince = now;
    const i = ++this.pingId;
    this.pings.set(i, performance.now());
    if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
    this.send({ t: 'ping', i });
  }

  private reportStats(): void {
    if (!this.room) return;
    const peers: Record<string, PeerStat> = {};
    for (const [id, p] of this.peers) peers[id] = { via: p.via, rtt: p.rtt };
    this.send({ t: 'stat', srv: this.srvRtt, peers });
  }

  private onMessage(m: FromServer): void {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        storageSet('session', 'sw.net.id', m.id);
        // 自己刚连回 LA：别人那边会把和我的直连重建，这边连不上的也跟着重建
        this.onlineIds.clear();
        this.status = 'online';
        this.ping();
        break;
      case 'error':
        if (m.code === 'version') {
          this.status = 'version';
          this.ws?.close();
        }
        this.lastError = m.code;
        break;
      case 'pong': {
        this.waitingSince = 0;
        const t0 = this.pings.get(m.i);
        if (t0 === undefined) return;
        this.pings.delete(m.i);
        const rtt = performance.now() - t0;
        const first = !this.srvRtt;
        this.srvRtt = this.srvRtt ? this.srvRtt + (rtt - this.srvRtt) * 0.3 : rtt;
        // 第一次测到就上报，大厅里不必干等一个上报周期
        if (first) this.reportStats();
        return;
      }
      case 'room':
        this.room = m.room;
        storageSet('session', 'sw.net.room', m.room ? m.room.code : '');
        this.syncPeers();
        if (!m.room && this.game) {
          this.game.dispose();
          this.game = null;
        }
        this.game?.onRoom();
        break;
      case 'start':
        if (this.game && this.game.info.epoch <= m.info.epoch && this.game.info.seed === m.info.seed) this.game.onServerBack(m.info);
        else {
          this.game?.dispose();
          this.game = new NetSession(this, m.info);
        }
        break;
      case 'host':
        this.game?.onHost(m.host, m.epoch);
        break;
      case 'signal': {
        let p = this.peers.get(m.from);
        // 对方新建了连接（重新上线、重试）而这边的已经用过或已断开：换一个新的来应答
        if (p && p.canDirect && isOffer(m.d) && !p.acceptsOffer()) p = this.addPeer(m.from);
        if (p) void p.onSignal(m.d);
        return;
      }
      case 'relay':
        this.game?.onRelay(m.from, m.d);
        return;
      case 'g':
        this.game?.onServerGame(m.d);
        return;
    }
    this.onChange();
  }

  /** 和房间里每个在线成员保持一条直连（或确认连不上） */
  private syncPeers(): void {
    const members = this.room?.members ?? [];
    const want = new Set(members.filter((m) => m.online && m.id !== this.id).map((m) => m.id));
    for (const [id, p] of this.peers) {
      // LA 说对方离线、直连却还通着：多半只是对方到 LA 的连接闪断，对局数据照样走直连，不拆
      if (want.has(id) || (p.via === 'direct' && members.some((m) => m.id === id))) continue;
      p.close();
      this.peers.delete(id);
    }
    for (const id of want) {
      const p = this.peers.get(id);
      // 对方刚重新上线：之前没连上的直连重来一次（对方那边也是新建的）
      if (p && (p.via !== 'relay' || this.onlineIds.has(id))) continue;
      this.addPeer(id);
    }
    this.onlineIds = want;
  }

  /** 新建（或换掉）和某个成员的直连 */
  private addPeer(id: string): Peer {
    this.peers.get(id)?.close();
    const p = new Peer(id, this.id < id, (d) => this.send({ t: 'signal', to: id, d }), this.delay);
    p.onState = () => {
      if (this.peers.get(id) !== p) return;
      if (p.via === 'direct') this.retries.delete(id);
      this.game?.onPeerState(id);
      this.onChange();
    };
    p.onGame = (d) => {
      if (this.peers.get(id) === p) this.game?.onPeerGame(id, d);
    };
    this.peers.set(id, p);
    return p;
  }

  /** 直连失败的成员隔一段时间重试：网络抖动、对方掉线重连之后，不至于一直走中转 */
  private retryPeers(): void {
    const now = performance.now();
    for (const [id, p] of this.peers) {
      if (p.via !== 'relay' || !p.canDirect || this.id >= id || !this.onlineIds.has(id)) continue;
      const n = this.retries.get(id) ?? 0;
      if (now - p.failedAt < Math.min(60_000, PEER_RETRY_MS * 2 ** n)) continue;
      this.retries.set(id, n + 1);
      this.addPeer(id);
    }
  }
}

function isOffer(d: unknown): boolean {
  return typeof d === 'object' && d !== null && (d as { sdp?: { type?: string } }).sdp?.type === 'offer';
}

/** 一局联机对局 */
export class NetSession {
  info: StartInfo;
  readonly seat: number;
  readonly client: NetClient;
  readonly names: string[];
  private online: Online;
  private authority: Authority | null = null;
  private stopTicker: (() => void) | null = null;
  /** 房主一侧：成员 → 经中转的链路（直连链路由 Peer 自己持有） */
  private relayIn = new Map<string, BaseLink>();
  private link: BaseLink | null = null;
  private ready = false;
  private disposed = false;
  private reconnectTimer = 0;
  private watchdog = 0;

  constructor(online: Online, info: StartInfo) {
    this.online = online;
    this.info = info;
    this.seat = info.seats.indexOf(online.me);
    this.names = info.seats.map((id) => (id ? online.memberName(id) : ''));
    this.client = new NetClient({ seat: this.seat, sched: realScheduler, predict: new URLSearchParams(location.search).get('predict') !== '0' });
    this.client.onLinkClosed = () => this.scheduleReconnect();
    this.setup();
    this.waitReady();
    this.watchdog = window.setInterval(() => this.watch(), 1000);
  }

  /** 本页正在运行权威 */
  get hosting(): boolean {
    return !!this.authority;
  }

  get isHost(): boolean {
    return this.info.mode === 'host' && this.info.host === this.online.me;
  }

  /** 给对局界面的连接状态一行字 */
  status(): { text: string; warn: boolean } {
    const c = this.client;
    const s = c.stats();
    if (s.held) return { text: t('net.st.held'), warn: true };
    if (!c.connected) return { text: t('net.st.reconnect'), warn: true };
    if (s.stalled) return { text: t('net.st.stalled'), warn: true };
    const ms = Math.round(s.rtt);
    if (this.info.mode === 'server') return { text: t('net.st.server', { ms }), warn: ms > 400 };
    if (this.isHost) return { text: t('net.st.host'), warn: false };
    const kind = c.linkKind === 'direct' ? t('net.via.direct') : t('net.via.relay');
    return { text: t('net.st.peer', { via: kind, ms }), warn: ms > 400 };
  }

  /** 离开对局：权威立即交给电脑；自己是房主时通知 LA 换人。仍留在房间里 */
  leave(): void {
    this.client.leave();
    this.online.send({ t: 'quitgame' });
    this.dispose();
    if (this.online.game === this) this.online.game = null;
    this.online.onChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    this.stopHost();
    this.link?.close();
    this.link = null;
  }

  // ---- 由 Online 转来的事件 ----

  onRoom(): void {
    // 成员掉线：经中转接进来的链路随之断开，权威开始计宽限期
    const room = this.online.room;
    for (const [id, l] of this.relayIn) {
      if (!room?.members.some((m) => m.id === id && m.online)) {
        l.ended();
        this.relayIn.delete(id);
      }
    }
  }

  onServerLost(): void {
    if (this.info.mode === 'server') {
      this.link?.ended();
      this.link = null;
    }
    for (const l of this.relayIn.values()) l.ended();
    this.relayIn.clear();
    if (this.link?.kind === 'relay') {
      this.link.ended();
      this.link = null;
    }
  }

  /** LA 重连成功后重新发来开局信息 */
  onServerBack(info: StartInfo): void {
    const hostChanged = info.host !== this.info.host;
    this.info = info;
    if (hostChanged) this.onHost(info.host, info.epoch);
    else if (!this.client.connected) this.connectToAuthority();
  }

  onServerGame(d: unknown): void {
    if (this.link?.kind === 'server') this.link.receive(d);
  }

  /** 中转消息：房主收到的是成员发给权威的；成员收到的是权威发来的 */
  onRelay(from: string, d: unknown): void {
    if (typeof d !== 'object' || d === null || (d as { t?: string }).t !== 'g') return;
    const inner = (d as { d: unknown }).d;
    if (this.authority) {
      let l = this.relayIn.get(from);
      if (!l || !l.isOpen()) {
        l = new BaseLink('relay', (text) => this.online.sendText(`{"t":"relay","to":${JSON.stringify(from)},"d":{"t":"g","d":${text}}}`));
        this.relayIn.set(from, l);
        this.authority.attach(l, this.info.seats.indexOf(from));
      }
      l.receive(inner);
    } else if (this.link?.kind === 'relay' && from === this.info.host) {
      this.link.receive(inner);
    }
  }

  /** 房主收到成员经直连发来的第一条对局消息：把这条直连接到权威上 */
  onPeerGame(from: string, d: unknown): void {
    if (!this.authority) return;
    const link = this.online.peers.get(from)?.gameLink();
    if (!link) return;
    this.authority.attach(link, this.info.seats.indexOf(from));
    link.receive(d);
  }

  /** 和房主的直连刚连上：从中转换到直连 */
  onPeerState(id: string): void {
    if (this.info.mode !== 'host' || this.authority || id !== this.info.host) return;
    const p = this.online.peers.get(id);
    if (p?.via === 'direct' && this.link?.kind !== 'direct') this.connectToAuthority();
    if (p?.via === 'relay' && this.link?.kind === 'direct') this.connectToAuthority();
  }

  /** LA 选出了新房主 */
  onHost(host: string, epoch: number): void {
    this.info = { ...this.info, host, epoch };
    if (this.info.mode !== 'host') return;
    if (host === this.online.me) {
      if (!this.authority) this.becomeHost(false);
      return;
    }
    // 自己曾经是房主但被换掉（例如掉线太久）：退位，作为普通成员连新房主
    this.stopHost();
    this.connectToAuthority();
  }

  // ---- 内部 ----

  private setup(): void {
    if (this.isHost) this.becomeHost(true);
    else this.connectToAuthority();
  }

  private waitReady(): void {
    const tick = () => {
      if (this.disposed) return;
      if (this.client.confirmed && !this.ready) {
        this.ready = true;
        this.online.onGameReady(this);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  }

  /** 接上通往权威的链路：服务器模式走 LA；玩家主机模式优先直连房主，不行就经 LA 中转 */
  private connectToAuthority(): void {
    if (this.disposed) return;
    const old = this.link;
    let link: BaseLink;
    if (this.info.mode === 'server') {
      link = new BaseLink('server', (text) => this.online.sendText(`{"t":"g","d":${text}}`));
    } else {
      const host = this.info.host;
      const direct = this.online.peers.get(host)?.gameLink();
      link = direct ?? new BaseLink('relay', (text) => this.online.sendText(`{"t":"relay","to":${JSON.stringify(host)},"d":{"t":"g","d":${text}}}`));
    }
    this.link = link;
    if (old && old !== link) old.close();
    this.client.attach(link);
  }

  private watch(): void {
    if (this.disposed || this.authority || !this.client.connected) return;
    const now = performance.now();
    if (this.client.heartbeat(now) > SILENT_MS || this.client.stale(now)) this.connectToAuthority();
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (this.disposed || this.client.connected) return;
      if (this.authority) {
        // 房主自己的本机链路不会断；走到这里说明权威已经退位
        return;
      }
      if (this.info.mode === 'server' && this.online.status !== 'online') return;
      this.connectToAuthority();
    }, 300);
  }

  /** 当房主：开局时从种子建立对局；换房主时用自己的已确认状态和帧记录接着走 */
  private becomeHost(fresh: boolean): void {
    const info = this.info;
    const humanSeats = info.seats.map((s) => !!s);
    let game;
    let log;
    let waitFor: number[];
    if (fresh || !this.client.confirmed) {
      game = createGame({ seed: info.seed, userCol: 4, rules: { ruleset: info.ruleset, ai: info.ai.slice() } });
      log = undefined;
      waitFor = info.seats.flatMap((s, c) => (s ? [c] : []));
    } else {
      game = cloneGame(this.client.confirmed);
      log = this.client.recentBatches();
      const room = this.online.room;
      waitFor = info.seats.flatMap((s, c) => (s && room?.members.some((m) => m.id === s && m.online) ? [c] : []));
    }
    const auth = new Authority({
      game, log, sched: realScheduler, dropAi: info.dropAi, humanSeats, waitFor, waitMs: fresh ? 10_000 : 8000,
      onEnded: () => this.online.send({ t: 'ended' }),
    });
    this.authority = auth;
    this.stopTicker = startTicker(() => auth.pump());
    const [a, b] = linkPair(realScheduler, 'local');
    auth.attach(a, this.seat);
    const old = this.link;
    this.link = b;
    old?.close();
    this.client.attach(b);
  }

  private stopHost(): void {
    this.stopTicker?.();
    this.stopTicker = null;
    this.authority?.shutdown();
    this.authority = null;
    for (const l of this.relayIn.values()) l.ended();
    this.relayIn.clear();
  }
}

/**
 * 权威的时钟。后台标签页里主线程的定时器会被降到每秒一次，Worker 里的不会，
 * 所以由 Worker 每 10 ms 发一条消息来驱动；Worker 不可用时退回 setInterval。
 */
function startTicker(fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),10)'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => fn();
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(fn, 10);
    return () => clearInterval(id);
  }
}

