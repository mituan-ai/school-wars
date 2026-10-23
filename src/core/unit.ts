// 单位状态机 ← 862/f3（函数名、分支顺序与原版保持一致）
import {
  ADDX, ADDY, AGGRO_RANGE, AREA, BSIZE, CAPTURE_VALUE, HEAL_PER_TICK, MOVEX, MOVEY,
  PMAX, PS, SSIZE, TOP_RATIO,
} from './constants.ts';
import { random } from './rng.ts';
import type { Game } from './types.ts';

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
  p.cnt = 20 + random(g.rng) * 30;
  p.hc = 0;
  p.pat = 10;
  people_pat(g, pn);
  people_pos(g, pn);
  p.donothing = 0;
}

// 862/f3:62 —— 先索敌，没有敌人才坐下
export function start_sit(g: Game, pn: number): void {
  const p = g.people[pn];
  const col = p.col;
  const cand: number[] = [];
  for (let i = 0; i < PMAX; i++) {
    if (i === pn) continue;
    const o = g.people[i];
    if (o.stat <= PS.DEAD) continue;
    if (o.col === col) continue;
    if (Math.abs(o.cx - p.cx) + Math.abs(o.cy - p.cy) > AGGRO_RANGE) continue;
    // 存在领先者时，电脑阵营只打领先者（862/f3:80）
    if (col !== g.user_col && g.top >= 0 && col !== g.top && o.col !== g.top) continue;
    cand.push(i);
  }
  if (cand.length > 0) {
    const r = Math.floor(random(g.rng) * cand.length);
    start_walk(g, pn, 0, 0, cand[r]);
    return;
  }
  p.stat = PS.SIT;
  p.cnt = 30 + random(g.rng) * 20;
  p.pat = 13 + Math.floor(random(g.rng) * 3);
  people_pat(g, pn);
  p.bx = Math.floor(p.cx / 4);
  p.by = Math.floor(p.cy / 4);
  p.area_num = g.bmap_n[p.by * BSIZE + p.bx];
}

// 862/f3:108 —— 占领与回血
function sitting(g: Game, pn: number): void {
  const p = g.people[pn];
  const n = p.area_num;
  if (n >= 0) {
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
      start_fight(g, pn, t);
      if (tp.stat === PS.FIGHT) return;
      tp.target_pn = pn;
      if (tp.stat <= PS.WALK) return;
      start_fight(g, t, pn);
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
  if (!set_dir(g, pn)) {
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
  if (p.target_pn >= 0) {
    const t = g.people[p.target_pn];
    if (t.stat <= PS.DEAD) {
      start_stand(g, pn);
      return;
    }
    if (Math.abs(t.cx - p.cx) + Math.abs(t.cy - p.cy) === 1) {
      const tn = p.target_pn;
      start_fight(g, pn, tn);
      if (t.stat === PS.FIGHT) return;
      t.target_pn = pn;
      if (t.stat <= PS.WALK) return;
      start_fight(g, tn, pn);
      return;
    }
  } else if (p.cx === p.dest_sx && p.cy === p.dest_sy) {
    start_stand(g, pn);
    return;
  }
  start_turn(g, pn);
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
      if (tp.stat !== PS.WALK) {
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
        if (random(g.rng) * 10 < 5) return;
        // 命中：对方硬直
        tp.pat = 20;
        tp.fs = 3;
        tp.cnt = 5;
        people_pat(g, t);
        tp.hp -= p.punch;
        if (tp.hp <= 0) {
          start_dead(g, t);
          start_levelup(g, pn);
          g.kills[p.col]++;
          g.events.push({ kind: 'dead', pn: t, px: tp.px, py: tp.py });
          return;
        }
        g.events.push({ kind: 'punch', pn: t, px: tp.px, py: tp.py });
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
  if (tp.stat <= PS.WALK) return false;
  if (tp.cx !== p.cx + ADDX[p.dir]) return false;
  if (tp.cy !== p.cy + ADDY[p.dir]) return false;
  return true;
}

// 862/f3:556 —— 升级只加 1 点最大生命
function start_levelup(g: Game, pn: number): void {
  g.people[pn].mhp += 1;
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
}

// 862/f3:573 —— 倒地、闪烁，然后释放槽位（尸体在此之前仍占格）
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
        g.smap[p.cy * SSIZE + p.cx] = -1;
        const col = p.col;
        g.player[col].people_cnt--;
        if (g.player[col].people_cnt <= 0) {
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
  g.top = top;
}
