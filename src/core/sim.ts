// 主循环 ← 862/f5:70-75（onEnterFrame：people_action → com_orders → check_add_people）
import { ADDX, ADDY, BSIZE, PMAX, PS, SSIZE } from './constants.ts';
import { com_orders } from './ai-classic.ts';
import { commander } from './ai-commander.ts';
import { check_add_people } from './spawn.ts';
import { isHuman } from './query.ts';
import { random } from './rng.ts';
import { decay_areas, people_action, start_walk, walk_to_cell } from './unit.ts';
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
    if (isHuman(g, col) || g.rules.ai[col] === 'classic' || !g.player[col].exist) continue;
    for (const c of commander(g, col)) applyCommand(g, c);
  }
  check_add_people(g);
  g.tick++;
  return g.events;
}

// 862/f5:99-120 —— 按槽位编号顺序给选中的己方单位下令
export function applyCommand(g: Game, c: Command): void {
  if (c.type === 'control') {
    if (c.col >= 0 && c.col < 4) g.rules.ai[c.col] = c.ai;
    return;
  }
  if (c.type === 'rally') {
    const pl = g.player[c.col ?? g.user_col];
    if (!pl) return;
    pl.rally_bx = c.bx;
    pl.rally_by = c.by;
    return;
  }
  const col = c.col ?? g.user_col;
  const remake = g.rules.ruleset === 'remake';
  const picked = new Set(c.units);
  const units: number[] = [];
  for (let i = 0; i < PMAX; i++) {
    if (!picked.has(i)) continue;
    const p = g.people[i];
    if (p.stat > PS.DEAD && p.col === col) units.push(i);
  }
  // "校园战争"规则：多人前往同一格时各占一个小格，人多就溢出到相邻格
  const cells = remake && c.target < 0 && units.length > 1 ? spreadCells(g, c.bx, c.by, units.length) : null;
  // 进攻移动：不算"执行指令"，挨打会还手，路上遇敌会去打（unit.ts step_boundary_remake）
  const amove = remake && !!c.amove && c.target < 0;
  units.forEach((i, k) => {
    const p = g.people[i];
    if (remake) {
      p.ordered = !amove;
      p.leash = false;
      p.retaliate = -1;
      p.amove = false;
    }
    if (cells) walk_to_cell(g, i, cells[k][0], cells[k][1]);
    else start_walk(g, i, c.bx, c.by, c.target);
    if (amove) {
      p.amove = true;
      p.goal_x = p.dest_sx;
      p.goal_y = p.dest_sy;
    }
  });
}

/** 大格 (bx, by) 内的 16 个小格随机排列；不够时依次加入四邻、斜邻大格的小格 */
function spreadCells(g: Game, bx: number, by: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  const tiles: [number, number][] = [[bx, by]];
  for (let d = 0; d < 4; d++) tiles.push([bx + ADDX[d], by + ADDY[d]]);
  for (const [dx, dy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) tiles.push([bx + dx, by + dy]);
  for (const [tx, ty] of tiles) {
    if (out.length >= n) break;
    if (tx < 0 || ty < 0 || tx >= BSIZE || ty >= BSIZE) continue;
    const cells: [number, number][] = [];
    for (let j = 0; j < 16; j++) cells.push([tx * 4 + (j % 4), ty * 4 + Math.floor(j / 4)]);
    for (let j = cells.length - 1; j > 0; j--) {
      const r = Math.floor(random(g.rng) * (j + 1));
      [cells[j], cells[r]] = [cells[r], cells[j]];
    }
    // 先去空着的小格
    cells.sort((a, b) => Number(g.smap[a[1] * SSIZE + a[0]] >= 0) - Number(g.smap[b[1] * SSIZE + b[0]] >= 0));
    out.push(...cells);
  }
  return out.slice(0, n);
}

/** 某阵营的 ♠ 持有数 */
export function spadeCount(g: Game, col: number): number {
  let n = 0;
  for (const a of g.area) if (a.areatype === 2 && a.col === col) n++;
  return n;
}
