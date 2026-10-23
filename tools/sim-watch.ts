// 无头跑四 AI 观战局，输出胜者分布与对局时长。用法：npm run sim -- [局数] [最长分钟]
import { FPS } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { step } from '../src/core/sim.ts';

const games = Number(process.argv[2] ?? 200);
const maxMinutes = Number(process.argv[3] ?? 60);
const names = ['黑曜', '绿林', '金刚', '紫电'];

const wins = [0, 0, 0, 0];
let unfinished = 0;
const durations: number[] = [];
const firstOut = [0, 0, 0, 0];

for (let seed = 1; seed <= games; seed++) {
  const g = createGame({ seed, userCol: 4 });
  let first = -1;
  while (g.tick < maxMinutes * 60 * FPS) {
    for (const e of step(g)) {
      if (e.kind === 'annihilated' && first < 0) first = e.col;
    }
    if (g.player.filter((p) => p.exist).length === 1) break;
  }
  if (first >= 0) firstOut[first]++;
  const alive = g.player.map((p, i) => (p.exist ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) {
    wins[alive[0]]++;
    durations.push(g.tick / FPS / 60);
  } else {
    unfinished++;
  }
}

durations.sort((a, b) => a - b);
const pct = (q: number) => durations[Math.floor(q * (durations.length - 1))]?.toFixed(1) ?? '-';
console.log(`${games} 局，上限 ${maxMinutes} 分钟`);
console.log('最终胜者：', names.map((n, i) => `${n} ${((100 * wins[i]) / games).toFixed(1)}%`).join('  '));
console.log('最先出局：', names.map((n, i) => `${n} ${((100 * firstOut[i]) / games).toFixed(1)}%`).join('  '));
console.log(`未分胜负：${unfinished} 局`);
console.log(`对局时长（分钟）：P10 ${pct(0.1)} / 中位 ${pct(0.5)} / P90 ${pct(0.9)}`);
