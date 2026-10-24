// 联机同步（docs/05 §7）：模拟网络下的一致性、响应、掉线托管、重连、换房主、纠正与防护。
import { describe, expect, it } from 'vitest';
import { cloneGame } from '../src/core/clone.ts';
import { PMAX, PS } from '../src/core/constants.ts';
import { hashGame } from '../src/core/save.ts';
import { step } from '../src/core/sim.ts';
import type { Game } from '../src/core/types.ts';
import { Authority } from '../src/net/authority.ts';
import { NetClient } from '../src/net/client.ts';
import { Reassembler, linkPair, toChunks } from '../src/net/link.ts';
import { sanitizeCommand, TICK_MS } from '../src/net/protocol.ts';
import { SimClock, bot, connect, mpGame, settle } from './netsim.ts';

const HUMANS = [true, true, true, false];
const AI = ['human', 'human', 'human', 'normal'] as const;

function setup(oneWay = 110, jitter = 30, seed = 11) {
  const clock = new SimClock();
  const auth = new Authority({ game: mpGame(seed, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [0, 1, 2] });
  const clients = [0, 1, 2].map((seat) => new NetClient({ seat, sched: clock }));
  const links = clients.map((c, i) => connect(clock, auth, c, oneWay, jitter, 100 + i));
  return { clock, auth, clients, links };
}

/** 每 1/30 秒：推进权威、各客户端画一帧、机器人下令 */
function loop(clock: SimClock, auth: Authority, clients: NetClient[], bots: (() => void)[]) {
  return () => {
    auth.pump();
    for (const c of clients) c.frame(clock.now());
    for (const b of bots) b();
  };
}

function mine(g: Game, col: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < PMAX; i++) if (g.people[i].stat > PS.DEAD && g.people[i].col === col) out.push(i);
  return out;
}

describe('核心：联机用的状态', () => {
  it('快速克隆与原状态指纹一致，且不共用任何对象', () => {
    const g = mpGame(3, [...AI]);
    for (let i = 0; i < 18 * 60; i++) step(g);
    const c = cloneGame(g);
    expect(hashGame(c)).toBe(hashGame(g));
    const seen = new Set<object>();
    const walk = (v: unknown) => {
      if (typeof v !== 'object' || v === null) return;
      seen.add(v);
      for (const x of Object.values(v)) walk(x);
    };
    walk({ ...g, events: null });
    const shared: string[] = [];
    const check = (v: unknown, path: string) => {
      if (typeof v !== 'object' || v === null) return;
      if (seen.has(v)) shared.push(path);
      for (const [k, x] of Object.entries(v)) check(x, `${path}.${k}`);
    };
    check({ ...c, events: null }, 'clone');
    expect(shared).toEqual([]);
  });

  it("'human' 座位不由电脑指挥；托管指令按帧切换", () => {
    const g = mpGame(5, ['human', 'normal', 'normal', 'normal']);
    for (let i = 0; i < 18 * 90; i++) step(g);
    // 人类座位没人下令，学生只会在本部附近坐着 / 迎战，不会被派去占地块
    expect(mine(g, 0).every((pn) => g.people[pn].task === 0)).toBe(true);
    step(g, [{ type: 'control', col: 0, ai: 'hard' }]);
    expect(g.rules.ai[0]).toBe('hard');
  });

  it('指令校验：阵营由权威填写，越界、伪造的指令一律丢弃', () => {
    expect(sanitizeCommand({ type: 'order', units: [1, 2], bx: 3, by: 4, target: -1, col: 2 }, 0)).toEqual({ type: 'order', col: 0, units: [1, 2], bx: 3, by: 4, target: -1 });
    expect(sanitizeCommand({ type: 'order', units: [99], bx: 3, by: 4, target: -1 }, 0)).toBeNull();
    expect(sanitizeCommand({ type: 'order', units: [1], bx: 16, by: 4, target: -1 }, 0)).toBeNull();
    expect(sanitizeCommand({ type: 'control', col: 1, ai: 'hard' }, 0)).toBeNull();
    expect(sanitizeCommand({ type: 'rally', bx: -1, by: -1 }, 3)).toEqual({ type: 'rally', col: 3, bx: -1, by: -1 });
    expect(sanitizeCommand('x', 0)).toBeNull();
  });

  it('大消息分片后能原样拼回', () => {
    const text = 'x'.repeat(50_000) + 'end';
    const r = new Reassembler();
    const parts = toChunks(text);
    expect(parts.length).toBe(4);
    let out: string | null = null;
    for (const p of parts) out = r.push(p) ?? out;
    expect(out).toBe(text);
  });
});

