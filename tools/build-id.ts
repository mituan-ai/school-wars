// 构建号：模拟与联机代码（src/core、src/net）和版本号的内容哈希。
// 客户端和服务器分开构建，只要这些代码相同，构建号就相同；不同就拒绝联机，避免状态不一致。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildId(root = process.cwd()): string {
  const h = createHash('sha256');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  h.update(pkg.version);
  for (const dir of ['src/core', 'src/net']) {
    for (const f of readdirSync(join(root, dir)).sort()) {
      h.update(f);
      h.update(readFileSync(join(root, dir, f)));
    }
  }
  return `${pkg.version}-${h.digest('hex').slice(0, 10)}`;
}
