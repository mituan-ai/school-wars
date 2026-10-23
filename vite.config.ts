import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    // 整局模拟和锦标赛回归需要较长时间
    testTimeout: 120_000,
  },
});