describe('联机同步：服务器模式（往返 220 ms，抖动 ±30 ms）', () => {
  it('四名玩家随机下令 10 分钟，所有人与权威的状态始终一致', () => {
    const clock = new SimClock();
    const auth = new Authority({
      game: mpGame(11, ['human', 'human', 'human', 'human']), sched: clock, dropAi: 'normal',
      humanSeats: [true, true, true, true], waitFor: [0, 1, 2, 3],
    });
    const clients = [0, 1, 2, 3].map((seat) => new NetClient({ seat, sched: clock }));
    clients.forEach((c, i) => connect(clock, auth, c, 110, 30, 100 + i));
    const bots = clients.map((c, i) => bot(c, 7 + i));
    clock.run(10 * 60_000, 1000 / 30, loop(clock, auth, clients, bots));
    expect(auth.desyncs).toBe(0);
    for (const c of clients) expect(c.stats().resyncs).toBe(0);
    const s = settle(clock, auth, clients);
    expect(s.ticks.every((k) => k === auth.open)).toBe(true);
    expect(s.clients).toEqual([s.auth, s.auth, s.auth, s.auth]);
    expect(auth.open).toBeGreaterThan(10 * 60 * 18 - 40);
  }, 120_000);

  it('自己的指令在本机下一帧就生效；确认延迟约为往返延迟', () => {
    const { clock, auth, clients } = setup();
    const c = clients[0];
    clock.run(10_000, 1000 / 60, loop(clock, auth, clients, []));
    const units = mine(c.confirmed!, 0).slice(0, 3);
    c.issue({ type: 'order', units, bx: 8, by: 8, target: -1 });
    // 和单机一样在下一个 tick 执行（≤ 56 ms）：之后的预测画面里，这几个人已经在执行指令
    clock.run(clock.t + TICK_MS + 1000 / 60, 1000 / 60, loop(clock, auth, clients, []));
    const view = c.frame(clock.now())!;
    for (const pn of units) expect(view.game.people[pn].ordered).toBe(true);
    // 已确认状态要等权威回来
    expect(units.some((pn) => !c.confirmed!.people[pn].ordered)).toBe(true);
    const lat: number[] = [];
    for (let i = 0; i < 20; i++) {
      clock.run(clock.t + 1500, 1000 / 60, loop(clock, auth, clients, []));
      c.issue({ type: 'order', units, bx: i % 16, by: 8, target: -1 });
      clock.run(clock.t + 1000, 1000 / 60, loop(clock, auth, clients, []));
      lat.push(c.stats().confirmMs);
    }
    lat.sort((a, b) => a - b);
    const median = lat[10];
    expect(median).toBeLessThanOrEqual(220 + 30 + 2 * TICK_MS);
    expect(c.stats().late).toBeLessThanOrEqual(3);
  });

  it('关掉预测作对照：自己的指令要等到确认才在画面上出现', () => {
    const clock = new SimClock();
    const auth = new Authority({ game: mpGame(11, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS });
    const c = new NetClient({ seat: 0, sched: clock, predict: false });
    connect(clock, auth, c, 110, 0, 1);
    clock.run(5_000, 1000 / 60, loop(clock, auth, [c], []));
    const units = mine(c.confirmed!, 0).slice(0, 2);
    c.issue({ type: 'order', units, bx: 8, by: 8, target: -1 });
    clock.run(clock.t + 100, 1000 / 60, loop(clock, auth, [c], []));
    expect(c.frame(clock.now())!.game.people[units[0]].ordered).toBe(false);
  });

  it('掉线 15 秒后电脑接管，重连后交还；全程一致', () => {
    const { clock, auth, clients, links } = setup();
    const bots = clients.map((c, i) => bot(c, 20 + i));
    clock.run(30_000, 1000 / 30, loop(clock, auth, clients, bots));
    links[1].close();
    clock.run(clock.t + 10_000, 1000 / 30, loop(clock, auth, clients, bots));
    expect(auth.seatStates()[1]).toBe('away');
    expect(auth.game.rules.ai[1]).toBe('human');
    clock.run(clock.t + 6_000, 1000 / 30, loop(clock, auth, clients, bots));
    expect(auth.seatStates()[1]).toBe('ai');
    expect(clients[0].confirmed!.rules.ai[1]).toBe('normal');
    expect(clients[0].seats[1]).toBe('ai');
    // 断线期间这个客户端没收到任何帧；重连后补齐
    connect(clock, auth, clients[1], 110, 30, 9);
    clock.run(clock.t + 3_000, 1000 / 30, loop(clock, auth, clients, bots));
    expect(auth.game.rules.ai[1]).toBe('human');
    expect(clients[2].seats[1]).toBe('online');
    clock.run(clock.t + 30_000, 1000 / 30, loop(clock, auth, clients, bots));
    const s = settle(clock, auth, clients);
    expect(s.clients).toEqual([s.auth, s.auth, s.auth]);
    expect(auth.desyncs).toBe(0);
  });

  it('刷新页面（客户端从零开始）靠快照回到原座位', () => {
    const { clock, auth, clients, links } = setup();
    const bots = clients.map((c, i) => bot(c, 30 + i));
    clock.run(40_000, 1000 / 30, loop(clock, auth, clients, bots));
    links[2].close();
    const fresh = new NetClient({ seat: 2, sched: clock });
    connect(clock, auth, fresh, 110, 30, 12);
    const all = [clients[0], clients[1], fresh];
    const bots2 = all.map((c, i) => bot(c, 40 + i));
    clock.run(clock.t + 20_000, 1000 / 30, loop(clock, auth, all, bots2));
    const s = settle(clock, auth, all);
    expect(s.clients).toEqual([s.auth, s.auth, s.auth]);
    expect(fresh.stats().resyncs).toBe(0);
    expect(fresh.seats).toEqual(['online', 'online', 'online', 'cpu']);
  });

  it('权威不声不响地消失（经中转、链路没有断开通知）时，客户端几秒内能察觉', () => {
    const { clock, auth, clients } = setup();
    clock.run(5_000, 1000 / 30, loop(clock, auth, clients, []));
    expect(clients[0].heartbeat(clock.t)).toBeLessThan(500);
    // 权威那一页没了：消息照常送达，但没人处理、没人回复
    for (const c of (auth as unknown as { conns: Set<{ link: { onMessage: unknown } }> }).conns) c.link.onMessage = () => {};
    clock.run(clock.t + 6_000, 100, () => clients[0].heartbeat(clock.t));
    expect(clients[0].connected).toBe(true);
    expect(clients[0].heartbeat(clock.t)).toBeGreaterThan(5_000);
  });

  it('sync 在权威建好之前就到了、被丢掉：客户端几秒内重发，正常进入对局', () => {
    const clock = new SimClock();
    const auth = new Authority({ game: mpGame(5, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [0] });
    const [a, b] = linkPair(clock, 'direct', 1);
    const c = new NetClient({ seat: 0, sched: clock });
    c.attach(b); // 对面还没有权威：这条 sync 没人处理
    clock.run(100, 10, () => {});
    auth.attach(a, 0); // 权威建好了，之后的 ping 都有 pong
    const watch = () => {
      auth.pump();
      if (c.heartbeat(clock.t) > 5000 || c.stale(clock.t)) c.attach(b);
    };
    clock.run(2500, 10, watch);
    expect(c.confirmed).toBeNull();
    expect(c.heartbeat(clock.t)).toBeLessThan(2000);
    clock.run(5000, 10, watch);
    expect(c.confirmed).not.toBeNull();
    expect(c.confirmed!.tick).toBeGreaterThan(0);
    expect(c.stats().resyncs).toBe(0);
  });

  it('开局时权威在等人，客户端重发 sync 换来的第二份快照不算纠正', () => {
    const clock = new SimClock();
    const auth = new Authority({ game: mpGame(6, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [0, 1] });
    const [a0, b0] = linkPair(clock, 'relay', 200);
    const [a1, b1] = linkPair(clock, 'direct', 5);
    auth.attach(a0, 0);
    auth.attach(a1, 1);
    const c0 = new NetClient({ seat: 0, sched: clock });
    const c1 = new NetClient({ seat: 1, sched: clock });
    c0.attach(b0);
    const watch = () => {
      auth.pump();
      if (c0.stale(clock.t)) c0.attach(b0);
    };
    // 座位 1 还没来，权威不发状态；约 3 秒时 c0 重发 sync（单程 200 ms）。
    // 座位 1 恰好在这条 sync 路上时到齐：权威恢复时发一份快照，随后到达的 sync 又换来一份
    clock.run(3050, 10, watch);
    c1.attach(b1);
    clock.run(10_000, 10, watch);
    expect(c0.confirmed).not.toBeNull();
    expect(c0.stats().resyncs).toBe(0);
  });

  it('主动离开的座位立即由电脑接管', () => {
    const { clock, auth, clients } = setup();
    clock.run(5_000, 1000 / 30, loop(clock, auth, clients, []));
    clients[0].leave();
    clock.run(clock.t + 1_000, 1000 / 30, loop(clock, auth, clients.slice(1), []));
    expect(auth.game.rules.ai[0]).toBe('normal');
  });

  it('状态被改坏时，5 秒内发现并用快照纠正', () => {
    const { clock, auth, clients } = setup();
    const bots = clients.map((c, i) => bot(c, 50 + i));
    clock.run(20_000, 1000 / 30, loop(clock, auth, clients, bots));
    const g = clients[1].confirmed!;
    const pn = mine(g, 1)[0];
    g.people[pn].hp = 1;
    clock.run(clock.t + 6_000, 1000 / 30, loop(clock, auth, clients, bots));
    expect(auth.desyncs).toBe(1);
    expect(clients[1].stats().resyncs).toBe(1);
    const s = settle(clock, auth, clients);
    expect(s.clients).toEqual([s.auth, s.auth, s.auth]);
  });

  it('刷屏的指令被限速；不能指挥别人的学生', () => {
    const { clock, auth, clients } = setup(20, 0);
    clock.run(3_000, 1000 / 30, loop(clock, auth, clients, []));
    const c = clients[0];
    const theirs = mine(c.confirmed!, 1);
    c.issue({ type: 'order', units: theirs, bx: 0, by: 15, target: -1 });
    for (let i = 0; i < 100; i++) c.issue({ type: 'order', units: mine(c.confirmed!, 0), bx: i % 16, by: 3, target: -1 });
    let accepted = 0;
    const before = auth.open;
    clock.run(clock.t + 2_000, 1000 / 30, loop(clock, auth, clients, []));
    expect(theirs.every((pn) => !auth.game.people[pn].ordered || auth.game.people[pn].col !== 1)).toBe(true);
    // 统计确认了多少条（权威每秒最多收 20 条）
    accepted = 101 - (c as unknown as { pending: unknown[] }).pending.length;
    expect(accepted).toBeLessThanOrEqual(22);
    expect(auth.open).toBeGreaterThan(before);
  });

  it('观战者能跟上对局但不能下令', () => {
    const { clock, auth, clients } = setup();
    const spec = new NetClient({ seat: -1, sched: clock });
    connect(clock, auth, spec, 110, 30, 77);
    clock.run(10_000, 1000 / 30, loop(clock, auth, [...clients, spec], []));
    spec.issue({ type: 'order', units: [0], bx: 1, by: 1, target: -1 });
    const s = settle(clock, auth, [...clients, spec]);
    expect(s.clients[3]).toBe(s.auth);
  });
});

describe('联机同步：玩家主机模式', () => {
  it('房主退出：新房主用自己的状态接替，其他人补齐后继续，状态一致', () => {
    const clock = new SimClock();
    // 房主（座位 0）本机连接，其余两人到房主单程 30 ms
    const a1 = new Authority({ game: mpGame(21, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [0, 1, 2] });
    const host = new NetClient({ seat: 0, sched: clock });
    const p1 = new NetClient({ seat: 1, sched: clock });
    const p2 = new NetClient({ seat: 2, sched: clock });
    connect(clock, a1, host, 0, 0, 1);
    const l1 = connect(clock, a1, p1, 30, 15, 2);
    const l2 = connect(clock, a1, p2, 30, 15, 3);
    const bots = [host, p1, p2].map((c, i) => bot(c, 60 + i));
    clock.run(60_000, 1000 / 30, loop(clock, a1, [host, p1, p2], bots));
    // 房主的页面关了：它的链路全断，权威随之消失
    a1.hold();
    l1.close();
    l2.close();
    // p1 被选为新房主：用自己的已确认状态和帧记录启动权威，等 p2 连上再走
    const a2 = new Authority({
      game: cloneGame(p1.confirmed!),
      log: (p1 as unknown as { tail: [] }).tail,
      sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [1, 2], waitMs: 10_000,
    });
    clock.run(clock.t + 1_500, 1000 / 30, () => {});
    connect(clock, a2, p1, 0, 0, 4);
    connect(clock, a2, p2, 30, 15, 5);
    const bots2 = [p1, p2].map((c, i) => bot(c, 70 + i));
    clock.run(clock.t + 30_000, 1000 / 30, loop(clock, a2, [p1, p2], bots2));
    expect(a2.isHeld).toBe(false);
    // 原房主的学校 15 秒后由电脑接管
    expect(a2.game.rules.ai[0]).toBe('normal');
    const s = settle(clock, a2, [p1, p2]);
    expect(s.clients).toEqual([s.auth, s.auth]);
    expect(a2.desyncs).toBe(0);
  });

  it('新房主落后时，从其他人手里补上它缺的帧', () => {
    const clock = new SimClock();
    const a1 = new Authority({ game: mpGame(22, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS });
    const p1 = new NetClient({ seat: 1, sched: clock });
    const p2 = new NetClient({ seat: 2, sched: clock });
    // p1 到旧房主的链路很慢，p2 很快：旧房主消失时 p2 手里的帧更多
    const l1 = connect(clock, a1, p1, 300, 0, 2);
    const l2 = connect(clock, a1, p2, 10, 0, 3);
    clock.run(20_000, 1000 / 30, loop(clock, a1, [p1, p2], [bot(p1, 1), bot(p2, 2)]));
    a1.hold();
    l1.close();
    l2.close();
    clock.run(clock.t + 50, 10, () => {});
    const behind = p2.confirmed!.tick - p1.confirmed!.tick;
    expect(behind).toBeGreaterThan(2);
    const a2 = new Authority({
      game: cloneGame(p1.confirmed!), log: [], sched: clock, dropAi: 'normal', humanSeats: HUMANS, waitFor: [1, 2],
    });
    connect(clock, a2, p1, 0, 0, 4);
    connect(clock, a2, p2, 30, 0, 5);
    clock.run(clock.t + 5_000, 1000 / 30, loop(clock, a2, [p1, p2], []));
    const s = settle(clock, a2, [p1, p2]);
    expect(s.clients).toEqual([s.auth, s.auth]);
  });

  it('房主本机链路（零延迟）与远端玩家在同一时间线上', () => {
    const clock = new SimClock();
    const auth = new Authority({ game: mpGame(23, [...AI]), sched: clock, dropAi: 'normal', humanSeats: HUMANS });
    const [a, b] = linkPair(clock);
    const host = new NetClient({ seat: 0, sched: clock });
    auth.attach(a, 0);
    host.attach(b);
    const p = new NetClient({ seat: 1, sched: clock });
    connect(clock, auth, p, 40, 10, 8);
    clock.run(20_000, 1000 / 30, loop(clock, auth, [host, p], [bot(host, 3), bot(p, 4)]));
    const s = settle(clock, auth, [host, p]);
    expect(s.clients).toEqual([s.auth, s.auth]);
  });
});
