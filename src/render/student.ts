// 学生角色的矢量绘制。姿势编号沿用原版 pat：
// 0–9 走路循环、10–12 站立、13–15 蹲坐、16 备战、17 蓄力、18 出拳中、19 出拳、20 受击、21–22 倒下、23 躺倒、24 躺倒（闪烁）
// 方向：0 右下、1 左下、2 左上、3 右上。坐标原点在脚下，单位为世界像素。
import { FACTION, HAIR, HAIR_DARK, HAIR_LIGHT, OUTLINE, SKIN, SKIN_DARK } from './palette.ts';

type P = [number, number];

interface Pose {
  lean: number;
  drop: number;
  nearLeg: [P, P, P];
  farLeg: [P, P, P];
  nearArm: [P, P];
  farArm: [P, P];
  headTilt: number;
  squat: boolean;
  lying: boolean;
  alpha: number;
}

function pose(pat: number): Pose {
  const base: Pose = {
    lean: 0,
    drop: 0,
    nearLeg: [[-2, -11], [-2.5, -5], [-3, 0]],
    farLeg: [[2, -11], [2.5, -5], [3, 0]],
    nearArm: [[-7, -17], [-4.5, -12.5]],
    farArm: [[7, -17], [4.5, -12.5]],
    headTilt: 0,
    squat: false,
    lying: false,
    alpha: 1,
  };
  if (pat >= 0 && pat <= 9) {
    const ph = (pat / 10) * Math.PI * 2;
    const s = Math.sin(ph);
    const lift = (v: number) => -Math.max(0, v) * 2;
    base.drop = -Math.abs(Math.cos(ph)) * 0.8;
    base.nearLeg = [[-2, -11], [-2 + 2.5 * s, -5.5 + lift(Math.cos(ph)) * 0.5], [-2 + 4.5 * s, lift(Math.cos(ph))]];
    base.farLeg = [[2, -11], [2 - 2.5 * s, -5.5 + lift(-Math.cos(ph)) * 0.5], [2 - 4.5 * s, lift(-Math.cos(ph))]];
    base.nearArm = [[-5 - 2 * s, -17], [-4 - 4 * s, -12.5]];
    base.farArm = [[5 + 2 * s, -17], [4 + 4 * s, -12.5]];
    base.lean = 0.04;
    return base;
  }
  switch (pat) {
    case 13:
    case 14:
    case 15: {
      // 不良蹲
      base.squat = true;
      base.drop = 7;
      base.lean = 0.08;
      base.nearLeg = [[-3, -6], [4, -9], [2, 0]];
      base.farLeg = [[1, -6], [8, -8], [7, 0]];
      base.nearArm = [[4, -12], [8, -10]];
      base.farArm = [[8, -12], [11, -10]];
      if (pat === 14) {
        base.nearArm = [[4, -12], [4, -19]];
        base.headTilt = 0.12;
      }
      if (pat === 15) {
        base.headTilt = -0.15;
        base.farArm = [[7, -13], [5, -15]];
      }
      return base;
    }
    case 16:
      base.nearLeg = [[-2, -11], [-4, -5], [-5, 0]];
      base.farLeg = [[2, -11], [4, -5], [5, 0]];
      base.nearArm = [[1, -15], [5, -20]];
      base.farArm = [[4, -17], [7, -22]];
      return base;
    case 17:
      base.nearLeg = [[-2, -11], [-4, -5], [-5, 0]];
      base.farLeg = [[2, -11], [4, -5], [5, 0]];
      base.lean = -0.06;
      base.nearArm = [[-6, -15], [-3, -19]];
      base.farArm = [[4, -17], [7, -22]];
      return base;
    case 18:
      base.nearLeg = [[-2, -11], [-4, -5], [-5, 0]];
      base.farLeg = [[2, -11], [5, -5], [6, 0]];
      base.lean = 0.05;
      base.nearArm = [[3, -18], [8, -20]];
      base.farArm = [[3, -17], [5, -21]];
      return base;
    case 19:
      base.nearLeg = [[-2, -11], [-5, -5], [-6, 0]];
      base.farLeg = [[2, -11], [5, -5], [7, 0]];
      base.lean = 0.14;
      base.nearArm = [[7, -21], [13, -21]];
      base.farArm = [[1, -17], [3, -20]];
      return base;
    case 20:
      base.lean = -0.28;
      base.headTilt = -0.3;
      base.nearArm = [[-8, -21], [-7, -26]];
      base.farArm = [[8, -22], [8, -27]];
      return base;
    case 21:
      base.lean = -0.65;
      base.headTilt = -0.2;
      base.nearArm = [[-8, -21], [-9, -25]];
      base.farArm = [[8, -22], [9, -26]];
      return base;
    case 22:
      base.lean = -1.15;
      base.nearArm = [[-8, -20], [-11, -22]];
      base.farArm = [[8, -21], [11, -23]];
      return base;
    case 23:
    case 24:
      base.lying = true;
      base.nearArm = [[-8, -19], [-11, -20]];
      base.farArm = [[8, -20], [11, -21]];
      base.alpha = pat === 24 ? 0.35 : 1;
      return base;
    default:
      // 10–12 站立：双手插兜
      base.nearArm = [[-7, -16], [-4.5, -12.5]];
      base.farArm = [[7, -16], [4.5, -12.5]];
      return base;
  }
}

