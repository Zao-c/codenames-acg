import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const base=process.env.PLAYTEST_BASE_URL, api=process.env.PLAYTEST_API_URL;
const artifacts=path.resolve('output/playwright/lobby-v2');await fs.mkdir(artifacts,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome',undefined]){try{browser=await chromium.launch({channel,headless:true});break;}catch{}}
if(!browser)throw new Error('No browser available');
const pages=[],states=[],errors=[],clients=[],checks=[];
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const until=async(fn,label)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out: ${label}`);};
const tab=async(p,name)=>{const n=p.getByRole('navigation',{name:'房间导航'});if(await n.isVisible())await button(n,name).click();};
async function shot(p,name){await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(artifacts,`${name}.png`),fullPage:true});const b=await p.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert.ok(b.s<=b.w+1,`${name}: overflow ${JSON.stringify(b)}`);}
async function create(p,mode){await button(p,'＋ 创建房间').click();await button(p.getByRole('dialog'),mode).click();await button(p.getByRole('dialog'),'创建房间 →').click();}
async function nextState(i,fn){const before=states[i]?.updatedAt;await fn();await until(()=>states[i]?.updatedAt!==before,'new server snapshot');}
try{
  for(let i=0;i<8;i++){
    const mobile=i===2||i===3;
    const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
    await context.addInitScript(({i})=>{localStorage.setItem('acg-codenames-identity',JSON.stringify({mode:'guest',nickname:`大厅验收${i}`,username:'',avatarUrl:null}));},{i});
    const p=await context.newPage();pages.push(p);p.on('response',async response=>{if(!response.url().includes('/socket.io/')||!response.url().includes('transport=polling'))return;try{for(const packet of (await response.text()).split('\x1e'))if(packet.startsWith('42')){const [event,data]=JSON.parse(packet.slice(2));if(event==='room_state')states[i]=data;}}catch{}});p.on('pageerror',e=>errors.push(e.message));p.on('websocket',ws=>ws.on('framereceived',f=>{try{const s=String(f.payload);if(s.startsWith('42')){const [e,d]=JSON.parse(s.slice(2));if(e==='room_state')states[i]=d;}}catch{}}));await p.goto(base);
  }
  const host=pages[0];await create(host,'动画组牌');await until(()=>states[0]?.nextPlan?.variant==='anime','anime create');const id=states[0].id;
  await host.getByRole('heading',{name:'本局玩法',exact:true}).waitFor({state:'visible',timeout:20000});
  assert.equal(await button(host,'取消本次准备').isVisible(),false);
  assert.equal(await host.getByRole('heading',{name:'本局玩法',exact:true}).count(),1);
  assert.equal(await host.getByRole('heading',{name:'队伍与成员',exact:true}).count(),1);
  for(let i=1;i<5;i++){await pages[i].goto(`${base}/room/${id}`);await button(pages[i],'加入房间').click();await until(()=>states[i]?.id===id,`join ${i}`);}
  assert.ok(await button(host,'保留队长随机队员').isDisabled());
  for(let n=0;n<5;n++)await nextState(0,()=>button(host,'全员重新随机').click());
  const fixed={...states[0].nextPlan.captains};
  for(let n=0;n<10;n++){
    await nextState(0,()=>button(host,'保留队长随机队员').click());assert.deepEqual(states[0].nextPlan.captains,fixed);
    for(const t of ['red','blue'])assert.equal(states[0].players.find(p=>p.id===fixed[t]).role,'spymaster');
    assert.ok(Math.abs(states[0].players.filter(p=>p.team==='red').length-states[0].players.filter(p=>p.team==='blue').length)<=1);
  }
  checks.push('real Socket.IO: repeat all-player shuffle 5 times and fixed-captain shuffle 10 times, odd-player balance and synchronized plan captains');
  // Self seat and host nomination live inside the same roster.
  await tab(pages[2],'玩家');const oldTeam=states[2].players.find(p=>p.nickname==='大厅验收2').team;
  await nextState(2,()=>pages[2].getByLabel('我的队伍',{exact:true}).selectOption(oldTeam==='red'?'blue':'red'));
  await nextState(2,()=>pages[2].getByLabel('我的队伍',{exact:true}).selectOption(oldTeam));
  await nextState(0,()=>button(host,'全员重新随机').click());
  await button(host,'修改设置').click();const config=host.getByRole('dialog',{name:'本局设置'});
  assert.deepEqual(await config.getByLabel('下一局计分').locator('option').allTextContents(),['胜场制','积分制']);
  await config.getByLabel('棋盘',{exact:true}).selectOption('6x6');await config.getByLabel('下一局计分').selectOption('scoring');
  await config.getByLabel('动画作品池',{exact:true}).selectOption('2026-Q3');await button(config,'保存设置').click();await until(()=>states[0].nextPlan.settings.boardMode==='6x6','saved config');
  assert.equal(await host.locator('.anime-config').count(),0);
  await pages[4].getByLabel('发送聊天消息').fill('大家准备好了吗？');await button(pages[4],'发送').click();await host.getByText('大家准备好了吗？',{exact:true}).waitFor();
  assert.equal(await host.getByText('GG',{exact:true}).count(),0);assert.equal(await host.locator('.danmaku-toggle').count(),0);
  await button(host,'打开快捷设置').click();await button(host,'关闭弹幕').click();assert.ok(await button(host,'开启弹幕').getAttribute('aria-pressed')==='false');await button(host,'关闭设置').click();
  await shot(host,'01-preparation-desktop-dark');await theme(host,true);await shot(host,'02-preparation-desktop-light');await theme(host,false);
  const nextAction=await host.getByRole('region',{name:'下一步操作'}).getByRole('button',{name:'进入队长预览 →',exact:true}).boundingBox();
  assert.ok(nextAction.y+nextAction.height<=900,'primary next action fits desktop first viewport');
  await tab(pages[2],'准备');await shot(pages[2],'03-preparation-mobile-dark');await tab(pages[2],'玩家');await shot(pages[2],'04-members-mobile-dark');await theme(pages[2],true);await shot(pages[2],'05-members-mobile-light');await tab(pages[2],'聊天');await shot(pages[2],'06-chat-mobile-light');await theme(pages[2],false);await tab(pages[2],'准备');
  checks.push('one settings dialog, score choices, merged self/roster, live chat, preferences, desktop/mobile and dark/light without overflow');
  // Two other real rooms populate the public directory; one is genuinely playing.
  await create(pages[5],'经典词牌');await until(()=>!!states[5],'classic create');const classicId=states[5].id;
  for(const size of ['7x7','9x9']){
    await button(pages[5],'修改设置').click();const settings=pages[5].getByRole('dialog',{name:'本局设置'});
    await settings.getByLabel('棋盘',{exact:true}).selectOption(size);await button(settings,'保存设置').click();
    await until(()=>states[5].nextPlan?.settings.boardMode===size,`classic ${size} saved`);
  }
  await button(pages[5],'修改设置').click();const classicSettings=pages[5].getByRole('dialog',{name:'本局设置'});
  await classicSettings.getByLabel('棋盘',{exact:true}).selectOption('5x5');
  await classicSettings.locator('.v2-advanced summary').click();
  await classicSettings.getByLabel('经典回合计时').selectOption('timed');await classicSettings.getByLabel('经典翻牌显示').selectOption('color-only');
  assert.notEqual(states[5].nextPlan.settings.timerMode,'timed','advanced edits are saved atomically');
  await classicSettings.getByLabel('上传文字题库').setInputFiles({name:'大厅上传题库.txt',mimeType:'text/plain',buffer:Buffer.from(Array.from({length:110},(_,i)=>`联想词条${i}`).join('\n'))});
  await button(classicSettings,'保存设置').click();await until(()=>states[5].nextPlan?.wordPackName==='大厅上传题库','uploaded classic pack');
  assert.equal(states[5].nextPlan.settings.timerMode,'timed');assert.equal(states[5].nextPlan.settings.flipMode,'color-only');
  for(let i=0;i<3;i++){const c=io(api,{transports:['websocket']});clients.push(c);await new Promise(r=>c.on('connect',r));await new Promise((resolve,reject)=>{c.once('session',resolve);c.once('error_message',d=>reject(new Error(d.message)));c.emit('join_room',{roomId:classicId,nickname:`公开大厅成员${i}`,identityKey:crypto.randomBytes(32).toString('hex')});});}
  await until(()=>states[5].players.length===4,'classic 4 players');await button(pages[5],'全员重新随机').click();await button(pages[5],'开始游戏').click();await until(()=>states[5].phase==='playing','classic playing');
  await create(pages[6],'揭幕猜番');await until(()=>states[6]?.gameMode==='reveal-guess','dedicated reveal flow');assert.equal(await pages[6].locator('.preparation-lobby').count(),0);
  const home=pages[7];await home.locator('.home-room').nth(2).waitFor();assert.equal(await home.locator('.home-room').count(),3);
  const cards=await home.locator('.home-room').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,w:e.getBoundingClientRect().width,y:e.getBoundingClientRect().y})));
  assert.ok(cards.every(c=>Math.abs(c.w-cards[0].w)<1&&c.y===cards[0].y));assert.equal(await home.locator('.home-room').first().getAttribute('data-room-id')===classicId,false);
  assert.equal(await home.locator('.home-room').getByText(/房主随机|创建了房间/).count(),0);
  await shot(home,'07-home-desktop-dark');await theme(home,true);await shot(home,'08-home-desktop-light');
  await button(home.getByRole('group',{name:'筛选公开房间'}),'进行中').click();assert.equal(await home.locator('.home-room').count(),1);assert.equal(await home.locator('.home-room').first().getAttribute('data-room-id'),classicId);assert.ok(await button(home.locator('.home-room'),'旁观').isVisible());
  await button(home.getByRole('group',{name:'筛选公开房间'}),'可加入').click();assert.equal(await home.locator('.home-room').count(),2);await button(home.getByRole('group',{name:'筛选公开房间'}),'全部').click();
  await home.setViewportSize({width:390,height:844});await shot(home,'09-home-mobile-light');await theme(home,false);await home.setViewportSize({width:360,height:740});await shot(home,'10-home-mobile-dark-360');
  checks.push('three real public rooms fill three equal columns; joinable-first sorting, filters, classic 5/7/9 sizes and uploaded word pack, reveal dedicated preparation');
  await button(host,'进入队长预览 →').click();await until(()=>states[0].nextPlan.stage==='guide','guide');
  const capPages=()=>['red','blue'].map(t=>pages[Number(states[0].players.find(p=>p.id===states[0].nextPlan.captains[t]).nickname.slice(-1))]);
  const [red,blue]=capPages();for(const p of [red,blue])await tab(p,'准备');
  await button(red,'预览候选作品 →').click();await red.locator('.draft-tile').first().locator('.draft-tile-main').click();await red.getByRole('dialog').last().getByRole('link',{name:'在 Bangumi 查看'}).waitFor();assert.equal(await button(red,'领取这张').count(),0);await red.getByRole('dialog').last().locator('.dialog-heading button').click();await button(red,'关闭队长预览').click();
  await button(red,'确认就绪，开始组牌').click();assert.equal(states[0].nextPlan.endsAt,undefined);
  host.once('dialog',d=>d.accept());await button(host,'取消本次准备').click();await until(()=>states[0].nextPlan.stage==='planning','cancel guide');assert.equal(await button(host,'取消本次准备').count(),0);
  await button(host,'进入队长预览 →').click();await until(()=>states[0].nextPlan.stage==='guide','second guide');
  for(const p of capPages()){await tab(p,'准备');await button(p,'确认就绪，开始组牌').click();}
  await until(()=>states[0].nextPlan.stage==='draft','draft');assert.ok(states[0].nextPlan.endsAt>Date.now()+175000);
  for(const p of capPages()){const b=button(p,'选牌与操作');if(await b.isVisible())await b.click();await button(p,'手选完成，剩余随机补齐').click();}
  await until(()=>states[0].nextPlan.stage==='sealed','sealed');await shot(host,'11-sealed-desktop');assert.ok(await button(host,'全员重新随机').isDisabled());assert.equal(await button(host,'进入队长预览 →').count(),0);
  await button(host,'开始五秒倒计时').click();await host.locator('.start-countdown').waitFor();await button(host,'取消开始').click();await until(()=>!states[0].countdown,'cancel countdown');assert.equal(states[0].nextPlan.stage,'sealed');
  await button(host,'开始五秒倒计时').click();await until(()=>states[0].phase==='playing','anime playing');assert.equal(states[0].board.length,36);
  checks.push('planning/guide/draft/sealed/countdown/playing server stages, preview cannot take, one-captain no timer, cancel/reset, both ready starts 180s, sealed locks and countdown cancel');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
}catch(e){for(let i=0;i<pages.length;i++){await pages[i].screenshot({path:path.join(artifacts,`failure-${i}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(artifacts,`failure-${i}.txt`),await pages[i].locator('body').innerText().catch(()=>''));}await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify({passed:false,checks,errors,failure:e.message},null,2));throw e;}
finally{for(const c of clients)c.disconnect();await browser.close();}
