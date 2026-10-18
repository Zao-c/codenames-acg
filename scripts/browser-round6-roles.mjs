import { readRoomState } from './room-observer.mjs';
import {io} from 'socket.io-client';
import {execFileSync} from 'node:child_process';
import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PLAYTEST_BASE_URL ?? 'http://127.0.0.1:5277';
const artifacts = path.resolve('output/playwright/round6/formal');
await fs.mkdir(artifacts, { recursive: true });
const previous=path.resolve('output/playwright/round6/attempts',new Date().toISOString().replaceAll(':','-'));
for(const name of await fs.readdir(artifacts))if(name.startsWith('failure-')){await fs.mkdir(previous,{recursive:true});await fs.rename(path.join(artifacts,name),path.join(previous,name));}
const applicationCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const screenshotRecords=[];

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
  screenshotRecords.push({name:name+'.png',viewport:p.viewportSize(),theme:await p.evaluate(()=>document.documentElement.classList.contains('light')?'light':'dark'),url:p.url(),applicationCommit});
  console.log('SCREENSHOT '+name);
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
async function raw(p,event,payload){await p.evaluate(async({event,payload})=>(await import('/src/lib/socket.ts')).getSocket().emit(event,payload),{event,payload});}
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
  await loginGuest(host, `R6身份主${stamp}`);
  const redOperative = await newPage(1);
  await loginGuest(redOperative, `R6身份红${stamp}`);
  const blueCaptain = await newPage(2, true);
  await loginGuest(blueCaptain, `R6身份蓝${stamp}`);
  const blueOperative = await newPage(3, true);
  await loginGuest(blueOperative, `R6身份蓝队员${stamp}`);
  const spectator = await newPage(4);
  await loginGuest(spectator, `R6身份观${stamp}`);

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
      await p.getByPlaceholder('输入昵称直接开玩').fill(`R6${stamp}${i}`);
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
  await poolSelect.locator('option[value$="-Q1"],option[value$="-Q2"],option[value$="-Q3"],option[value$="-Q4"]').first().waitFor({state:'attached'});
  const options = await poolSelect.locator('option').evaluateAll(list => list.map(option => option.value).filter(Boolean));
  const quarterly = options.find(value => /^\d{4}-Q[1-4]$/.test(value));
  assert.ok(quarterly, 'quarterly pool available');
  await poolSelect.selectOption(quarterly);
  await button(settings, '保存设置').click();
  await until(() => states[0].nextPlan?.variant === 'anime', 'anime configured');

  await host.getByRole('button',{name:/进入队长预览/}).click();await until(()=>states[0].nextPlan.stage==='guide','guide');
  for(const i of [0,2]){await tab(pages[i],'准备');await button(pages[i],'确认就绪，开始组牌').click();}
  await until(()=>states[0].nextPlan.stage==='draft','draft');await button(spectator,'排队下一局').click();await until(()=>states[4].viewer.isQueuedForNextRound,'draft queued');await shot(spectator,'spectator-draft-queued',true);await button(spectator,'取消排队').click();await until(()=>!states[4].viewer.isQueuedForNextRound,'draft queue cancelled');await act(blueCaptain,roomId,'take',{workId:states[0].nextPlan.candidates[0].id});await button(blueCaptain,'选牌与操作').click();for(const light of [false,true]){await theme(blueCaptain,light);await shot(blueCaptain,`mobile-captain-console-${light?'light':'dark'}`,true);}await act(host,roomId,'done');await act(blueCaptain,roomId,'done');
  await button(host,'开始五秒倒计时').click();await until(()=>states[0].phase==='playing','playing');await button(spectator,'排队下一局').first().click();await until(()=>states[4].viewer.isQueuedForNextRound,'playing queued');await button(spectator,'取消排队').first().click();await until(()=>!states[4].viewer.isQueuedForNextRound,'playing queue cancelled');
  for(const [i,role] of [[0,'red-captain'],[2,'blue-captain'],[1,'operative'],[4,'spectator']]){
    const p=pages[i];
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      await p.setViewportSize(viewport);await tab(p,'棋盘');
      for(const light of [false,true]){await theme(p,light);await shot(p,`formal-${role}-${viewport.width}-${light?'light':'dark'}`,true);}
    }
    await theme(p,false);await p.setViewportSize(i===2?{width:390,height:844}:{width:1440,height:900});
  }
  for(let turn=0;turn<2;turn++){
    const team=states[0].currentTeam,ci=team==='red'?0:2,oi=ci+1,p=pages[ci];
    await tab(p,'棋盘');await p.getByPlaceholder('例如：机甲 / 学园 / 主角团').fill(`联想星${turn}`);await p.getByLabel('数字',{exact:true}).fill('2');
    assert.equal(await p.locator(`.clue-team-${team}`).count(),1);
    for(const light of [false,true]){await theme(p,light);await p.locator('.clue-form').screenshot({path:path.join(artifacts,`clue-${team}-${light?'light':'dark'}-detail.png`)});await shot(p,`clue-${team}-${light?'light':'dark'}-full`,true);}
    await button(p,'提交提示').click();await until(()=>!!states[0].clue,'clue accepted');
    await tab(pages[oi],'棋盘');await shot(pages[oi],`operative-${team}-action`,true);
    await button(pages[oi],'结束回合').click();await until(()=>states[0].currentTeam!==team,'opponent turn');
  }

  // Same browser identity, two tabs, different rooms. A misses room_closed while
  // disconnected; its recovery error must clear A's UI but preserve persisted B.
  const savedA=await host.evaluate(async()=>({session:(await import('/src/lib/storage.ts')).loadSession(),key:localStorage.getItem('cipai.private-identity.v1')}));
  const bTab=await host.context().newPage();await attach(bTab,5);await bTab.goto(base);await visible(button(bTab,'返回当前房间'));
  bTab.once('dialog',d=>d.accept());await button(bTab,'＋ 创建房间').click();await button(bTab.getByRole('dialog'),'经典词牌').click();await button(bTab.getByRole('dialog'),'创建房间 →').click();await until(()=>states[5]?.id&&states[5].id!==roomId,'same-identity B');const roomB=states[5].id;
  await host.evaluate(async()=>{(await import('/src/lib/socket.ts')).getSocket().disconnect();});
  const closer=io(process.env.PLAYTEST_API_URL??'http://127.0.0.1:3112',{transports:['websocket'],autoConnect:false});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('close A timeout')),10000);closer.on('connect',()=>closer.emit('reconnect_room',{roomId,sessionToken:savedA.session.sessionToken,identityKey:savedA.key}));closer.on('session',()=>closer.emit('disband_room',{roomId}));closer.on('room_closed',p=>{if(p.roomId===roomId){clearTimeout(timer);resolve();}});closer.on('error_message',p=>{clearTimeout(timer);reject(new Error(p.message));});closer.connect();});closer.disconnect();
  await host.evaluate(async saved=>{const socket=(await import('/src/lib/socket.ts')).getSocket();socket.connect();socket.emit('reconnect_room',{roomId:saved.session.roomId,sessionToken:saved.session.sessionToken,identityKey:saved.key});},savedA);
  await until(()=>host.locator('.room-identity').count().then(n=>n===0),'offline A UI invalidated');
  assert.equal(await bTab.evaluate(async()=>(await import('/src/lib/storage.ts')).loadSession()?.roomId),roomB);
  assert.equal(await host.evaluate(async()=>(await import('/src/lib/storage.ts')).loadSession()?.roomId),roomB);
  assert.equal(states[5].id,roomB);assert.equal(await host.evaluate(async id=>(await import('/src/lib/storage.ts')).loadRecoverableSessions()[id]??null,roomId),null);
  await bTab.evaluate(async id=>{(await import('/src/lib/socket.ts')).getSocket().emit('disband_room',{roomId:id});},roomB);
  console.log('offline A recovery clears its tab while same-account B session survives PASS');

  assert.deepEqual(errors,[]);await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify({passed:true,applicationCommit,screenshotRecords,checks:['formal red/blue captain, operative and spectator in desktop/mobile dark/light','same-account tabs A/B: A offline at closure self-heals without deleting stored B','spectator can queue/cancel during draft and playing, with server-authorized state','real red and blue clue forms use current team class, retain accessible input/submit, accept clues and end turns'],errors},null,2));console.log('formal role and clue screenshots PASS');
}finally{await browser.close();}
