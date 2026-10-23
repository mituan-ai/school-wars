// 单位状态机 ← 862/f3（函数名、分支顺序与原版保持一致）
// "校园战争"规则（docs/03 §2）以 remake 分支插在少数几处，经典规则的执行路径保持不变。
import {
  ADDX, ADDY, AGGRO_RANGE, AMOVE_RANGE, AREA, BSIZE, CAPTURE_VALUE, DECAY_DELAY, HEAL_PER_TICK, KILL_HEAL, KILL_MHP,
  LEASH_RANGE, MOVEX, MOVEY, PMAX, PS, RECOVER_VALUE, SIEGE_VALUE, SSIZE, STUCK_TRIES, TOP_RATIO,
  TRAIT_CAPTURE, TRAIT_HEAL, TRAIT_HIT_TAKEN,
} from './constants.ts';
import { freeCellNear, nextDir, STEP_WAIT } from './path.ts';
import { baseFallen, topBlocks } from './query.ts';
import { random } from './rng.ts';
import type { Area, Game, Person } from './types.ts';

function remake(g: Game): boolean {
  return g.rules.ruleset === 'remake';
}

// 862/f3:1
export function people_action(g: Game): void {
  for (let pn = 0; pn < PMAX; pn++) {
    const p = g.people[pn];
    switch (p.stat) {
      case PS.STAND:
        p.cnt--;
        if (p.cnt < 0) start_sit(g, pn);
        break;
      case PS.SIT:
        sitting(g, pn);
        break;
      case PS.WALK:
        walking(g, pn);
        break;
      case PS.WAIT:
        p.cnt--;
        if (p.cnt < 0) start_turn(g, pn);
        break;
      case PS.FIGHT:
        fighting(g, pn);
        break;
      case PS.DEAD:
        dying(g, pn);
        break;
    }
  }
}

// 862/f3:38
function people_pat(g: Game, pn: number): void {
  g.people[pn].show = g.people[pn].pat;
}

// 862/f3:43
function people_pos(g: Game, pn: number): void {
  const p = g.people[pn];
  p.px = p.cx * 12 - p.cy * 12;
  p.py = p.cy * 6 + p.cx * 6;
}

// 862/f3:52
export function start_stand(g: Game, pn: number): void {
  const p = g.people[pn];
  p.stat = PS.STAND;
  // 进攻移动途中打完一架，稍站一下就继续前进
  p.cnt = (p.amove ? 4 : 20) + random(g.rng) * (p.amove ? 4 : 30);
  p.hc = 0;
  p.pat = 10;
  people_pat(g, pn);
  people_pos(g, pn);
  p.donothing = 0;
  p.ordered = false;
}

// 862/f3:62 —— 先索敌，没有敌人才坐下
export function start_sit(g: Game, pn: number): void {
  const p = g.people[pn];
  const col = p.col;
  if (remake(g)) {
    if (auto_engage(g, pn)) return;
  } else {
    const cand: number[] = [];
    for (let i = 0; i < PMAX; i++) {
      if (i === pn) continue;
      const o = g.people[i];
      if (o.stat <= PS.DEAD) continue;
      if (o.col === col) continue;
      if (Math.abs(o.cx - p.cx) + Math.abs(o.cy - p.cy) > AGGRO_RANGE) continue;
      // 存在领先者时，电脑阵营只打领先者（862/f3:80）
      if (col !== g.user_col && topBlocks(g, col, o.col)) continue;
      cand.push(i);
    }
    if (cand.length > 0) {
      const r = Math.floor(random(g.rng) * cand.length);
      start_walk(g, pn, 0, 0, cand[r]);
      return;
    }
  }
  p.stat = PS.SIT;
  p.cnt = 30 + random(g.rng) * 20;
  p.pat = 13 + Math.floor(random(g.rng) * 3);
  people_pat(g, pn);
  p.bx = Math.floor(p.cx / 4);
  p.by = Math.floor(p.cy / 4);
  p.area_num = g.bmap_n[p.by * BSIZE + p.bx];
}

/**
 * "校园战争"规则的索敌：优先打正在打我方的敌人，其次最近、血少的；不受"众矢之的"限制。
 * 返回槽位号，没有则返回 -1。
 */
