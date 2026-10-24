// LA 服务器（docs/05）：房间、信令、中转；服务器模式下还在这里跑权威。
// 只依赖一个最小的 socket 接口，测试里可以直接用内存 socket。
import { createGame } from '../src/core/mapgen.ts';
import type { AiLevel, RuleSet } from '../src/core/types.ts';
import { Authority } from '../src/net/authority.ts';
import { BaseLink, type Scheduler } from '../src/net/link.ts';
import {
  BUILD_ID, PROTOCOL, ROOM_MAX, isAiLevel,
  type FromServer, type MemberInfo, type NetMode, type PeerStat, type RoomInfo, type StartInfo, type ToServer,
} from '../src/net/protocol.ts';

export interface Sock {
  send(text: string): void;
  close(): void;
  onMessage: (text: string) => void;
  onClose: () => void;
}

interface Member {
  id: string;
  name: string;
  sock: Sock | null;
  room: Room | null;
  srv: number;
  peers: Record<string, PeerStat>;
  offlineSince: number;
}

interface Room {
  code: string;
  mode: NetMode;
  owner: string;
  host: string;
  ruleset: RuleSet;
  /** 战争迷雾（仅校园战争规则） */
  fog: boolean;
  ai: AiLevel[];
  dropAi: AiLevel;
  status: 'lobby' | 'playing';
  epoch: number;
  members: string[];
  seats: Map<string, number>;
  start: StartInfo | null;
  /** 服务器模式的权威，以及每个成员通往它的链路 */
  auth: Authority | null;
  links: Map<string, BaseLink>;
  hostAwaySince: number;
  idleSince: number;
  dirty: boolean;
  lastSent: number;
}

