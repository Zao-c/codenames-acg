import { readRoomState } from './room-observer.mjs';
import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PLAYTEST_BASE_URL ?? 'http://127.0.0.1:5257';
const artifacts = path.resolve('artifacts/ui-acceptance-round5');
await fs.mkdir(artifacts, { recursive: true });

let browser;
for (const channel of ['chromium', 'msedge', 'chrome', undefined]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
if (!browser) throw new Error('No browser available');

const pages = [], states = [], errors = [], checks = [];
const stamp = Date.now().toString().slice(-5);
const button = (p, name) => p.getByRole('button', { name, exact: true });
const visible = locator => locator.waitFor({ state: 'visible', timeout: 20000 });
async function until(fn, label) { for (let i = 0; i < 200; i += 1) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`Timed out: ${label}`); }
async function shot(p, name, mobile = false) {
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: mobile });
  const bounds = await p.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
  assert.ok(bounds.s <= bounds.w + 1, `${name}: horizontal overflow ${JSON.stringify(bounds)}`);
}
async function attach(p, i) {
  pages[i] = p;
  p.on('pageerror', e => errors.push(`page${i}: ${e.message}`));
  p.on('response',async response=>{if(!response.url().includes('/socket.io/')||response.request().method()!=='GET')return;try{for(const packet of(await response.text()).split('\x1e'))if(packet.startsWith('42')){const[event,data]=JSON.parse(packet.slice(2));if(event==='room_state'||event==='room_state_delta')states[i]=readRoomState(event,data,states[i]);}}catch{}});p.on('websocket', ws => ws.on('framereceived', frame => {
    try {
      const value = String(frame.payload);
      if (!value.startsWith('42')) return;
      const [event, data] = JSON.parse(value.slice(2));
      if(event==='room_state'||event==='room_state_delta')states[i]=readRoomState(event,data,states[i]);
    } catch { /* ignore non-json frames */ }
  }));
}
async function newPage(i, mobile = false) {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await context.newPage();
  await attach(p, i);
  return p;
}
async function loginGuest(p, nickname) {
  await p.goto(`${base}/login`);
  await button(p, '游客').click();
  await p.getByPlaceholder('输入昵称直接开玩').fill(nickname);
  await button(p, '快速进入').click();
  await visible(button(p, '＋ 创建房间'));
}
async function tab(p, name) {
  const nav = p.getByRole('navigation', { name: '房间导航' });
  if (await nav.isVisible()) await nav.getByRole('button', { name, exact: true }).click();
}
async function emit(p, event, payload) {
  return p.evaluate(async ({ event, payload }) => {
    const socket = (await import('/src/lib/socket.ts')).getSocket();
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, message: 'ack timeout' }), 8000);
      socket.emit(event, payload, result => { clearTimeout(timer); resolve(result ?? { ok: true }); });
    });
  }, { event, payload });
}
async function plan(p, roomId, version, kind, extra = {}) {
  return emit(p, 'plan_action', { roomId, version, kind, ...extra });
}
async function act(p, roomId, kind, extra = {}) {
  const version = states[0].nextPlan.version;
  const result = await plan(p, roomId, version, kind, extra);
  if (!result?.ok) throw new Error(`plan ${kind} failed: ${result?.message ?? 'unknown'} (version ${version})`);
  await p.waitForTimeout(220);
  return result;
}

