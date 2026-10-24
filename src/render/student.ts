// 学生角色的矢量绘制。姿势编号沿用原版 pat：
// 0–9 走路循环、10–12 站立、13–15 蹲坐、16 备战、17 蓄力、18 出拳中、19 出拳、20 受击、21–22 倒下、23 躺倒、24 躺倒（闪烁）
// 方向：0 右下、1 左下、2 左上、3 右上。坐标原点在脚下，单位为世界像素。
// 四个种族共用一套骨架和立领校服，区别在体型、肤色和头部（docs/04 §3）。
import { FACTION, HAIR, HAIR_DARK, HAIR_LIGHT, OUTLINE, SKIN, SKIN_DARK } from './palette.ts';

export type P = [number, number];

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

export function pose(pat: number): Pose {
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

/** 种族外形：体型缩放 [宽, 高]、肤色、额外前倾（兽人驼背） */
interface Race {
  body: [number, number];
  skin: string;
  skinDark: string;
  hunch: number;
}

export const RACE: Race[] = [
  { body: [1, 1], skin: SKIN, skinDark: SKIN_DARK, hunch: 0 }, // 人族：原版的飞机头不良少年
  { body: [1.08, 0.97], skin: '#b2c96e', skinDark: '#7c9442', hunch: 0.07 }, // 兽人：橄榄色皮肤，和绿校服区分开
  { body: [1.22, 0.8], skin: '#f2b48c', skinDark: '#c9845c', hunch: 0 }, // 矮人
  { body: [0.86, 1.1], skin: '#fbe3d0', skinDark: '#dcb79c', hunch: -0.02 }, // 精灵
];

/** 影子（不随身体旋转）。描边绘制时单独画在主画布上 */
export function drawStudentShadow(ctx: CanvasRenderingContext2D, x: number, y: number, col: number, pat: number): void {
  const ps = pose(pat);
  const [sx, sy] = (RACE[col] ?? RACE[0]).body;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.globalAlpha = 0.28 * ps.alpha;
  ctx.beginPath();
  ctx.ellipse(ps.lying ? 2 : 0, 0, ps.lying ? 15 : 9, ps.lying ? 5 : 3.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

/** 画一个学生。(x, y) 是脚下位置；flash 为受击闪白强度 0–1 */
export function drawStudent(
  ctx: CanvasRenderingContext2D, x: number, y: number, col: number, dir: number, pat: number, flash = 0, shadow = true,
): void {
  const c = FACTION[col] ?? FACTION[0];
  const race = RACE[col] ?? RACE[0];
  const ps = pose(pat);
  const back = dir === 2 || dir === 3;
  const mirror = dir === 1 || dir === 2;

  if (shadow) drawStudentShadow(ctx, x, y, col, pat);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(race.body[0], race.body[1]);
  if (flash > 0) ctx.filter = `brightness(${1 + flash * 1.6})`;
  ctx.globalAlpha = ps.alpha;

  if (mirror) ctx.scale(-1, 1);
  if (ps.lying) {
    ctx.translate(15, -1);
    ctx.scale(1, 0.75);
    ctx.rotate(-Math.PI / 2 + 0.05);
  } else {
    ctx.rotate(ps.lean + (ps.squat ? 0 : race.hunch));
  }
  const d = ps.drop;

  // 远侧手脚
  limb(ctx, ps.farLeg.map(([px, py]) => [px, py + (ps.squat ? 0 : d * (py < -3 ? 1 : 0))] as P), 4.6, c.dark);
  shoe(ctx, ps.farLeg[2]);
  arm(ctx, [5.5, -22 + d], ps.farArm, c, 1, race.skin);

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

  // 头：矮人、精灵的头按体型反向缩放回来，免得被压扁或拉长
  ctx.save();
  ctx.translate(1, -31 + d);
  ctx.rotate(ps.headTilt);
  ctx.scale(1 / Math.sqrt(race.body[0]), 1 / Math.sqrt(race.body[1]));
  (HEADS[col] ?? humanHead)(ctx, back, race);
  ctx.restore();

  // 近侧手臂
  arm(ctx, [-4.5, -22 + d], ps.nearArm, c, 0, race.skin);

  ctx.restore();
}

function arm(ctx: CanvasRenderingContext2D, shoulder: P, a: [P, P], c: (typeof FACTION)[number], far: number, skin: string): void {
  limb(ctx, [shoulder, a[0], a[1]], 4.2, far ? c.dark : c.coat);
  circle(ctx, a[1][0], a[1][1], 1.9, skin);
}

function shoe(ctx: CanvasRenderingContext2D, foot: P): void {
  ctx.beginPath();
  ctx.ellipse(foot[0] + 1.2, foot[1] - 0.6, 2.8, 1.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1b1a1f';
  ctx.fill();
}

function face(ctx: CanvasRenderingContext2D, race: Race, r = 7): void {
  const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, r + 1);
  g.addColorStop(0, race.skin);
  g.addColorStop(1, race.skinDark);
  circle(ctx, 0, 0, r, g);
}

function fillPath(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, outline = true): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function eyes(ctx: CanvasRenderingContext2D, color = '#2a1712'): void {
  ctx.fillStyle = color;
  ctx.fillRect(2.3, -1.4, 1, 1.5);
  ctx.fillRect(5, -1.4, 0.9, 1.5);
}

type Head = (ctx: CanvasRenderingContext2D, back: boolean, race: Race) => void;

/** 人族：原版的红色飞机头 */
function humanHead(ctx: CanvasRenderingContext2D, back: boolean, race: Race): void {
  if (back) {
    circle(ctx, 0, 0, 7, HAIR);
    // 后脑勺被头发盖住，顶上是飞机头的脊
    ctx.beginPath();
    ctx.ellipse(1.5, -5.5, 7.5, 3.6, -0.15, 0, Math.PI * 2);
    fillPath(ctx, HAIR_LIGHT);
    ctx.strokeStyle = HAIR_DARK;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0.6, 2.4);
    ctx.stroke();
    return;
  }
  face(ctx, race);
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
  fillPath(ctx, hg);
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
  eyes(ctx);
  // 嘴
  ctx.beginPath();
  ctx.moveTo(3, 3.2);
  ctx.lineTo(5.2, 2.8);
  ctx.stroke();
}

/** 兽人：绿皮肤、黑色莫西干、尖耳、下獠牙 */
function orcHead(ctx: CanvasRenderingContext2D, back: boolean, race: Race): void {
  const mohawk = (x0: number, x1: number, y: number, h: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      ctx.lineTo(x + (x1 - x0) / n / 2, y - h - (i % 2) * 1.2);
      ctx.lineTo(x + (x1 - x0) / n, y - (i === n ? 0 : 1));
    }
    ctx.closePath();
    fillPath(ctx, '#1f1b1b');
  };
  const ear = (sx: number) => {
    ctx.beginPath();
    ctx.moveTo(sx * 5.5, -2.5);
    ctx.lineTo(sx * 11, -6);
    ctx.lineTo(sx * 6, 1.5);
    ctx.closePath();
    fillPath(ctx, race.skinDark);
  };
  if (back) {
    ear(-1);
    ear(1);
    face(ctx, race, 7.3);
    ctx.beginPath();
    ctx.ellipse(0, -2, 2.2, 7, 0, 0, Math.PI * 2);
    fillPath(ctx, '#1f1b1b');
    return;
  }
  ear(-1);
  face(ctx, race, 7.3);
  // 突出的下巴
  ctx.beginPath();
  ctx.ellipse(3.6, 3.3, 4.6, 3, 0.1, 0, Math.PI * 2);
  fillPath(ctx, race.skin);
  mohawk(-6, 4, -5.2, 5.5);
  // 粗眉和眼睛
  ctx.strokeStyle = '#2d3b1a';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1, -3.6);
  ctx.lineTo(6.8, -2.6);
  ctx.stroke();
  eyes(ctx, '#7a1010');
  // 獠牙
  ctx.fillStyle = '#fffbe8';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.5;
  for (const tx of [3.2, 6.6]) {
    ctx.beginPath();
    ctx.moveTo(tx - 0.9, 3.6);
    ctx.lineTo(tx, 0.6);
    ctx.lineTo(tx + 0.9, 3.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** 矮人：矿工头盔（带灯）、大鼻子、大胡子 */
function dwarfHead(ctx: CanvasRenderingContext2D, back: boolean, race: Race): void {
  const beardFill = (() => {
    const g = ctx.createLinearGradient(0, -2, 0, 11);
    g.addColorStop(0, '#d9783f');
    g.addColorStop(1, '#9c4420');
    return g;
  })();
  const helmet = () => {
    ctx.beginPath();
    ctx.ellipse(0.5, -3.6, 9.2, 2, 0, 0, Math.PI * 2);
    fillPath(ctx, '#6f747c');
    ctx.beginPath();
    ctx.moveTo(-7, -3.8);
    ctx.bezierCurveTo(-7.5, -13, 7.5, -13, 7.5, -3.8);
    ctx.closePath();
    const hg = ctx.createLinearGradient(-6, -11, 6, -2);
    hg.addColorStop(0, '#d3d7dc');
    hg.addColorStop(1, '#868c95');
    fillPath(ctx, hg);
    ctx.strokeStyle = 'rgba(40,40,48,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0.3, -12);
    ctx.lineTo(0.3, -4.5);
    ctx.stroke();
  };
  if (back) {
    // 胡子从两侧露出来
    ctx.beginPath();
    ctx.ellipse(0, 4, 8, 5, 0, 0, Math.PI * 2);
    fillPath(ctx, beardFill);
    face(ctx, race, 6.8);
    helmet();
    return;
  }
  face(ctx, race, 6.8);
  // 胡子：从两颊垂到胸前
  ctx.beginPath();
  ctx.moveTo(-3.5, -0.5);
  ctx.quadraticCurveTo(-4.5, 8, 1.5, 11);
  ctx.quadraticCurveTo(5, 12, 7, 9);
  ctx.quadraticCurveTo(9.5, 4, 8, -0.5);
  ctx.quadraticCurveTo(5, 2, 1, 1);
  ctx.closePath();
  fillPath(ctx, beardFill);
  ctx.strokeStyle = 'rgba(90,30,10,0.55)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.quadraticCurveTo(1.5, 7, 2.5, 9.5);
  ctx.moveTo(4.5, 3);
  ctx.quadraticCurveTo(5, 6.5, 5.5, 9);
  ctx.stroke();
  // 眉毛和眼睛
  ctx.strokeStyle = '#8a3c18';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(1.4, -2.6);
  ctx.lineTo(6.4, -2.4);
  ctx.stroke();
  eyes(ctx);
  // 大鼻子
  ctx.beginPath();
  ctx.arc(6.6, 0.6, 2, 0, Math.PI * 2);
  fillPath(ctx, race.skinDark);
  helmet();
  // 头灯
  ctx.beginPath();
  ctx.arc(6.4, -7, 1.9, 0, Math.PI * 2);
  fillPath(ctx, '#ffe680');
  ctx.fillStyle = 'rgba(255,240,170,0.35)';
  ctx.beginPath();
  ctx.arc(6.6, -7, 3.6, 0, Math.PI * 2);
  ctx.fill();
}

/** 精灵：银色长发、长尖耳、大眼睛 */
function elfHead(ctx: CanvasRenderingContext2D, back: boolean, race: Race): void {
  const hair = (() => {
    const g = ctx.createLinearGradient(0, -10, 0, 14);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#e4e2f2');
    g.addColorStop(1, '#a7a3c8');
    return g;
  })();
  const ear = (sx: number, len = 1) => {
    ctx.beginPath();
    ctx.moveTo(sx * 4, -1.5);
    ctx.quadraticCurveTo(sx * (4 + 5 * len), -5 * len, sx * (4 + 9 * len), -10 * len);
    ctx.quadraticCurveTo(sx * (4 + 4 * len), -2, sx * 4.5, 2);
    ctx.closePath();
    fillPath(ctx, race.skin);
  };
  if (back) {
    ear(-1, 0.7);
    ear(1, 0.7);
    // 长发盖住后脑，垂到背上
    ctx.beginPath();
    ctx.moveTo(-7, -1);
    ctx.bezierCurveTo(-8.5, -11, 8.5, -11, 7, -1);
    ctx.lineTo(6.5, 13);
    ctx.quadraticCurveTo(0, 15.5, -6.5, 13);
    ctx.closePath();
    fillPath(ctx, hair);
    ctx.strokeStyle = 'rgba(120,115,160,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-2.5, -4);
    ctx.lineTo(-3, 12);
    ctx.moveTo(2.5, -4);
    ctx.lineTo(3, 12);
    ctx.stroke();
    return;
  }
  // 脑后的长发，披在背上
  ctx.beginPath();
  ctx.moveTo(-1, -7);
  ctx.bezierCurveTo(-9, -7, -9.5, 4, -8, 13);
  ctx.quadraticCurveTo(-4, 14.5, -1.5, 12);
  ctx.quadraticCurveTo(-3, 4, 1, -1);
  ctx.closePath();
  fillPath(ctx, hair);
  ear(-1);
  face(ctx, race, 6.6);
  // 刘海
  ctx.beginPath();
  ctx.moveTo(-6.4, -1.5);
  ctx.bezierCurveTo(-6.5, -10, 6, -10.5, 7.4, -3.5);
  ctx.quadraticCurveTo(4.5, -5.5, 3, -4.2);
  ctx.quadraticCurveTo(1, -6, -2, -4.5);
  ctx.quadraticCurveTo(-4, -4, -6.4, -1.5);
  ctx.closePath();
  fillPath(ctx, hair);
  // 大眼睛带高光
  ctx.fillStyle = '#3b2a6b';
  ctx.fillRect(2.1, -2, 1.3, 2.2);
  ctx.fillRect(4.9, -2, 1.2, 2.2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(2.5, -1.9, 0.5, 0.6);
  ctx.fillRect(5.2, -1.9, 0.5, 0.6);
  ctx.strokeStyle = '#7b6a9a';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(1.8, -3.2);
  ctx.lineTo(3.6, -3.6);
  ctx.moveTo(4.8, -3.6);
  ctx.lineTo(6.4, -3.3);
  ctx.moveTo(3.6, 3);
  ctx.lineTo(5, 2.9);
  ctx.stroke();
}

const HEADS: Head[] = [humanHead, orcHead, dwarfHead, elfHead];
