// 联机服务器打包成单个文件（含 ws），服务器上只需要 Node，不必 npm install
import { defineConfig } from 'vite';
import { buildId } from './tools/build-id.ts';

export default defineConfig({
  define: { __SW_BUILD__: JSON.stringify(buildId()) },
  ssr: { noExternal: true, external: ['bufferutil', 'utf-8-validate'] },
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist-server',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
});