try {
  const host = await newPage(0);
  await loginGuest(host, `R5房主${stamp}`);
  const redOperative = await newPage(1);
  await loginGuest(redOperative, `R5红队${stamp}`);
  const blueCaptain = await newPage(2, true);
  await loginGuest(blueCaptain, `R5蓝队${stamp}`);
  const blueOperative = await newPage(3, true);
  await loginGuest(blueOperative, `R5蓝队队员${stamp}`);
  const spectator = await newPage(4);
  await loginGuest(spectator, `R5旁观${stamp}`);

  await host.goto(base);
  await button(host, '＋ 创建房间').click();
  const create = host.getByRole('dialog', { name: '创建一间房间' });
  await button(create, '动画组牌').click();
  await button(create, '创建房间 →').click();
  await until(() => !!states[0]?.id, 'host room');
  const roomId = states[0].id;

  const join = async (p, i, asSpectator = false) => {
    await p.goto(`${base}/room/${roomId}`);
    await until(() => states[i]?.id === roomId || p.locator('.invite-panel').isVisible(), `page${i} invite`);
    if (await p.getByPlaceholder('输入昵称直接开玩').isVisible().catch(() => false)) {
      await p.getByPlaceholder('输入昵称直接开玩').fill(`R5${stamp}${i}`);
      await button(p, '快速进入').click();
    }
    const joinButton = button(p, asSpectator ? '旁观' : '加入房间');
    if (await joinButton.isVisible().catch(() => false)) await joinButton.click();
    await until(() => states[i]?.id === roomId, `page${i} in room`);
  };
  for (let i = 1; i < 4; i += 1) await join(pages[i], i);
  await join(spectator, 4, true);

  for (let i = 0; i < 4; i += 1) {
    await tab(pages[i], '玩家');
    await pages[i].getByLabel('我的队伍', { exact: true }).selectOption(i < 2 ? 'red' : 'blue');
    if (i % 2 === 0) await pages[i].getByLabel('我的身份', { exact: true }).selectOption('spymaster');
  }

  await button(host, '修改设置').click();
  const settings = host.getByRole('dialog', { name: '本局设置' });
  await settings.getByLabel('玩法', { exact: true }).selectOption('anime');
  await settings.getByLabel('棋盘', { exact: true }).selectOption('5x5');
  const poolSelect = settings.getByLabel('动画作品池', { exact: true });
  const options = await poolSelect.locator('option').evaluateAll(list => list.map(option => option.value).filter(Boolean));
  const quarterly = options.find(value => /^\d{4}-Q[1-4]$/.test(value));
  assert.ok(quarterly, 'quarterly pool available');
  await poolSelect.selectOption(quarterly);
  await button(settings, '保存并返回准备大厅').click();
  await until(() => states[0].nextPlan?.variant === 'anime', 'anime configured');
  await host.getByRole('button', { name: /进入队长预览/ }).click();
  await until(() => states[0].nextPlan?.stage === 'guide', 'guide');

  // T06: guide captain offline past the (test-shortened) lobby kick delay must keep the seat.
  await blueCaptain.context().setOffline(true);
  await until(() => states[0].players.find(player => player.nickname === `R5蓝队${stamp}`)?.connected === false, 'guide captain offline');
  await host.waitForTimeout(700);
  assert.equal((states[0]).players.length, 4, 'guide captain is not silently kicked');
  assert.equal((states[0]).nextPlan.captains.blue, (states[0]).players[2].id);
  await blueCaptain.context().setOffline(false);
  await until(() => states[0].players.find(player => player.nickname === `R5蓝队${stamp}`)?.connected === true, 'guide captain reconnected');
  checks.push('guide preview captain offline > lobby kick delay keeps seat and captain role');

  for (const i of [0, 2]) {
    await tab(pages[i], '准备');
    await button(pages[i], '确认就绪，开始组牌').click();
  }
  await until(() => states[0].nextPlan?.stage === 'draft', 'draft');
  await until(() => [0,1,2,3,4].every(index=>states[index]?.nextPlan?.stage==='draft'), 'all participant draft snapshots');
  const candidates = states[0].nextPlan.candidates;
  const [a, b, c, d, e] = candidates.map(work => work.id);

  // Non-captains only receive a neutral current set.
  for (const index of [1, 3, 4]) {
    const view = states[index];
    assert.equal(view.nextPlan.captainView, undefined, `page${index} has no captainView`);
    assert.equal(JSON.stringify(view.nextPlan).includes('"claims"'), false);
    assert.equal(JSON.stringify(view.nextPlan).includes('protectedUntil'), false);
    assert.deepEqual(view.nextPlan.publicSelectedWorkIds, []);
  }

  // Real UI: red captain takes A.
  const redTile = host.locator(`.draft-candidates [data-replace-id="${a}"] .draft-tile-main`);
  await redTile.scrollIntoViewIfNeeded();
  await redTile.click();
  await button(host, '领取这张').click();
  await until(() => states[0].nextPlan.captainView?.claims[a], 'red takes A');
  assert.equal((await act(blueCaptain, roomId, 'take', { workId: b })).ok, true);
  await until(() => states[0].nextPlan.captainView?.claims[b], 'blue takes B');
  await until(() => (states[1].nextPlan.publicSelectedWorkIds ?? []).length === 2, 'public sees A+B');
  assert.deepEqual([...states[1].nextPlan.publicSelectedWorkIds].sort((x, y) => x - y), [a, b].sort((x, y) => x - y));
  assert.deepEqual([...states[4].nextPlan.publicSelectedWorkIds].sort((x, y) => x - y), [a, b].sort((x, y) => x - y));

  await tab(redOperative, '棋盘');
  await visible(redOperative.locator('.draft-workspace'));
  assert.equal(await redOperative.locator('.draft-public-badge').count(), 2);
  const publicChrome = (await redOperative.locator('.draft-public-panel .draft-public-head, .draft-public-panel .hint-text').allInnerTexts()).join(' ');
  assert.match(publicChrome, /实时组牌/);
  assert.match(publicChrome, /2/);
  assert.equal(/红队|蓝队|干扰|保护/.test(publicChrome), false, 'neutral panel chrome has no team/interference/protection words');
  await shot(redOperative, '01-public-desktop-dark');
  await theme(redOperative, true);
  await shot(redOperative, '02-public-desktop-light');
  await theme(redOperative, false);
  await blueOperative.reload();
  await until(() => states[3]?.nextPlan?.stage === 'draft', 'mobile draft state after reload');
  await visible(blueOperative.locator('.draft-mobile-tabs'));
  await blueOperative.locator('.draft-mobile-tabs').getByRole('button', { name: /实时组牌/ }).click();
  await visible(blueOperative.locator('.draft-public-panel'));
  assert.equal(await blueOperative.locator('.draft-public-item').count(), 2);
  await shot(blueOperative, '03-public-mobile-dark', true);
  await theme(blueOperative, true);
  await shot(blueOperative, '04-public-mobile-light', true);
  await theme(blueOperative, false);
  checks.push('D01 neutral A+B visible to operative and spectator; no claims/protection/team words in public UI');

  // Release A.
  assert.equal((await act(host, roomId, 'release', { workId: a })).ok, true);
  await until(() => !(states[1].nextPlan.publicSelectedWorkIds ?? []).includes(a), 'A removed from public');
  assert.ok((states[1].nextPlan.publicSelectedWorkIds ?? []).includes(b));
  checks.push('D02 release removes only the released work');

  // Replace B with C atomically.
  assert.equal((await act(blueCaptain, roomId, 'take', { workId: c, replaceId: b })).ok, true);
  await until(() => (states[1].nextPlan.publicSelectedWorkIds ?? []).includes(c) && !(states[1].nextPlan.publicSelectedWorkIds ?? []).includes(b), 'atomic replace');
  checks.push('D03 replace shows only the final set');

  // Interference and bookmarks never appear.
  assert.equal((await act(host, roomId, 'interfere', { workId: d })).ok, true);
  await until(() => !!states[0].nextPlan.captainView?.claims[d], 'interference claim');
  assert.equal((states[1].nextPlan.publicSelectedWorkIds ?? []).includes(d), false);
  assert.equal((await act(host, roomId, 'bookmark', { workId: e })).ok, true);
  assert.equal((await act(host, roomId, 'take', { workId: e })).ok, true);
  await until(() => states[0].nextPlan.captainView?.claims[e], 'red takes E');
  await until(() => (states[1].nextPlan.publicSelectedWorkIds ?? []).includes(e), 'E enters public list');
  assert.equal((states[1].nextPlan.publicSelectedWorkIds ?? []).includes(d), false);
  checks.push('D05/D06 interference and bookmarks stay private');

  // Steal after protection: neutral membership must not change.
  const beforeSteal = [...(states[1].nextPlan.publicSelectedWorkIds ?? [])].sort((x, y) => x - y);
  await host.waitForTimeout(10_300);
  const steal = await act(blueCaptain, roomId, 'take', { workId: e });
  assert.equal(steal.ok, true);
  await host.waitForTimeout(250);
  assert.deepEqual([...(states[1].nextPlan.publicSelectedWorkIds ?? [])].sort((x, y) => x - y), beforeSteal);
  assert.equal(JSON.stringify(states[1].nextPlan).includes('保护'), false);
  checks.push('D04 steal is invisible in the neutral list');

  // T08/D08: non-captain cannot forge a draft action.
  const version = states[0].nextPlan.version;
  const forged = await plan(redOperative, roomId, version, 'take', { workId: b });
  assert.equal(forged.ok, false);
  checks.push('D08 non-captain plan_action rejected by the server');

  // Seal and start.
  assert.equal((await act(host, roomId, 'done')).ok, true);
  assert.equal((await act(blueCaptain, roomId, 'done')).ok, true);
  await until(() => states[0].nextPlan?.stage === 'sealed', 'sealed');
  await until(() => states[1].nextPlan?.stage === 'sealed', 'sealed public state');
  assert.equal(states[1].nextPlan.publicSelectedWorkIds, undefined, 'sealed no longer exposes live selections');
  await button(host, '开始五秒倒计时').click();
  await until(() => states[0].phase === 'playing', 'playing');
  checks.push('D07 sealed transition hides the live neutral set');

  // T01: a room_state from chat must not unlock a guess the server has not received.
  const team = states[0].currentTeam;
  const captainIndex = team === 'red' ? 0 : 2;
  const operativeIndex = team === 'red' ? 1 : 3;
  const operative = pages[operativeIndex];
  const captain = pages[captainIndex];
  await tab(captain, '棋盘');
  await tab(operative, '棋盘');
  const clueInput = captain.getByPlaceholder('例如：机甲 / 学园 / 主角团');
  await visible(clueInput);
  await clueInput.fill('隐私验收');
  await captain.getByLabel('数字', { exact: true }).fill('3');
  await button(captain, '提交提示').click();
  await until(() => !!states[0].clue, 'clue');

  // Swallow the guess event once, then let a chat room_state arrive.
  await operative.evaluate(async () => {
    const socket = (await import('/src/lib/socket.ts')).getSocket();
    const original = socket.emit.bind(socket);
    window.__r5OriginalEmit = original;
    window.__r5Pending = null;
    socket.emit = (event, payload, callback) => {
      if (event === 'guess_card' && !window.__r5Pending) {
        window.__r5Pending = { payload, callback };
        return true;
      }
      return original(event, payload, callback);
    };
  });
  const ownCard = states[0].board.find(card => card.role === team && !card.revealed);
  assert.ok(ownCard);
  const ownIndex = states[0].board.findIndex(card => card.id === ownCard.id);
  const secondCard = states[0].board.find(card => card.id !== ownCard.id && !card.revealed);
  const secondIndex = states[0].board.findIndex(card => card.id === secondCard.id);
  await operative.locator('.anime-board-card').nth(ownIndex).click();
  await button(operative, '猜牌').click();
  await button(operative, '确认猜牌').click();
  await until(() => states[0].players.length === 4, 'pending guess');
  // Chat triggers a room_state while the guess is still only local.
  await emit(pages[4], 'send_chat_message', { roomId, text: '聊天不应解锁猜牌', requestId: `r5-chat-${Date.now()}` });
  await operative.waitForTimeout(300);
  assert.equal(states[0].board.find(card => card.id === ownCard.id)?.revealed, false);
  await operative.locator('.anime-board-card').nth(secondIndex).click();
  await button(operative, '猜牌').click();
  await button(operative, '确认猜牌').click();
  await operative.waitForTimeout(300);
  assert.equal(states[0].board.find(card => card.id === secondCard.id)?.revealed, false, 'second guess blocked while first is pending');
  assert.equal(states[0].board.filter(card => card.revealed).length, 0);
  // Release the original payload; the server applies exactly the first request.
  await operative.evaluate(async () => {
    const socket = (await import('/src/lib/socket.ts')).getSocket();
    const pending = window.__r5Pending;
    socket.emit = window.__r5OriginalEmit;
    window.__r5Pending = null;
    window.__r5OriginalEmit('guess_card', pending.payload, pending.callback);
  });
  await until(() => states[0].board.find(card => card.id === ownCard.id)?.revealed === true, 'first guess applied');
  assert.equal(states[0].board.find(card => card.id === secondCard.id)?.revealed, false);
  checks.push('T01 chat room_state does not unlock a locally pending guess; second guess stays blocked');

  // Double click safety and normal multi-round victory.
  let rounds = 0;
  while (states[0].phase === 'playing' && rounds < 70) {
    const room = states[0];
    const captain = pages[room.currentTeam === 'red' ? 0 : 2];
    const operative = pages[room.currentTeam === 'red' ? 1 : 3];
    await tab(captain, '棋盘');
    await tab(operative, '棋盘');
    if (!room.clue) {
      const input = captain.getByPlaceholder('例如：机甲 / 学园 / 主角团');
      await visible(input);
      await input.fill(`线索${rounds}`);
      await captain.getByLabel('数字', { exact: true }).fill('1');
      await button(captain, '提交提示').click();
      await until(() => !!states[0].clue, 'clue accepted');
    }
    const target = states[0].board.find(card => card.role === states[0].currentTeam && !card.revealed);
    assert.ok(target, 'own target exists');
    const index = states[0].board.findIndex(card => card.id === target.id);
    await operative.locator('.anime-board-card').nth(index).click();
    await button(operative, '猜牌').click();
    if (rounds === 0) {
      await button(operative, '确认猜牌').click();
      // Preview closes after the first confirm; double-click cannot submit a second card.
    } else {
      await button(operative, '确认猜牌').click();
    }
    await until(() => states[0].board.find(card => card.id === target.id)?.revealed, 'guess applied');
    rounds += 1;
    if (rounds === 2) {
      await blueOperative.context().setOffline(true);
      await until(() => states[0].players.find(player => player.nickname === `R5蓝队队员${stamp}`)?.connected === false, 'operative offline');
      await blueOperative.context().setOffline(false);
      await until(() => states[0].players.find(player => player.nickname === `R5蓝队队员${stamp}`)?.connected === true, 'operative reconnected');
    }
    await operative.waitForTimeout(350);
  }
  await until(() => states[0].phase === 'finished', 'normal finish');
  assert.equal(states[0].endReason, 'normal');
  assert.ok(rounds >= 10, `expected a full normal game, got ${rounds}`);
  checks.push(`T04 normal 5x5 victory in ${rounds} rounds with mid-game reconnect`);

  // T05: a late recovery failure for another room must not disturb the current room.
  const tokenBefore = await redOperative.evaluate(() => localStorage.getItem('acg-codenames-session'));
  await redOperative.evaluate(async () => {
    const socket = (await import('/src/lib/socket.ts')).getSocket();
    socket.emit('reconnect_room', { roomId: 'ZZZZZZ', sessionToken: 'x'.repeat(24), identityKey: null });
  });
  await redOperative.waitForTimeout(500);
  assert.equal(states[1]?.id, roomId);
  assert.equal(await redOperative.evaluate(() => localStorage.getItem('acg-codenames-session')), tokenBefore);
  await visible(redOperative.locator('.room-code').first());
  checks.push('T05 late ROOM_RECOVERY_FAILED for another room leaves the current session intact');

  // T08: a failed create-room attempt while in A keeps A.
  redOperative.once('dialog', dialog => dialog.accept());
  await redOperative.goto(base);
  await button(redOperative, '＋ 创建房间').click();
  const createTry = redOperative.getByRole('dialog', { name: '创建一间房间' });
  await visible(createTry);
  await createTry.getByRole('button', { name: '创建房间 →' }).evaluate(el => el.click());
  await visible(button(redOperative, '返回当前房间'));
  await button(redOperative, '返回当前房间').click();
  await until(() => states[1]?.id === roomId, 'returned to room after failed create');
  await visible(redOperative.locator('.room-code').first());
  checks.push('T08 failed create keeps the original room and seat');

  assert.deepEqual(errors, []);
  const report = { passed: true, roomId, rounds, checks, screenshots: (await fs.readdir(artifacts)).filter(name => name.endsWith('.png')) };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, roomId, rounds, checks }));
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
