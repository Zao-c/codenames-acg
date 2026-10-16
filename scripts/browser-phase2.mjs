import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PLAYTEST_BASE_URL ?? 'http://127.0.0.1:5187';
const api = process.env.PLAYTEST_API_URL ?? 'http://127.0.0.1:3032';
const artifacts = path.resolve('output/playwright/phase2'); await fs.mkdir(artifacts, { recursive: true });
let browser;
for (const channel of ['msedge', 'chrome', undefined]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
if (!browser) throw new Error('No local browser available');
const pages = [], states = [], keys = [], errors = [], checks = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const until = async (condition, label) => { for (let i = 0; i < 150; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); };
const visible = locator => locator.waitFor({ state: 'visible', timeout: 20_000 });
async function request(route, i = 0, method = 'GET', body, admin = false) {
  const response = await fetch(`${api}${route}`, { method, headers: { 'content-type': 'application/json', [admin ? 'x-anime-admin-key' : 'x-private-key']: admin ? process.env.PLAYTEST_ADMIN_KEY : keys[i] }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  return { status: response.status, data };
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: false });
  const bounds = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(bounds.scroll <= bounds.width + 1, `${name}: horizontal overflow`);
}
async function mobileTab(page, label) { const nav = page.getByRole('navigation', { name: '房间导航' }); if (await nav.isVisible()) await nav.getByRole('button', { name: label, exact: true }).click(); }
async function addNote(scope,text){await button(scope,'＋线索').click();await scope.getByLabel('线索内容').fill(text);await button(scope,'添加线索节点').click();}
async function addWork(scope,title){await button(scope,'＋动画').click();await button(scope.locator('.graph-work-picker'),title).click();}
async function emit(page, event, payload) { await page.evaluate(async ({ event, payload }) => { const module = await import('/src/lib/socket.ts'); module.getSocket().emit(event, payload); }, { event, payload }); }
try {
  for (let i = 0; i < 5; i++) {
    const key = crypto.randomBytes(32).toString('hex'); keys.push(key);
    const context = await browser.newContext(i >= 2 ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
    await context.addInitScript(({ key, i }) => {
      if (!localStorage.getItem('cipai.private-identity.v1')) localStorage.setItem('cipai.private-identity.v1', key);
      if (!localStorage.getItem('acg-codenames-identity')) localStorage.setItem('acg-codenames-identity', JSON.stringify({ mode: 'guest', nickname: `二批验收${i}`, username: '', avatarUrl: null }));
    }, { key, i });
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => socket.on('framereceived', frame => { try { const value = String(frame.payload); if (value.startsWith('42')) { const [event, data] = JSON.parse(value.slice(2)); if (event === 'room_state') states[i] = data; if (event === 'analysis_state' && states[i]?.id === data.roomId) states[i].analysis = data.analysis; } } catch {} }));
    await page.goto(base);
  }
  const host = pages[0];
  await host.goto(`${base}/anime-pools`); await visible(host.locator('.anime-discovery'));
  let dialog = host.locator('.anime-discovery'); await visible(dialog);
  await dialog.getByLabel('作品池名称', { exact: true }).fill('浏览器私人草稿');
  await dialog.locator('.discovery-poster-actions button').first().click();
  await button(dialog, '保存作品池').click();await visible(host.getByText('作品池已保存。',{exact:true}));
  await button(host, '我的作品池').click(); await visible(host.getByRole('heading', { name: '浏览器私人草稿' }));
  const catalog = (await request('/api/anime/catalog')).data.works;
  const selectedWorks = [...new Map(catalog.map(w => [w.seriesId, w])).values()].slice(0, 65);
  const created = await request('/api/anime-pools', 2, 'POST', { name: '二批社区联机池', description: '真实目录、独立版本、双端验收', author: '同好', workIds: selectedWorks.map(w => w.id), isPublic: true });
  assert.equal(created.status, 201); const poolId = created.data.id;
  await button(host, '公开广场').click(); await visible(host.getByRole('heading', { name: '二批社区联机池' }));
  const card = host.locator('.community-pool-card').filter({ has: host.getByRole('heading', { name: '二批社区联机池' }) });
  await button(card, '收藏').click(); await visible(button(card, '取消收藏')); await button(card, '复制到我的作品池').click();
  await button(host, '我的收藏').click(); await visible(host.getByRole('heading', { name: '二批社区联机池' }));
  await shot(host, '01-community-desktop');
  await pages[3].goto(`${base}/anime-pools`);await button(pages[3], '公开广场').click(); await visible(pages[3].getByRole('heading', { name: '二批社区联机池' })); await pages[3].setViewportSize({ width: 360, height: 780 });
  await theme(pages[3],true); await shot(pages[3], '02-community-mobile-light');
  await button(card, '举报').click(); dialog = host.getByRole('dialog', { name: '举报作品池' }); await dialog.getByLabel('举报原因').fill('验收举报与管理员隐藏'); await button(dialog, '提交举报').click();
  await button(host, '社区管理').click(); dialog = host.getByRole('dialog', { name: '作品池社区管理' });
  await dialog.getByLabel('管理员凭证').fill(process.env.PLAYTEST_ADMIN_KEY); await button(dialog, '读取待处理举报').click();
  await visible(dialog.locator('summary').filter({ hasText: '二批社区联机池' })); await dialog.locator('summary').filter({ hasText: '二批社区联机池' }).click(); await button(dialog, '处理此作品池').click(); await dialog.getByLabel('处理理由').fill('本地验收隐藏'); await button(dialog, '保存处理结果').click();
  await visible(dialog.locator('summary').filter({ hasText: /二批社区联机池.*已隐藏/ })); await button(host, '关闭作品池社区管理').click();
  const hidden = await request(`/api/anime-pools/${poolId}`, 0); assert.equal(hidden.status, 404);
  await request(`/api/anime-pools/${poolId}/moderation`, 0, 'PUT', { hidden: false, reason: '本地验收恢复' }, true);
  checks.push('community UI create, private identity, copy, favorite, mobile theme, report and administrator hide/restore');
  await host.reload(); await button(host, '公开广场').click(); await visible(host.getByRole('heading', { name: '二批社区联机池' })); await button(card, '查看作品').click();
  await button(host.getByRole('dialog'), '带回房间选择').click();
  await host.goto(base); await button(host,'＋ 创建房间').click(); await button(host.getByRole('dialog'),'创建房间 →').click(); await visible(host.locator('.room-code').first());
  const roomId = await host.locator('.room-code').first().innerText();
  for (let i = 1; i < 5; i++) { await pages[i].goto(`${base}/room/${roomId}`); await button(pages[i], i === 4 ? '旁观' : '加入房间').click(); await visible(pages[i].locator('.preparation-lobby')); }
  for (let i = 0; i < 4; i++) { await mobileTab(pages[i], '玩家'); await pages[i].getByLabel('我的队伍',{exact:true}).selectOption(i<2?'red':'blue'); if(i%2===0) await pages[i].getByLabel('我的身份',{exact:true}).selectOption('spymaster'); await mobileTab(pages[i], '准备'); }
  await button(host,'修改设置').click(); const config = host.locator('.anime-config'); if (!(await config.getAttribute('open') !== null)) await config.locator('summary').click();
  await config.getByLabel('玩法', { exact: true }).selectOption('anime'); await config.getByLabel('棋盘', { exact: true }).selectOption('6x6');
  await config.getByLabel('动画作品池', { exact: true }).selectOption(`community:${poolId}`); await button(host, '保存设置').click();
  await until(() => states[0]?.nextPlan?.sourcePool?.id === poolId, 'versioned community snapshot');
  await button(host, '进入队长预览 →').click(); await button(host, '确认就绪，开始组牌').click();
  const blue = pages[2]; await mobileTab(blue,'准备'); await button(blue, '确认就绪，开始组牌').click(); await button(blue,'选牌与操作').click();
  await visible(button(host, '手选完成，剩余随机补齐')); await button(host, '手选完成，剩余随机补齐').click(); await button(blue, '手选完成，剩余随机补齐').click(); await visible(button(host, '开始五秒倒计时')); await button(host, '开始五秒倒计时').click();
  await until(() => states[0]?.phase === 'playing' && !!states[1]?.analysis, 'analysis-enabled match');
  checks.push('community pool selected by ID/revision and sealed as a valid 36-card match');
  await mobileTab(blue, '棋盘'); await blue.evaluate(() => scrollTo(0, 0)); await shot(blue, '08-enabled-mobile-board');
  const mobileBoard = await blue.locator('.anime-board').boundingBox();
  const mobileNavigation = await blue.locator('.mobile-nav').boundingBox();
  assert.ok(mobileBoard && mobileNavigation && mobileBoard.y + mobileBoard.height <= mobileNavigation.y, `Enabled mobile board clipped: ${JSON.stringify({ mobileBoard, mobileNavigation })}`);
  const operative = pages[1]; await button(operative, '关联板与思路').click(); dialog = operative.getByRole('dialog', { name: '关联板与思路' });
  await addWork(dialog,states[1].board[0].word);await until(()=>states[1]?.analysis?.teamGraphs?.match?.revision===1,'team work node');
  await addNote(dialog,'队内联想验收');await until(()=>states[1]?.analysis?.teamGraphs?.match?.revision===2,'team note');
  await dialog.locator('.graph-node').first().click();await button(dialog,'连接到…').click();await dialog.locator('.graph-node').nth(1).click();await until(()=>states[1]?.analysis?.teamGraphs?.match?.revision===3,'manual edge');
  await dialog.locator('.graph-wire-hit').click({force:true});await dialog.getByLabel('连线内容').fill('青春');await button(dialog,'保存编辑').click();await until(()=>states[1]?.analysis?.teamGraphs?.match?.revision===4,'edge text');
  await shot(operative, '03-team-graph-desktop'); assert.equal(JSON.stringify(states[2].analysis).includes('队内联想验收'), false); await button(operative, '关闭关联板与思路').click();
  await button(host, '关联板与思路').click(); dialog = host.getByRole('dialog', { name: '关联板与思路' }); await button(dialog, '我的意图图').click(); await addNote(dialog,'PRIVATE_INTENT_BROWSER'); await until(() => states[0]?.analysis?.myIntents?.match?.graph.revision === 1, 'captain intent'); await button(dialog, '锁定当前计划').click(); await until(() => !!states[0]?.analysis?.myIntents?.match?.locked, 'locked plan'); assert.equal(JSON.stringify(states[1].analysis).includes('PRIVATE_INTENT_BROWSER'), false); await button(host, '关闭关联板与思路').click();
  await mobileTab(blue, '棋盘'); await button(blue, '关联板与思路').click(); dialog = blue.getByRole('dialog', { name: '关联板与思路' }); await button(dialog, '我的意图图').click(); await addNote(dialog,'蓝队私人想法'); await until(() => states[2]?.analysis?.myIntents?.match?.graph.revision === 1, 'mobile private intent'); await shot(blue, '06-private-intent-mobile'); await button(blue, '关闭关联板与思路').click();
  const captain = states[0].currentTeam === 'red' ? 0 : 2, guesser = captain + 1;
  await emit(pages[captain], 'submit_clue', { roomId, word: '联想', count: 1 }); await until(() => !!states[0].clue, 'clue accepted');
  const clueId = states[0].clue.id;
  await button(operative, '关联板与思路').click(); dialog = operative.getByRole('dialog', { name: '关联板与思路' }); await dialog.getByLabel('范围').selectOption('clue'); await addNote(dialog,'CURRENT_CLUE_NOTE'); await until(() => states[1]?.analysis?.teamGraphs?.[clueId]?.revision === 1, 'current clue graph'); await button(operative, '关闭关联板与思路').click();
  const assassin = states[0].board.find(c => c.role === 'assassin');
  const spectator = pages[4]; await mobileTab(spectator, '棋盘'); await button(spectator, '我的预测').click(); dialog = spectator.getByRole('dialog', { name: '我的预测' }); await dialog.getByLabel(`预测 ${assassin.word}`, { exact: true }).selectOption('red'); await until(() => states[4]?.analysis?.myPredictions?.[assassin.id]?.choice === 'red', 'private prediction'); await shot(spectator, '04-private-prediction-mobile'); await button(spectator, '关闭我的预测').click();
  await mobileTab(pages[guesser], '棋盘'); await pages[guesser].locator('.anime-board-card').nth(states[0].board.findIndex(c => c.id === assassin.id)).click(); await button(pages[guesser], '猜牌').click(); assert.equal(states[0].board.find(c => c.id === assassin.id).revealed, false); await button(pages[guesser], '确认猜牌').click();
  await until(() => states[0]?.phase === 'finished' && !!states[0]?.replayId, 'normal finish with archive'); const matchId = states[0].matchId;
  const privateMember = await request(`/api/private-replays/${matchId}`, 1); assert.equal(privateMember.status, 200); assert.equal(privateMember.data.snapshots.length, 1); assert.equal(privateMember.data.sharedPredictions.length, 0);
  assert.equal(privateMember.data.snapshots[0].teamGraphs.red[clueId].nodes[0].text, 'CURRENT_CLUE_NOTE');
  const privateSpectator = await request(`/api/private-replays/${matchId}`, 4); assert.equal(privateSpectator.status, 200); assert.equal(privateSpectator.data.teamGraphs, undefined); assert.deepEqual(privateSpectator.data.predictionResult, { total: 1, correct: 0 });
  const publicReplay = await request(`/api/replays/${states[0].replayId}`, 4); assert.equal(JSON.stringify(publicReplay.data).includes('PRIVATE_INTENT_BROWSER'), false);
  await host.locator('.private-review-entry summary').click(); await button(host, '第 1 局 · 私密复盘').click(); dialog = host.getByRole('dialog', { name: '房内私密复盘' }); await visible(dialog.getByLabel('查看时间点')); await dialog.getByLabel('查看时间点').selectOption('0'); await shot(host, '05-private-review-desktop'); await button(host, '关闭房内私密复盘').click();
  await request(`/api/private-replays/${matchId}/share`, 4, 'POST', { shared: true }); assert.equal((await request(`/api/private-replays/${matchId}`, 0)).data.sharedPredictions.length, 1);
  await request(`/api/private-replays/${matchId}/share`, 4, 'POST', { shared: false }); assert.equal((await request(`/api/private-replays/${matchId}`, 0)).data.sharedPredictions.length, 0);
  checks.push('team graph collaboration, private locked intent, spectator freeze, pre-reveal snapshot and authorized private review without public replay leaks');
  const restoredContext = await browser.newContext({ viewport: { width: 430, height: 844 }, isMobile: true, hasTouch: true });
  const restoredPage = await restoredContext.newPage(); pages.push(restoredPage); restoredPage.on('pageerror', e => errors.push(e.message));
  await restoredPage.goto(`${base}/private-replay/${matchId}`); await visible(restoredPage.getByRole('alert')); await button(restoredPage, '关闭房内私密复盘').click();
  await restoredPage.locator('.community-identity summary').click(); await restoredPage.getByLabel('恢复身份凭证', { exact: true }).fill(keys[0]); await button(restoredPage, '恢复并切换身份').click(); await visible(restoredPage.getByRole('dialog').getByLabel('查看时间点')); await shot(restoredPage, '07-restored-private-review-mobile');
  checks.push('current-clue graph snapshot, mobile intent editing and cross-device identity recovery with unauthorized access rejected');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors }));
} catch (error) {
  for (let i = 0; i < pages.length; i++) { try { await pages[i].screenshot({ path: path.join(artifacts, `failure-${i}.png`) }); await fs.writeFile(path.join(artifacts, `failure-${i}.txt`), await pages[i].locator('body').innerText()); } catch {} }
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ passed: false, checks, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
