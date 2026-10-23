// 沿轮廓描边：先把图形画到离屏画布，再把它的剪影染色后向四周错开着画几遍，最后把原图盖在上面。
// 只用于选中 / 悬停的少数几个学生，所以每次现画也不贵。
let spr: HTMLCanvasElement | null = null;
let tint: HTMLCanvasElement | null = null;

function scratch(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const cv = c ?? document.createElement('canvas');
  if (cv.width < w || cv.height < h) {
    cv.width = Math.max(cv.width, w);
    cv.height = Math.max(cv.height, h);
  }
  return cv;
}

/**
 * 把 draw 画出的东西描边后画到 ctx 上。(x, y, w, h) 是图形所在的世界坐标范围；
 * width 是描边粗细，glow 是外发光半径（都以设备像素计）。ctx 当前的变换须只有缩放和平移。
 */
export function drawOutlined(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
  color: string,
  width: number,
  glow: number,
): void {
  const m = ctx.getTransform();
  const pad = Math.ceil(width + glow) + 2;
  const ix = Math.floor(m.a * x + m.e) - pad;
  const iy = Math.floor(m.d * y + m.f) - pad;
  const pw = Math.ceil(w * m.a) + pad * 2 + 1;
  const ph = Math.ceil(h * m.d) + pad * 2 + 1;
  spr = scratch(spr, pw, ph);
  tint = scratch(tint, pw, ph);
  const sc = spr.getContext('2d')!;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.clearRect(0, 0, pw, ph);
  sc.setTransform(m.a, 0, 0, m.d, m.e - ix, m.f - iy);
  draw(sc);
  const tc = tint.getContext('2d')!;
  tc.setTransform(1, 0, 0, 1, 0, 0);
  tc.globalCompositeOperation = 'copy';
  tc.drawImage(spr, 0, 0);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = color;
  tc.fillRect(0, 0, pw, ph);
  tc.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.drawImage(tint, 0, 0, pw, ph, ix, iy, pw, ph);
    ctx.shadowBlur = 0;
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.drawImage(tint, 0, 0, pw, ph, ix + Math.cos(a) * width, iy + Math.sin(a) * width, pw, ph);
  }
  ctx.drawImage(spr, 0, 0, pw, ph, ix, iy, pw, ph);
  ctx.restore();
}
