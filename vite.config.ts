import { buildId } from './tools/build-id.ts';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  base: './',
  // 联机要求所有人运行同一份模拟代码：构建号取核心与联机代码的内容哈希，服务器构建用同一个
  define: command === 'build' ? { __SW_BUILD__: JSON.stringify(buildId()) } : {},
  server: {
    // 开发时 /net 转给本机的联机服务器（npm run server）
    proxy: { '/net': { target: 'ws://127.0.0.1:8787', ws: true } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // 整局模拟和锦标赛回归需要较长时间
    testTimeout: 120_000,
  },
}));
