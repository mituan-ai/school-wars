// 无头跑四 AI 观战局，输出胜者分布与对局时长。
// 用法：npm run sim -- [局数] [最长分钟] [--rules classic|remake] [--ai classic|easy|normal|hard|黑,绿,金,紫]
import { FPS } from '../src/core/constants.ts';
import { createGame } from '../src/core/mapgen.ts';
import { step } from '../src/core/sim.ts';
import type { AiLevel, Rules, RuleSet } from '../src/core/types.ts';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
const ruleset = (flag('--rules') ?? 'classic') as RuleSet;
const aiArg = (flag('--ai') ?? (ruleset === 'classic' ? 'classic' : 'normal')).split(',') as AiLevel[];
const ai = [0, 1, 2, 3].map((i) => aiArg[i] ?? aiArg[0]);
const rules: Rules = { ruleset, ai };

const games = Number(args[0] ?? 200);
const maxMinutes = Number(args[1] ?? 60);
const names = ['黑曜', '绿林', '金刚', '紫电'];

const wins = [0, 0, 0, 0];
let unfinished = 0;
let unfinished40 = 0;
const durations: number[] = [];
const firstOut = [0, 0, 0, 0];
const firstFight: number[] = [];

for (let seed = 1; seed <= games; seed++) {
  const g = createGame({ seed, userCol: 4, rules });
  let first = -1;
  let fight = -1;
  while (g.tick < maxMinutes * 60 * FPS) {
    for (const e of step(g)) {
      if (e.kind === 'annihilated' && first < 0) first = e.col;
      if (fight < 0 && (e.kind === 'punch' || e.kind === 'miss' || e.kind === 'dead')) fight = g.tick;
    }
    if (g.player.filter((p) => p.exist).length === 1) break;
  }
  if (fight >= 0) firstFight.push(fight / FPS);
  if (first >= 0) firstOut[first]++;
  const alive = g.player.map((p, i) => (p.exist ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) {
    wins[alive[0]]++;
    durations.push(g.tick / FPS / 60);
    if (g.tick > 40 * 60 * FPS) unfinished40++;
  } else {
    unfinished++;
    unfinished40++;
  }
}

const pct = (xs: number[], q: number, d = 1) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))]?.toFixed(d) ?? '-';
};
console.log(`${games} 局，上限 ${maxMinutes} 分钟，规则 ${ruleset}，AI ${ai.join('/')}`);
console.log('最终胜者：', names.map((n, i) => `${n} ${((100 * wins[i]) / games).toFixed(1)}%`).join('  '));
console.log('最先出局：', names.map((n, i) => `${n} ${((100 * firstOut[i]) / games).toFixed(1)}%`).join('  '));
console.log(`未分胜负：${unfinished} 局；40 分钟内未分胜负：${((100 * unfinished40) / games).toFixed(1)}%`);
console.log(`对局时长（分钟）：P10 ${pct(durations, 0.1)} / 中位 ${pct(durations, 0.5)} / P90 ${pct(durations, 0.9)}`);
console.log(`首次交战（秒）：中位 ${pct(firstFight, 0.5, 0)}`);
