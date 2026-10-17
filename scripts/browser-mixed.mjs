import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PLAYTEST_BASE_URL ?? 'http://127.0.0.1:5247';
const api = process.env.PLAYTEST_API_URL ?? 'http://127.0.0.1:3082';
const artifacts = path.resolve('artifacts/ui-acceptance-round4');
await fs.mkdir(artifacts, { recursive: true });
let browser;
for (const channel of ['chromium', 'msedge', 'chrome', undefined]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
if (!browser) throw new Error('No browser available');

const pages = [], states = [], errors = [], checks = [];
const stamp = Date.now().toString().slice(-5);
const button = (p, name) => p.getByRole('button', { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible', timeout: 20000 });
async function until(fn, label) { for (let i = 0; i < 160; i += 1) { if (fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); }
async function shot(p, name) {
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: false });
  const bounds = await p.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
  assert.ok(bounds.s <= bounds.w + 1, `${name}: horizontal overflow ${JSON.stringify(bounds)}`);
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      raw[offset] = rgb[0]; raw[offset + 1] = rgb[1]; raw[offset + 2] = rgb[2]; raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function attach(p, i) {
  pages[i] = p;
  p.on('pageerror', e => errors.push(`page${i}: ${e.message}`));
  p.on('websocket', ws => ws.on('framereceived', frame => {
    try {
      const value = String(frame.payload);
      if (!value.startsWith('42')) return;
      const [event, data] = JSON.parse(value.slice(2));
      if (event === 'room_state') states[i] = data;
    } catch { /* ignore non-json frames */ }
  }));
}
async function newPage(i, mobile = false) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await context.newPage();
  await attach(p, i);
  return p;
}
async function loginGuest(p, i, nickname) {
  await p.goto(`${base}/login`);
  await button(p, '游客').click();
  await p.getByPlaceholder('输入昵称直接开玩').fill(nickname);
  await button(p, '快速进入').click();
  await visible(button(p, '＋ 创建房间'));
}
async function loginNamed(p, name) {
  await p.goto(`${base}/login`);
  await p.getByPlaceholder('输入用户名').fill(name);
  await button(p, '进入结社').click();
  await visible(button(p, '＋ 创建房间'));
}
async function tab(p, name) {
  const nav = p.getByRole('navigation', { name: '房间导航' });
  if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click();
}
async function poolAction(card, label) {
  const more = card.locator('.pool-more');
  if (!(await more.evaluate(el => el.open))) await more.locator('summary').click();
  await button(card, label).click();
}
async function addManual(p, title, color) {
  await button(p, '＋ 手动新增动画').click();
  const dialog = p.getByRole('dialog', { name: '手动新增动画' });
  await dialog.getByLabel('上传动画封面').setInputFiles({ name: `${title}.png`, mimeType: 'image/png', buffer: png(240, 320, color) });
  await dialog.getByPlaceholder('例如：某部没有收录的原创短片').fill(title);
  await dialog.getByPlaceholder('多个别名用 / 或 , 分隔').fill('オリジナル / 自制短片');
  await dialog.getByPlaceholder('2026 或 2026-10-01').fill('2026');
  await dialog.getByPlaceholder('原创, 短片（最多 10 个）').fill('原创, 短片');
  await button(dialog, '创建并加入作品池').click();
  await dialog.waitFor({ state: 'hidden' });
}

try {
  const host = await newPage(0);
  await loginNamed(host, `混合验收${stamp}`);
  const others = [];
  for (let i = 1; i < 4; i += 1) {
    const p = await newPage(i, i >= 2);
    await loginGuest(p, i, `混验${stamp}${i}`);
    others.push(p);
  }

  // ── Manual works + mixed pool through the real UI ─────────────────────
  await host.goto(`${base}/anime-pools`);
  await button(host, '动画发现与手动新增').click();
  await visible(host.locator('.anime-discovery'));
  await addManual(host, `没有收录的原创短片 ${stamp}`, [72, 110, 190]);
  await addManual(host, `自建日文别名作品 ${stamp}`, [160, 80, 130]);
  await until(() => host.locator('.discovery-bag-list > div').count().then(n => n >= 2), 'manual works in bag');
  await button(host, '加入本页').click();
  await button(host, '加载更多作品').click();
  await visible(host.locator('.discovery-poster').first());
  await button(host, '加入本页').click();
  await host.getByLabel('作品池名称', { exact: true }).fill(`混合动画池 ${stamp}`);
  await host.getByLabel('作品池介绍').fill('Bangumi 与自建作品混用，验证组牌、棋盘与回放。');
  await host.getByLabel('发布到同好题库广场').check();
  await button(host, '保存作品池').click();
  await visible(host.getByText('作品池已保存。', { exact: true }));
  assert.equal(await host.locator('.discovery-bag-list > div').filter({ hasText: `没有收录的原创短片 ${stamp}` }).count(), 1);
  assert.match(await host.locator('.discovery-bag-count').innerText(), /已加入作品\s*50/);
  await shot(host, '01-mixed-editor-desktop-dark');
  await theme(host, true);
  await shot(host, '02-mixed-editor-desktop-light');
  await theme(host, false);

  await button(host, '公开广场').click();
  const card = host.locator('.community-pool-card').filter({ has: host.getByRole('heading', { name: `混合动画池 ${stamp}` }) });
  await visible(card);
  assert.ok(await card.locator('.cover-slot img').count() >= 1);
  await shot(host, '03-plaza-desktop-dark');
  await theme(host, true);
  await shot(host, '04-plaza-desktop-light');
  await theme(host, false);
  const mobile = others[2];
  await mobile.goto(`${base}/anime-pools`);
  await visible(mobile.locator('.community-pool-card').first());
  await shot(mobile, '05-plaza-mobile-dark');
  await theme(mobile, true);
  await shot(mobile, '06-plaza-mobile-light');
  await theme(mobile, false);

  // Profile reflects career wording and keeps account actions distinct.
  await host.goto(`${base}/profile`);
  await visible(host.getByRole('heading', { name: '生涯概览' }));
  assert.equal(await host.getByText('最近表现').count(), 0);
  assert.equal(await host.getByText('默契搭档').count(), 0);
  await visible(host.getByRole('button', { name: '切换账户' }));
  await visible(host.getByRole('button', { name: '退出登录' }));
  await shot(host, '07-profile-desktop-dark');
  await theme(host, true);
  await shot(host, '08-profile-desktop-light');
  await theme(host, false);
  await mobile.goto(`${base}/profile`);
  await visible(mobile.getByRole('heading', { name: '生涯概览' }));
  await shot(mobile, '09-profile-mobile-dark');
  await theme(mobile, true);
  await shot(mobile, '10-profile-mobile-light');
  await theme(mobile, false);

  // ── Create a room and apply the mixed pool ────────────────────────────
  await host.goto(base);
  await button(host, '＋ 创建房间').click();
  const create = host.getByRole('dialog', { name: '创建一间房间' });
  await button(create, '动画组牌').click();
  await button(create, '创建房间 →').click();
  await until(() => !!states[0]?.id, 'host room');
  const roomId = states[0].id;
  for (let i = 1; i < 4; i += 1) {
    const p = others[i - 1];
    await p.goto(`${base}/room/${roomId}`);
    await until(() => states[i]?.id === roomId || p.locator('.invite-panel').isVisible(), `page ${i} invite`);
    if (await p.getByPlaceholder('输入昵称直接开玩').isVisible().catch(() => false)) {
      await p.getByPlaceholder('输入昵称直接开玩').fill(`混验${stamp}${i}`);
      await button(p, '快速进入').click();
    } else if (await button(p, '加入房间').isVisible().catch(() => false)) {
      await button(p, '加入房间').click();
    }
    await until(() => states[i]?.id === roomId, `page ${i} in room`);
  }
  for (let i = 0; i < 4; i += 1) {
    await tab(pages[i], '玩家');
    await pages[i].getByLabel('我的队伍', { exact: true }).selectOption(i < 2 ? 'red' : 'blue');
    if (i % 2 === 0) await pages[i].getByLabel('我的身份', { exact: true }).selectOption('spymaster');
  }
  await button(host, '修改设置').click();
  const settings = host.getByRole('dialog', { name: '本局设置' });
  await settings.getByLabel('玩法', { exact: true }).selectOption('anime');
  await settings.getByLabel('棋盘', { exact: true }).selectOption('5x5');
  await button(settings, '搜索全部作品池…').click();
  const picker = host.getByRole('dialog', { name: '选择动画作品池' });
  await picker.getByLabel('搜索作品池').fill(`混合动画池 ${stamp}`);
  await button(picker, '搜索').click();
  const pickCard = picker.locator('.pool-picker-list article').filter({ hasText: `混合动画池 ${stamp}` });
  await visible(pickCard);
  await button(pickCard, '选择').click();
  await button(settings, '保存设置').click();
  await until(() => states[0].nextPlan?.sourcePool, 'mixed community pool applied');
  assert.ok(states[0].nextPlan.poolIds.some(id => id < 0), 'mixed pool includes a manual work');
  checks.push('manual upload + mixed 5x5 pool applied in a real room');

  // ── Draft: take a manual card, seal and start ─────────────────────────
  await host.getByRole('button', { name: /进入队长预览/ }).click();
  await until(() => states[0].nextPlan?.stage === 'guide', 'captain guide');
  for (const i of [0, 2]) {
    await tab(pages[i], '准备');
    await button(pages[i], '确认就绪，开始组牌').click();
  }
  await until(() => states[0].nextPlan?.stage === 'draft', 'draft started');
  const manualCandidate = states[0].nextPlan.candidates.find(w => w.source === 'manual');
  assert.ok(manualCandidate, 'manual work is a draft candidate');
  const redCaptain = 0;
  const tile = host.locator(`.draft-candidates [data-replace-id="${manualCandidate.id}"]`);
  await tile.locator('.draft-tile-main').click();
  await button(host, '领取这张').click();
  await until(() => !!states[0].nextPlan.captainView?.claims[manualCandidate.id], 'manual claim');
  for (const i of [0, 2]) {
    const control = button(pages[i], '选牌与操作');
    if (await control.isVisible()) await control.click();
    await button(pages[i], '手选完成，剩余随机补齐').click();
  }
  await until(() => states[0].nextPlan?.stage === 'sealed', 'sealed');
  await button(host, '开始五秒倒计时').click();
  await until(() => states[0].phase === 'playing', 'playing');
  const manualCard = states[0].board.find(c => c.anime?.id === manualCandidate.id);
  assert.ok(manualCard, 'manual work is on the sealed board');
  assert.match(manualCard.wordId, /^manual:/);
  await tab(host, '棋盘');
  await visible(host.locator('.anime-board'));
  assert.ok(await host.locator('.anime-board-card img').count() > 0);
  await shot(host, '11-mixed-board-desktop-dark');
  await theme(host, true);
  await shot(host, '12-mixed-board-desktop-light');
  await theme(host, false);
  await tab(mobile, '棋盘');
  await visible(mobile.locator('.anime-board'));
  await shot(mobile, '13-mixed-board-mobile-dark');
  await theme(mobile, true);
  await shot(mobile, '14-mixed-board-mobile-light');
  await theme(mobile, false);

  // Manual preview must not fabricate a Bangumi link.
  const manualIndex = states[0].board.findIndex(c => c.id === manualCard.id);
  await host.locator('.anime-board-card').nth(manualIndex).click();
  const preview = host.getByRole('dialog');
  await visible(preview);
  assert.equal(await preview.locator('a[href*="bgm.tv"]').count(), 0);
  assert.ok(await preview.locator('img').count() > 0);
  await host.keyboard.press('Escape');

  // ── Normal multi-round win with reconnect and double-click safety ──────
  let rounds = 0, doubleClickChecked = false;
  while (states[0].phase === 'playing' && rounds < 40) {
    const room = states[0];
    const captain = room.currentTeam === 'red' ? 0 : 2;
    const operative = room.currentTeam === 'red' ? 1 : 3;
    await tab(pages[captain], '棋盘');
    await tab(pages[operative], '棋盘');
    if (!room.clue) {
      const input = pages[captain].getByPlaceholder('例如：机甲 / 学园 / 主角团');
      await visible(input);
      await input.fill(`线索${rounds}`);
      await pages[captain].getByLabel('数字', { exact: true }).fill('1');
      await button(pages[captain], '提交提示').click();
      await until(() => !!states[0].clue, 'clue accepted');
    }
    const target = states[captain].board.find(c => c.role === states[0].currentTeam && !c.revealed);
    assert.ok(target, 'own target remains');
    const index = states[captain].board.findIndex(c => c.id === target.id);
    const p = pages[operative];
    await p.locator('.anime-board-card').nth(index).click();
    await button(p, '猜牌').click();
    await button(p, '确认猜牌').click();
    if (!doubleClickChecked) {
      doubleClickChecked = true;
      // A delayed second click must not reveal a second card.
      const before = states[0].board.filter(c => c.revealed).length;
      await p.locator('.anime-board-card').nth(index).click().catch(() => {});
      await p.waitForTimeout(250);
      assert.equal(states[0].board.filter(c => c.revealed).length, before);
      await p.keyboard.press('Escape').catch(() => {});
    }
    await until(() => states[0].board.find(c => c.id === target.id)?.revealed, 'guess accepted');
    rounds += 1;
    if (rounds === 2) {
      await others[0].context().setOffline(true);
      await until(() => !states[0].players.find(x => x.nickname === `混验${stamp}1`)?.connected, 'operative offline');
      await others[0].context().setOffline(false);
      await until(() => states[0].players.find(x => x.nickname === `混验${stamp}1`)?.connected, 'operative reconnected');
    }
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(400);
  }
  await until(() => states[0].phase === 'finished', 'normal finish');
  assert.equal(states[0].endReason, 'normal');
  assert.ok(rounds >= 3, `expected at least 3 rounds, got ${rounds}`);
  const replayId = states[0].replayId;
  assert.ok(replayId, 'replay generated');
  const replay = await (await fetch(`${api}/api/replays/${replayId}`)).json();
  assert.ok(replay.finalBoard.some(card => card.anime?.id === manualCandidate.id && card.anime.source === 'manual'));
  await host.goto(`${base}/replay/${replayId}`);
  await visible(host.locator('.replay-board'));
  assert.ok(await host.locator('.replay-board-cover img').count() > 0, 'replay shows anime covers');
  await shot(host, '15-mixed-replay-desktop');
  await mobile.goto(`${base}/replay/${replayId}`);
  await visible(mobile.locator('.replay-board'));
  await shot(mobile, '16-mixed-replay-mobile');
  checks.push(`mixed manual+Bangumi normal victory in ${rounds} rounds after a disconnect/reconnect; replay keeps manual cover`);

  assert.deepEqual(errors, []);
  const report = { passed: true, roomId, rounds, checks, screenshots: (await fs.readdir(artifacts)).filter(name => name.endsWith('.png')) };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  for (const [i, p] of pages.entries()) {
    if (!p) continue;
    await p.screenshot({ path: path.join(artifacts, `failure-${i}.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(artifacts, `failure-${i}.txt`), await p.locator('body').innerText().catch(() => '')).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
