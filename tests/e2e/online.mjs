// 联机端到端：每个玩家一个独立的浏览器上下文，脚本随机下令，每 90 帧记录一次已确认状态的指纹，最后逐帧比对。
// 先开两个终端：NET_DELAY=110 npm run server（到"LA"往返约 220 ms）和 npm run dev，再执行：
//   PLAYWRIGHT_CORE=<playwright-core 的 index.mjs> [CHROME=<浏览器路径>] node tests/e2e/online.mjs <server|host> <截图目录> [4] [reload]
// 第三个参数为 4：四名玩家（否则三名玩家 + 一台困难电脑）；玩家主机模式下 Cat 强制中转（?relay=1），Dan 加 40 ms 延迟。
// server：之后刷新一名玩家的页面、让一名玩家断网 25 秒；host：之后关闭房主页面（带 reload 则改为刷新房主页面）。
// 也可以测线上站点：BASE=https://… [PROXY=socks5://127.0.0.1:7890]。
// 期望：每次 "hash check" 都是 0 mismatches，退出码 0。
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const BASE = process.env.BASE ?? 'http://localhost:5173/';
const MODE = process.argv[2] ?? 'server';
const OUT = process.argv[3] ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${(performance.now() / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, proxy: process.env.PROXY ? { server: process.env.PROXY } : undefined, args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });

