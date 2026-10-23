// LA 服务器的房间逻辑：内存 socket + 虚拟时钟，不起真正的网络。
import { describe, expect, it } from 'vitest';
import { hashGame } from '../src/core/save.ts';
import { Authority } from '../src/net/authority.ts';
import { NetClient } from '../src/net/client.ts';
import { BaseLink } from '../src/net/link.ts';
import { BUILD_ID, PROTOCOL, type FromServer, type ToServer } from '../src/net/protocol.ts';
import { Hub, type Sock } from '../server/hub.ts';
import { SimClock, bot } from './netsim.ts';

/** 一位成员：一条到 Hub 的内存 socket，单程延迟 oneWay */
class Member {
  got: FromServer[] = [];
  id = '';
  sock: Sock | null = null;
  client: NetClient | null = null;
  link: BaseLink | null = null;
  private clock: SimClock;
  private hub: Hub;
  private oneWay: number;

  constructor(clock: SimClock, hub: Hub, oneWay: number, id: string, name: string) {
    this.clock = clock;
    this.hub = hub;
    this.oneWay = oneWay;
    this.id = id;
    this.connect(name);
  }

  connect(name = 'P', g = 0): void {
    let open = true;
    const sock: Sock = {
      send: (text) => this.clock.after(this.oneWay, () => open && this.sock === sock && this.recv(JSON.parse(text) as FromServer)),
      close: () => {
        open = false;
        this.clock.after(this.oneWay, () => sock.onClose());
      },
      onMessage: () => {},
      onClose: () => {},
    };
    this.sock = sock;
    this.hub.connect(sock);
    this.send({ t: 'hello', v: BUILD_ID, p: PROTOCOL, id: this.id, name, g });
  }

  /** 网络断开（不是主动离开） */
  drop(): void {
    const s = this.sock!;
    this.sock = null;
    this.link?.ended();
    this.link = null;
    s.close();
  }

  send(m: ToServer): void {
    const s = this.sock;
    if (!s) return;
    const text = JSON.stringify(m);
    this.clock.after(this.oneWay, () => s.onMessage(text));
  }

  last<T extends FromServer['t']>(t: T): Extract<FromServer, { t: T }> | undefined {
    for (let i = this.got.length - 1; i >= 0; i--) if (this.got[i].t === t) return this.got[i] as Extract<FromServer, { t: T }>;
    return undefined;
  }

  /** 服务器模式：经 'g' 信封连上服务器里的权威 */
  play(seat: number): NetClient {
    if (!this.client) this.client = new NetClient({ seat, sched: this.clock });
    this.link = new BaseLink('server', (text) => this.send({ t: 'g', d: JSON.parse(text) }));
    this.client.attach(this.link);
    return this.client;
  }

  private recv(m: FromServer): void {
    this.got.push(m);
    if (m.t === 'g') this.link?.receive(m.d);
  }
}

function setup() {
  const clock = new SimClock();
  const hub = new Hub(clock);
  const run = (ms: number, tick: () => void = () => {}) =>
    clock.run(clock.t + ms, 10, () => {
      hub.pump();
      tick();
    });
  return { clock, hub, run };
}

function authOf(hub: Hub): Authority {
  const room = [...(hub as unknown as { rooms: Map<string, { auth: Authority | null }> }).rooms.values()][0];
  return room.auth!;
}

