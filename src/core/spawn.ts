// 刷兵 ← 862/f2:1-118
import {
  AREA, PEOPLE_CAP, PMAX, PS, REMAKE_APPEAR, REMAKE_HP, REMAKE_PUNCH, SPEC_APPEAR, SPEC_HP, SPEC_PUNCH, SSIZE,
} from './constants.ts';
import { random } from './rng.ts';
import { baseFallen } from './query.ts';
import { start_walk } from './unit.ts';
import { UP, upgradedAppear, upgradedHp } from './growth.ts';
import { suppliedSpades } from './territory.ts';
import type { Game } from './types.ts';

// 862/f2:1
export function appear_people(g: Game, pn: number, cx: number, cy: number, col: number): void {
  const p = g.people[pn];
  g.smap[cy * SSIZE + cx] = pn;
  p.stat = PS.STAND;
  p.cx = cx;
  p.cy = cy;
  p.cnt = 10 + random(g.rng) * 20;
  p.dir = Math.floor(random(g.rng) * 4);
  const remake = g.rules.ruleset === 'remake';
  const pl = g.player[col];
  // "校园战争"规则：按本部升级定下新兵的生命、攻击、移速
  p.hp = p.mhp = remake ? upgradedHp(REMAKE_HP[col], pl) : SPEC_HP[col];
  p.punch = remake ? REMAKE_PUNCH[col] + pl.up[UP.PUNCH] : SPEC_PUNCH[col];
  p.spd = remake ? pl.up[UP.SPEED] : 0;
  p.acc = 0;
  p.squad = -1;
  p.squad_uid = -1;
  p.lev = 0;
  p.col = col;
  p.uid = g.next_uid++;
  p.ordered = false;
  p.leash = false;
  p.retaliate = -1;
  p.task = 0;
  p.task_area = -1;
  p.stuck = 0;
  p.amove = false;
  p.px = cx * 12 - cy * 12;
  p.py = cy * 6 + cx * 6;
  // 原版显示第 col*100 + 11 + dir*25 帧，即站立姿势；pat 本身不重置
  p.show = 10;
  // 注意：fs、target_pn、hc、donothing 等字段沿用槽位上一任主人的值，与原版一致
  g.player[col].people_cnt++;
  g.events.push({ kind: 'appear', pn, col });
}

// 862/f2:28 —— 返回是否真的出了兵（"校园战争"规则下没出兵就保留增援进度）
export function add_people(g: Game, col: number): boolean {
  if (!g.player[col].exist) return false;
  if (g.player[col].people_cnt >= PEOPLE_CAP) return false;
  let slot = -1;
  for (let i = 0; i < PMAX; i++) {
    if (g.people[i].stat === PS.EMPTY) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return false;
  const bx = g.player[col].basex;
  const by = g.player[col].basey;
  const free: { cx: number; cy: number }[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = bx * 4 + j;
      const cy = by * 4 + i;
      if (g.smap[cy * SSIZE + cx] < 0) free.push({ cx, cy });
    }
  }
  if (free.length === 0) return false;
  const r = Math.floor(random(g.rng) * free.length);
  appear_people(g, slot, free[r].cx, free[r].cy, col);
  const pl = g.player[col];
  if (g.rules.ruleset === 'remake' && pl.rally_bx >= 0) {
    // 新兵自动前往集结点，到达后照常坐下（顺便占领）
    start_walk(g, slot, pl.rally_bx, pl.rally_by, -1);
    g.people[slot].ordered = true;
  }
  return true;
}

// 862/f2:87
export function check_add_people(g: Game): void {
  if (g.rules.ruleset === 'remake') {
    check_add_people_remake(g);
    return;
  }
  for (const a of g.area) {
    if (a.areatype === AREA.SPADE && a.col >= 0) {
      g.player[a.col].appear_cnt++;
    }
  }
  for (let i = 0; i < 4; i++) {
    const pl = g.player[i];
    if (pl.exist) {
      pl.appear_cnt += 2;
      if (pl.appear_cnt > SPEC_APPEAR[i]) {
        pl.appear_cnt -= SPEC_APPEAR[i];
        add_people(g, i);
      }
    }
  }
}

// 本部沦陷时不增援；人满时进度停在满格，一有空位立即补上。只有连上补给的营地加快增援
function check_add_people_remake(g: Game): void {
  for (let i = 0; i < 4; i++) {
    const pl = g.player[i];
    if (!pl.exist || baseFallen(g, i)) continue;
    const need = upgradedAppear(REMAKE_APPEAR[i], pl);
    pl.appear_cnt += 2 + suppliedSpades(g, i);
    if (pl.appear_cnt > need) {
      if (add_people(g, i)) pl.appear_cnt -= need;
      else pl.appear_cnt = need + 1;
    }
  }
}

/** 距离下一个新兵还需多少帧（界面提示用，不影响规则） */
export function ticksToNextSpawn(g: Game, col: number): number {
  const pl = g.player[col];
  const remake = g.rules.ruleset === 'remake';
  let spades = 0;
  if (remake) spades = suppliedSpades(g, col);
  else for (const a of g.area) if (a.areatype === AREA.SPADE && a.col === col) spades++;
  const need = (remake ? upgradedAppear(REMAKE_APPEAR[col], pl) : SPEC_APPEAR[col]) - pl.appear_cnt;
  return Math.max(0, Math.floor(need / (2 + spades)) + 1);
}
