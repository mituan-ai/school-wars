// WebRTC 直连（docs/05 §4）：房间里的成员两两尝试直连，用于测速、玩家主机模式的对局数据和换房主。
// 信令经 LA 转发；10 秒内连不上就算失败，这对成员之间改走 LA 中转。不部署 TURN。
import { BaseLink, Reassembler, toChunks } from './link.ts';

/** 公共 STUN：任一可用即可。中国大陆通常连不上 Google，所以另配了 Cloudflare 和小米的 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];
const CONNECT_MS = 10_000;
const PING_MS = 2000;

type Wire = { t: 'p'; i: number } | { t: 'q'; i: number } | { t: 'g'; d: unknown };

export class Peer {
  via: 'trying' | 'direct' | 'relay' = 'trying';
  rtt = 0;
  /** 直连状态变化 */
  onState: () => void = () => {};
  /** 对方经直连发来的对局消息 */
  onGame: (d: unknown) => void = () => {};
  readonly id: string;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private reasm = new Reassembler();
  private pendingCand: RTCIceCandidateInit[] = [];
  private timer = 0;
  private pinger = 0;
  private pings = new Map<number, number>();
  private pingId = 0;
  private link: BaseLink | null = null;
  private signal: (d: unknown) => void;
  private delay: number;

  /** initiator：两人中 id 较小的一方发起，避免双方同时发 offer */
  constructor(id: string, initiator: boolean, signal: (d: unknown) => void, delay = 0) {
    this.id = id;
    this.signal = signal;
    this.delay = delay;
    if (typeof RTCPeerConnection === 'undefined' || forcedRelay()) {
      this.via = 'relay';
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    // 双方各自创建同一个预先约定的通道，不必等 ondatachannel
    const dc = pc.createDataChannel('sw', { negotiated: true, id: 0, ordered: true });
    this.dc = dc;
    dc.onopen = () => {
      clearTimeout(this.timer);
      this.via = 'direct';
      this.pinger = window.setInterval(() => this.ping(), PING_MS);
      this.ping();
      this.onState();
    };
    dc.onclose = () => this.fail();
    dc.onmessage = (e) => this.onData(String(e.data));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ cand: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.fail();
    };
    this.timer = window.setTimeout(() => this.fail(), CONNECT_MS);
    if (initiator) {
      void pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        this.signal({ sdp: pc.localDescription?.toJSON() });
      }).catch(() => this.fail());
    }
  }

  /** 收到对方经 LA 转发的信令 */
  async onSignal(d: unknown): Promise<void> {
    const pc = this.pc;
    if (!pc || typeof d !== 'object' || d === null) return;
    const m = d as { sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };
    try {
      if (m.sdp) {
        await pc.setRemoteDescription(m.sdp);
        if (m.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.signal({ sdp: pc.localDescription?.toJSON() });
        }
        for (const c of this.pendingCand.splice(0)) await pc.addIceCandidate(c);
      } else if (m.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.cand);
        else this.pendingCand.push(m.cand);
      }
    } catch {
      // 个别候选地址无效不要紧；真连不上由超时处理
    }
  }

  /**
   * 经直连通往对方的对局链路（直连断开时随之断开）。对方发来的对局消息交给这条链路；
   * 还没有链路时交给 onGame（房主一侧据此建链路、接到权威上）。
   */
  gameLink(): BaseLink | null {
    if (this.via !== 'direct') return null;
    if (this.link?.isOpen()) return this.link;
    this.link = new BaseLink('direct', (text) => this.sendText(`{"t":"g","d":${text}}`), () => {});
    return this.link;
  }

  close(): void {
    clearTimeout(this.timer);
    clearInterval(this.pinger);
    this.link?.ended();
    this.link = null;
    if (this.dc) this.dc.onclose = null;
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
  }

  private fail(): void {
    if (this.via === 'relay') return;
    this.close();
    this.via = 'relay';
    this.onState();
  }

  private ping(): void {
    const i = ++this.pingId;
    this.pings.set(i, performance.now());
    if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!);
    this.sendWire({ t: 'p', i });
  }

  private sendWire(m: Wire): void {
    this.sendText(JSON.stringify(m));
  }

  private sendText(text: string): void {
    const go = () => {
      const dc = this.dc;
      if (!dc || dc.readyState !== 'open') return;
      try {
        for (const part of toChunks(text)) dc.send(part);
      } catch {
        this.fail();
      }
    };
    if (this.delay > 0) window.setTimeout(go, this.delay);
    else go();
  }

  private onData(text: string): void {
    const full = this.reasm.push(text);
    if (full === null) return;
    let m: Wire;
    try {
      m = JSON.parse(full) as Wire;
    } catch {
      return;
    }
    if (m.t === 'p') this.sendWire({ t: 'q', i: m.i });
    else if (m.t === 'q') {
      const t0 = this.pings.get(m.i);
      if (t0 === undefined) return;
      this.pings.delete(m.i);
      const rtt = performance.now() - t0;
      this.rtt = this.rtt ? this.rtt + (rtt - this.rtt) * 0.3 : rtt;
    } else if (m.t === 'g') {
      if (this.link?.isOpen()) this.link.receive(m.d);
      else this.onGame(m.d);
    }
  }
}

/** 调试：网址带 ?relay=1 时不尝试直连（验证"直连失败改走中转"） */
function forcedRelay(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('relay') === '1';
}
