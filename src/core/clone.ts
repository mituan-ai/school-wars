// 对局状态的快速深拷贝（联机预测每秒要拷几十次；structuredClone 一次约 1 ms，这里约为其几十分之一）。
// Game 里新增嵌套字段时要在这里补上，tests/net.test.ts 会检查拷贝与原状态没有共用的对象。
import type { Game } from './types.ts';

export function cloneGame(g: Game): Game {
  return {
    ...g,
    rng: { state: g.rng.state },
    rules: { ruleset: g.rules.ruleset, ai: g.rules.ai.slice() },
    bmap_pat: g.bmap_pat.slice(),
    bmap_n: g.bmap_n.slice(),
    area: g.area.map((a) => ({ ...a, val: a.val.slice(), touch: a.touch.slice() })),
    smap: g.smap.slice(),
    player: g.player.map((p) => ({ ...p })),
    people: g.people.map((p) => ({ ...p, hx: p.hx.slice(), hy: p.hy.slice() })),
    groups: g.groups.map((x) => x.slice()),
    kills: g.kills.slice(),
    events: [],
  };
}