async function newPage(name, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  await ctx.addInitScript((n) => localStorage.setItem('sw.net.name', n), name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(name, 'PAGEERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && log(name, 'console.error', m.text()));
  page.label = name;
  page.query = query;
  return page;
}

/** 页面里：记录每 90 帧确认状态的指纹；随机给自己的学生下令 */
async function instrument(page) {
  await page.evaluate(async () => {
    // 开发服务器上用核心自己的指纹；线上构建里没有源码模块，退回到"所有学生位置、血量、状态 + 各校数据"的摘要
    let hashGame;
    try {
      ({ hashGame } = await import('/src/core/save.ts'));
    } catch {
      hashGame = (g) => {
        const text = JSON.stringify([g.tick, g.people.map((p) => [p.stat, p.col, p.px, p.py, p.hp]), g.player]);
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return (h >>> 0).toString(16) + ':' + text.length;
      };
    }
    const w = window;
    w.__hashes = w.__hashes ?? {};
    const hook = () => {
      const c = w.__online?.game?.client;
      if (!c || c.__hooked) return;
      c.__hooked = true;
      const orig = c.onBatch.bind(c);
      c.onBatch = (b, now) => {
        orig(b, now);
        const g = c.confirmed;
        if (g && g.tick % 90 === 0 && !(g.tick in w.__hashes)) w.__hashes[g.tick] = hashGame(g);
      };
    };
    hook();
    setInterval(hook, 200);
    let n = 0;
    setInterval(() => {
      const s = w.__online?.game;
      const g = s?.client.confirmed;
      if (!g || s.seat < 0) return;
      const mine = [];
      for (let i = 0; i < g.people.length; i++) if (g.people[i].stat > 0 && g.people[i].col === s.seat) mine.push(i);
      if (!mine.length) return;
      n++;
      const units = mine.filter(() => Math.random() < 0.5);
      if (!units.length) units.push(mine[0]);
      w.__sw?.send?.({ type: 'order', units, bx: Math.floor(Math.random() * 16), by: Math.floor(Math.random() * 16), target: -1, amove: Math.random() < 0.4 });
    }, 700);
  });
}

async function stats(page) {
  return page.evaluate(() => {
    const s = window.__online?.game;
    if (!s) return null;
    const st = s.client.stats();
    return {
      tick: s.client.confirmed?.tick, link: s.client.linkKind, host: s.isHost, status: s.status().text,
      rtt: Math.round(st.rtt), jitter: Math.round(st.jitter), confirmMs: Math.round(st.confirmMs), ahead: st.ahead,
      late: st.late, resyncs: st.resyncs, stalled: st.stalled, seats: s.client.seats.join(','),
    };
  });
}

function compare(pages, hashes) {
  const ticks = new Set();
  for (const h of hashes) for (const k of Object.keys(h)) ticks.add(+k);
  let both = 0;
  let bad = 0;
  for (const k of [...ticks].sort((a, b) => a - b)) {
    const vals = hashes.map((h) => h[k]).filter(Boolean);
    if (vals.length < 2) continue;
    both++;
    if (new Set(vals).size > 1) {
      bad++;
      log('MISMATCH at tick', k, vals);
    }
  }
  log(`hash check: ${both} ticks compared across ${pages.length} pages, ${bad} mismatches`);
  return bad;
}

async function hashesOf(pages) {
  return Promise.all(pages.map((p) => p.evaluate(() => window.__hashes ?? {})));
}

async function waitGame(page, ms = 30000) {
  try {
    await page.waitForFunction(() => !!window.__sw?.net, null, { timeout: ms });
  } catch (e) {
    const d = await page.evaluate(() => {
      const o = window.__online;
      const s = o?.game;
      return {
        status: o?.status, room: o?.room?.status, host: o?.room?.host === o?.id, game: !!s, hosting: s?.hosting,
        link: s?.client.linkKind, confirmed: s?.client.confirmed?.tick ?? null, held: s?.client.held,
        peers: o ? [...o.peers.values()].map((p) => p.via) : null,
      };
    });
    log(page.label, 'not in game:', JSON.stringify(d));
    throw e;
  }
}

// ---- 建房 ----
const A = await newPage('Ann');
await A.goto(BASE);
await A.getByRole('button', { name: '联机对战' }).click();
await A.waitForSelector('.net-status.online');
await A.getByText(MODE === 'host' ? '玩家主机模式' : '服务器模式', { exact: true }).first().click();
await A.getByRole('button', { name: '创建房间' }).click();
await A.waitForSelector('.room-code b');
const code = await A.textContent('.room-code b');
log('room', code, 'mode', MODE);

const B = await newPage('Bob');
const C = await newPage('Cat', MODE === 'host' ? '&relay=1' : '');
const FOUR = process.argv[4] === '4';
const extra = FOUR ? [await newPage('Dan', MODE === 'host' ? '&netdelay=40' : '')] : [];
for (const p of [B, C, ...extra]) await p.goto(`${BASE}?room=${code}${p.query}`);
await A.waitForFunction((n) => window.__online.room?.members.length === n, 3 + extra.length);
// 第 4 座：困难电脑
if (!FOUR) await A.locator('.seat').nth(3).locator('select').selectOption('hard');
await sleep(MODE === 'host' ? 12000 : 3000); // 直连测速 / 失败判定
await A.screenshot({ path: `${OUT}/lobby-${MODE}.png` });
log('advice:', await A.textContent('.advice'));
log('net table:', (await A.textContent('.net-table')).replace(/\s+/g, ' '));
await A.getByRole('button', { name: '开始对局' }).click();
const pages = [A, B, C, ...extra];
await Promise.all(pages.map((p) => waitGame(p)));
log('all in game');
await Promise.all(pages.map(instrument));

await sleep(30000);
for (const p of pages) log(p.label, JSON.stringify(await stats(p)));
await A.screenshot({ path: `${OUT}/game-${MODE}.png` });
let bad = compare(pages, await hashesOf(pages));

if (MODE === 'server') {
  // 刷新页面：回到大厅、自动回到对局
  log('reload Bob');
  await B.reload();
  await waitGame(B);
  await instrument(B);
  log('Bob back', JSON.stringify(await stats(B)));
  // 断网 20 秒：电脑接管，再恢复
  log('Cat offline 25s');
  await C.context().setOffline(true);
  const off0 = performance.now();
  let awayAt = 0;
  let aiAt = 0;
  while (performance.now() - off0 < 25000) {
    const s = (await stats(A)).seats.split(',')[2];
    if (s === 'away' && !awayAt) awayAt = performance.now() - off0;
    if (s === 'ai' && !aiAt) aiAt = performance.now() - off0;
    await sleep(250);
  }
  log(`Cat seat: away after ${(awayAt / 1000).toFixed(1)}s, ai after ${(aiAt / 1000).toFixed(1)}s`);
  log('Ann sees seats', JSON.stringify(await stats(A)));
  await C.context().setOffline(false);
  await sleep(12000);
  log('Cat after online', JSON.stringify(await stats(C)));
  log('Ann sees seats', JSON.stringify(await stats(A)));
} else if (process.argv[5] === 'reload') {
  // 房主刷新页面：权威随页面消失，LA 立即换人；原房主回来当普通成员
  const before = await stats(B);
  log('reload host Ann; Bob was', JSON.stringify(before));
  const t0 = performance.now();
  await A.reload();
  await waitGame(A);
  await instrument(A);
  for (let i = 0; i < 40; i++) {
    const s = await Promise.all(pages.map(stats));
    if (s.every((x) => x && x.tick > before.tick + 18 && !x.status.includes('暂停'))) break;
    await sleep(250);
  }
  log(`resumed after ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  for (const p of pages) log(p.label, JSON.stringify(await stats(p)));
  await sleep(15000);
} else {
  // 房主关掉页面：换房主，对局继续
  const before = await stats(B);
  log('close host page Ann; Bob was', JSON.stringify(before));
  await A.context().close();
  const t0 = performance.now();
  await B.waitForFunction(() => {
    const s = window.__online?.game;
    return s && (s.isHost || s.client.linkKind !== 'relay' || true) && window.__online.room?.host !== window.__online.room?.owner;
  }, null, { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  for (let i = 0; i < 20; i++) {
    const s = await Promise.all(pages.slice(1).map(stats));
    if (s.every((x) => x && x.tick > before.tick + 18 && !x.status.includes('暂停'))) break;
    await sleep(500);
  }
  log(`resumed after ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  for (const p of pages.slice(1)) log(p.label, JSON.stringify(await stats(p)));
  await sleep(20000);
  for (const p of pages.slice(1)) log(p.label, JSON.stringify(await stats(p)));
  pages.splice(0, 1);
}
await sleep(10000);
for (const p of pages) log(p.label, JSON.stringify(await stats(p)));
await pages[0].screenshot({ path: `${OUT}/game-${MODE}-end.png` });
bad += compare(pages, await hashesOf(pages));
await browser.close();
process.exit(bad ? 1 : 0);