describe('LA 服务器', () => {
  it('构建号不一致的客户端被拒绝', () => {
    const { clock, hub, run } = setup();
    const errs: string[] = [];
    let closed = false;
    const sock: Sock = {
      send: (t) => errs.push(t),
      close: () => (closed = true),
      onMessage: () => {},
      onClose: () => {},
    };
    hub.connect(sock);
    sock.onMessage(JSON.stringify({ t: 'hello', v: 'old-build', p: PROTOCOL, id: 'aaaaaaaaaa', name: 'x' }));
    run(100);
    expect(errs.map((e) => JSON.parse(e).code)).toEqual(['version']);
    expect(closed).toBe(true);
    void clock;
  });

  it('建房、加入、换座位、只有房主能改设置、开局', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 30, 'member-aaaa', 'Ann');
    const b = new Member(clock, hub, 30, 'member-bbbb', 'Bob');
    run(200);
    a.send({ t: 'create', mode: 'server', ruleset: 'remake' });
    run(200);
    const code = a.last('room')!.room!.code;
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    b.send({ t: 'join', code: code.toLowerCase() });
    run(200);
    let room = b.last('room')!.room!;
    expect(room.members.map((m) => [m.name, m.seat])).toEqual([['Ann', 0], ['Bob', 1]]);
    b.send({ t: 'seat', seat: 0 }); // 有人坐着，无效
    b.send({ t: 'seat', seat: 3 });
    b.send({ t: 'config', ai: ['easy', 'easy', 'easy', 'easy'] }); // 不是房主，无效
    a.send({ t: 'config', ai: ['normal', 'normal', 'hard', 'normal'], dropAi: 'hard' });
    a.send({ t: 'config', ai: ['classic', 'classic', 'classic', 'classic'] }); // 新规则不能用原版电脑
    run(200);
    room = b.last('room')!.room!;
    expect(room.members.map((m) => m.seat)).toEqual([0, 3]);
    expect(room.ai).toEqual(['normal', 'normal', 'hard', 'normal']);
    expect(room.dropAi).toBe('hard');
    b.send({ t: 'start' }); // 不是房主
    run(200);
    expect(b.last('start')).toBeUndefined();
    a.send({ t: 'start' });
    run(200);
    const info = b.last('start')!.info;
    expect(info.seats).toEqual(['member-aaaa', '', '', 'member-bbbb']);
    expect(info.ai).toEqual(['human', 'normal', 'hard', 'human']);
    expect(info.mode).toBe('server');
    // 对局中加入的人只能观战
    const c = new Member(clock, hub, 30, 'member-cccc', 'Cat');
    run(100);
    c.send({ t: 'join', code });
    run(200);
    expect(c.last('room')!.room!.members.find((m) => m.id === c.id)!.seat).toBe(-1);
    expect(c.last('start')!.info.epoch).toBe(info.epoch);
  });

  it('服务器模式：两名玩家 + 两台电脑，往返 220 ms，一分钟后各方一致；掉线重连后追上', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 110, 'member-aaaa', 'Ann');
    const b = new Member(clock, hub, 110, 'member-bbbb', 'Bob');
    run(500);
    a.send({ t: 'create', mode: 'server', ruleset: 'remake' });
    run(500);
    b.send({ t: 'join', code: a.last('room')!.room!.code });
    run(500);
    a.send({ t: 'start' });
    run(500);
    const ca = a.play(0);
    const cb = b.play(1);
    const bots = [bot(ca, 1), bot(cb, 2)];
    run(60_000, () => bots.forEach((f) => f()));
    const auth = authOf(hub);
    expect(auth.game.tick).toBeGreaterThan(18 * 55);
    expect(ca.confirmed!.tick).toBeGreaterThan(auth.game.tick - 18);

    // B 断网 5 秒（未到电脑接管时间），换一条新连接回来
    b.drop();
    run(5000, () => bots[0]());
    expect(auth.seatStates()[1]).toBe('away');
    b.connect('Bob');
    run(500);
    expect(b.last('start')).toBeDefined();
    b.play(1);
    run(20_000, () => bots.forEach((f) => f()));
    expect(auth.seatStates()[1]).toBe('online');
    auth.hold();
    run(2000);
    const h = hashGame(auth.game);
    expect(hashGame(ca.confirmed!)).toBe(h);
    expect(hashGame(cb.confirmed!)).toBe(h);
    expect(auth.desyncs).toBe(0);
  });

  it('服务器模式：掉线超过 15 秒由电脑接管', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 50, 'member-aaaa', 'Ann');
    const b = new Member(clock, hub, 50, 'member-bbbb', 'Bob');
    run(300);
    a.send({ t: 'create', mode: 'server', ruleset: 'remake' });
    run(300);
    b.send({ t: 'join', code: a.last('room')!.room!.code });
    run(300);
    a.send({ t: 'start' });
    run(300);
    a.play(0);
    b.play(1);
    run(3000);
    b.drop();
    run(16_000);
    expect(authOf(hub).seatStates()[1]).toBe('ai');
    expect(a.client!.seats[1]).toBe('ai');
  });

  it('玩家主机模式：房主掉线 4 秒后选直连最多的人接替；房主离开对局立即换人', () => {
    const { clock, hub, run } = setup();
    const ms = ['aaaa', 'bbbb', 'cccc'].map((s, i) => new Member(clock, hub, 30, `member-${s}`, `P${i}`));
    const [a, b, c] = ms;
    run(200);
    a.send({ t: 'create', mode: 'host', ruleset: 'remake' });
    run(200);
    const code = a.last('room')!.room!.code;
    b.send({ t: 'join', code });
    c.send({ t: 'join', code });
    run(200);
    // C 与另外两人都直连，B 只连上了房主
    b.send({ t: 'stat', srv: 220, peers: { [a.id]: { via: 'direct', rtt: 40 }, [c.id]: { via: 'relay', rtt: 0 } } });
    c.send({ t: 'stat', srv: 230, peers: { [a.id]: { via: 'direct', rtt: 50 }, [b.id]: { via: 'direct', rtt: 60 } } });
    a.send({ t: 'start' });
    run(1500);
    expect(b.last('start')!.info.host).toBe(a.id);
    const epoch = b.last('start')!.info.epoch;

    a.drop();
    run(3000);
    expect(b.last('host')).toBeUndefined();
    run(1500);
    expect(b.last('host')).toEqual({ t: 'host', host: c.id, epoch: epoch + 1 });
    expect(c.last('host')!.host).toBe(c.id);

    // 原房主回来时拿到的是新房主
    a.connect('P0');
    run(300);
    expect(a.last('start')!.info.host).toBe(c.id);

    // 新房主主动离开对局：不等 4 秒
    c.send({ t: 'quitgame' });
    run(200);
    expect(b.last('host')!.epoch).toBe(epoch + 2);
    expect([a.id, b.id]).toContain(b.last('host')!.host);
  });

  it('玩家主机模式：房主网络闪断后回来继续当房主；刷新过页面（权威没了）立即换人', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 30, 'member-aaaa', 'A');
    const b = new Member(clock, hub, 30, 'member-bbbb', 'B');
    run(200);
    a.send({ t: 'create', mode: 'host', ruleset: 'remake' });
    run(200);
    b.send({ t: 'join', code: a.last('room')!.room!.code });
    run(200);
    a.send({ t: 'start' });
    run(200);
    const epoch = a.last('start')!.info.epoch;
    a.drop();
    run(1000);
    a.connect('A', epoch);
    run(5000);
    expect(b.last('host')).toBeUndefined();
    a.drop();
    run(1000);
    a.connect('A', 0);
    run(300);
    expect(b.last('host')).toEqual({ t: 'host', host: b.id, epoch: epoch + 1 });
    expect(a.last('start')!.info.host).toBe(b.id);
  });

  it('信令与中转只在同房间成员之间转发', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 20, 'member-aaaa', 'A');
    const b = new Member(clock, hub, 20, 'member-bbbb', 'B');
    const x = new Member(clock, hub, 20, 'member-xxxx', 'X');
    run(100);
    a.send({ t: 'create', mode: 'host', ruleset: 'remake' });
    run(100);
    b.send({ t: 'join', code: a.last('room')!.room!.code });
    run(100);
    a.send({ t: 'relay', to: b.id, d: { t: 'b', k: 5, c: [] } });
    a.send({ t: 'signal', to: b.id, d: { sdp: 'x' } });
    x.send({ t: 'relay', to: b.id, d: 'spam' });
    a.send({ t: 'relay', to: x.id, d: 'leak' });
    run(100);
    expect(b.got.filter((m) => m.t === 'relay' || m.t === 'signal')).toEqual([
      { t: 'relay', from: a.id, d: { t: 'b', k: 5, c: [] } },
      { t: 'signal', from: a.id, d: { sdp: 'x' } },
    ]);
    expect(x.got.some((m) => m.t === 'relay')).toBe(false);
  });

  it('大厅里掉线 30 秒移出房间，空房间被销毁', () => {
    const { clock, hub, run } = setup();
    const a = new Member(clock, hub, 20, 'member-aaaa', 'A');
    const b = new Member(clock, hub, 20, 'member-bbbb', 'B');
    run(100);
    a.send({ t: 'create', mode: 'server', ruleset: 'classic' });
    run(100);
    b.send({ t: 'join', code: a.last('room')!.room!.code });
    run(100);
    a.drop();
    run(31_000);
    const room = b.last('room')!.room!;
    expect(room.members.map((m) => m.id)).toEqual([b.id]);
    expect(room.owner).toBe(b.id);
    b.send({ t: 'leave' });
    run(100);
    expect(hub.info().rooms).toBe(0);
  });
});
