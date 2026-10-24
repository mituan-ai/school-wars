// 立体物件的像素精灵：营地帐篷、泉水、四所校舍，以及头顶的小图标（星、王冠、十字、铃铛）。
// 帐篷、泉水、校舍先用矢量画好再烘焙成像素（pixel.ts），按归属 / 状态缓存；旗子、烟这些会动的部分每帧另画。
import { FACTION } from './palette.ts';
import { SCHOOL_D, SCHOOL_H, SCHOOL_W } from './geom.ts';
import { bake, SpriteCache, type Sprite } from './pixel.ts';

export type SchoolState = 'ok' | 'fallen' | 'dead';

/** 矮人石堡烟囱口（相对地基中心） */
export const CHIMNEY: [number, number] = [SCHOOL_W * 0.45, -(SCHOOL_H - 2) - SCHOOL_D * 0.2];

const cache = new SpriteCache();

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, hw: number, hh: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
}

export function mix(a: string, b: string, k: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const ch = (i: number) => Math.round(pa[i] * (1 - k) + pb[i] * k);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function parseHex(c: string): [number, number, number] {
  if (c.startsWith('rgb')) {
    const m = c.match(/\d+/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 营地帐篷（不含旗子）；篷布是占领方的颜色。dim：迷雾里记得的样子 */
export function tentSprite(owner: number, dim = false): Sprite {
  return cache.get(`tent/${owner}/${dim}`, () =>
    bake(-18, -24, 18, 8, (ctx) => {
      const base = owner >= 0 ? FACTION[owner].ui : '#d8d2bf';
      const w = 14;
      const hgt = 20;
      ctx.strokeStyle = 'rgba(20,14,12,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -hgt);
      ctx.lineTo(-w, 0);
      ctx.quadraticCurveTo(-w / 2, 4.5, 0, 5);
      ctx.closePath();
      ctx.fillStyle = mix(base, '#ffffff', 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -hgt);
      ctx.lineTo(w, 0);
      ctx.quadraticCurveTo(w / 2, 4.5, 0, 5);
      ctx.closePath();
      ctx.fillStyle = mix(base, '#000000', 0.22);
      ctx.fill();
      ctx.stroke();
      // 门帘
      ctx.beginPath();
      ctx.moveTo(-1.5, -9);
      ctx.lineTo(-6.5, 3.2);
      ctx.lineTo(0.5, 4.8);
      ctx.closePath();
      ctx.fillStyle = '#2a1d16';
      ctx.fill();
    }, { colors: 6, dim: dim ? 0.45 : 0 }),
  );
}

/** 泉水：石砌小泉，石沿是归属方的颜色 */
export function springSprite(owner: number, dim = false): Sprite {
  return cache.get(`spring/${owner}/${dim}`, () =>
    bake(-16, -10, 16, 12, (ctx) => {
      const rx = 14;
      const ry = 7;
      const h = 4;
      ctx.beginPath();
      ctx.ellipse(0, h, rx, ry, 0, 0, Math.PI);
      ctx.lineTo(-rx, 0);
      ctx.ellipse(0, 0, rx, ry, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fillStyle = '#8f8a80';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = owner >= 0 ? FACTION[owner].ui : '#bdb6a8';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, rx - 3.5, ry - 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3f9be0';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-2, -1.5, rx - 8, ry - 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9fe6ff';
      ctx.fill();
    }, { colors: 6, dim: dim ? 0.45 : 0 }),
  );
}

/** 校舍主体（不含旗子、烟） */
export function schoolSprite(col: number, state: SchoolState): { sprite: Sprite; apexY: number } {
  let apexY = 0;
  const sprite = cache.get(`school/${col}/${state}`, () =>
    bake(-38, -72, 38, 18, (ctx) => {
      apexY = schoolBody(ctx, col, state);
    }, { colors: 16 }),
  );
  return { sprite, apexY: APEX[col] ?? apexY };
}

/** 各校旗杆底部的高度（与 schoolBody 的返回值一致，免得每次都要画一遍） */
const APEX = [-(SCHOOL_H + 13), -(SCHOOL_H + 17), -(SCHOOL_H - 2) - SCHOOL_D * 0.15 - 3, -(SCHOOL_H + 2 + 38)];

// ---- 小图标：直接写像素 ----

function icon(key: string, grid: string[], pal: Record<string, string>, ax: number, ay: number): Sprite {
  return cache.get(key, () => {
    const canvas = document.createElement('canvas');
    canvas.width = grid[0].length;
    canvas.height = grid.length;
    const ctx = canvas.getContext('2d')!;
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    return { canvas, ax, ay };
  });
}

const DARK = '#2b1a08';

export function starIcon(big = false): Sprite {
  if (big) {
    return icon('star9', [
      '....o....',
      '...oyo...',
      '...oyo...',
      'ooooyoooo',
      'oyyyyyyyo',
      '.oyyYyyo.',
      '..oyyyo..',
      '.oyyoyyo.',
      '.ooo.ooo.',
    ], { o: DARK, y: '#ffd84a', Y: '#fff3a0' }, 4, 4);
  }
  return icon('star', [
    '..o..',
    '.oyo.',
    'oyyyo',
    '.oyo.',
    'o.o.o',
  ], { o: DARK, y: '#ffd84a' }, 2, 2);
}

export function crownIcon(): Sprite {
  return icon('crown', [
    'o.o.o.o',
    'oyoyoyo',
    'oyyryyo',
    'oyyyyyo',
    'ooooooo',
  ], { o: DARK, y: '#ffd84a', r: '#e8413a' }, 3, 4);
}

/** 小队队员头顶的小箭头 */
export function chevronIcon(): Sprite {
  return icon('chevron', [
    'o...o',
    'oyoyo',
    '.oyo.',
    '..o..',
  ], { o: DARK, y: '#ffd84a' }, 2, 3);
}

export function crossIcon(on: boolean): Sprite {
  return icon(`cross/${on}`, [
    '..ooo..',
    '..ogo..',
    'oooGooo',
    'oGGGGGo',
    'ooogooo',
    '..ogo..',
    '..ooo..',
  ], on ? { o: '#0f4a1c', g: '#5fe36f', G: '#8cf59a' } : { o: '#3c3c3c', g: '#cfd3cf', G: '#e4e7e4' }, 3, 3);
}

export function plusIcon(): Sprite {
  return icon('plus', [
    '.ooo.',
    'oogoo',
    'ogggo',
    'oogoo',
    '.ooo.',
  ], { o: '#0f4a1c', g: '#5fe36f' }, 2, 2);
}

/** 下课铃：一口金色小铃铛 */
export function bellIcon(): Sprite {
  return icon('bell', [
    '....oo....',
    '...oyyo...',
    '..oyYyyo..',
    '..oyYyyo..',
    '.oyYyyyyo.',
    '.oyyyyyyo.',
    'oyyyyyyyyo',
    'oooooooooo',
    '....oo....',
  ], { o: DARK, y: '#ffcf3a', Y: '#fff3a0' }, 5, 9);
}

/** 攻击目标箭头 */
export function arrowIcon(): Sprite {
  return icon('arrow', [
    'ooooooo',
    'orrrrro',
    '.orrro.',
    '..oro..',
    '...o...',
  ], { o: '#ffffff', r: '#ff4a3d' }, 3, 4);
}

const WALLS: [string, string][] = [
  ['#e9e4d8', '#cfc8b8'], // 人族：原版教学楼
  ['#9a6638', '#7a4d27'], // 兽人：木屋
  ['#b2b5b9', '#8f9398'], // 矮人：石堡
  ['#f6f3ec', '#dcd8ce'], // 精灵：白墙
];

/** 两面墙（左墙向右下、右墙向右上） */
function walls(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number, hgt: number, l: string, r: string): void {
  ctx.strokeStyle = 'rgba(20,14,12,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.lineTo(cx, cy + d);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.lineTo(cx - w, cy - hgt);
  ctx.closePath();
  ctx.fillStyle = l;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + d);
  ctx.lineTo(cx + w, cy);
  ctx.lineTo(cx + w, cy - hgt);
  ctx.lineTo(cx, cy + d - hgt);
  ctx.closePath();
  ctx.fillStyle = r;
  ctx.fill();
  ctx.stroke();
}

/** 墙面上沿等距方向的一条线（k 从 0 到 1 横穿墙面，h 为离地高度） */
function wallLine(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number, h: number, left: boolean): void {
  if (left) {
    ctx.moveTo(cx - w, cy - h);
    ctx.lineTo(cx, cy + d - h);
  } else {
    ctx.moveTo(cx, cy + d - h);
    ctx.lineTo(cx + w, cy - h);
  }
}

/** 校舍主体（不含旗子、烟）：原点为地基中心；返回旗杆底部的高度 */
function schoolBody(ctx: CanvasRenderingContext2D, col: number, state: SchoolState): number {
  const c = FACTION[col];
  const w = SCHOOL_W;
  const d = SCHOOL_D;
  const hgt = col === 3 ? SCHOOL_H + 2 : col === 2 ? SCHOOL_H - 2 : SCHOOL_H;
  const cx = 0;
  const cy = 0;
  const grey = state !== 'ok';
  const tone = (v: string) => (grey ? mix(v, '#8d9196', 0.6) : v);
  const [wl, wr] = WALLS[col];
  const roof = state === 'dead' ? '#777b80' : state === 'fallen' ? mix(c.ui, '#666666', 0.55) : c.ui;
  walls(ctx, cx, cy, w, d, hgt, tone(wl), tone(wr));

  // 墙面细节
  ctx.save();
  if (col === 1) {
    // 木板缝
    ctx.strokeStyle = 'rgba(40,20,5,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let h = 6; h < hgt; h += 6) {
      wallLine(ctx, cx, cy, w, d, h, true);
      wallLine(ctx, cx, cy, w, d, h, false);
    }
    ctx.stroke();
  } else if (col === 2) {
    // 石块
    ctx.strokeStyle = 'rgba(40,40,48,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let h = 6; h < hgt; h += 6) {
      wallLine(ctx, cx, cy, w, d, h, true);
      wallLine(ctx, cx, cy, w, d, h, false);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 窗户
  ctx.fillStyle = grey ? '#5d6166' : col === 1 ? '#2a1a0e' : col === 3 ? '#7fe0c8' : '#5d86b8';
  const rows = col === 2 ? 1 : 2;
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < 3; i++) {
      const k = (i + 0.5) / 3;
      const wy = -hgt + 6 + row * 9 + (col === 2 ? 5 : 0);
      win(ctx, cx - w + w * k, cy + d * k + wy, -1, col === 3);
      win(ctx, cx + w * k, cy + d - d * k + wy, 1, col === 3);
    }
  }

  const ry = cy - hgt;
  let apexY = ry - 13;
  if (col === 2) {
    apexY = flatRoof(ctx, cx, ry, w, d, tone('#a1a5ab'), roof);
  } else {
    const rise = col === 3 ? 38 : col === 1 ? 17 : 13;
    apexY = ry - rise;
    hipRoof(ctx, cx, ry, w, d, apexY, roof, col === 1 ? 4 : 2);
    if (col === 1) {
      // 兽人：屋脊两端的獠牙
      ctx.strokeStyle = 'rgba(20,14,12,0.9)';
      ctx.lineWidth = 1;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * 2, apexY + 2);
        ctx.quadraticCurveTo(cx + sx * 9, apexY - 1, cx + sx * 8, apexY - 9);
        ctx.quadraticCurveTo(cx + sx * 6, apexY - 2, cx + sx * 1, apexY + 4);
        ctx.closePath();
        ctx.fillStyle = '#f3ecd6';
        ctx.fill();
        ctx.stroke();
      }
    } else if (col === 3) {
      // 精灵：墙上的藤蔓
      ctx.fillStyle = grey ? '#7a8a7a' : '#4fae5a';
      for (let i = 0; i < 9; i++) {
        const k = (i + 0.5) / 9;
        const yy = ry + 2 + Math.sin(i * 1.7) * 2.5;
        ctx.beginPath();
        ctx.arc(cx - w + w * k, yy + d * k, 2, 0, Math.PI * 2);
        ctx.arc(cx + w * k, yy + d - d * k, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return apexY;
}

/** 四坡屋顶（人族、兽人）；顶点更高就是精灵的尖塔 */
function hipRoof(ctx: CanvasRenderingContext2D, cx: number, ry: number, w: number, d: number, apexY: number, roof: string, eave: number): void {
  ctx.strokeStyle = 'rgba(20,14,12,0.85)';
  ctx.lineWidth = 1.2;
  ctx.fillStyle = mix(roof, '#000000', 0.25);
  ctx.beginPath();
  ctx.moveTo(cx - w - eave, ry);
  ctx.lineTo(cx, ry - d - 1);
  ctx.lineTo(cx + w + eave, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w - eave, ry);
  ctx.lineTo(cx, ry + d + 1);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, ry + d + 1);
  ctx.lineTo(cx + w + eave, ry);
  ctx.lineTo(cx, apexY);
  ctx.closePath();
  ctx.fillStyle = mix(roof, '#000000', 0.15);
  ctx.fill();
  ctx.stroke();
}

/** 矮人石堡：平顶加城垛，一侧有冒烟的烟囱，正面挂阵营色的长幡；返回旗杆底部的高度 */
function flatRoof(ctx: CanvasRenderingContext2D, cx: number, ry: number, w: number, d: number, stone: string, banner: string): number {
  diamond(ctx, cx, ry, w, d);
  ctx.fillStyle = mix(stone, '#000000', 0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,12,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 城垛：沿两条前沿的一排小方块
  ctx.fillStyle = stone;
  for (let i = 0; i <= 6; i++) {
    const k = i / 6;
    for (const [x, y] of [[cx - w + w * k, ry + d * k], [cx + w * k, ry + d - d * k]]) {
      ctx.beginPath();
      ctx.rect(x - 2, y - 4, 4, 4);
      ctx.fill();
      ctx.stroke();
    }
  }
  // 烟囱
  ctx.fillStyle = '#7d6a5a';
  ctx.beginPath();
  ctx.rect(CHIMNEY[0] - 3, CHIMNEY[1] - 12, 6, 12);
  ctx.fill();
  ctx.stroke();
  // 正面长幡
  const bx = cx - w * 0.5;
  const by = ry + d * 0.5;
  ctx.beginPath();
  ctx.moveTo(bx - 4, by + 1);
  ctx.lineTo(bx + 4, by + 5);
  ctx.lineTo(bx + 4, by + 15);
  ctx.lineTo(bx, by + 11);
  ctx.lineTo(bx - 4, by + 11);
  ctx.closePath();
  ctx.fillStyle = banner;
  ctx.fill();
  ctx.stroke();
  return ry - d * 0.15 - 3;
}

/** 墙面上的平行四边形小窗；side < 0 为左墙（向右下倾斜），否则为右墙；arch 为精灵的拱形窗 */
function win(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, arch = false): void {
  const slope = side < 0 ? 0.5 : -0.5;
  ctx.beginPath();
  ctx.moveTo(x - 2.5, y - 2.5 * slope);
  if (arch) ctx.quadraticCurveTo(x, y - 4, x + 2.5, y + 2.5 * slope);
  else ctx.lineTo(x + 2.5, y + 2.5 * slope);
  ctx.lineTo(x + 2.5, y + 2.5 * slope + 4);
  ctx.lineTo(x - 2.5, y - 2.5 * slope + 4);
  ctx.closePath();
  ctx.fill();
}
