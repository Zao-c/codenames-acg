import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {theme} from './browser-support.mjs';
import {execFileSync} from 'node:child_process';
const base=process.env.PLAYTEST_BASE_URL??'http://127.0.0.1:5287';
const stage=process.env.ROUND7_CAPTURE??'after';
const applicationCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const out=path.resolve('output/playwright/round7',stage);
await fs.mkdir(out,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome',undefined])try{browser=await chromium.launch({channel,headless:true});break;}catch{}
assert.ok(browser);const pages=[],states=[],records=[],errors=[];
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function until(fn,label){for(let i=0;i<240;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label);}
async function tab(p,name){const nav=p.getByRole('navigation',{name:'房间导航'});if(await nav.isVisible())await button(nav,name).click();}
async function emit(p,event,payload){return p.evaluate(async({event,payload})=>{const socket=(await import('/src/lib/socket.ts')).getSocket();if(event!=='plan_action'){socket.emit(event,payload);return {ok:true};}return new Promise(resolve=>socket.emit(event,payload,result=>resolve(result??{ok:true})));},{event,payload});}
async function act(p,roomId,kind,extra={}){const result=await emit(p,'plan_action',{roomId,version:states[0].nextPlan.version,kind,...extra});assert.ok(result.ok,result.message);await p.waitForTimeout(100);}
const viewports=[{width:1440,height:900},{width:900,height:1024},{width:390,height:844}];
async function shot(p,name){await p.evaluate(()=>scrollTo(0,0));await p.evaluate(()=>document.fonts.ready);const viewport=p.viewportSize();const light=await p.evaluate(()=>document.documentElement.classList.contains('light'));const file=`${name}-${viewport.width}-${light?'light':'dark'}.png`;await p.screenshot({path:path.join(out,file),fullPage:true});const metrics=await p.evaluate(()=>{const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};return{viewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,board:rect('.anime-board'),card:rect('.anime-board-card'),identity:rect('.room-identity'),console:rect('.draft-control-panel'),lobby:rect('.v2-lobby-grid'),next:rect('.v2-next-step'),chat:rect('.v2-chat')};});assert.ok(metrics.scrollWidth<=viewport.width+1,file+' overflow');records.push({file,metrics});}
async function matrix(p,name,tabName='棋盘'){for(const viewport of viewports){await p.setViewportSize(viewport);await tab(p,tabName);for(const light of [false,true]){await theme(p,light);await shot(p,name);if(name.startsWith("draft-")&&viewport.width===390){await button(p,"选牌与操作").click();await shot(p,name+"-console");await button(p,"候选池").click();}}}await p.setViewportSize(viewports[0]);await theme(p,false);}
async function newPlayer(i){const context=await browser.newContext({viewport:viewports[0]});const p=await context.newPage();pages[i]=p;p.on('pageerror',e=>errors.push(e.message));p.on('websocket',ws=>ws.on('framereceived',frame=>{try{if(String(frame.payload).startsWith('42')){const[e,d]=JSON.parse(String(frame.payload).slice(2));if(e==='room_state')states[i]=d;}}catch{}}));p.on('response',async r=>{if(r.url().includes('/socket.io/')&&r.request().method()==='GET')try{for(const packet of(await r.text()).split('\x1e'))if(packet.startsWith('42')){const[e,d]=JSON.parse(packet.slice(2));if(e==='room_state')states[i]=d;}}catch{}});await p.goto(base+'/login');await button(p,'游客').click();await p.getByPlaceholder('输入昵称直接开玩').fill(`R7视觉${Date.now().toString().slice(-4)}${i}`);await button(p,'快速进入').click();await button(p,'＋ 创建房间').waitFor();return p;}
try{
 const host=await newPlayer(0);await button(host,'＋ 创建房间').click();const create=host.getByRole('dialog',{name:'创建一间房间'});await button(create,'动画组牌').click();await button(create,'创建房间 →').click();await until(()=>!!states[0]?.id,'host');const id=states[0].id;
 await matrix(host,'lobby-1','准备');
 for(let i=1;i<9;i++){const p=await newPlayer(i);await p.goto(base+'/room/'+id);await button(p,i===4?'旁观':'加入房间').click();await until(()=>states[i]?.id===id,'join'+i);if(i===4)await matrix(host,'lobby-4','准备');}
 await matrix(host,'lobby-8','准备');
 for(let i=5;i<9;i++){await emit(pages[i],'leave_room',{roomId:id});await pages[i].context().close();}await until(()=>states[0].players.length===4,'four');
 for(let i=0;i<4;i++){await pages[i].getByLabel('我的队伍',{exact:true}).selectOption(i<2?'red':'blue');await pages[i].waitForTimeout(120);if(i%2===0)await pages[i].getByLabel('我的身份',{exact:true}).selectOption('spymaster');await pages[i].waitForTimeout(120);}
 for(const board of ['5x5','6x6']){
  if(board==='6x6'){await emit(host,'return_to_lobby',{roomId:id});await until(()=>states[0].phase==='lobby','lobby');}
  await button(host,'修改设置').click();const settings=host.getByRole('dialog',{name:'本局设置'});await settings.getByLabel('棋盘',{exact:true}).selectOption(board);const pool=settings.getByLabel('动画作品池',{exact:true});const options=await pool.locator('option').evaluateAll(list=>list.map(o=>o.value));await pool.selectOption(options.find(v=>/^\d{4}-Q[1-4]$/.test(v)));await button(settings,'保存设置').click();
  await host.getByRole('button',{name:/进入队长预览/}).click();await until(()=>states[0].nextPlan.stage==='guide','guide');for(const i of [0,2])await button(pages[i],'确认就绪，开始组牌').click();await until(()=>states[0].nextPlan.stage==='draft','draft');
  if(board==='5x5'){await matrix(host,'draft-0','准备');const ids=states[0].nextPlan.candidates.map(w=>w.id);await act(host,id,'take',{workId:ids[0]});await matrix(host,'draft-1','准备');for(let n=1;n<6;n++)await act(host,id,'take',{workId:ids[n]});await matrix(host,'draft-6','准备');}
  await act(host,id,'done');await act(pages[2],id,'done');await until(()=>states[0].nextPlan.stage==='sealed','sealed');
  if(stage==='after'){
   const spec=pages[4];assert.ok(states[4].viewer.canQueueForNextRound);
   await spec.locator('.room-identity').getByRole('button',{name:'排队下一局',exact:true}).click();await until(()=>states[4].viewer.isQueuedForNextRound,'sealed queue');
   await spec.locator('.room-identity').getByRole('button',{name:'取消排队',exact:true}).click();await until(()=>!states[4].viewer.isQueuedForNextRound,'sealed cancel queue');
   await matrix(spec,`sealed-${board}-spectator`,'准备');
  }
  await button(host,'开始五秒倒计时').click();await until(()=>states[0].phase==='playing','playing');
  for(const[i,role]of[[0,'red-captain'],[2,'blue-captain'],[1,'red-operative'],[3,'blue-operative'],[4,'spectator']])await matrix(pages[i],`board-${board}-${role}`);
  for(let turn=0;turn<2;turn++){const team=states[0].currentTeam,i=team==='red'?0:2,p=pages[i];await p.getByPlaceholder('例如：机甲 / 学园 / 主角团').fill('星河'+turn);await matrix(p,`clue-${board}-${team}`);await button(p,'提交提示').click();await until(()=>!!states[0].clue,'clue');await matrix(pages[i+1],`guess-${board}-${team}`);await button(pages[i+1],'结束回合').click();await until(()=>states[0].currentTeam!==team,'turn');}
  await emit(host,'force_end_game',{roomId:id,mode:'abort'});await until(()=>states[0].phase==='finished','finished');await matrix(pages[4],`finished-${board}`);
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'metrics.json'),JSON.stringify({stage,applicationCommit,passed:true,records,errors},null,2));console.log(`Round7 ${stage} visual matrix PASS: ${records.length} screenshots`);
}catch(e){await fs.writeFile(path.join(out,'failure.txt'),e.stack+'\n'+await pages[0].locator('body').innerText());await pages[0].screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}finally{await browser.close();}
