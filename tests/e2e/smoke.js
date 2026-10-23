// 端到端冒烟测试：选阵营 → 框选 → 右键占领营地 → 存档 → 退出 → 读档。
// 先 npm run dev，再执行：playwright-cli open about:blank && playwright-cli run-code --filename=tests/e2e/smoke.js
// 期望：log 中"占领成功: true"，读档 tick 等于存档 tick，errors 为空。
async page => {
  const S = 'test-results/';
  const log = []; const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.locator('.card').nth(1).click();
  await page.waitForTimeout(500);
  await page.locator('.tips button').click();
  // 框选己方单位
  const box = await page.evaluate(() => {
    const s = window.__sw, g = s.state;
    const pts = g.people.filter(p => p.stat > 1 && p.col === g.user_col).map(p => s.debugToScreen(p.px, p.py));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [Math.min(...xs) - 30, Math.min(...ys) - 60, Math.max(...xs) + 30, Math.max(...ys) + 30];
  });
  await page.mouse.move(box[0], box[1]); await page.mouse.down();
  await page.mouse.move((box[0]+box[2])/2, (box[1]+box[3])/2, { steps: 4 });
  await page.mouse.move(box[2], box[3], { steps: 4 }); await page.mouse.up();
  log.push('选中: ' + await page.locator('.sel-text').textContent());
  // 找最近的中立营地
  const target = await page.evaluate(() => {
    const s = window.__sw, g = s.state, pl = g.player[g.user_col];
    const cands = g.area.filter(a => a.areatype === 2 && a.col < 0).map(a => ({ a, d: Math.abs(a.bx - pl.basex) + Math.abs(a.by - pl.basey) })).sort((x, y) => x.d - y.d);
    const a = cands[0].a;
    const idx = g.area.indexOf(a);
    const [x, y] = s.debugToScreen(a.bx * 48 - a.by * 48, a.by * 24 + a.bx * 24 + 24);
    return { idx, x, y, d: cands[0].d };
  });
  log.push('目标营地 距离 ' + target.d + ' 屏幕 ' + Math.round(target.x) + ',' + Math.round(target.y));
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(200);
  await page.screenshot({ path: S + 'e_order.png' });
  await page.mouse.click(target.x, target.y, { button: 'right' });
  await page.waitForTimeout(300);
  log.push('下令后状态: ' + await page.evaluate(() => { const g = window.__sw.state; return g.people.filter(p => p.col === g.user_col && p.stat > 1).map(p => p.stat).join(','); }));
  await page.locator('.hud-right .btn').first().click(); // 2x
  let captured = false;
  for (let i = 0; i < 40 && !captured; i++) {
    await page.waitForTimeout(1000);
    captured = await page.evaluate((idx) => { const g = window.__sw.state; return g.area[idx].col === g.user_col; }, target.idx);
    if (i === 8) await page.screenshot({ path: S + 'e_walk.png' });
  }
  log.push('占领成功: ' + captured + ' tick ' + await page.evaluate(() => window.__sw.state.tick));
  await page.screenshot({ path: S + 'e_captured.png' });
  // 存档
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.screenshot({ path: S + 'e_pause.png' });
  await page.getByRole('button', { name: '保存' }).click();
  await page.locator('.slot').nth(0).getByRole('button').click();
  const savedTick = await page.evaluate(() => window.__sw.state.tick);
  const savedHash = await page.evaluate(() => JSON.stringify(window.__sw.state.people.map(p => [p.stat, p.cx, p.cy, p.hp])));
  log.push('存档状态: ' + await page.locator('.panel-status').textContent() + ' tick ' + savedTick);
  await page.screenshot({ path: S + 'e_save.png' });
  await page.getByRole('button', { name: '返回' }).click();
  await page.getByRole('button', { name: '继续' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  if (!(await page.locator('.modal').count())) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '退出到标题' }).click();
  await page.waitForTimeout(600);
  log.push('标题有继续游戏: ' + await page.getByRole('button', { name: '继续游戏' }).count());
  await page.getByRole('button', { name: '读取存档' }).click();
  await page.locator('.slot').nth(1).getByRole('button').click();
  await page.waitForTimeout(50);
  const loaded = await page.evaluate(() => ({ tick: window.__sw.state.tick }));
  log.push('读档 tick ' + loaded.tick + '（存档时 ' + savedTick + '）');
  await page.waitForTimeout(400);
  await page.screenshot({ path: S + 'e_loaded.png' });
  return { log, errors };
}
