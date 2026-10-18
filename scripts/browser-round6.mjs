import { readRoomState } from './room-observer.mjs';
import {execFileSync} from 'node:child_process';
import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.PLAYTEST_BASE_URL ?? 'http://127.0.0.1:5267';
const artifacts = path.resolve('output/playwright/round6/after');
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

const check=label=>{checks.push(label);console.log('PASS '+label);};
async function leave(p){
 await button(p,'打开快捷设置').click();
 p.once('dialog',d=>d.accept());
 await button(p,'离开房间').click();
}
async function pressureAndSeatChecks(host,roomId,join){
 const spec=pages[4];
 assert.equal(await button(spec,'排队下一局').count(),0);
 await visible(button(spec,'加入玩家席'));
 for(let i=5;i<12;i++){
  const p=await newPage(i);
  await loginGuest(p,`R6${i}号长昵称视觉压力${stamp}`);
  await join(p,i,true);
  if(i<9){await button(p,'加入玩家席').click();await until(()=>states[i]?.viewer.participantType==='player',`seat conversion ${i}`);}
 }
 await until(()=>states[0].players.length===8&&states[0].spectators.length===4,'12 clients');
 assert.equal(await button(spec,'加入玩家席').count(),0);
 assert.match(await spec.locator('.spectator-seat-actions').innerText(),/已满/);
 await shot(host,'lobby-8-players-12-clients-dark');
 await theme(host,true);await shot(host,'lobby-8-players-12-clients-light');await theme(host,false);
 for(let i=5;i<12;i++){await leave(pages[i]);await pages[i].context().close();}
 await until(()=>states[0].players.length===4&&states[0].spectators.length===1,'4+1 restored');
 await shot(host,'lobby-4-desktop-dark');await theme(host,true);await shot(host,'lobby-4-desktop-light');await theme(host,false);
 await tab(pages[2],'玩家');await shot(pages[2],'lobby-4-mobile-dark',true);await theme(pages[2],true);await shot(pages[2],'lobby-4-mobile-light',true);await theme(pages[2],false);await tab(pages[2],'准备');
 check('R10/R12 open spectator converts to a player; 8-player full state explains capacity; 12 real clients, MAX_PLAYERS remains 8');
}
async function mouseDrag(p,source,target,name,valid=true){
 await target.scrollIntoViewIfNeeded();await source.scrollIntoViewIfNeeded();
 const from=await source.boundingBox(),to=await target.boundingBox();
 assert.ok(from&&to,`drag boxes ${name}`);
 const a={x:from.x+from.width/2,y:from.y+Math.min(from.height/2,65)};
 const b={x:to.x+to.width/2,y:to.y+Math.min(to.height/2,45)};
 await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x+10,a.y+10,{steps:3});await p.mouse.move(b.x,b.y,{steps:24});await p.waitForTimeout(100);
 assert.equal(await p.locator('.draft-drag-ghost').count(),1,'real pointer ghost');
 if(name){assert.equal((await p.locator('.drop-hot').count())>0,valid,'only valid targets highlight');await p.screenshot({path:path.join(artifacts,`${name}.png`)});}
 await p.mouse.up();await p.waitForTimeout(250);
 assert.equal(await p.locator('.draft-drag-ghost').count(),0);
 assert.equal(await p.locator('.drop-hot').count(),0);
}
const candidate=(p,id)=>p.locator(`.draft-candidates [data-replace-id="${id}"] .draft-tile-main`);
const chosen=(p,id)=>p.locator(`.draft-selected-panel [data-replace-id="${id}"] .draft-tile-main`);
const zone=(p,kind)=>p.locator(`.draft-drop-zones [data-drop="${kind}"]`);
async function captureRoles(prefix){
 for(const [i,role] of [[0,'red-captain'],[2,'blue-captain'],[1,'operative'],[4,'spectator']]){
  const p=pages[i];const viewport=p.viewportSize();
  for(const size of [{width:1440,height:900},{width:390,height:844}]){
   await p.setViewportSize(size);await tab(p,'准备');
   const suffix=size.width===390?'mobile':'desktop';
   if(size.width===390&&await button(p,'实时组牌 '+(states[i].nextPlan?.publicSelectedWorkIds?.length??0)).isVisible().catch(()=>false))await button(p,'实时组牌 '+(states[i].nextPlan?.publicSelectedWorkIds?.length??0)).click();
   for(const light of [false,true]){await theme(p,light);await shot(p,`${prefix}-${role}-${suffix}-${light?'light':'dark'}`,size.width===390);}
  }
  await p.setViewportSize(viewport);await theme(p,false);
  if(viewport.width<761&&await button(p,'候选池').isVisible())await button(p,'候选池').click();
 }
}
const clueScreens=new Set();
async function finishNormally(round){
 let guesses=0;
 while(states[0].phase==='playing'&&guesses<80){
  const state=states[0];const ci=state.currentTeam==='red'?0:2,oi=ci+1;
  const captain=pages[ci],operative=pages[oi];
  await tab(captain,'棋盘');await tab(operative,'棋盘');
  if(!state.clue){await captain.waitForTimeout(3400);await captain.getByPlaceholder('例如：机甲 / 学园 / 主角团').fill(`联想${round}局${guesses}`);await captain.getByLabel('数字',{exact:true}).fill('1');if(!clueScreens.has(state.currentTeam)){clueScreens.add(state.currentTeam);await shot(captain,`clue-form-${state.currentTeam}-dark`);await theme(captain,true);await shot(captain,`clue-form-${state.currentTeam}-light`);await theme(captain,false);}await button(captain,'提交提示').click();await until(()=>!!states[0].clue,'clue');}
  if(guesses<2){await shot(captain,`round${round}-${state.currentTeam}-clue`);assert.equal(await captain.locator(`.clue-team-${state.currentTeam}`).count(),0);}
  const target=states[0].board.find(c=>c.role===states[0].currentTeam&&!c.revealed);assert.ok(target);
  const index=states[0].board.findIndex(c=>c.id===target.id);
  await operative.locator('.anime-board-card').nth(index).click();await button(operative,'猜牌').click();await button(operative,'确认猜牌').click();await until(()=>states[0].board.find(c=>c.id===target.id)?.revealed,'guess');
  guesses++;
  if(round===1&&guesses===2){await pages[3].context().setOffline(true);await until(()=>!states[0].players[3].connected,'offline');await pages[3].context().setOffline(false);await until(()=>states[0].players[3].connected,'reconnect');}
  await operative.waitForTimeout(300);
 }
 assert.equal(states[0].phase,'finished');assert.equal(states[0].endReason,'normal');
 check(`normal anime game ${round} completed with ${guesses} real preview/confirm guesses`);
}

