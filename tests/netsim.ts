// 联机测试用的虚拟时钟与模拟网络：时间只在 advance() 里前进，延迟、抖动可设，结果可复现。
import { createGame } from '../src/core/mapgen.ts';
import { createRng, random } from '../src/core/rng.ts';
import { hashGame } from '../src/core/save.ts';
import type { AiLevel, Game } from '../src/core/types.ts';
import { Authority } from '../src/net/authority.ts';
import { NetClient } from '../src/net/client.ts';
import { linkPair, type BaseLink, type Scheduler } from '../src/net/link.ts';
import { PS, PMAX } from '../src/core/constants.ts';

export class SimClock implements Scheduler {
  t = 0;
  private q: { at: number; n: number; fn: () => void }[] = [];
  private n = 0;

  now(): number {
    return this.t;
  }

  after(ms: number, fn: () => void): void {
    this.q.push({ at: this.t + Math.max(0, ms), n: this.n++, fn });
  }

  /** 把时间推进到 until，按顺序执行到期的回调；每过 step 毫秒调用一次 tick */
  run(until: number, step: number, tick: () => void): void {
    while (this.t < until) {
      const next = Math.min(until, this.t + step);
      this.flush(next);
      this.t = next;
      tick();
    }
  }

  flush(until: number): void {
    for (;;) {
      let bi = -1;
      for (let i = 0; i < this.q.length; i++) {
        const e = this.q[i];
        if (e.at > until) continue;
        if (bi < 0 || e.at < this.q[bi].at || (e.at === this.q[bi].at && e.n < this.q[bi].n)) bi = i;
      }
      if (bi < 0) return;
      const [e] = this.q.splice(bi, 1);
      this.t = Math.max(this.t, e.at);
      e.fn();
    }
  }
}

export interface Seat {
  client: NetClient;
  link: BaseLink | null;
}

export function mpGame(seed: number, ai: AiLevel[]): Game {
  return createGame({ seed, userCol: 4, rules: { ruleset: 'remake', ai } });
}

/** 接上一条 客户端 ⇄ 权威 的模拟链路 */
export function connect(clock: SimClock, auth: Authority, client: NetClient, oneWay: number, jitter: number, seed: number): BaseLink {
  const rng = createRng(seed);
  const [a, b] = linkPair(clock, 'sim', oneWay, jitter, () => random(rng));
  auth.attach(a, client.seat);
  client.attach(b);
  return b;
}

/** 随机下令的"玩家"：每隔一段时间挑几个自己的学生走向随机地块 */
export function bot(client: NetClient, seed: number): () => void {
  const rng = createRng(seed);
  let next = 0;
  return () => {
    const g = client.confirmed;
    if (!g || client.seat < 0) return;
    if (g.tick < next) return;
    next = g.tick + 10 + Math.floor(random(rng) * 40);
    const mine: number[] = [];
    for (let i = 0; i < PMAX; i++) if (g.people[i].stat > PS.DEAD && g.people[i].col === client.seat) mine.push(i);
    if (mine.length === 0) return;
    const units = mine.filter(() => random(rng) < 0.5);
    if (units.length === 0) units.push(mine[0]);
    const r = random(rng);
    if (r < 0.08) client.issue({ type: 'rally', bx: Math.floor(random(rng) * 16), by: Math.floor(random(rng) * 16) });
    else client.issue({ type: 'order', units, bx: Math.floor(random(rng) * 16), by: Math.floor(random(rng) * 16), target: -1, amove: r < 0.4 });
  };
}

/** 停住权威、等网络里的消息都送到，返回各方状态指纹 */
export function settle(clock: SimClock, auth: Authority, clients: NetClient[]): { auth: string; clients: string[]; ticks: number[] } {
  auth.hold();
  clock.run(clock.t + 2000, 50, () => {});
  return {
    auth: hashGame(auth.game),
    clients: clients.map((c) => (c.confirmed ? hashGame(c.confirmed) : 'none')),
    ticks: clients.map((c) => c.confirmed?.tick ?? -1),
  };
}
