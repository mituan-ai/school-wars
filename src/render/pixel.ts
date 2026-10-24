// 像素风（docs/06 §7）：世界先画到一张低分辨率的"美术画布"（1 美术像素 = 2 世界单位），再放大到屏幕。
// 角色、帐篷、校舍等立体物件由矢量图形烘焙成像素精灵：硬边透明、颜色收拢到少数几种、外加 1 像素描边。

/** 每个世界单位对应的美术像素数 */
export const ART = 0.5;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** 锚点（脚下 / 中心）在精灵里的像素坐标 */
  ax: number;
  ay: number;
}

export interface BakeOpts {
  /** 描边颜色；null 表示不描边 */
  outline?: string | null;
  /** 受击闪白：颜色向白色靠拢 */
  flash?: boolean;
  /** 整体压暗（迷雾里记住的样子） */
  dim?: number;
  /** 最多保留几种颜色 */
  colors?: number;
}

/** 世界坐标包围盒 (x0, y0)–(x1, y1)，原点为锚点；draw 在世界单位下以锚点为原点作画 */
export function bake(
  x0: number, y0: number, x1: number, y1: number, draw: (ctx: CanvasRenderingContext2D) => void, opts: BakeOpts = {},
): Sprite {
  const pad = 1;
  const ax = Math.ceil(-x0 * ART) + pad;
  const ay = Math.ceil(-y0 * ART) + pad;
  const w = ax + Math.ceil(x1 * ART) + pad;
  const h = ay + Math.ceil(y1 * ART) + pad;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(ax, ay);
  ctx.scale(ART, ART);
  draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  pixelate(img, opts);
  ctx.putImageData(img, 0, 0);
  return { canvas, ax, ay };
}

/** 硬边 → 颜色收拢 → 描边 */
export function pixelate(img: ImageData, opts: BakeOpts = {}): void {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] >= 110) {
      solid[i] = 1;
      d[i * 4 + 3] = 255;
    } else {
      d[i * 4 + 3] = 0;
    }
  }
  quantize(d, solid, opts.colors ?? 14);
  if (opts.flash || opts.dim) {
    for (let i = 0; i < n; i++) {
      if (!solid[i]) continue;
      for (let c = 0; c < 3; c++) {
        let v = d[i * 4 + c];
        if (opts.flash) v = v + (255 - v) * 0.75;
        if (opts.dim) v = v * (1 - opts.dim);
        d[i * 4 + c] = v;
      }
    }
  }
  const ol = opts.outline === undefined ? '#1c1418' : opts.outline;
  if (ol) {
    const [r, g, b] = rgb(ol);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        const edge = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
        if (!edge) continue;
        d[i * 4] = r;
        d[i * 4 + 1] = g;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = 255;
      }
    }
  }
}

/**
 * 把抗锯齿产生的过渡色并到最常见的几种颜色上：先统计（按 4 位精度）出现最多的颜色当调色板，
 * 再把每个像素换成调色板里最近的颜色
 */
function quantize(d: Uint8ClampedArray, solid: Uint8Array, max: number): void {
  const count = new Map<number, number>();
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i]) continue;
    const k = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const pal: [number, number, number][] = [];
  for (const [k] of ranked) {
    if (pal.length >= max) break;
    const c: [number, number, number] = [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
    // 和已选颜色太接近的不再单独占一个位置
    if (pal.some((p) => dist2(p, c) < 300)) continue;
    pal.push(c);
  }
  if (pal.length === 0) return;
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i]) continue;
    const c: [number, number, number] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    let best = pal[0];
    let bd = Infinity;
    for (const p of pal) {
      const dd = dist2(p, c);
      if (dd < bd) {
        bd = dd;
        best = p;
      }
    }
    d[i * 4] = best[0];
    d[i * 4 + 1] = best[1];
    d[i * 4 + 2] = best[2];
  }
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  // 按人眼敏感度加权
  return 3 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 2 * (a[2] - b[2]) ** 2;
}

