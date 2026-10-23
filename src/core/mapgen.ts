// 地图生成与对局初始化 ← 862/f1、862/f2:127-155
import { AREA, BSIZE, INITIAL_PEOPLE, PMAX, SSIZE, ADDX, ADDY, mappat } from './constants.ts';
import { createRng, random } from './rng.ts';
import { add_people } from './spawn.ts';
import { CLASSIC_RULES, type Game, type Person, type Rules } from './types.ts';

export function emptyPerson(): Person {
  return {
    stat: 0, col: -1, cx: 0, cy: 0, px: 0, py: 0, cnt: 0, dir: 0, pat: 10, show: 10,
    hp: 0, mhp: 0, punch: 0, lev: 0, fs: 0, target_pn: -1, dest_sx: 0, dest_sy: 0,
    hx: [], hy: [], hc: 0, bx: 0, by: 0, area_num: -1,
    donothing: NaN,
  };
}

export interface NewGameOptions {
  seed: number;
  /** 0–3 玩家阵营；4 观战 */
  userCol: number;
  rules?: Rules;
}

export function createGame(opts: NewGameOptions): Game {
  const rng = createRng(opts.seed);
  const bmap_pat = new Array<number>(BSIZE * BSIZE).fill(0);
  const bmap_n = new Array<number>(BSIZE * BSIZE).fill(-1);

  // 四个本部放在四角，阵营顺序随机（862/f1:50-73，保留原版的有偏打乱）
  const jun = [1, 2, 3, 4];
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(random(rng) * 4);
    const tmp = jun[r];
    jun[r] = jun[i];
    jun[i] = tmp;
  }
  let c = 0;
  const s = BSIZE - 1;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      bmap_pat[i * s * BSIZE + j * s] = jun[c];
      c++;
    }
  }

  // 特殊地块：26 次尝试，自身和四邻都为空才放；1/3 ♥、2/3 ♠（862/f1:74-107）
  const max = 0.1 * BSIZE * BSIZE;
  for (let i = 0; i < max; i++) {
    const rx = Math.floor(random(rng) * BSIZE);
    const ry = Math.floor(random(rng) * BSIZE);
    let f = bmap_pat[ry * BSIZE + rx] ? 1 : 0;
    for (let j = 0; j < 4; j++) {
      const nx = rx + ADDX[j];
      const ny = ry + ADDY[j];
      if (nx >= 0 && nx < BSIZE && ny >= 0 && ny < BSIZE && bmap_pat[ny * BSIZE + nx]) f = 1;
    }
    if (f === 0) {
      bmap_pat[ry * BSIZE + rx] = random(rng) * 3 >= 2 ? 10 : 5;
    }
  }

  const area: Game['area'] = [];
  for (let i = 0; i < BSIZE; i++) {
    for (let j = 0; j < BSIZE; j++) {
      const p = bmap_pat[i * BSIZE + j];
      if (p !== 0) {
        const mp = mappat(p);
        bmap_n[i * BSIZE + j] = area.length;
        area.push({ bx: j, by: i, areatype: mp.areatype, col: mp.col, val: [0, 0, 0, 0] });
      }
    }
  }

  const player: Game['player'] = [];
  for (let i = 0; i < 4; i++) {
    player.push({ exist: false, basex: 0, basey: 0, people_cnt: 0, appear_cnt: 0 });
  }
  for (let i = 0; i < BSIZE; i++) {
    for (let j = 0; j < BSIZE; j++) {
      const mp = mappat(bmap_pat[i * BSIZE + j]);
      if (mp.areatype === AREA.BASE) {
        player[mp.col] = { exist: true, basex: j, basey: i, people_cnt: 0, appear_cnt: 0 };
      }
    }
  }

  const people: Person[] = [];
  for (let i = 0; i < PMAX; i++) people.push(emptyPerson());

  const g: Game = {
    seed: opts.seed,
    rng,
    tick: 0,
    rules: opts.rules ?? CLASSIC_RULES,
    user_col: opts.userCol,
    bmap_pat,
    bmap_n,
    area,
    smap: new Array<number>(SSIZE * SSIZE).fill(-1),
    player,
    people,
    top: -1,
    pn_com: 0,
    kills: [0, 0, 0, 0],
    result: 'playing',
    events: [],
  };

  for (let i = 0; i < 4; i++) {
    if (g.player[i].exist) {
      for (let j = 0; j < INITIAL_PEOPLE; j++) add_people(g, i);
    }
  }
  g.events.length = 0;
  return g;
}

/** 大格中心的世界坐标（原版 mcMapPat 的注册点是菱形顶点，中心再下移 24） */
export function tileTop(bx: number, by: number): { x: number; y: number } {
  return { x: bx * 48 - by * 48, y: by * 24 + bx * 24 };
}
