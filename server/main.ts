// 联机服务器入口：HTTP + WebSocket（路径 /net），只监听本机，由 nginx 反代。
// 用法：node server/main.ts            环境变量 PORT（默认 8787）、HOST（默认 127.0.0.1）
//       NET_DELAY=110 node server/main.ts   每个方向人为加 110 ms 延迟，本机模拟往返 220 ms
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { realScheduler } from '../src/net/link.ts';
import { BUILD_ID } from '../src/net/protocol.ts';
import { Hub, type Sock } from './hub.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  /** 每个方向人为增加的延迟（ms） */
  delay?: number;
}

export function startServer(o: ServerOptions): Promise<{ port: number; hub: Hub; close: () => void }> {
  const DELAY = o.delay ?? 0;
  const hub = new Hub(realScheduler);

  const http = createServer((req, res) => {
    if (req.url === '/net/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, build: BUILD_ID, ...hub.info() }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const wss = new WebSocketServer({ server: http, path: '/net', maxPayload: 512 * 1024 });

  wss.on('connection', (ws) => {
    const later = (fn: () => void) => (DELAY > 0 ? setTimeout(fn, DELAY) : fn());
    const sock: Sock = {
      send: (text) => later(() => ws.readyState === ws.OPEN && ws.send(text)),
      close: () => ws.close(),
      onMessage: () => {},
      onClose: () => {},
    };
    let alive = true;
    ws.on('pong', () => (alive = true));
    // 半开连接（对方网络消失但没发 FIN）靠心跳发现：5–10 秒内断开，之后才开始算掉线宽限期
    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 5000);
    ws.on('message', (data) => {
      const text = data.toString();
      later(() => sock.onMessage(text));
    });
    ws.on('close', () => {
      clearInterval(beat);
      later(() => sock.onClose());
    });
    ws.on('error', () => ws.terminate());
    hub.connect(sock);
  });

  const timer = setInterval(() => hub.pump(), 5);
  return new Promise((resolve) => {
    http.listen(o.port, o.host ?? '127.0.0.1', () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        hub,
        close: () => {
          clearInterval(timer);
          for (const c of wss.clients) c.terminate();
          wss.close();
          http.close();
        },
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const host = process.env.HOST ?? '127.0.0.1';
  const delay = Number(process.env.NET_DELAY ?? 0);
  const { port } = await startServer({ port: Number(process.env.PORT ?? 8787), host, delay });
  console.log(`school-wars net server ${BUILD_ID} on ${host}:${port}${delay ? ` (+${delay} ms each way)` : ''}`);
}
