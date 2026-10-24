// 本机玩家眼中的迷雾（docs/06 §6）：此刻看得见的小格、最近看见过的小格（REFOG 内还记得地盘归属）、
// 早已看不见或从没看见过的小格。只是画面上的记忆，不进存档；观战、出局或关掉迷雾时什么都看得见。
import { AREA, BSIZE, PS, REFOG, SSIZE } from '../core/constants.ts';
import { fogOn, vision } from '../core/fog.ts';
import { tileOwner } from '../core/territory.ts';
import type { Game } from '../core/types.ts';

export const FOG = { DARK: 0, MEMORY: 1, SEEN: 2 } as const;

export class FogView {
  /** 每个小格最后一次看见的帧 */
  readonly seen = new Int32Array(SSIZE * SSIZE).fill(-1e9);
  /** 每个大格记住的归属 */
  readonly terr = new Int8Array(BSIZE * BSIZE).fill(-1);
  private vis = new Uint8Array(SSIZE * SSIZE);
  private tick = -1;
  private on = false;
  /** 内容变化的计数，地面层据此决定要不要重画 */
  version = 0;

  readonly me: number;

  constructor(me: number) {
    this.me = me;
  }

  /** 迷雾是否起作用 */
  active(g: Game): boolean {
    return fogOn(g) && this.me < 4 && g.player[this.me].exist;
  }

  update(g: Game): void {
    if (g.tick === this.tick) return;
    this.tick = g.tick;
    this.version++;
    this.on = this.active(g);
    if (!this.on) return;
    vision(g, this.me, this.vis);
    for (let i = 0; i < this.vis.length; i++) if (this.vis[i]) this.seen[i] = g.tick;
    for (let t = 0; t < BSIZE * BSIZE; t++) {
      const bx = t % BSIZE;
      const by = (t - bx) / BSIZE;
      // 大格里有一个小格看得见就更新记忆
      let any = false;
      for (let k = 0; k < 16 && !any; k++) any = this.vis[(by * 4 + (k >> 2)) * SSIZE + bx * 4 + (k & 3)] === 1;
      if (any) this.terr[t] = tileOwner(g, t);
    }
  }

  get enabled(): boolean {
    return this.on;
  }

  cell(i: number): number {
    if (!this.on || this.vis[i]) return FOG.SEEN;
    return this.tick - this.seen[i] < REFOG ? FOG.MEMORY : FOG.DARK;
  }

  cellAt(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= SSIZE || cy >= SSIZE) return FOG.SEEN;
    return this.cell(cy * SSIZE + cx);
  }

  /** 大格的归属：看得见 → 实际，记得 → 记忆，否则 -2（不知道） */
  owner(g: Game, t: number): number {
    if (!this.on) return tileOwner(g, t);
    // 各校本部的位置和归属人人都知道
    const n = g.bmap_n[t];
    if (n >= 0 && g.area[n].areatype === AREA.BASE) return tileOwner(g, t);
    const bx = t % BSIZE;
    const by = (t - bx) / BSIZE;
    let best: number = FOG.DARK;
    for (let k = 0; k < 16; k++) best = Math.max(best, this.cell((by * 4 + (k >> 2)) * SSIZE + bx * 4 + (k & 3)));
    if (best === FOG.SEEN) return tileOwner(g, t);
    if (best === FOG.MEMORY) return this.terr[t];
    return -2;
  }

  /** 大格中心那一小格的迷雾状态 */
  tile(t: number): number {
    const bx = t % BSIZE;
    const by = (t - bx) / BSIZE;
    return this.cell((by * 4 + 1) * SSIZE + bx * 4 + 1);
  }

  /** 这个学生现在能不能看见 */
  unit(g: Game, pn: number): boolean {
    const p = g.people[pn];
    if (!this.on || p.col === this.me) return true;
    if (p.stat === PS.EMPTY) return false;
    return this.vis[p.cy * SSIZE + p.cx] === 1;
  }

  /** 世界坐标处此刻是否看得见（特效用） */
  point(cx: number, cy: number): boolean {
    if (!this.on) return true;
    cx = Math.floor(cx);
    cy = Math.floor(cy);
    if (cx < 0 || cy < 0 || cx >= SSIZE || cy >= SSIZE) return true;
    return this.vis[cy * SSIZE + cx] === 1;
  }
}
