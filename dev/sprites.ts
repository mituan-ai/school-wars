// 开发用：按 阵营 × 方向 × 姿势 排出所有角色帧，用来审查美术
import { drawStudent } from '../src/render/student.ts';

const S = 3;
const CW = 40;
const CH = 52;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const pats = Array.from({ length: 25 }, (_, i) => i);
const rows = 4 * 4;
canvas.width = (pats.length * CW + 40) * S;
canvas.height = (rows * CH + 20) * S;
const ctx = canvas.getContext('2d')!;
ctx.scale(S, S);
ctx.font = '8px sans-serif';
for (let col = 0; col < 4; col++) {
  for (let dir = 0; dir < 4; dir++) {
    const r = col * 4 + dir;
    ctx.fillStyle = '#333';
    ctx.fillText(`${col}/${dir}`, 2, 20 + r * CH + 30);
    for (const p of pats) drawStudent(ctx, 40 + p * CW + CW / 2, 20 + r * CH + 44, col, dir, p);
  }
}