function pick_enemy(g: Game, pn: number, range: number): number {
  const p = g.people[pn];
  const col = p.col;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < PMAX; i++) {
    if (i === pn) continue;
    const o = g.people[i];
    if (o.stat <= PS.DEAD) continue;
    if (o.col === col) continue;
    const d = Math.abs(o.cx - p.cx) + Math.abs(o.cy - p.cy);
    if (d > range) continue;
    // "众矢之的"在新规则里只影响电脑的进攻选择（ai-commander），学生总会迎战身边的敌人
    let score = d * 4 + (o.hp / o.mhp) * 3;
    if (o.stat === PS.FIGHT && o.target_pn >= 0 && g.people[o.target_pn].col === col) score -= 20;
    if (o.target_pn === pn) score -= 20;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * "校园战争"规则的自动迎战。记下出发点；追不到或打完后回到原位（进攻移动则继续前往目的地）。
 * 返回是否离开了座位。
 */
function auto_engage(g: Game, pn: number): boolean {
  const p = g.people[pn];
  const best = pick_enemy(g, pn, AGGRO_RANGE);
  if (best >= 0) {
    if (!p.leash) {
      p.leash = true;
      p.anchor_x = p.cx;
      p.anchor_y = p.cy;
    }
    start_walk(g, pn, 0, 0, best);
    return true;
  }
  if (p.leash) {
    p.leash = false;
    const [x, y] = p.amove ? [p.goal_x, p.goal_y] : [p.anchor_x, p.anchor_y];
    if (p.cx !== x || p.cy !== y) {
      walk_to_cell(g, pn, x, y);
      return true;
    }
  }
  if (p.amove && (p.cx !== p.goal_x || p.cy !== p.goal_y)) {
    walk_to_cell(g, pn, p.goal_x, p.goal_y);
    return true;
  }
  p.amove = false;
  return false;
}

/** 走向指定小格（"校园战争"规则：回到自动迎战前的位置、整队分散落点） */
export function walk_to_cell(g: Game, pn: number, cx: number, cy: number): void {
  const p = g.people[pn];
  p.target_pn = -1;
  p.dest_sx = cx;
  p.dest_sy = cy;
  p.hc = 0;
  if (p.stat !== PS.WALK) {
    p.pat = Math.floor(random(g.rng) * 10);
    start_turn(g, pn);
  }
}

// 862/f3:108 —— 占领与回血
function sitting(g: Game, pn: number): void {
  const p = g.people[pn];
  const n = p.area_num;
  if (n >= 0 && remake(g)) {
    sit_on_area_remake(g, p, n);
  } else if (n >= 0) {
    const a = g.area[n];
    const col = p.col;
    if (a.areatype >= AREA.SPADE && a.col !== col) {
      a.val[col]++;
      if (a.val[col] >= CAPTURE_VALUE) {
        a.col = col;
        for (let i = 0; i < 4; i++) if (i !== col) a.val[i] = 0;
        g.events.push({ kind: 'capture', area: n, col });
        check_top(g);
      }
    }
    if ((a.areatype === AREA.BASE || a.areatype === AREA.HEART) && a.col === col) {
      if (p.hp < p.mhp) {
        p.hp += HEAL_PER_TICK;
        if (p.hp > p.mhp) p.hp = p.mhp;
      }
    }
  }
  p.cnt--;
  if (p.cnt < 0) start_sit(g, pn);
  p.donothing++;
}

/** "校园战争"规则的坐下效果：在原版占领 / 回血之外，加入攻陷与夺回本部 */
function sit_on_area_remake(g: Game, p: Person, n: number): void {
  const a = g.area[n];
  const col = p.col;
  if (a.areatype >= AREA.SPADE && a.col !== col) {
    if (advance(g, a, col, CAPTURE_VALUE)) {
      a.col = col;
      g.events.push({ kind: 'capture', area: n, col });
      check_top(g);
    }
  } else if (a.areatype === AREA.BASE) {
    if (a.col !== col && !a.fallen && g.player[a.col].exist) {
      if (advance(g, a, col, SIEGE_VALUE)) {
        a.fallen = true;
        a.holder = col;
        g.events.push({ kind: 'fallen', area: n, col: a.col, by: col });
        if (g.player[a.col].people_cnt <= 0) {
          g.player[a.col].exist = false;
          on_annihilated(g, a.col);
        }
        check_top(g);
      }
    } else if (a.col === col && a.fallen) {
      if (advance(g, a, col, RECOVER_VALUE)) {
        a.fallen = false;
        a.holder = -1;
        g.events.push({ kind: 'recovered', area: n, col });
        check_top(g);
      }
    }
  }
  const heals = (a.areatype === AREA.BASE && !a.fallen) || a.areatype === AREA.HEART;
  if (heals && a.col === col && p.hp < p.mhp) {
    p.hp += HEAL_PER_TICK * TRAIT_HEAL[col];
    if (p.hp > p.mhp) p.hp = p.mhp;
  }
}

/** 推进 col 的进度；满了就清空所有进度并返回 true */
function advance(g: Game, a: Area, col: number, need: number): boolean {
  a.val[col] += TRAIT_CAPTURE[col];
  a.touch[col] = g.tick;
  if (a.val[col] < need) return false;
  for (let i = 0; i < 4; i++) a.val[i] = 0;
  return true;
}

/** "校园战争"规则：5 秒没人推进的占领进度，每 2 帧回退 1 点 */
export function decay_areas(g: Game): void {
  if (g.tick % 2) return;
  for (const a of g.area) {
    for (let c = 0; c < 4; c++) {
      if (a.val[c] > 0 && g.tick - a.touch[c] > DECAY_DELAY) a.val[c] = Math.max(0, a.val[c] - 1);
    }
  }
}

// 862/f3:162 —— t >= 0 时追击目标，否则走向大格 (bx, by) 内的随机小格
export function start_walk(g: Game, pn: number, bx: number, by: number, t: number): void {
  const p = g.people[pn];
  p.target_pn = t;
  if (t < 0) {
    p.dest_sx = bx * 4 + Math.floor(random(g.rng) * 4);
    p.dest_sy = by * 4 + Math.floor(random(g.rng) * 4);
  } else {
    const tp = g.people[t];
    if (Math.abs(tp.cx - p.cx) + Math.abs(tp.cy - p.cy) === 1) {
      engage(g, pn, t);
      return;
    }
    p.dest_sx = tp.cx;
    p.dest_sy = tp.cy;
  }
  p.hc = 0;
  if (p.stat !== PS.WALK) {
    p.pat = Math.floor(random(g.rng) * 10);
    start_turn(g, pn);
  }
}

// 862/f3:201 —— 迈出一步（逻辑坐标在起步时就写入目标格）
export function start_turn(g: Game, pn: number): void {
  const p = g.people[pn];
  let cx = p.cx;
  let cy = p.cy;
  let hc = p.hc;
  if (hc > 6) {
    let c = 0;
    for (let i = 0; i < 6; i++) {
      hc--;
      if (cx === p.hx[hc] && cy === p.hy[hc]) c++;
    }
    if (c >= 3) {
      start_stand(g, pn);
      return;
    }
  }
  if (p.target_pn >= 0) {
    const t = g.people[p.target_pn];
    p.dest_sx = t.cx;
    p.dest_sy = t.cy;
  }
  if (remake(g)) {
    const d = path_dir(g, pn);
    if (d < 0) {
      if (d === STEP_WAIT && p.stuck < STUCK_TRIES) {
        p.stuck++;
        start_wait(g, pn);
        p.cnt = 3 + random(g.rng) * 3;
      } else {
        start_stand(g, pn);
      }
      return;
    }
    p.dir = d;
    p.stuck = 0;
  } else if (!set_dir(g, pn)) {
    if (p.stat === PS.WAIT) start_stand(g, pn);
    else start_wait(g, pn);
    return;
  }
  p.stat = PS.WALK;
  p.cnt = 0;
  g.smap[cy * SSIZE + cx] = -1;
  p.hc++;
  p.hx[p.hc] = cx;
  p.hy[p.hc] = cy;
  cx += ADDX[p.dir];
  cy += ADDY[p.dir];
  g.smap[cy * SSIZE + cx] = pn;
  p.cx = cx;
  p.cy = cy;
}

/** "校园战争"规则：A* 选下一步；目的地被人坐着时改去旁边最近的空格 */
function path_dir(g: Game, pn: number): number {
  const p = g.people[pn];
  if (p.target_pn < 0) {
    const o = g.smap[p.dest_sy * SSIZE + p.dest_sx];
    if (o >= 0 && o !== pn && g.people[o].stat !== PS.WALK) {
      const c = freeCellNear(g, pn, p.dest_sx, p.dest_sy);
      if (c) {
        p.dest_sx = c[0];
        p.dest_sy = c[1];
        if (p.amove) {
          p.goal_x = c[0];
          p.goal_y = c[1];
        }
      }
    }
  }
  return nextDir(g, pn, p.dest_sx, p.dest_sy, p.stuck > 0);
}

// 862/f3:260
function walking(g: Game, pn: number): void {
  const p = g.people[pn];
  p.px += 2 * MOVEX[p.dir];
  p.py += MOVEY[p.dir];
  people_pat(g, pn);
  p.pat++;
  if (p.pat >= 10) p.pat = 0;
  p.cnt++;
  if (p.cnt < 6) return;
  if (remake(g)) step_boundary_remake(g, pn);
  if (p.target_pn >= 0) {
    const t = g.people[p.target_pn];
    if (t.stat <= PS.DEAD) {
      start_stand(g, pn);
      return;
    }
    if (Math.abs(t.cx - p.cx) + Math.abs(t.cy - p.cy) === 1) {
      engage(g, pn, p.target_pn);
      return;
    }
  } else if (p.cx === p.dest_sx && p.cy === p.dest_sy) {
    if (p.amove && p.cx === p.goal_x && p.cy === p.goal_y) p.amove = false;
    start_stand(g, pn);
    return;
  }
  start_turn(g, pn);
}

/** "校园战争"规则：走完一步时，先回头反击路上打我的人，再检查追击是否超出范围 */
function step_boundary_remake(g: Game, pn: number): void {
  const p = g.people[pn];
  if (p.retaliate >= 0) {
    const rn = p.retaliate;
    const r = g.people[rn];
    p.retaliate = -1;
    if (!p.ordered && r.stat > PS.DEAD && r.col !== p.col) {
      if (!p.leash && p.target_pn < 0) {
        p.leash = true;
        p.anchor_x = p.cx;
        p.anchor_y = p.cy;
      }
      p.target_pn = rn;
    }
  }
  if (p.target_pn >= 0 && p.leash && Math.abs(p.cx - p.anchor_x) + Math.abs(p.cy - p.anchor_y) > LEASH_RANGE) {
    p.leash = false;
    p.target_pn = -1;
    p.dest_sx = p.amove ? p.goal_x : p.anchor_x;
    p.dest_sy = p.amove ? p.goal_y : p.anchor_y;
    return;
  }
  // 进攻移动：路上发现附近的敌人就去打，追击范围从这里算起
  if (p.amove && p.target_pn < 0) {
    const t = pick_enemy(g, pn, AMOVE_RANGE);
    if (t >= 0) {
      p.leash = true;
      p.anchor_x = p.cx;
      p.anchor_y = p.cy;
      p.target_pn = t;
    }
  }
}

/** 走到目标相邻格：开打，并让对方转身应战（862/f3:180-196 与 284-299 的共同部分） */
function engage(g: Game, pn: number, tn: number): void {
  const t = g.people[tn];
  start_fight(g, pn, tn);
  if (t.stat === PS.FIGHT) return;
  if (remake(g) && t.stat === PS.WALK) {
    // 执行指令的人继续赶路；其余的人走完这一步再回头
    if (!t.ordered) t.retaliate = pn;
    return;
  }
  t.target_pn = pn;
  if (t.stat <= PS.WALK) return;
  start_fight(g, tn, pn);
}

// 862/f3:317 —— 贪心选方向，不远离目标；dx 或 dy 为 0 时优先走直线
function set_dir(g: Game, pn: number): boolean {
  const p = g.people[pn];
  const dsx = p.dest_sx;
  const dsy = p.dest_sy;
  const cx = p.cx;
  const cy = p.cy;
  if (cx === dsx && cy === dsy) return false;
  const dx = dsx - cx;
  const dy = dsy - cy;
  const cand: number[] = [];
  let pref = -1;
  for (let i = 0; i < 4; i++) {
    const ax = ADDX[i];
    const ay = ADDY[i];
    if (dx > 0 && ax < 0) continue;
    if (dx < 0 && ax > 0) continue;
    if (dy > 0 && ay < 0) continue;
    if (dy < 0 && ay > 0) continue;
    const nx = cx + ax;
    const ny = cy + ay;
    if (nx < 0 || nx >= SSIZE || ny < 0 || ny >= SSIZE) continue;
    if (g.smap[ny * SSIZE + nx] >= 0) continue;
    if (dx === 0 && ay) pref = i;
    if (dy === 0 && ax) pref = i;
    cand.push(i);
  }
  if (cand.length === 0) return false;
  let d = cand[Math.floor(random(g.rng) * cand.length)];
  if (pref >= 0) d = pref;
  p.dir = d;
  return true;
}

// 862/f3:393
function start_wait(g: Game, pn: number): void {
  const p = g.people[pn];
  p.stat = PS.WAIT;
  p.cnt = 20 + random(g.rng) * 80;
  p.hc = 0;
  p.pat = 10;
  people_pat(g, pn);
}

// 862/f3:401
export function start_fight(g: Game, pn: number, t: number): void {
  const p = g.people[pn];
  if (p.stat === PS.FIGHT) return;
  p.stat = PS.FIGHT;
  p.fs = 0;
  p.pat = 16;
  p.target_pn = t;
  p.ordered = false;
  fight_dir(g, pn);
  people_pat(g, pn);
}

// 862/f3:414 —— 出拳循环：fs1 2 帧 → fs2 2 帧 → 判定 → fs3 11 帧
function fighting(g: Game, pn: number): void {
  const p = g.people[pn];
  const t = p.target_pn;
  const tp = g.people[t];
  switch (p.fs) {
    case 0:
      if (tp.stat !== PS.WALK || remake(g)) {
        p.pat = 17;
        p.cnt = 1;
        people_pat(g, pn);
        p.fs = 1;
      }
      break;
    case 1:
      p.cnt--;
      if (p.cnt < 0) {
        p.pat = 18;
        p.cnt = 1;
        people_pat(g, pn);
        p.fs = 2;
      }
      break;
    case 2:
      p.cnt--;
      if (p.cnt < 0) {
        p.pat = 19;
        people_pat(g, pn);
        p.fs = 3;
        p.cnt = 10;
        if (!target_exist(g, pn, t)) return;
        // 命中率 50%；"校园战争"规则下精灵更难打中
        const missBelow = remake(g) ? 10 * (1 - TRAIT_HIT_TAKEN[tp.col]) : 5;
        if (random(g.rng) * 10 < missBelow) {
          g.events.push({ kind: 'miss', pn: t, px: tp.px, py: tp.py });
          return;
        }
        if (tp.stat === PS.WALK) {
          // 只有"校园战争"规则会打中走路的人：扣血，但不打断这一步
          if (hit(g, pn, t)) return;
          if (!tp.ordered) tp.retaliate = pn;
          return;
        }
        // 命中：对方硬直
        tp.pat = 20;
        tp.fs = 3;
        tp.cnt = 5;
        people_pat(g, t);
        if (hit(g, pn, t)) return;
        tp.target_pn = pn;
        fight_dir(g, t);
        if (tp.stat === PS.FIGHT) return;
        start_fight(g, t, pn);
      }
      break;
    case 3:
      p.cnt--;
      if (p.cnt < 0) {
        if (!target_exist(g, pn, t)) {
          start_stand(g, pn);
          return;
        }
        p.pat = 17;
        people_pat(g, pn);
        p.fs = 1;
        p.cnt = 1;
      }
      break;
  }
}

/** 扣血并发出事件；打倒对方时返回 true */
function hit(g: Game, pn: number, t: number): boolean {
  const p = g.people[pn];
  const tp = g.people[t];
  tp.hp -= p.punch;
  if (tp.hp <= 0) {
    start_dead(g, t);
    start_levelup(g, pn);
    g.kills[p.col]++;
    g.events.push({ kind: 'dead', pn: t, px: tp.px, py: tp.py });
    return true;
  }
  g.events.push({ kind: 'punch', pn: t, px: tp.px, py: tp.py });
  return false;
}

// 862/f3:503
function fight_dir(g: Game, pn: number): void {
  const p = g.people[pn];
  const t = g.people[p.target_pn];
  const dx = t.cx - p.cx;
  const dy = t.cy - p.cy;
  let d = 0;
  if (dy > 0) d = 1;
  if (dx < 0) d = 2;
  if (dy < 0) d = 3;
  p.dir = d;
}

// 862/f3:523 —— 目标必须在正前方相邻格且没在走路
function target_exist(g: Game, pn: number, t: number): boolean {
  const p = g.people[pn];
  const tp = g.people[t];
  const fx = p.cx + ADDX[p.dir];
  const fy = p.cy + ADDY[p.dir];
  if (remake(g) && tp.stat === PS.WALK) {
    // "校园战争"规则：走动中的人，出发格或目标格在正前方都能打到
    if (tp.cx === fx && tp.cy === fy) return true;
    return tp.cx - ADDX[tp.dir] === fx && tp.cy - ADDY[tp.dir] === fy;
  }
  if (tp.stat <= PS.WALK) return false;
  if (tp.cx !== fx) return false;
  if (tp.cy !== fy) return false;
  return true;
}

// 862/f3:556 —— 原版升级只加 1 点最大生命；"校园战争"规则再回复 30% 生命、上限 +2
function start_levelup(g: Game, pn: number): void {
  const p = g.people[pn];
  p.lev++;
  if (remake(g)) {
    p.mhp += KILL_MHP;
    p.hp = Math.min(p.mhp, p.hp + KILL_HEAL * p.mhp);
  } else {
    p.mhp += 1;
  }
  g.events.push({ kind: 'levelup', pn });
}

// 862/f3:565
function start_dead(g: Game, pn: number): void {
  const p = g.people[pn];
  p.stat = PS.DEAD;
  p.cnt = 10;
  p.fs = 0;
  p.pat = 20;
  people_pat(g, pn);
  // "校园战争"规则：尸体只是画面，立即让出格子
  if (remake(g)) g.smap[p.cy * SSIZE + p.cx] = -1;
}

// 862/f3:573 —— 倒地、闪烁，然后释放槽位（原版尸体在此之前仍占格）
function dying(g: Game, pn: number): void {
  const p = g.people[pn];
  switch (p.fs) {
    case 0:
      if (p.cnt <= 0) {
        p.cnt = 3;
        p.pat++;
        people_pat(g, pn);
        if (p.pat >= 23) {
          p.cnt = 12;
          p.fs = 1;
        }
      }
      break;
    case 1:
      p.pat = !(p.cnt % 2) ? 24 : 23;
      people_pat(g, pn);
      if (p.cnt <= 0) {
        p.stat = PS.EMPTY;
        if (g.smap[p.cy * SSIZE + p.cx] === pn) g.smap[p.cy * SSIZE + p.cx] = -1;
        const col = p.col;
        g.player[col].people_cnt--;
        // "校园战争"规则：本部还在就会继续出兵，只有本部沦陷且无人时才出局
        if (g.player[col].people_cnt <= 0 && !(remake(g) && !baseFallen(g, col))) {
          g.player[col].exist = false;
          on_annihilated(g, col);
        }
        check_top(g);
      }
      break;
  }
  p.cnt--;
}

// 862/f3:614
function on_annihilated(g: Game, col: number): void {
  let alive = 0;
  for (let i = 0; i < 4; i++) if (g.player[i].exist) alive++;
  let result: 'none' | 'win' | 'lose' = 'none';
  let persistent = false;
  if (col === g.user_col) {
    result = 'lose';
    persistent = true;
    g.result = 'lose';
  }
  if (alive === 1) {
    persistent = true;
    if (g.player[g.user_col]?.exist) {
      result = 'win';
      g.result = 'win';
    } else if (g.result === 'playing') {
      g.result = 'over';
    }
  }
  g.events.push({ kind: 'annihilated', col, result, persistent });
}

// 862/f3:644 —— 得分 = 人数 + ♠ 数（绿色减半），超过 40% 即为领先者
export function check_top(g: Game): void {
  const v = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) v[i] = g.player[i].people_cnt;
  for (const a of g.area) {
    if (a.areatype === AREA.SPADE && a.col >= 0 && g.player[a.col].exist) v[a.col]++;
  }
  v[1] /= 2;
  const sum = v[0] + v[1] + v[2] + v[3];
  let top = -1;
  for (let i = 0; i < 4; i++) if (v[i] > sum * TOP_RATIO) top = i;
  // "校园战争"规则：只剩两所学校时不再制衡
  if (remake(g) && g.player.filter((pl) => pl.exist).length < 3) top = -1;
  g.top = top;
}
