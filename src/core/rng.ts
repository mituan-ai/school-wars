// 可设种子、可序列化的伪随机数（mulberry32），替代原版的 Math.random。
// 状态只有一个 uint32，存档时直接保存。

export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** 返回 [0, 1) 的浮点数，语义同 Math.random() */
export function random(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