/** 玩家主机模式：房主断开多久后换人 */
const HOST_SWITCH_MS = 4000;
/** 大厅里掉线多久移出房间；对局中保留更久，方便重连 */
const LOBBY_DROP_MS = 30_000;
const GAME_DROP_MS = 10 * 60_000;
/** 只有成员测速信息变了时，房间状态最多每秒广播一次 */
const ROOM_THROTTLE_MS = 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Hub {
  private members = new Map<string, Member>();
  private rooms = new Map<string, Room>();
  private sched: Scheduler;

  constructor(sched: Scheduler) {
    this.sched = sched;
  }

  connect(sock: Sock): void {
    let me: Member | null = null;
    sock.onMessage = (text) => {
      let m: ToServer;
      try {
        m = JSON.parse(text) as ToServer;
      } catch {
        return;
      }
      if (typeof m !== 'object' || m === null) return;
      if (!me) {
        if (m.t !== 'hello') return;
        me = this.hello(sock, m);
        return;
      }
      if (me.sock !== sock) return;
      this.onMessage(me, m);
    };
    sock.onClose = () => {
      if (!me || me.sock !== sock) return;
      me.sock = null;
      me.offlineSince = this.sched.now();
      const room = me.room;
      if (!room) return;
      room.links.get(me.id)?.ended();
      room.links.delete(me.id);
      if (room.status === 'playing' && room.mode === 'host' && room.host === me.id) room.hostAwaySince = this.sched.now();
      room.dirty = true;
    };
  }

  /** 定时调用：推进服务器模式的权威、换房主、清理 */
  pump(): void {
    const now = this.sched.now();
    for (const room of this.rooms.values()) {
      room.auth?.pump();
      if (room.status === 'playing' && room.mode === 'host' && room.hostAwaySince > 0 && now - room.hostAwaySince >= HOST_SWITCH_MS) {
        this.switchHost(room);
      }
      for (const id of [...room.members]) {
        const m = this.members.get(id)!;
        if (m.sock) continue;
        if (now - m.offlineSince >= (room.status === 'lobby' ? LOBBY_DROP_MS : GAME_DROP_MS)) this.leaveRoom(m);
      }
      if (!this.rooms.has(room.code)) continue;
      const online = room.members.some((id) => this.members.get(id)!.sock);
      if (online) room.idleSince = now;
      else if (now - room.idleSince >= GAME_DROP_MS) this.destroy(room);
      if (room.dirty && now - room.lastSent >= ROOM_THROTTLE_MS) this.sendRoom(room);
    }
    for (const m of [...this.members.values()]) {
      if (!m.sock && !m.room && now - m.offlineSince > LOBBY_DROP_MS) this.members.delete(m.id);
    }
  }

  /** 统计用 */
  info(): { rooms: number; members: number; games: number } {
    let games = 0;
    for (const r of this.rooms.values()) if (r.status === 'playing') games++;
    return { rooms: this.rooms.size, members: this.members.size, games };
  }

  // ---- 消息 ----

  private hello(sock: Sock, m: Extract<ToServer, { t: 'hello' }>): Member | null {
    if (m.v !== BUILD_ID || m.p !== PROTOCOL) {
      sock.send(JSON.stringify({ t: 'error', code: 'version' } satisfies FromServer));
      sock.close();
      return null;
    }
    const id = typeof m.id === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(m.id) ? m.id : randomId();
    const name = cleanName(m.name);
    let me = this.members.get(id);
    if (me) {
      if (me.sock && me.sock !== sock) me.sock.close();
      me.sock = sock;
      me.name = name;
    } else {
      me = { id, name, sock, room: null, srv: 0, peers: {}, offlineSince: 0 };
      this.members.set(id, me);
    }
    this.send(me, { t: 'welcome', id });
    const room = me.room;
    if (room) {
      if (room.mode === 'host' && room.host === me.id && room.status === 'playing') {
        // 网络闪断：权威还在这一页里跑，继续当房主。刷新过页面：权威没了，马上换人（没人可换时只能从头开）
        if (m.g === room.epoch) room.hostAwaySince = 0;
        else this.switchHost(room);
      }
      this.sendRoom(room);
      if (room.status === 'playing' && room.start) this.send(me, { t: 'start', info: room.start });
    } else {
      this.send(me, { t: 'room', room: null });
    }
    return me;
  }

  private onMessage(me: Member, m: ToServer): void {
    const room = me.room;
    switch (m.t) {
      case 'ping':
        this.send(me, { t: 'pong', i: m.i });
        break;
      case 'create': {
        this.leaveRoom(me);
        const mode: NetMode = m.mode === 'host' ? 'host' : 'server';
        const ruleset: RuleSet = m.ruleset === 'classic' ? 'classic' : 'remake';
        const r: Room = {
          code: this.newCode(), mode, owner: me.id, host: me.id, ruleset, fog: true,
          ai: defaultAi(ruleset), dropAi: ruleset === 'classic' ? 'classic' : 'normal',
          status: 'lobby', epoch: 0, members: [me.id], seats: new Map([[me.id, 0]]),
          start: null, auth: null, links: new Map(), hostAwaySince: 0, idleSince: this.sched.now(), dirty: true, lastSent: 0,
        };
        this.rooms.set(r.code, r);
        me.room = r;
        this.sendRoom(r);
        break;
      }
      case 'join': {
        const r = typeof m.code === 'string' ? this.rooms.get(m.code.toUpperCase()) : undefined;
        if (!r) return this.send(me, { t: 'error', code: 'noroom' });
        if (me.room === r) {
          // 已在房间里：中途离开对局后重新进入
          this.sendRoom(r);
          if (r.status === 'playing' && r.start) this.send(me, { t: 'start', info: r.start });
          return;
        }
        if (r.members.length >= ROOM_MAX) return this.send(me, { t: 'error', code: 'full' });
        this.leaveRoom(me);
        r.members.push(me.id);
        me.room = r;
        // 对局进行中加入的人只能观战
        r.seats.set(me.id, r.status === 'lobby' ? this.freeSeat(r) : -1);
        this.sendRoom(r);
        if (r.status === 'playing' && r.start) this.send(me, { t: 'start', info: r.start });
        break;
      }
      case 'leave':
        this.leaveRoom(me);
        this.send(me, { t: 'room', room: null });
        break;
      case 'seat': {
        if (!room || room.status !== 'lobby') return;
        const seat = m.seat;
        if (!Number.isInteger(seat) || seat < -1 || seat > 3) return;
        if (seat >= 0 && [...room.seats.entries()].some(([id, s]) => s === seat && id !== me.id)) return;
        room.seats.set(me.id, seat);
        this.sendRoom(room);
        break;
      }
      case 'config': {
        if (!room || room.owner !== me.id || room.status !== 'lobby') return;
        if (m.mode === 'server' || m.mode === 'host') room.mode = m.mode;
        if (m.ruleset === 'classic' || m.ruleset === 'remake') {
          room.ruleset = m.ruleset;
          room.ai = defaultAi(m.ruleset);
          room.dropAi = m.ruleset === 'classic' ? 'classic' : 'normal';
        }
        if (typeof m.fog === 'boolean') room.fog = m.fog;
        if (Array.isArray(m.ai) && m.ai.length === 4 && m.ai.every((a) => okAi(room.ruleset, a))) room.ai = m.ai.slice();
        if (okAi(room.ruleset, m.dropAi)) room.dropAi = m.dropAi!;
        if (typeof m.host === 'string' && room.members.includes(m.host)) room.host = m.host;
        this.sendRoom(room);
        break;
      }
      case 'start':
        if (room && room.owner === me.id && room.status === 'lobby') this.startGame(room);
        break;
      case 'ended':
        // 玩家主机模式由房主报告终局；服务器模式由服务器自己的权威发现
        if (room && room.status === 'playing' && room.mode === 'host' && room.host === me.id) this.endGame(room);
        break;
      case 'quitgame':
        // 玩家主机模式的房主离开对局：马上换人，不必等掉线判定
        if (room && room.status === 'playing' && room.mode === 'host' && room.host === me.id) this.switchHost(room);
        break;
      case 'stat':
        if (typeof m.srv === 'number') me.srv = Math.round(m.srv);
        if (typeof m.peers === 'object' && m.peers !== null) me.peers = cleanPeers(m.peers);
        if (room) room.dirty = true;
        break;
      case 'signal':
      case 'relay': {
        if (!room || typeof m.to !== 'string' || !room.members.includes(m.to)) return;
        const to = this.members.get(m.to);
        if (to?.sock) to.sock.send(JSON.stringify({ t: m.t, from: me.id, d: m.d }));
        break;
      }
      case 'g':
        this.toAuthority(me, m.d);
        break;
    }
  }

  // ---- 对局 ----

  private startGame(room: Room): void {
    const seats = ['', '', '', ''];
    for (const [id, s] of room.seats) if (s >= 0) seats[s] = id;
    if (seats.every((s) => !s)) return;
    const ai: AiLevel[] = seats.map((id, c) => (id ? 'human' : room.ai[c]));
    room.epoch++;
    room.status = 'playing';
    room.hostAwaySince = 0;
    const info: StartInfo = {
      epoch: room.epoch, mode: room.mode, host: room.host, seed: (Math.random() * 2 ** 32) >>> 0,
      ruleset: room.ruleset, fog: room.ruleset === 'remake' && room.fog, ai, dropAi: room.dropAi, seats,
    };
    room.start = info;
    if (room.mode === 'server') {
      const game = createGame({ seed: info.seed, userCol: 4, rules: { ruleset: info.ruleset, ai: info.ai.slice(), fog: !!info.fog } });
      room.auth = new Authority({
        game, sched: this.sched, dropAi: info.dropAi,
        humanSeats: seats.map((s) => !!s),
        waitFor: seats.flatMap((s, c) => (s ? [c] : [])),
        waitMs: 10_000,
        onEnded: () => this.endGame(room),
      });
    }
    for (const id of room.members) {
      const m = this.members.get(id)!;
      this.send(m, { t: 'start', info });
    }
    this.sendRoom(room);
  }

  /** 终局：房间回到大厅；服务器模式的权威再跑一会儿，让大家看完结局 */
  private endGame(room: Room): void {
    if (room.status !== 'playing') return;
    room.status = 'lobby';
    const auth = room.auth;
    if (auth) {
      this.sched.after(30_000, () => {
        if (room.auth === auth) this.stopAuthority(room);
      });
    }
    this.sendRoom(room);
  }

  private stopAuthority(room: Room): void {
    room.auth?.shutdown();
    room.auth = null;
    room.links.clear();
  }

  private toAuthority(me: Member, d: unknown): void {
    const room = me.room;
    if (!room || !room.auth || !room.start) return;
    let link = room.links.get(me.id);
    if (!link || !link.isOpen()) {
      const id = me.id;
      link = new BaseLink('server', (text) => {
        const m = this.members.get(id);
        m?.sock?.send(`{"t":"g","d":${text}}`);
      });
      room.links.set(me.id, link);
      room.auth.attach(link, room.start.seats.indexOf(me.id));
    }
    link.deliver(JSON.stringify(d));
  }

  /** 玩家主机模式：房主断开太久，选一位在线成员接替。直连最多的优先，再按座位号 */
  private switchHost(room: Room): void {
    room.hostAwaySince = 0;
    const online = room.members.map((id) => this.members.get(id)!).filter((m) => m.sock && m.id !== room.host);
    if (online.length === 0) return;
    const seatOf = (m: Member) => {
      const s = room.start?.seats.indexOf(m.id) ?? -1;
      return s < 0 ? 9 : s;
    };
    const direct = (m: Member) => Object.values(m.peers).filter((p) => p.via === 'direct').length;
    online.sort((a, b) => direct(b) - direct(a) || seatOf(a) - seatOf(b));
    room.host = online[0].id;
    room.epoch++;
    if (room.start) room.start = { ...room.start, host: room.host, epoch: room.epoch };
    for (const id of room.members) this.send(this.members.get(id)!, { t: 'host', host: room.host, epoch: room.epoch });
    this.sendRoom(room);
  }

  // ---- 房间 ----

  private leaveRoom(me: Member): void {
    const room = me.room;
    if (!room) return;
    me.room = null;
    room.members = room.members.filter((id) => id !== me.id);
    room.seats.delete(me.id);
    room.links.get(me.id)?.ended();
    room.links.delete(me.id);
    if (room.members.length === 0) {
      this.destroy(room);
      return;
    }
    if (room.owner === me.id) room.owner = room.members[0];
    if (room.host === me.id) {
      if (room.status === 'playing' && room.mode === 'host') this.switchHost(room);
      else room.host = room.owner;
    }
    this.sendRoom(room);
  }

  private destroy(room: Room): void {
    this.stopAuthority(room);
    this.rooms.delete(room.code);
    for (const id of room.members) {
      const m = this.members.get(id);
      if (m && m.room === room) m.room = null;
    }
  }

  private freeSeat(room: Room): number {
    const used = new Set(room.seats.values());
    for (let s = 0; s < 4; s++) if (!used.has(s)) return s;
    return -1;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private roomInfo(room: Room): RoomInfo {
    const members: MemberInfo[] = room.members.map((id) => {
      const m = this.members.get(id)!;
      return { id, name: m.name, seat: room.seats.get(id) ?? -1, online: !!m.sock, srv: m.srv, peers: m.peers };
    });
    return {
      code: room.code, mode: room.mode, owner: room.owner, host: room.host, ruleset: room.ruleset, fog: room.fog,
      ai: room.ai.slice(), dropAi: room.dropAi, status: room.status, epoch: room.epoch, members,
    };
  }

  private sendRoom(room: Room): void {
    room.dirty = false;
    room.lastSent = this.sched.now();
    const info = this.roomInfo(room);
    for (const id of room.members) this.send(this.members.get(id)!, { t: 'room', room: info });
  }

  private send(m: Member, msg: FromServer): void {
    m.sock?.send(JSON.stringify(msg));
  }
}

function defaultAi(ruleset: RuleSet): AiLevel[] {
  const lv: AiLevel = ruleset === 'classic' ? 'classic' : 'normal';
  return [lv, lv, lv, lv];
}

/** 经典规则只用原版电脑；新规则用三档指挥官 */
function okAi(ruleset: RuleSet, a: unknown): boolean {
  if (!isAiLevel(a)) return false;
  return ruleset === 'classic' ? a === 'classic' : a !== 'classic';
}

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) : '';
  return s || 'Player';
}

function cleanPeers(v: object): Record<string, PeerStat> {
  const out: Record<string, PeerStat> = {};
  for (const [id, p] of Object.entries(v).slice(0, ROOM_MAX)) {
    if (typeof p !== 'object' || p === null) continue;
    const via = (p as PeerStat).via;
    const rtt = (p as PeerStat).rtt;
    if ((via === 'direct' || via === 'relay' || via === 'trying') && typeof rtt === 'number') out[id.slice(0, 40)] = { via, rtt: Math.round(rtt) };
  }
  return out;
}

function randomId(): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)].toLowerCase();
  return s;
}