try {
  const host = await newPage(0);
  await loginGuest(host, `R6房主${stamp}`);
  const redOperative = await newPage(1);
  await loginGuest(redOperative, `R6红队${stamp}`);
  const blueCaptain = await newPage(2, true);
  await loginGuest(blueCaptain, `R6蓝队${stamp}`);
  const blueOperative = await newPage(3, true);
  await loginGuest(blueOperative, `R6蓝队队员${stamp}`);
  const spectator = await newPage(4);
  await loginGuest(spectator, `R6旁观${stamp}`);

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
  const options = await poolSelect.locator('option').evaluateAll(list => list.map(option => option.value).filter(Boolean));
  const quarterly = options.find(value => /^\d{4}-Q[1-4]$/.test(value));
  assert.ok(quarterly, 'quarterly pool available');
  await poolSelect.selectOption(quarterly);
  await settings.getByLabel('历局作品轮换 · 排除已玩系列').uncheck();
  await button(settings, '保存设置').click();
  await until(() => states[0].nextPlan?.variant === 'anime', 'anime configured');
  await pressureAndSeatChecks(host, roomId, join);
  await host.getByRole('button', { name: /进入队长预览/ }).click();
  await until(() => states[0].nextPlan?.stage === 'guide', 'guide');


  // Preserve the existing mobile gesture and pointer implementation throughout.
  for(const i of [0,2]){await tab(pages[i],'准备');await button(pages[i],'确认就绪，开始组牌').click();}
  await until(()=>states[0].nextPlan?.stage==='draft','draft');
  const ids=states[0].nextPlan.candidates.map(w=>w.id);
  const [a,b,c,d,e,f,g]=ids;
  const claims=()=>states[0].nextPlan.captainView.claims;
  await shot(host,'draft-public-empty');
  await mouseDrag(host,candidate(host,a),zone(host,'take'),'D01-mouse-take-ghost');
  await until(()=>claims()[a]?.team==='red','mouse take');
  await until(()=>states[4].nextPlan.publicSelectedWorkIds?.includes(a),'public includes');
  await shot(host,'draft-public-one');
  await mouseDrag(host,chosen(host,a),host.locator('.draft-candidates'),'D02-release-to-pool');
  await until(()=>!claims()[a],'release via pool');
  await mouseDrag(host,candidate(host,a),zone(host,'take'));
  await until(()=>claims()[a],'retake');
  await mouseDrag(host,chosen(host,a),zone(host,'release'),'D03-release-zone');
  await until(()=>!claims()[a],'release zone');
  await mouseDrag(host,candidate(host,a),zone(host,'take'));
  await until(()=>claims()[a],'retake for replace');
  await mouseDrag(host,candidate(host,b),chosen(host,a),'D05-atomic-replace-ghost');
  await visible(host.getByRole('dialog',{name:'更换作品',exact:true}));
  await button(host,'取消').click();assert.ok(claims()[a]);assert.equal(claims()[b],undefined);
  await mouseDrag(host,candidate(host,b),chosen(host,a));
  await button(host,'确认更换').click();await until(()=>claims()[b]&&!claims()[a],'replace confirmed');
  check('D01/D02/D03/D05/D06 real mouse take, release-to-pool, release-zone, replace cancel/confirm; ghost/highlights cleaned');

  await mouseDrag(host,candidate(host,c),zone(host,'interfere'),'D09-interference-ghost');
  await button(host,'确认投放').click();await until(()=>claims()[c]?.kind==='interference','interference');
  assert.equal(states[4].nextPlan.publicSelectedWorkIds.includes(c),false);
  await mouseDrag(host,candidate(host,d),zone(host,'interfere'));
  await button(host,'确认投放').click();await until(()=>claims()[d]?.kind==='interference'&&!claims()[c],'interference replacement');

  // Mobile: a short swipe scrolls; only a 350ms hold becomes a drag.
  await tab(blueCaptain,'准备');await button(blueCaptain,'候选池').click();
  const cdp=await blueCaptain.context().newCDPSession(blueCaptain);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await candidate(blueCaptain,e).scrollIntoViewIfNeeded();
  let rect=await candidate(blueCaptain,e).boundingBox();
  let x=rect.x+rect.width/2,y=rect.y+50;
  await touch('touchStart',x,y);await touch('touchMove',x,y-55);await touch('touchEnd',x,y-55);await blueCaptain.waitForTimeout(300);
  assert.equal(await blueCaptain.locator('.draft-drag-ghost').count(),0);
  assert.equal(claims()[e],undefined);
  await candidate(blueCaptain,e).scrollIntoViewIfNeeded();rect=await candidate(blueCaptain,e).boundingBox();x=rect.x+rect.width/2;y=rect.y+45;
  await touch('touchStart',x,y);await blueCaptain.waitForTimeout(420);
  await visible(blueCaptain.locator('.draft-drag-ghost'));
  const dock=await blueCaptain.locator('.draft-dock [data-drop="take"]').boundingBox();
  await touch('touchMove',dock.x+dock.width/2,dock.y+dock.height/2);await blueCaptain.waitForTimeout(120);
  await blueCaptain.screenshot({path:path.join(artifacts,'D07-mobile-longpress-dock-ghost.png')});
  await touch('touchEnd',dock.x,dock.y);await until(()=>claims()[e]?.team==='blue','touch take');
  await cdp.detach();
  // Replacement button/preview remains a keyboard/tap alternative.
  await candidate(blueCaptain,f).click();await button(blueCaptain,'领取这张').click();await until(()=>claims()[f]?.team==='blue','mobile tap alternative');
  check('D07/D08 mobile short swipe does not select; real CDP touch hold shows original ghost/dock and takes; tap+preview alternative works');

  // Protected opponent take rejects immediately; 10 seconds later real drag steals.
  await mouseDrag(host,candidate(host,f),zone(host,'take'));
  assert.equal(claims()[f].team,'blue');
  check('D04 opponent selection is protected for the original 10 seconds');
  await captureRoles('draft');
  await until(()=>Date.now()>claims()[e].protectedUntil,'10 second protection passed');
  const beforeSteal=[...states[4].nextPlan.publicSelectedWorkIds].sort();
  await mouseDrag(host,candidate(host,e),zone(host,'take'),'D04-steal-after-protection');
  await until(()=>claims()[e]?.team==='red','steal');
  assert.deepEqual([...states[4].nextPlan.publicSelectedWorkIds].sort(),beforeSteal);
  for(const i of [1,3,4]){
   assert.equal(await pages[i].locator('.draft-control-panel').count(),0);
   const plan=states[i].nextPlan;
   for(const field of ['captainView','claims','protectedUntil','myBookmarks','interference'])assert.equal(JSON.stringify(plan).includes('"'+field+'"'),false,`private field ${field}`);
  }
  check('D04/R11 ordinary player and spectator have no captain console or private network fields; steal preserves public set');

  // Dynamic strip cardinality and stable console placement at actual legal quotas.
  for(let n=0;n<12;){
   const next=ids.find(id=>!claims()[id]);
   const count=Object.values(claims()).filter(q=>q.kind==='manual'&&q.team==='red').length;
   const who=count<6?host:blueCaptain;
   await act(who,roomId,'take',{workId:next});
   n=Object.values(claims()).filter(q=>q.kind==='manual').length;
   if(n===6)await shot(host,'draft-public-six');
  }
  await shot(host,'draft-public-twelve');
  const topBefore=(await host.locator('.draft-control-panel').boundingBox()).y;
  await host.locator('.draft-public-head button').focus();await host.keyboard.press('Enter');assert.equal(await host.locator('.draft-public-head button').getAttribute('aria-expanded'),'false');await shot(host,'draft-public-collapsed');
  assert.ok(Math.abs((await host.locator('.draft-control-panel').boundingBox()).y-topBefore)<2,'collapse keeps right console aligned');
  await host.locator('.draft-public-head button').click();
  await host.setViewportSize({width:900,height:1024});await shot(host,'draft-tablet');await host.setViewportSize({width:1440,height:900});
  await host.emulateMedia({reducedMotion:'reduce'});assert.equal(await host.locator('.draft-tile').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await host.emulateMedia({reducedMotion:'no-preference'});
  await candidate(host,g).click();
  const dialog=host.getByRole('dialog').last();await dialog.getByRole('button',{name:/关闭/}).click();
  await host.getByLabel('搜索候选动画').fill('不存在的作品');assert.equal(await host.locator('.draft-candidates .draft-tile').count(),0);await host.getByLabel('搜索候选动画').fill('');
  check('D11/D12 public 0/1/6/12, collapse/expand and tablet; original search/filter/preview remain reachable');


  // Exercise the real 180s server clock, without a shortened business timer.
  while(states[0].nextPlan.endsAt-Date.now()>19500){
    const left=Math.ceil((states[0].nextPlan.endsAt-Date.now())/1000);
    console.log(`draft boundary check: ${left}s remaining`);
    await host.waitForTimeout(Math.min(5000,Math.max(100,states[0].nextPlan.endsAt-Date.now()-19500)));
  }
  const other=Number(Object.keys(claims()).find(id=>claims()[id].team==='blue'&&claims()[id].kind==='manual'));
  const old=Number(Object.keys(claims()).find(id=>claims()[id].team==='red'&&claims()[id].kind==='manual'));
  await mouseDrag(host,candidate(host,other),chosen(host,old),'D09-last20-replace-attempt',false);
  assert.equal(await host.getByRole('dialog',{name:'更换作品',exact:true}).count(),0);
  assert.equal(claims()[other].team,'blue');assert.equal(claims()[old].team,'red');
  assert.match((await host.locator('.draft-bookmark-status').allInnerTexts()).join(' '),/最后 20/);
  const unclaimed=ids.find(id=>!claims()[id]);
  await candidate(host,unclaimed).click();assert.equal(await button(host,'投放为干扰牌').count(),0);await host.keyboard.press('Escape');
  check('D09 real final-20s clock rejects steal/replace atomically and removes interference action; old selections preserved');
  await act(host,roomId,'done');await act(blueCaptain,roomId,'done');await until(()=>states[0].nextPlan.stage==='sealed','seal');
  assert.equal(states[4].nextPlan.publicSelectedWorkIds,undefined);
  await button(host,'开始五秒倒计时').click();await until(()=>states[0].phase==='playing','game 1');

  // Compare the actual cover board at the three required viewport sizes. Keep
  // the current default until measured screenshots justify a product change.
  const measurements=[];
  async function boardRatios(size){
   for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:900,height:1024}]){
    await host.setViewportSize(viewport);await tab(host,'棋盘');
    for(const ratio of ['current','4-3','1-1']){
     const style=await host.addStyleTag({content:ratio==='current'?'/* existing board rows */':`.anime-board{grid-auto-rows:auto!important}.anime-board-card{aspect-ratio:${ratio==='4-3'?'4/3':'1/1'};min-height:0!important}`});
     for(const light of [false,true]){await theme(host,light);await shot(host,`board-${size}-${viewport.width}-${ratio}-${light?'light':'dark'}`,viewport.width===390);}
     measurements.push({size,viewport,ratio,...await host.locator('.anime-board').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight}))});
     await style.evaluate(el=>el.remove());
    }
   }
   await host.setViewportSize({width:1440,height:900});await theme(host,false);
  }
  await boardRatios('5x5');
  await finishNormally(1);
  const firstReplay=states[0].replayId;assert.ok(firstReplay);
  // Use the existing next-game plan dialog, preserving the actual gameplay flow.
  await button(host,'准备下一局').first().click();
  await host.getByRole('dialog',{name:'下一局计划'}).getByLabel('棋盘',{exact:true}).selectOption('6x6');
  const configButton=host.getByRole('dialog',{name:'下一局计划'}).getByRole('button',{name:/保存配置并更新候选池/});
  await configButton.click();await host.waitForTimeout(350);
  await host.getByRole('dialog',{name:'下一局计划'}).getByRole('button',{name:'进入队长预览',exact:true}).click();
  await until(()=>states[0].phase==='lobby'&&states[0].nextPlan.stage==='guide','next guide');
  await act(host,roomId,'ready');await act(blueCaptain,roomId,'ready');await until(()=>states[0].nextPlan.stage==='draft','second draft');
  assert.deepEqual(states[4].nextPlan.publicSelectedWorkIds,[]);
  await act(host,roomId,'done');await act(blueCaptain,roomId,'done');await until(()=>states[0].nextPlan.stage==='sealed','second sealed');
  await button(host,'开始五秒倒计时').click();await until(()=>states[0].phase==='playing','game 2');
  assert.equal(states[0].board.length,36);
  await boardRatios('6x6');await finishNormally(2);
  assert.notEqual(states[0].replayId,firstReplay);
  await fs.writeFile(path.join(artifacts,'board-measurements.json'),JSON.stringify(measurements,null,2));


  await blueCaptain.setViewportSize({width:1440,height:900});await blueCaptain.goto(base);
  blueCaptain.once('dialog',d=>d.accept());await button(blueCaptain,'＋ 创建房间').click();
  await button(blueCaptain.getByRole('dialog'),'经典词牌').click();await button(blueCaptain.getByRole('dialog'),'创建房间 →').click();
  await until(()=>states[2].id!==roomId,'room B');const roomB=states[2].id;
  await redOperative.goto(`${base}/room/${roomB}`);await button(redOperative,'加入房间').click();await until(()=>states[1].id===roomB,'operative entered B');
  // Same identity in another real tab: authoritative close clears only this room.
  const otherTab=await host.context().newPage();await attach(otherTab,12);await otherTab.goto(base);
  await visible(button(otherTab,'返回当前房间'));
  await button(host,'打开快捷设置').click();await button(host,'离开房间').isVisible();await button(host,'关闭设置').click();
  const session=await host.evaluate(async()=> (await import('/src/lib/storage.ts')).loadSession());
  await raw(host,'disband_room',{roomId,sessionToken:session.sessionToken});await until(()=>host.evaluate(async()=>!(await import('/src/lib/storage.ts')).loadSession()),'host close received');

  await redOperative.waitForTimeout(250);assert.equal(states[1].id,roomB);
  assert.equal(await redOperative.evaluate(async()=> (await import('/src/lib/storage.ts')).loadSession()?.roomId),roomB);
  await raw(redOperative,'reconnect_room',{roomId,sessionToken:'stale-a',identityKey:null});await redOperative.waitForTimeout(250);
  assert.equal(await redOperative.evaluate(async()=> (await import('/src/lib/storage.ts')).loadSession()?.roomId),roomB);
  check('R03 real A closes after operative entered B; late A recovery error leaves B active');
  await raw(blueCaptain,'disband_room',{roomId:roomB});await until(()=>blueCaptain.evaluate(async()=>!(await import('/src/lib/storage.ts')).loadSession()),'room B closed');
  await otherTab.goto(base);await host.goto(base);
  await until(()=>host.locator('.current-room-return').count().then(n=>n===0),'close nav');
  assert.equal(await otherTab.locator('.current-room-return').count(),0);
  for(const p of [host,otherTab])assert.equal(await p.evaluate(async id=>(await import('/src/lib/storage.ts')).loadRecoverableSessions()[id]??null,roomId),null);
  await host.reload();assert.equal(await host.locator('.current-room-return').count(),0);
  check('R01/R02 room close clears matching recoverable credentials across tabs and reload, no stale participation banner');
  for(const light of [false,true]){await theme(host,light);await shot(host,`brand-home-desktop-${light?'light':'dark'}`);await host.setViewportSize({width:390,height:844});await shot(host,`brand-home-mobile-${light?'light':'dark'}`,true);await host.setViewportSize({width:1440,height:900});}
  await host.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await host.locator('.home-room').first().evaluate(el=>getComputedStyle(el).transitionDuration).catch(()=> '0s'),'0s');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify({passed:true,checks,measurements,applicationCommit,screenshotRecords,screenshots:(await fs.readdir(artifacts)).filter(f=>f.endsWith('.png')&&!f.startsWith('failure-')),browser:browser.version(),viewports:['1440x900','390x844','900x1024']},null,2));
  console.log(JSON.stringify({passed:true,checks}));
} catch(error){
 for(const [i,p] of pages.entries())if(p&&!p.isClosed()){await p.screenshot({path:path.join(artifacts,`failure-${i}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(artifacts,`failure-${i}.txt`),await p.locator('body').innerText().catch(()=>''));}
 throw error;
} finally {await browser.close();}
