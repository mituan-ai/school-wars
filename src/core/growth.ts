// 基地经验与升级（docs/06 §2，仅"校园战争"规则）。
// 经验来自：坐在连通补给的己方营地上、己方地盘、击倒敌人、下课铃小卖部。攒满一次就能挑一项升级，
// 只影响之后新出的学生。电脑当场自己挑；玩家用 upgrade 指令挑（联机时经权威同步）。
import { EXP_COST_BASE, EXP_COST_STEP, FPS, UP_HP, UP_REIN, UPGRADE_MAX, UPGRADES } from './constants.ts';
import { isHuman } from './query.ts';
import { suppliedLand } from './territory.ts';
import type { Game, Player } from './types.ts';

export const UP = { HP: 0, PUNCH: 1, SPEED: 2, REIN: 3 } as const;

/** 下一次升级要多少经验 */
export function expCost(pl: Player): number {
  const taken = pl.up[0] + pl.up[1] + pl.up[2] + pl.up[3] + pl.picks;
  return EXP_COST_BASE + EXP_COST_STEP * taken;
}

/** 四项都满级后不再攒升级 */
export function maxed(pl: Player): boolean {
  return pl.up.every((v) => v >= UPGRADE_MAX);
}

export function addExp(g: Game, col: number, n: number): void {
  const pl = g.player[col];
  if (!pl.exist || maxed(pl)) return;
  pl.exp += n;
  let open = UPGRADES * UPGRADE_MAX - pl.up.reduce((a, b) => a + b, 0) - pl.picks;
  while (open > 0 && pl.exp >= expCost(pl)) {
    pl.exp -= expCost(pl);
    pl.picks++;
    open--;
    g.events.push({ kind: 'levelready', col });
  }
  if (open <= 0) pl.exp = 0;
}

/** 每帧：每秒按有补给的空白地盘数加经验；电脑把攒下的升级用掉 */
export function growth(g: Game): void {
  if (g.tick % FPS === 0) {
    for (let col = 0; col < 4; col++) {
      if (!g.player[col].exist) continue;
      const land = suppliedLand(g, col);
      if (land >= 2) addExp(g, col, land >> 1);
    }
  }
  for (let col = 0; col < 4; col++) {
    const pl = g.player[col];
    if (pl.picks <= 0 || isHuman(g, col) || g.rules.ai[col] === 'classic') continue;
    while (pl.picks > 0 && !maxed(pl)) upgrade(g, col, aiPick(pl, col));
  }
}

/** 各校电脑的偏好顺序（同等级时先选排在前面的） */
const AI_ORDER = [
  [UP.PUNCH, UP.HP, UP.REIN, UP.SPEED], // 人族
  [UP.REIN, UP.PUNCH, UP.HP, UP.SPEED], // 兽人
  [UP.HP, UP.PUNCH, UP.REIN, UP.SPEED], // 矮人
  [UP.PUNCH, UP.SPEED, UP.HP, UP.REIN], // 精灵
];

function aiPick(pl: Player, col: number): number {
  let best = -1;
  let score = Infinity;
  AI_ORDER[col].forEach((k, i) => {
    if (pl.up[k] >= UPGRADE_MAX) return;
    const s = pl.up[k] * 4 + i;
    if (s < score) {
      score = s;
      best = k;
    }
  });
  return best;
}

/** 用掉一次升级；不合法（没有攒下的、已满级）就什么也不做 */
export function upgrade(g: Game, col: number, kind: number): void {
  const pl = g.player[col];
  if (!pl || pl.picks <= 0 || !(kind >= 0 && kind < UPGRADES) || pl.up[kind] >= UPGRADE_MAX) return;
  pl.up[kind]++;
  pl.picks--;
  g.events.push({ kind: 'upgrade', col, kind2: kind });
}

/** 升级后新兵的生命上限 */
export function upgradedHp(base: number, pl: Player): number {
  return Math.round(base * (1 + UP_HP * pl.up[UP.HP]));
}

/** 升级后的增援间隔 */
export function upgradedAppear(base: number, pl: Player): number {
  return Math.round(base * (1 - UP_REIN * pl.up[UP.REIN]));
}
