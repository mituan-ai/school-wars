// 全新合成的音效（WebAudio 实时生成，不使用原版音频）。
// 种类与原版六个音效一一对应：移动、选中、出拳、消息、倒下、取消。
import { settings } from '../settings.ts';

export type Sfx = 'move' | 'select' | 'punch' | 'message' | 'dead' | 'cancel';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number) {
  const o = a.createOscillator();
  const gn = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  gn.gain.setValueAtTime(vol, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(gn).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function burst(a: AudioContext, out: AudioNode, t0: number, dur: number, freq: number, vol: number) {
  const s = a.createBufferSource();
  s.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const gn = a.createGain();
  gn.gain.setValueAtTime(vol, t0);
  gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f).connect(gn).connect(out);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

// 同一帧里大量出拳时限制并发，避免爆音
let lastPunch = 0;

export function play(name: Sfx): void {
  if (settings.volume <= 0) return;
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (name === 'punch') {
    if (now - lastPunch < 0.04) return;
    lastPunch = now;
  }
  const out = a.createGain();
  out.gain.value = settings.volume * 0.5;
  out.connect(a.destination);
  switch (name) {
    case 'move':
      tone(a, out, 'square', 660, 660, now, 0.06, 0.15);
      tone(a, out, 'square', 990, 990, now + 0.07, 0.08, 0.12);
      break;
    case 'select':
      tone(a, out, 'triangle', 880, 1320, now, 0.09, 0.3);
      break;
    case 'punch':
      tone(a, out, 'sine', 180, 60, now, 0.12, 0.6);
      burst(a, out, now, 0.08, 2400, 0.35);
      break;
    case 'message':
      tone(a, out, 'triangle', 523, 523, now, 0.18, 0.25);
      tone(a, out, 'triangle', 784, 784, now + 0.12, 0.3, 0.25);
      break;
    case 'dead':
      tone(a, out, 'sawtooth', 400, 70, now, 0.45, 0.2);
      burst(a, out, now, 0.25, 800, 0.3);
      break;
    case 'cancel':
      tone(a, out, 'square', 440, 220, now, 0.12, 0.12);
      break;
  }
}
