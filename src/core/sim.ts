// 主循环 ← 862/f5:70-75（onEnterFrame：people_action → com_orders → check_add_people）
import { PMAX, PS } from './constants.ts';
import { com_orders } from './ai-classic.ts';
import { commander } from './ai-commander.ts';
import { check_add_people } from './spawn.ts';
import { decay_areas, people_action, start_walk } from './unit.ts';
import type { Command, Game, GameEvent } from './types.ts';

/**
 * 推进一帧。指令在本帧逻辑之前执行，等价于原版在两帧之间处理鼠标事件。
 * 返回本帧产生的事件。
 */
export function step(g: Game, commands: readonly Command[] = []): GameEvent[] {
  g.events = [];
  for (const c of commands) applyCommand(g, c);
  people_action(g);
  if (g.rules.ruleset === 'remake') decay_areas(g);
  com_orders(g);
  for (let col = 0; col < 4; col++) {
    if (col === g.user_col || g.rules.ai[col] === 'classic' || !g.player[col].exist) continue;
    for (const c of commander(g, col)) applyCommand(g, c);
  }
  check_add_people(g);
  g.tick++;
  return g.events;
}

// 862/f5:99-120 —— 按槽位编号顺序给选中的己方单位下令
export function applyCommand(g: Game, c: Command): void {
  if (c.type === 'rally') {
    const pl = g.player[g.user_col];
    if (!pl) return;
    pl.rally_bx = c.bx;
    pl.rally_by = c.by;
    return;
  }
  const col = c.col ?? g.user_col;
  const remake = g.rules.ruleset === 'remake';
  const picked = new Set(c.units);
  for (let i = 0; i < PMAX; i++) {
    if (!picked.has(i)) continue;
    const p = g.people[i];
    if (p.stat > PS.DEAD && p.col === col) {
      if (remake) {
        p.ordered = true;
        p.leash = false;
        p.retaliate = -1;
      }
      start_walk(g, i, c.bx, c.by, c.target);
    }
  }
}

/** 某阵营的 ♠ 持有数 */
export function spadeCount(g: Game, col: number): number {
  let n = 0;
  for (const a of g.area) if (a.areatype === 2 && a.col === col) n++;
  return n;
}
