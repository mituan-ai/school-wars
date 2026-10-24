// 像素学生：沿用矢量版的骨架（student.ts 的 pose），直接在像素网格上画四肢和校服，头部是手绘的像素图。
// 头身比放大成 Q 版；四个方向只画"朝右下"和"朝右上"两套，另两个方向左右镜像。
import { FACTION } from './palette.ts';
import { pixelate, rgb, SpriteCache, type Sprite } from './pixel.ts';
import { RACE, pose, type P } from './student.ts';

/** 骨架（世界单位）到像素的缩放 */
const K = 0.55;
const BW = 44;
const BH = 46;
/** 脚下在缓冲区里的位置 */
const OX = 22;
const OY = 38;

class Buf {
  data = new Uint32Array(BW * BH);
  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= BW || y >= BH) return;
    this.data[y * BW + x] = c;
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= BW || y >= BH) return 0;
    return this.data[y * BW + x];
  }
  /** 粗线：沿线段逐点盖 w×w 的方块 */
  line(a: P, b: P, w: number, c: number): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n;
      const y = a[1] + ((b[1] - a[1]) * i) / n;
      const x0 = Math.round(x - w / 2);
      const y0 = Math.round(y - w / 2);
      for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) this.set(x0 + dx, y0 + dy, c);
    }
  }
  /** 扫描线填充多边形（按像素中心取样）；返回每行的 [行, 左, 右] */
  poly(pts: P[], c: number): [number, number, number][] {
    const rows: [number, number, number][] = [];
    const ys = pts.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const l = Math.ceil(xs[i] - 0.5);
        const r = Math.floor(xs[i + 1] - 0.5);
        if (r < l) continue;
        for (let x = l; x <= r; x++) this.set(x, y, c);
        rows.push([y, l, r]);
      }
    }
    return rows;
  }
  /** 贴像素图：grid 的 (ax, ay) 对准 (x, y)；flip 左右翻转 */
  stamp(grid: string[], pal: Record<string, number>, x: number, y: number, ax: number, ay: number): void {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      for (let k = 0; k < row.length; k++) {
        const c = pal[row[k]];
        if (c) this.set(x - ax + k, y - ay + r, c);
      }
    }
  }
}