function limb(ctx: CanvasRenderingContext2D, pts: P[], width: number, color: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 1.4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient, outline = true): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

/** 体型反映属性：金刚壮、紫电精瘦、绿林矮小 */
const BODY: [number, number][] = [
  [1, 1],
  [0.9, 0.9],
  [1.13, 1.05],
  [0.9, 1.05],
];

/** 画一个学生。(x, y) 是脚下位置；flash 为受击闪白强度 0–1 */
export function drawStudent(ctx: CanvasRenderingContext2D, x: number, y: number, col: number, dir: number, pat: number, flash = 0): void {
  const c = FACTION[col] ?? FACTION[0];
  const ps = pose(pat);
  const back = dir === 2 || dir === 3;
  const mirror = dir === 1 || dir === 2;

  ctx.save();
  ctx.translate(x, y);
  const [sx, sy] = BODY[col] ?? BODY[0];
  ctx.scale(sx, sy);
  if (flash > 0) ctx.filter = `brightness(${1 + flash * 1.6})`;

  // 影子（不随身体旋转）
  ctx.globalAlpha = 0.28 * ps.alpha;
  ctx.beginPath();
  ctx.ellipse(ps.lying ? 2 : 0, 0, ps.lying ? 15 : 9, ps.lying ? 5 : 3.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalAlpha = ps.alpha;

  if (mirror) ctx.scale(-1, 1);
  if (ps.lying) {
    ctx.translate(15, -1);
    ctx.scale(1, 0.75);
    ctx.rotate(-Math.PI / 2 + 0.05);
  } else {
    ctx.rotate(ps.lean);
  }
  const d = ps.drop;

  // 远侧手脚
  limb(ctx, ps.farLeg.map(([px, py]) => [px, py + (ps.squat ? 0 : d * (py < -3 ? 1 : 0))] as P), 4.6, c.dark);
  shoe(ctx, ps.farLeg[2]);
  arm(ctx, [5.5, -22 + d], ps.farArm, c, 1);

  // 腿
  limb(ctx, ps.nearLeg.map(([px, py]) => [px, py + (ps.squat ? 0 : d * (py < -3 ? 1 : 0))] as P), 4.8, c.dark);
  shoe(ctx, ps.nearLeg[2]);

  // 长款立领学生服
  const hem = ps.squat ? -2 : -7.5;
  const g = ctx.createLinearGradient(-8, 0, 8, 0);
  g.addColorStop(0, back ? c.coat : c.light);
  g.addColorStop(0.55, c.coat);
  g.addColorStop(1, c.dark);
  ctx.beginPath();
  ctx.moveTo(-5.5, -24.5 + d);
  ctx.quadraticCurveTo(0, -26 + d, 5.5, -24.5 + d);
  ctx.lineTo(7.5 + (ps.squat ? 3 : 0), hem);
  ctx.quadraticCurveTo(0, hem + 1.5, -7.5 - (ps.squat ? 2 : 0), hem);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  if (!back) {
    // 门襟和纽扣
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(2.2, -23.5 + d);
    ctx.lineTo(2.6, hem + 0.5);
    ctx.stroke();
    for (let i = 0; i < 4; i++) circle(ctx, 3.4, -21.5 + d + i * 3.3, 0.75, c.button, false);
  } else {
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -20 + d);
    ctx.lineTo(0, hem + 0.5);
    ctx.stroke();
  }
  // 立领
  ctx.fillStyle = c.dark;
  ctx.fillRect(-3, -27 + d, 6.5, 3);

  // 头
  ctx.save();
  ctx.translate(1, -31 + d);
  ctx.rotate(ps.headTilt);
  drawHead(ctx, back);
  ctx.restore();

  // 近侧手臂
  arm(ctx, [-4.5, -22 + d], ps.nearArm, c, 0);

  ctx.restore();
}

