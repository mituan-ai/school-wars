// 平衡扫参：node tools/balance.ts <局数> '<hp>' '<punch>' '<appear>' [ai] ['<占领倍率>' '<回血倍率>' '<被命中率>']
// 例：node tools/balance.ts 100 '20,12,25,15' '4,2,3,5' '1500,500,1500,1500'
// 参数留空字符串表示沿用当前值
import {
  FPS, REMAKE_APPEAR, REMAKE_HP, REMAKE_PUNCH, TRAIT_CAPTURE, TRAIT_HEAL, TRAIT_HIT_TAKEN,
} from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { step } from '../src/core/sim.ts';
import type { AiLevel } from '../src/core/types.ts';

const [n, hp, punch, appear, aiArg, capture, heal, hit] = process.argv.slice(2);
const set = (dst: number[], src?: string) => src && src.split(',').forEach((v, i) => (dst[i] = Number(v)));
set(REMAKE_HP, hp);
set(REMAKE_PUNCH, punch);
set(REMAKE_APPEAR, appear);
set(TRAIT_CAPTURE, capture);
set(TRAIT_HEAL, heal);
set(TRAIT_HIT_TAKEN, hit);
const ai = (aiArg || 'normal') as AiLevel;
const games = Number(n ?? 100);
const wins = [0, 0, 0, 0];
let late = 0;
const dur: number[] = [];
for (let seed = 1; seed <= games; seed++) {
  const g = createGame({ seed, userCol: 4, rules: { ruleset: 'remake', ai: [ai, ai, ai, ai] } });
  while (g.tick < 40 * 60 * FPS && g.player.filter((p) => p.exist).length > 1) step(g);
  const alive = g.player.map((p, i) => (p.exist ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) {
    wins[alive[0]]++;
    dur.push(g.tick / FPS / 60);
  } else late++;
}
dur.sort((a, b) => a - b);
console.log(
  `hp ${REMAKE_HP} atk ${REMAKE_PUNCH} app ${REMAKE_APPEAR} cap ${TRAIT_CAPTURE} heal ${TRAIT_HEAL} hit ${TRAIT_HIT_TAKEN} | 胜率 ${wins.map((w) => ((100 * w) / games).toFixed(0)).join('/')} | 40分未完 ${late} | 中位 ${dur[Math.floor(dur.length / 2)]?.toFixed(1)}`,
);