export function rgb(c: string): [number, number, number] {
  if (c.startsWith('rgb')) {
    const m = c.match(/[\d.]+/g) ?? ['0', '0', '0'];
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 精灵按键缓存 */
export class SpriteCache {
  private map = new Map<string, Sprite>();
  get(key: string, make: () => Sprite): Sprite {
    let s = this.map.get(key);
    if (!s) {
      s = make();
      this.map.set(key, s);
    }
    return s;
  }
  clear(): void {
    this.map.clear();
  }
}

/** 在美术画布上（变换为世界坐标 × ART）把精灵的锚点对齐到世界坐标 (wx, wy) 所在的美术像素 */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, wx: number, wy: number): void {
  const px = Math.round(wx * ART) - s.ax;
  const py = Math.round(wy * ART) - s.ay;
  ctx.drawImage(s.canvas, px / ART, py / ART, s.canvas.width / ART, s.canvas.height / ART);
}

/** 对齐美术像素的实心矩形（世界坐标起点，美术像素宽高） */
export function pxRect(ctx: CanvasRenderingContext2D, wx: number, wy: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(wx * ART) / ART, Math.round(wy * ART) / ART, w / ART, h / ART);
}

/** 对齐美术像素的实心菱形（中心世界坐标，半宽半高为世界单位，2:1） */
export function pxDiamond(ctx: CanvasRenderingContext2D, wx: number, wy: number, hw: number, hh: number, color: string): void {
  ctx.fillStyle = color;
  const cx = Math.round(wx * ART);
  const cy = Math.round(wy * ART);
  const H = Math.round(hh * ART);
  const W = Math.round(hw * ART);
  for (let r = -H; r < H; r++) {
    const k = r < 0 ? r + H + 0.5 : H - r - 0.5;
    const half = Math.round((k / H) * W);
    if (half <= 0) continue;
    ctx.fillRect((cx - half) / ART, (cy + r) / ART, (2 * half) / ART, 1 / ART);
  }
}

/** 菱形边框（1 美术像素宽） */
export function pxDiamondEdge(ctx: CanvasRenderingContext2D, wx: number, wy: number, hw: number, hh: number, color: string, dash = 0): void {
  ctx.fillStyle = color;
  const cx = Math.round(wx * ART);
  const cy = Math.round(wy * ART);
  const H = Math.round(hh * ART);
  const W = Math.round(hw * ART);
  for (let r = -H; r < H; r++) {
    const k = r < 0 ? r + H + 0.5 : H - r - 0.5;
    const half = Math.round((k / H) * W);
    const prev = r < 0 ? Math.round(((k - 1) / H) * W) : Math.round(((k + 1) / H) * W);
    const len = Math.max(1, Math.abs(half - Math.max(0, prev)));
    if (dash && Math.floor((r + H) / dash) % 2) continue;
    ctx.fillRect((cx - half) / ART, (cy + r) / ART, len / ART, 1 / ART);
    ctx.fillRect((cx + half - len) / ART, (cy + r) / ART, len / ART, 1 / ART);
  }
}

const texts = new SpriteCache();
let textCount = 0;
let fontFamily = '';

/** 像素字精灵：按 12 像素原生字号写好、去掉半透明边、加 1 像素描边；锚点在基线中点 */
export function textSprite(text: string, color: string, outline: string | null = '#140c10', font = '"Fusion Pixel", sans-serif'): Sprite {
  const ready = typeof document.fonts?.check !== 'function' || document.fonts.check(`12px ${font}`);
  const make = (): Sprite => {
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = `12px ${font}`;
    const w = Math.ceil(probe.measureText(text).width) + 4;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = 17;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.font = `12px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(text, 2, 13);
    const img = ctx.getImageData(0, 0, w, 17);
    // 字的颜色统一成原色（抗锯齿边在 pixelate 里被切掉）
    const [r, g, b] = rgb(color);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
    }
    pixelate(img, { outline, colors: 0 });
    ctx.putImageData(img, 0, 0);
    return { canvas, ax: Math.round(w / 2), ay: 13 };
  };
  if (!ready) return make();
  if (font !== fontFamily) {
    fontFamily = font;
    texts.clear();
  }
  // 倒计时这类会不断出新字的，攒多了清一次
  if (++textCount > 400) {
    textCount = 0;
    texts.clear();
  }
  return texts.get(`${color}|${outline}|${text}`, make);
}