function arm(ctx: CanvasRenderingContext2D, shoulder: P, a: [P, P], c: (typeof FACTION)[number], far: number): void {
  limb(ctx, [shoulder, a[0], a[1]], 4.2, far ? c.dark : c.coat);
  circle(ctx, a[1][0], a[1][1], 1.9, SKIN);
}

function shoe(ctx: CanvasRenderingContext2D, foot: P): void {
  ctx.beginPath();
  ctx.ellipse(foot[0] + 1.2, foot[1] - 0.6, 2.8, 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1a1f';
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, back: boolean): void {
  const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 8);
  g.addColorStop(0, SKIN);
  g.addColorStop(1, SKIN_DARK);
  circle(ctx, 0, 0, 7, back ? HAIR : g);
  if (back) {
    // 后脑勺被头发盖住，顶上是飞机头的脊
    ctx.beginPath();
    ctx.ellipse(1.5, -5.5, 7.5, 3.6, -0.15, 0, Math.PI * 2);
    ctx.fillStyle = HAIR_LIGHT;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.strokeStyle = HAIR_DARK;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0.6, 2.4);
    ctx.stroke();
    return;
  }
  // 后脑和鬓角
  ctx.beginPath();
  ctx.moveTo(-6.8, 2);
  ctx.quadraticCurveTo(-8.5, -6, -2, -7.2);
  ctx.lineTo(1, -6);
  ctx.quadraticCurveTo(-3, -2, -3.5, 3);
  ctx.closePath();
  ctx.fillStyle = HAIR;
  ctx.fill();
  // 飞机头
  ctx.beginPath();
  ctx.moveTo(-6, -3.5);
  ctx.quadraticCurveTo(-5.5, -14, 3.5, -13.5);
  ctx.quadraticCurveTo(12.5, -13, 12.5, -7.5);
  ctx.quadraticCurveTo(12, -5.2, 9.5, -5.6);
  ctx.quadraticCurveTo(6, -6.4, 3.5, -4);
  ctx.quadraticCurveTo(-1, -5.2, -6, -3.5);
  ctx.closePath();
  const hg = ctx.createLinearGradient(0, -14, 0, -4);
  hg.addColorStop(0, HAIR_LIGHT);
  hg.addColorStop(1, HAIR);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 发丝高光
  ctx.strokeStyle = 'rgba(255,200,170,0.7)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-2.5, -10.5);
  ctx.quadraticCurveTo(4, -12.8, 10, -9.5);
  ctx.stroke();
  // 眉眼
  ctx.strokeStyle = '#2a1712';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1.2, -3.2);
  ctx.lineTo(3.4, -2.3);
  ctx.moveTo(4.6, -2.3);
  ctx.lineTo(6.4, -3.1);
  ctx.stroke();
  ctx.fillStyle = '#2a1712';
  ctx.fillRect(2.3, -1.4, 1, 1.5);
  ctx.fillRect(5, -1.4, 0.9, 1.5);
  // 嘴
  ctx.beginPath();
  ctx.moveTo(3, 3.2);
  ctx.lineTo(5.2, 2.8);
  ctx.stroke();
}