/** '#rrggbb' → 画布像素（小端 ABGR） */
function px(c: string): number {
  const [r, g, b] = rgb(c);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function shade(c: string, k: number): string {
  const [r, g, b] = rgb(c);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---- 头部像素图（朝右下 / 朝右上，锚点为脖子：第 5 列、最后一行之下） ----
// o 深色描线  s 皮肤  S 皮肤暗部  e 眼睛  w 白  m 嘴  h 头发  H 头发暗部  L 头发高光
// 矮人：g 头盔亮  G 头盔暗  y 头灯  b 胡子  B 胡子暗  n 鼻子

const HEAD_FRONT: string[][] = [
  // 人族：红色飞机头
  [
    '....LLLLL....',
    '..LLhhhhhLL..',
    '.hhhhhhhhhhhL',
    '.Hhhhhhhhhhhh',
    '.HHhhhhhhhhh.',
    '.HHssssssshh.',
    '.HSsssessse..',
    '.HSsssessse..',
    '.SSsssssssS..',
    '..Sssssssm...',
    '...SSssssS...',
    '....SSSSS....',
  ],
  // 兽人：黑色鸡冠头、橄榄色皮肤、红眼、獠牙
  [
    '.....oooo....',
    '....ooooo....',
    '...ooooo.....',
    '..sssooosss..',
    '.Sssssssssss.',
    'SSssssssssss.',
    '.Ssssoosoos..',
    '.SssssrssrS..',
    '.SSssssssssss',
    '..Sswssssws..',
    '..SSwSSSSwS..',
    '...SSSSSSS...',
  ],
  // 矮人：钢盔、头灯、大胡子
  [
    '....ggggg....',
    '..ggggggggy..',
    '.gggggggggyy.',
    '.GGGGGGGGGGy.',
    '.GSssssssssG.',
    '.SsssesssesS.',
    '.Sssssssnnss.',
    '.bbssssnnnbb.',
    '.bbbbbbbbbbb.',
    '..bbBbbbbbb..',
    '..bbbBbbBbb..',
    '...bbbbbbb...',
    '....bBbbb....',
  ],
  // 精灵：银白长发、尖耳、紫色大眼
  [
    '....LLLLL....',
    '..LLhhhhhLL..',
    '.Hhhhhhhhhhh.',
    '.Hhhhhhhhhhhh',
    'SHHhhsshhshh.',
    'sSHssssssssh.',
    '.SHssweswesh.',
    '.HHssseesees.',
    '.HHsssssssh..',
    '.HHHsssssm...',
    '.HHHHSSSSS...',
    '..HHH........',
    '..HH.........',
  ],
];

const HEAD_BACK: string[][] = [
  [
    '....LLLLL....',
    '..LLhhhhhLL..',
    '.hhhhhhhhhhh.',
    '.hhhhhhhhhhhL',
    '.Hhhhhhhhhhhh',
    '.HHhhhhhhhhh.',
    '.HHHhhhhhhhh.',
    '.HHHHhhhhhhh.',
    '.SHHHHhhhhhS.',
    '..SHHHHHHHS..',
    '...SSSSSSS...',
    '....SSSSS....',
  ],
  [
    '.....oooo....',
    '....ooooo....',
    '...ooooo.....',
    '..sssooosss..',
    '.Sssssoossss.',
    'SSsssssssssS.',
    '.SssssssssS..',
    '.SSssssssss..',
    '.SSSsssssss..',
    '..SSSsssssS..',
    '..SSSSSSSSS..',
    '...SSSSSSS...',
  ],
  [
    '....ggggg....',
    '..gggggggg...',
    '.gggggggggg..',
    '.GGGGGGGGGG..',
    '.GGGGGGGGGG..',
    '.bSSSSSSSSb..',
    '.bSSSSSSSSb..',
    '.bbSSSSSSbbb.',
    '.bbbSSSSbbbb.',
    '..bbb..bbbb..',
    '..bb....bb...',
  ],
  [
    '....LLLLL....',
    '..LLhhhhhLL..',
    '.hhhhhhhhhhh.',
    '.hhhhhhhhhhhh',
    'SHhhhhhhhhhh.',
    'sSHhhhhhhhhhs',
    '.SHHhhhhhhhh.',
    '.HHHhhhhhhhh.',
    '.HHHHhhhhhhh.',
    '.HHHHHhhhhhh.',
    '..HHHHHhhhH..',
    '..HHHHHHHH...',
    '...HHHHHH....',
  ],
];

interface RacePal {
  hair: string;
  hairDark: string;
  hairLight: string;
}

const RACE_PAL: RacePal[] = [
  { hair: '#d23b2c', hairDark: '#8a1f18', hairLight: '#f27a52' },
  { hair: '#1f1b1b', hairDark: '#1f1b1b', hairLight: '#1f1b1b' },
  { hair: '#8f4a22', hairDark: '#5e2c12', hairLight: '#8f4a22' },
  { hair: '#e4e2f2', hairDark: '#a7a3c8', hairLight: '#ffffff' },
];

function headPal(col: number): Record<string, number> {
  const race = RACE[col];
  const rp = RACE_PAL[col];
  return {
    o: px('#1f1b1b'),
    s: px(race.skin),
    S: px(race.skinDark),
    e: px(col === 3 ? '#3b2a6b' : '#2a1712'),
    r: px('#d81e1e'),
    w: px('#fffbe8'),
    m: px('#8a3a2c'),
    h: px(rp.hair),
    H: px(rp.hairDark),
    L: px(rp.hairLight),
    g: px('#d5dade'),
    G: px('#6a7079'),
    y: px('#ffe680'),
    b: px('#8f4a22'),
    B: px('#5e2c12'),
    n: px(race.skinDark),
  };
}

const OUTLINE = '#1c1418';

/** 朝右（不镜像）画一帧，返回缓冲区 */
function paint(col: number, back: boolean, pat: number): Buf {
  const b = new Buf();
  const c = FACTION[col] ?? FACTION[0];
  const race = RACE[col] ?? RACE[0];
  const ps = pose(pat);
  const [sx, sy] = race.body;
  const d = ps.drop;
  const at = (p: P): P => [OX + p[0] * K * sx, OY + p[1] * K * sy];
  const legPt = (p: P): P => at([p[0], p[1] + (ps.squat ? 0 : d * (p[1] < -3 ? 1 : 0))]);
  const trousers = px(shade(c.dark, -0.15));
  const shoe = px('#1b1a1f');
  const coat = px(c.coat);
  const skin = px(race.skin);

  const leg = (pts: [P, P, P], col2: number) => {
    const q = pts.map(legPt);
    b.line(q[0], q[1], 2, col2);
    b.line(q[1], q[2], 2, col2);
    b.line([q[2][0] + 0.5, q[2][1]], [q[2][0] + 1.5, q[2][1]], 1.4, shoe);
  };
  const arm = (shoulder: P, a: [P, P], sleeve: number) => {
    const s = at(shoulder);
    const e = at(a[0]);
    const h = at(a[1]);
    b.line(s, e, 2, sleeve);
    b.line(e, h, 2, sleeve);
    b.set(h[0], h[1], skin);
  };

  // 远侧手脚
  leg(ps.farLeg, px(shade(c.dark, -0.3)));
  arm([5.5, -22 + d], ps.farArm, px(c.dark));
  // 近侧腿
  leg(ps.nearLeg, trousers);

  // 长款立领学生服
  const hem = ps.squat ? -2 : -7.5;
  const rows = b.poly(
    [at([-5.5, -25 + d]), at([5.5, -25 + d]), at([7.5 + (ps.squat ? 3 : 0), hem]), at([-7.5 - (ps.squat ? 2 : 0), hem])],
    coat,
  );
  const light = px(back ? c.coat : c.light);
  const dark = px(c.dark);
  let top = Infinity;
  for (const [y, l, r] of rows) {
    top = Math.min(top, y);
    b.set(l, y, light);
    b.set(r, y, dark);
    if (r - l > 4) b.set(r - 1, y, dark);
  }
  // 门襟与纽扣（正面），背缝（背面）
  const midX = Math.round(OX + (back ? 0 : 2) * K * sx);
  for (const [y, l, r] of rows) {
    if (y <= top || midX < l || midX > r) continue;
    if (!back && (y - top) % 2 === 1) b.set(midX + 1, y, px(c.button));
    else if (back) b.set(midX, y, dark);
  }
  // 立领
  const neck = at([1, -26 + d]);
  b.line([neck[0] - 2, neck[1]], [neck[0] + 1, neck[1]], 1.5, dark);

  // 头
  const grid = (back ? HEAD_BACK : HEAD_FRONT)[col] ?? HEAD_FRONT[0];
  b.stamp(grid, headPal(col), Math.round(neck[0]), Math.round(neck[1]), 6, grid.length);

  // 近侧手臂（站立时插兜：手藏在衣服里）
  arm([-4.5, -22 + d], ps.nearArm, px(shade(c.coat, back ? -0.1 : 0.12)));
  return b;
}

/** 绕脚下倾斜：小角度按行错位（像素画常见做法），大角度整体旋转（最近邻取样） */
function tilt(src: Buf, angle: number, lying: boolean): Buf {
  if (Math.abs(angle) < 0.03 && !lying) return src;
  const out = new Buf();
  if (!lying && Math.abs(angle) < 0.2) {
    for (let y = 0; y < BH; y++) {
      const shift = Math.round((OY - y) * Math.sin(angle) * 0.9);
      for (let x = 0; x < BW; x++) {
        const v = src.get(x - shift, y);
        if (v) out.set(x, y, v);
      }
    }
    return out;
  }
  // 躺倒：转 90° 并压扁，身体朝后摊在地上
  const a = lying ? -Math.PI / 2 + 0.05 : angle;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const sq = lying ? 0.75 : 1;
  const cx = OX + (lying ? 8 : 0);
  const cy = OY - (lying ? 1 : 0);
  for (let y = 0; y < BH; y++) {
    for (let x = 0; x < BW; x++) {
      // 目标像素 → 原图：先撤销压扁再反向旋转
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) / sq;
      const ux = cs * dx + sn * dy;
      const uy = -sn * dx + cs * dy;
      const v = src.get(Math.floor(OX + ux), Math.floor(OY + uy));
      if (v) out.set(x, y, v);
    }
  }
  return out;
}

const cache = new SpriteCache();

export interface StudentFrameOpts {
  flash?: boolean;
  outline?: string;
}

/** 一帧学生像素精灵（锚点在脚下） */
export function studentSprite(col: number, dir: number, pat: number, opts: StudentFrameOpts = {}): Sprite {
  const key = `${col}/${dir}/${pat}/${opts.flash ? 1 : 0}/${opts.outline ?? ''}`;
  return cache.get(key, () => {
    const back = dir === 2 || dir === 3;
    const mirror = dir === 1 || dir === 2;
    const ps = pose(pat);
    let buf = paint(col, back, pat);
    buf = tilt(buf, ps.lean + (ps.squat ? 0 : (RACE[col] ?? RACE[0]).hunch), ps.lying);
    const canvas = document.createElement('canvas');
    canvas.width = BW;
    canvas.height = BH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.createImageData(BW, BH);
    const out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) out[y * BW + (mirror ? BW - 1 - x : x)] = buf.data[y * BW + x];
    }
    pixelate(img, { outline: opts.outline ?? OUTLINE, flash: opts.flash, colors: 0 });
    if (ps.alpha < 1) for (let i = 3; i < img.data.length; i += 4) img.data[i] = Math.round(img.data[i] * ps.alpha);
    ctx.putImageData(img, 0, 0);
    return { canvas, ax: mirror ? BW - 1 - OX : OX, ay: OY };
  });
}
