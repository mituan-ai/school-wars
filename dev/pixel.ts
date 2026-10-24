// 开发用：像素学生图鉴（阵营 × 方向 × 姿势），放大 4 倍
import { studentSprite } from '../src/render/pixel-student.ts';

const Z = 4;
const CW = 30;
const CH = 36;
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = (25 * CW + 10) * Z;
canvas.height = (16 * CH + 10) * Z;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#ddd6c6';
ctx.fillRect(0, 0, canvas.width, canvas.height);
for (let col = 0; col < 4; col++) {
  for (let dir = 0; dir < 4; dir++) {
    const r = col * 4 + dir;
    for (let p = 0; p < 25; p++) {
      const s = studentSprite(col, dir, p, { flash: p === 20 && dir === 1 });
      const x = 5 + p * CW + CW / 2 - s.ax;
      const y = 5 + r * CH + 30 - s.ay;
      ctx.drawImage(s.canvas, x * Z, y * Z, s.canvas.width * Z, s.canvas.height * Z);
    }
  }
}
