import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {readRoomState} from './room-observer.mjs';
import {browserProxy} from './browser-network.mjs';
import {theme} from './browser-support.mjs';

const base=process.env.SOAK_BASE_URL??'http://127.0.0.1:5394',out=path.resolve(process.env.SOAK_OUT??'output/playwright/staged-draft/smoke');
const duration=Number(process.env.SOAK_SECONDS??10800),full=duration>=10800;await fs.mkdir(out,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome'])try{browser=await chromium.launch({channel,headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding'],...browserProxy()});break;}catch{}
assert.ok(browser);const pages=[],states=[],cdps=[],acks=Array.from({length:8},()=>new Map()),checks=[],errors=[],rounds=[];
const counters={snapshots:0,deltas:0,roomBytes:0,imageResponses:0,imageHttpErrors:0,imageNetworkErrors:0,guesses:0,clues:0,reconnections:0};
const coverChecks=[];
const catalogRequests=Array(8).fill(0);
const receivedAt=Array(8).fill(0);
let serial=1000000000,started=0,sampling=false,lastChat=0,lastSample=0;const latency=[],uiLatency=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),button=(p,name)=>p.getByRole('button',{name,exact:true});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
async function log(file,value){await fs.appendFile(path.join(out,file),JSON.stringify({at:new Date().toISOString(),...value})+'\n');}
async function until(fn,label,seconds=45){const end=performance.now()+seconds*1000;while(performance.now()<end){if(await fn())return;await sleep(100);}throw new Error(label);}
async function wire(i,event,payload,wantAck=true,allowStageChange=false){
 const key=++serial,begin=performance.now();
 const promise=wantAck?new Promise((resolve,reject)=>{const timer=setTimeout(()=>{acks[i].delete(key);reject(new Error(`ACK timeout ${i} ${event}`));},12000);acks[i].set(key,{resolve:value=>{clearTimeout(timer);resolve(value);}});}):undefined;
 await pages[i].evaluate(packet=>{if(window.__soakSocket?.readyState!==1)throw new Error('Browser WebSocket is not connected');window.__soakSocket.send(packet);},`42${wantAck?key:''}${JSON.stringify([event,payload])}`);
 if(!wantAck)return;
 const result=await promise;latency.push(performance.now()-begin);if(latency.length>10000)latency.shift();if(allowStageChange&&!result?.ok&&result?.message?.includes('阶段已更新'))return result;assert.ok(result?.ok,`${event}: ${result?.message}`);return result;
}
async function plan(i,kind,extra={}){const p=states[i].nextPlan;await wire(i,'plan_action',{roomId:states[i].id,version:p.version,planId:p.id,stageVersion:p.stageVersion??0,draftProtocol:2,requestId:crypto.randomUUID(),kind,...extra},true,kind==='bookmark');await sleep(100);}
async function tab(p,name){const n=p.getByRole('navigation',{name:'房间导航'});if(await n.isVisible())await button(n,name).click();}
async function shot(i,name){const p=pages[i];await p.evaluate(()=>document.fonts.ready);const dialog=p.getByRole('dialog',{name:'本局设置',exact:true});await p.screenshot({path:path.join(out,name+'.png'),fullPage:!await dialog.isVisible()});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');}
async function sample(label='heartbeat'){
 if(sampling||!started)return;sampling=true;
 try{
  const clients=[];
  for(let i=0;i<8;i++){
   const metrics=await cdps[i].send('Performance.getMetrics'),m=Object.fromEntries(metrics.metrics.map(item=>[item.name,item.value]));
   const view=await pages[i].evaluate(()=>{
    window.__soakImageAges??=new WeakMap();const images=[...document.images].filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;});
    const pending=[];for(const img of images){if(!window.__soakImageAges.has(img))window.__soakImageAges.set(img,Date.now());if(!img.complete||!img.naturalWidth)pending.push({src:img.currentSrc||img.src,seconds:(Date.now()-window.__soakImageAges.get(img))/1000});}
    const tasks=window.__soakLongTasks??[];window.__soakLongTasks=[];
    return {visibleImages:images.length,loadedImages:images.length-pending.length,pending,longTasks:tasks.length,longTaskMaxMs:Math.max(0,...tasks)};
   });
   const s=states[i];assert.equal(s.players.length,8);if(i!==0&&i!==4)assert.equal(s.nextPlan?.captainView,undefined,'operative receives no private draft claims');
   clients.push({index:i,phase:s.phase,stage:s.nextPlan?.stage,heapBytes:m.JSHeapUsedSize,nodes:m.Nodes,taskSeconds:m.TaskDuration,...view});
  }
  const record={label,elapsedSeconds:(performance.now()-started)/1000,completedGames:rounds.length,ackP95Ms:percentile(latency,.95),uiP95Ms:percentile(uiLatency,.95),counters:{...counters},clients};
  await log('samples.jsonl',record);await fs.writeFile(path.join(out,'progress.json'),JSON.stringify(record,null,2));
  console.log(`SOAK_PROGRESS ${Math.round(record.elapsedSeconds)}/${duration}s games=${rounds.length} phase=${states[0].phase}/${states[0].nextPlan?.stage} ackP95=${Math.round(record.ackP95Ms)}ms`);
 }finally{sampling=false;}
}
async function pulse(){
 if(Date.now()-lastChat>20000){const i=Math.floor((Date.now()/20000)%8);await wire(i,'send_chat_message',{roomId:states[0].id,text:`八人长测 ${Math.floor((performance.now()-started)/1000)} 秒`,requestId:crypto.randomUUID()});lastChat=Date.now();}
 if(Date.now()-lastSample>60000){await sample();lastSample=Date.now();}
}
async function connectEight(){
 for(let i=0;i<8;i++){
  const context=await browser.newContext({viewport:{width:i===7?390:1440,height:i===7?844:900},hasTouch:i===7});const p=await context.newPage();pages[i]=p;p.setDefaultTimeout(45000);
  p.on('request',r=>{if(new URL(r.url()).pathname==='/api/anime/catalog')catalogRequests[i]++;});
  await p.addInitScript(()=>{
   const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);if(String(args[0]).includes('/socket.io/'))window.__soakSocket=this;}};
   window.__soakLongTasks=[];try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(window.__soakLongTasks.length<1000)window.__soakLongTasks.push(e.duration);}).observe({type:'longtask',buffered:true});}catch{}
   window.__soakImageAges=new WeakMap();
   const remember=node=>{if(node.nodeType!==1)return;for(const img of [node,...node.querySelectorAll('img')])if(img.tagName==='IMG'&&!window.__soakImageAges.has(img))window.__soakImageAges.set(img,Date.now());};
   new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)remember(n);}).observe(document,{childList:true,subtree:true});
  });
  p.on('pageerror',e=>{errors.push({i,message:e.message});void log('errors.jsonl',{i,message:e.message});});
  const packet=raw=>{try{
   if(raw.startsWith('42[')){const [event,data]=JSON.parse(raw.slice(2));if(event==='room_state'||event==='room_state_delta'){states[i]=readRoomState(event,data,states[i]);receivedAt[i]=performance.now();counters[event==='room_state'?'snapshots':'deltas']++;counters.roomBytes+=Buffer.byteLength(JSON.stringify(data));}}
   const match=raw.match(/^43(\d+)(\[.*)$/s);if(match){const item=acks[i].get(Number(match[1]));if(item){acks[i].delete(Number(match[1]));item.resolve(JSON.parse(match[2])[0]);}}
  }catch(e){errors.push({i,message:'observer: '+e.message});}};
  p.on('websocket',ws=>ws.on('framereceived',frame=>packet(String(frame.payload))));
  p.on('response',async response=>{
   if(response.url().includes('/socket.io/')&&response.request().method()==='GET')try{for(const part of(await response.text()).split('\x1e'))packet(part);}catch{}
   if(response.request().resourceType()==='image'){counters.imageResponses++;if(response.status()>=400)counters.imageHttpErrors++;void log('images.jsonl',{i,url:response.url(),status:response.status(),ms:Date.now()-response.request().timing().startTime});}
  });
  p.on('requestfailed',request=>{if(request.resourceType()==='image'&&!request.failure()?.errorText.includes('ERR_ABORTED')){counters.imageNetworkErrors++;void log('images.jsonl',{i,url:request.url(),error:request.failure()?.errorText});}});
  cdps[i]=await context.newCDPSession(p);await cdps[i].send('Performance.enable');
  console.log('SOAK_JOIN '+i);await p.goto(base+'/login',{waitUntil:'domcontentloaded'});await p.getByPlaceholder('输入用户名').fill(`长测${Date.now().toString().slice(-6)}${i}`);await button(p,'进入结社').click();await button(p,'＋ 创建房间').waitFor();
  const identity=await p.evaluate(()=>JSON.parse(localStorage.getItem('acg-codenames-identity')));
  const avatar=await sharp(crypto.randomBytes(96*96*3),{raw:{width:96,height:96,channels:3}}).webp({quality:80}).toBuffer();
  const update=await p.request.put(base+'/api/users/'+encodeURIComponent(identity.username),{headers:{'x-user-session-token':identity.userSessionToken},data:{avatarUrl:'data:image/webp;base64,'+avatar.toString('base64')}});assert.ok(update.ok());
  if(i===0){await button(p,'＋ 创建房间').click();const dialog=p.getByRole('dialog',{name:'创建一间房间'});await button(dialog,'动画组牌').click();await button(dialog,'创建房间 →').click();}
  else{await p.goto(base+'/room/'+states[0].id,{waitUntil:'domcontentloaded'});await button(p,'加入房间').click();}
  await until(()=>states[i]?.players.length===i+1,'join '+i);await until(async()=>await p.evaluate(()=>window.__soakSocket?.readyState===1),'WebSocket '+i);
  await wire(i,'set_team',{roomId:states[0].id,team:i<4?'red':'blue'},false);await until(()=>states[i].viewer.team===(i<4?'red':'blue'),'team '+i);
  if(i===0||i===4){await wire(i,'set_role',{roomId:states[0].id,role:'spymaster'},false);await until(()=>states[i].viewer.role==='spymaster','captain '+i);}
 }
 assert.equal(states[0].nextPlan.settings.animeDraft.version,2);assert.equal(states[0].nextPlan.poolSummary.source,0);assert.equal(states[0].nextPlan.candidates.length,0);assert.equal(catalogRequests[0],0);checks.push('eight named browser seats; new anime room has no chosen pool, no candidates and no full catalog request');
}
async function dragTake(i,work){
 const p=pages[i],source=p.locator(`.draft-candidates .draft-tile[data-replace-id="${work.id}"] .draft-tile-main`),target=p.locator('.draft-selected-panel[data-drop="take"]');
 await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(a.x+a.width/2+20,a.y+a.height/2+10,{steps:4});await p.waitForTimeout(120);await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await p.locator('.draft-drag-ghost').waitFor();await sleep(60);assert.equal(await p.locator('.draft-drag-ghost').evaluate(e=>getComputedStyle(e).position),'fixed');if(rounds.length<2)await p.screenshot({path:path.join(out,`drag-desktop-${rounds.length}.png`)});await p.mouse.up();
 await until(()=>states[i].nextPlan.captainView.claims[work.id]?.team===states[i].viewer.team,'real draft drag');await p.locator('.draft-drag-ghost').waitFor({state:'detached'});assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('draft-drag-active')),false);
}
async function touchTake(i,work){
 const p=pages[i];await p.setViewportSize({width:390,height:844});await cdps[i].send('Emulation.setTouchEmulationEnabled',{enabled:true});
 const handle=p.locator(`.draft-candidates .draft-tile[data-replace-id="${work.id}"] .draft-grab`);await handle.scrollIntoViewIfNeeded();const a=await handle.boundingBox();assert.ok(a);
 await cdps[i].send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await p.locator('.draft-drag-ghost').waitFor();
 const target=p.locator('.draft-dock [data-drop="take"]');await target.waitFor({state:'visible'});const b=await target.boundingBox();assert.ok(b);
 await p.screenshot({path:path.join(out,'touch-grab-mobile.png')});
 for(let n=1;n<=8;n++){await cdps[i].send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+a.width/2+(b.x+b.width/2-a.x-a.width/2)*n/8,y:a.y+a.height/2+(b.y+b.height/2-a.y-a.height/2)*n/8}]});await sleep(40);}
 await cdps[i].send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await until(()=>states[i].nextPlan.captainView.claims[work.id]?.team===states[i].viewer.team,'real mobile handle drag');
 await p.locator('.draft-drag-ghost').waitFor({state:'detached'});assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('draft-drag-active')),false);assert.equal(await target.isVisible(),false);
 await handle.scrollIntoViewIfNeeded();const cancel=await handle.boundingBox();await cdps[i].send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cancel.x+cancel.width/2,y:cancel.y+cancel.height/2}]});await p.locator('.draft-drag-ghost').waitFor();await cdps[i].send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await p.locator('.draft-drag-ghost').waitFor({state:'detached'});assert.equal(await target.isVisible(),false,'cancelled touch does not leave targets over the cards');
 const grid=p.locator('.draft-candidates'),before=await grid.evaluate(e=>e.scrollTop),box=await grid.boundingBox();
 const x=box.x+box.width/2,y=box.y+box.height*.7;await cdps[i].send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let step=1;step<=8;step++){await cdps[i].send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*14}]});await sleep(20);}
 await cdps[i].send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(200);assert.ok(await grid.evaluate(e=>e.scrollTop)>before,'normal cover swipe still scrolls instead of picking a card');
 await p.setViewportSize({width:1440,height:900});await cdps[i].send('Emulation.setTouchEmulationEnabled',{enabled:false});checks.push('real browser touch handle lifts a visible ghost, drops into two-target dock and clears ghost/dock on release');
}
async function configureRound(number){
 const size=number%2?'6x6':'5x5',selection=[180,240,300][number%3],interference=[30,60,null][number%3];
 await button(pages[0],'修改设置').click();const dialog=pages[0].getByRole('dialog',{name:'本局设置'});
 if(states[0].nextPlan.poolSummary.source===0){const picker=dialog.getByLabel('动画作品池',{exact:true});assert.equal(await picker.inputValue(),'');await shot(0,'new-room-empty-pool');await picker.locator('option[value="all"]').waitFor({state:'attached'});await picker.selectOption('all');}
 await dialog.getByLabel('棋盘',{exact:true}).selectOption(size);await dialog.getByLabel('选牌时间',{exact:true}).selectOption(String(selection));await dialog.getByLabel('干扰时间',{exact:true}).selectOption(interference===null?'unlimited':String(interference));
 if(number<2){for(const width of [1440,390])for(const light of [true,false]){await pages[0].setViewportSize({width,height:width===390?844:900});await pages[0].evaluate(light=>{document.documentElement.classList.toggle('light',light);},light);await shot(0,`round-${number}-settings-${width}-${light?'light':'dark'}`);}await pages[0].setViewportSize({width:1440,height:900});}
 const save=dialog.getByRole('button',{name:/^(保存并返回准备大厅|返回准备大厅)$/});await save.click();await dialog.waitFor({state:'hidden'});
 assert.equal(states[0].nextPlan.settings.animeDraft.selectionSeconds,selection);assert.equal(states[0].nextPlan.settings.animeDraft.interferenceSeconds,interference);
 assert.equal(catalogRequests[0],0,'opening settings and choosing a preset never downloads the full works catalog');
 await button(pages[0],'进入队长预览 →').click();await until(()=>states[0].nextPlan.stage==='guide','guide');
 for(const i of [0,4]){await tab(pages[i],'准备');await button(pages[i],'确认就绪，开始组牌').click();}
 await until(()=>states[0].nextPlan.stage==='draft','draft');await pages[0].locator('.draft-workspace').waitFor();
 const candidates=states[0].nextPlan.candidates;await dragTake(0,candidates[0]);
 if(number===0)await touchTake(4,candidates[1]);
 const quota=(team)=>size==='6x6'?(states[0].nextPlan.startingTeam===team?10:9):(states[0].nextPlan.startingTeam===team?7:6);
 for(const i of [0,4]){const team=i===0?'red':'blue';while(Object.values(states[i].nextPlan.captainView.claims).filter(c=>c.team===team&&c.kind==='manual').length<quota(team)){const p=states[i].nextPlan,w=p.candidates.find(w=>!p.captainView.claims[w.id]);await plan(i,'take',{workId:w.id});}}
 if(number<2){await shot(0,`round-${number}-draft-desktop`);await tab(pages[7],'准备');await shot(7,`round-${number}-draft-mobile`);}
 if(number===0){const badge=pages[7].locator('.draft-public-badge').first();await badge.waitFor();const style=await badge.evaluate(e=>{const s=getComputedStyle(e);return {height:e.getBoundingClientRect().height,rightGap:e.parentElement.getBoundingClientRect().right-e.getBoundingClientRect().right,color:s.color};});assert.ok(style.height<25);assert.ok(style.rightGap>=4&&style.rightGap<=10);assert.notEqual(style.color,'rgb(255, 255, 255)');assert.equal(await pages[7].locator('.draft-grab').count(),0);checks.push('operative selected badges use a compact neutral theme label and reveal no drag controls or team affiliation');}
 let changed=false,reconnected=false,lastBookmark=0,earlyFinished=false;
 while(states[0].nextPlan.stage==='draft'){
  await pulse();const p=states[0].nextPlan,secondsLeft=(p.endsAt-states[0].serverNow-(performance.now()-receivedAt[0]))/1000;
  if(!changed&&secondsLeft<selection-20&&secondsLeft>25){const claims=p.captainView.claims,now=states[0].serverNow+performance.now()-receivedAt[0],own=Object.keys(claims).find(id=>claims[id].team==='red'&&claims[id].kind==='manual'),other=Object.keys(claims).find(id=>claims[id].team==='blue'&&claims[id].kind==='manual'&&claims[id].protectedUntil+500<now);if(own&&other){await plan(0,'take',{workId:Number(other),replaceId:Number(own)});const free=states[4].nextPlan.candidates.find(w=>!states[4].nextPlan.captainView.claims[w.id]);await plan(4,'take',{workId:free.id});changed=true;}}
  if(secondsLeft>5&&Date.now()-lastBookmark>15000){await plan(0,'bookmark',{workId:p.candidates[number%p.candidates.length].id});lastBookmark=Date.now();}
  if(!reconnected&&secondsLeft<selection-35&&secondsLeft>30){const participant=states[6].viewer.participantId;await pages[6].evaluate(()=>window.__soakSocket.close());await until(()=>states[0].players.find(p=>p.id===participant)?.connected===false,'drop client');await until(()=>states[6].viewer?.participantId===participant&&states[0].players.find(p=>p.id===participant)?.connected===true,'recover same seat');counters.reconnections++;reconnected=true;}
  if(number%2===1&&secondsLeft<=selection-120&&secondsLeft>25){await button(pages[0],'组牌完毕').click();await button(pages[0],'取消完成').waitFor();await button(pages[0],'取消完成').click();await button(pages[0],'组牌完毕').click();await button(pages[4],'组牌完毕').click();earlyFinished=true;await until(()=>states[0].nextPlan.stage==='interference','both captains skip remaining selection time');break;}
  await sleep(700);
 }
 assert.equal(states[0].nextPlan.stage,'interference');await pages[0].getByRole('region',{name:'独立干扰阶段'}).waitFor();
 const workspace=pages[0].locator('.draft-workspace.stage-interference');
 await workspace.waitFor();assert.equal(await pages[0].locator('.interference-workspace').count(),0,'reuse the drafting layout');
 const layout=await pages[0].locator('.next-match-panel').evaluate(el=>({panel:el.getBoundingClientRect().width,room:el.parentElement.getBoundingClientRect().width}));
 assert.ok(layout.panel/layout.room>.95,'interference occupies the full room width');
 const hand=workspace.locator('.draft-selected-panel');assert.ok((await hand.getByRole('button',{name:'对方已选',exact:true}).getAttribute('class')).includes('selected'));
 assert.equal(await hand.locator('.draft-tile').count(),Object.values(states[0].nextPlan.captainView.claims).filter(c=>c.kind==='manual'&&c.team==='blue').length);
 assert.equal(await pages[1].locator('.draft-control-panel').count(),0,'ordinary members cannot view team hands or interference controls');
 assert.equal(await pages[1].getByLabel('搜索干扰作品').count(),0,'ordinary members cannot search the private interference pool');
 for(const i of [0,4]){
  if(i===4&&interference!==null&&number%2===0)continue;
  const p=states[i].nextPlan,key=await pages[i].evaluate(()=>localStorage.getItem('cipai.private-identity.v1'));
  const result=await pages[i].request.get(base+`/api/rooms/${states[0].id}/interference-pool?`+new URLSearchParams({planId:p.id,stageVersion:String(p.stageVersion),page:'1'}),{headers:{'x-private-key':key}});assert.ok(result.ok());const data=await result.json();assert.ok(data.works.length<=60);
  const work=(i===4?data.works.find(w=>p.candidates.some(c=>c.id===w.id)):data.works.find(w=>!p.candidates.some(c=>c.id===w.id)))??data.works[0];assert.ok(work);
  await pages[i].getByLabel('搜索干扰作品').fill(work.fullTitle);const choose=pages[i].locator('.draft-candidates').getByRole('button',{name:work.title,exact:true});await choose.waitFor();await until(async()=>await choose.locator('..').locator('.draft-grab').count()>0,'interference search');
  if(i===0){
   const zone=pages[i].locator('.draft-drop-zones [data-drop="interfere"]');await zone.scrollIntoViewIfNeeded();await choose.scrollIntoViewIfNeeded();const source=await choose.boundingBox(),target=await zone.boundingBox();assert.ok(source&&target);assert.ok(target.y+target.height/2<pages[i].viewportSize().height,'drag target must be inside the viewport');
   await pages[i].mouse.move(source.x+source.width/2,source.y+source.height/2);await pages[i].mouse.down();await pages[i].mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:15});
   assert.equal(await pages[i].locator('.draft-drag-ghost').count(),1);if(number<2)await pages[i].screenshot({path:path.join(out,`round-${number}-interference-grab.png`),fullPage:false});await pages[i].mouse.up();
  }else await choose.click();
  await button(pages[i].getByRole('dialog',{name:'确认干扰作品'}),'确认投放').click();
  await until(()=>states[i].nextPlan.captainView?.claims[work.id]?.kind==='interference','interference committed');
  const handIds=await pages[i].locator('.draft-selected-list .draft-tile').evaluateAll(cards=>cards.map(c=>c.getAttribute('data-replace-id')));assert.equal(new Set(handIds).size,handIds.length,'candidate metadata and interference metadata must not duplicate a hand card');
  if(number<2){await shot(i,`round-${number}-interference-${i}`);if(i===0){await theme(pages[i],true);await shot(i,`round-${number}-interference-desktop-light`);await pages[i].setViewportSize({width:390,height:844});await pages[i].getByRole('region',{name:'对方普通手牌'}).waitFor();assert.equal(await pages[i].getByRole('region',{name:'对方普通手牌'}).locator('button').count(),Object.values(states[i].nextPlan.captainView.claims).filter(c=>c.kind==='manual'&&c.team==='blue').length);await shot(i,`round-${number}-interference-mobile-light`);await theme(pages[i],false);await shot(i,`round-${number}-interference-mobile-dark`);await pages[i].setViewportSize({width:1440,height:900});}}
  await button(pages[i],'准备成牌').click();
 }
 if(number===0)checks.push('interference reuses the full-width drafting workspace, defaults to opponent hand, supports real drag confirmation and full-pool search, retains anonymous member view, and fits light/dark desktop/mobile');
 while(states[0].nextPlan.stage!=='sealed'){await pulse();await sleep(500);}
 assert.equal(states[0].nextPlan.randomSwapCompleted,true);await button(pages[0],'开始五秒倒计时').click();await until(()=>states.every(s=>s.phase==='playing'),'eight clients playing');
 assert.equal(await pages[0].getByRole('button',{name:'放大棋盘',exact:true}).count(),0);assert.equal(await pages[0].locator('.anime-board-panel').getByRole('button',{name:'重置视图',exact:true}).count(),0);
 assert.equal(await pages[0].getByText('本队等待，留意对方的线索与翻牌。',{exact:true}).count(),0);
 assert.equal(await pages[0].getByText(/阵营标签为队长视角；深色蒙层/).count(),0);
 assert.equal(await pages[0].locator('.anime-board-panel').getByText(/点卡片查看作品，猜牌需再次确认/).count(),0);
 for(let i=0;i<8;i++){
  await tab(pages[i],'棋盘');const cards=pages[i].locator('.anime-board-card');await cards.last().scrollIntoViewIfNeeded();await cards.first().scrollIntoViewIfNeeded();
 }
 const imageStart=performance.now();let unresolved=[];
 do{
  unresolved=[];
  for(let i=0;i<8;i++){
   const missing=await pages[i].locator('.anime-board-card img').evaluateAll(imgs=>imgs.filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&(!img.complete||!img.naturalWidth);}).map(img=>img.currentSrc||img.src));
   if(missing.length)unresolved.push({i,urls:missing});
  }
  if(!unresolved.length)break;
  await pulse();await sleep(1000);
 }while(performance.now()-imageStart<90000);
 const coverCheck={round:number+1,size,waitSeconds:(performance.now()-imageStart)/1000,passed:unresolved.length===0,unresolved};coverChecks.push(coverCheck);await log('cover-checks.jsonl',coverCheck);
 assert.equal(unresolved.length,0,'visible board covers must recover within 90 seconds; see cover-checks.jsonl');
 await tab(pages[7],'棋盘');if(number<2)await shot(7,`round-${number}-board-mobile`);
 return {size,selectionSeconds:selection,interferenceSeconds:interference,changed,reconnected,earlyFinished};
}
async function playNormally(number){
 let turn=0,lastClue=0;
 while(states[0].phase==='playing'){
  assert.ok(turn++<40,'normal win must finish');await pulse();const team=states[0].currentTeam,ci=team==='red'?0:4,oi=ci+1;
  await tab(pages[ci],'棋盘');await tab(pages[oi],'棋盘');
  if(performance.now()-lastClue<4000)await sleep(4000-(performance.now()-lastClue));
  await pages[ci].getByPlaceholder('例如：机甲 / 学园 / 主角团').fill(`长测${number}回合${turn}`);await pages[ci].getByLabel('数字',{exact:true}).fill('2');await button(pages[ci],'提交提示').click();await until(()=>!!states[0].clue,'submitted actual clue');lastClue=performance.now();counters.clues++;
  for(let k=0;k<2&&states[0].phase==='playing'&&states[0].currentTeam===team;k++){
   const card=states[ci].board.find(c=>!c.revealed&&c.role===team);assert.ok(card);const begin=performance.now();
   await pages[oi].locator('.anime-board-card').nth(states[0].board.findIndex(c=>c.id===card.id)).click();const dialog=pages[oi].getByRole('dialog').last();await button(dialog,'猜牌').click();await button(dialog,'确认猜牌').click();await until(()=>states[0].board.find(c=>c.id===card.id).revealed,'actual UI guess');uiLatency.push(performance.now()-begin);counters.guesses++;await sleep(1000);
  }
  if(states[0].phase==='playing'&&states[0].currentTeam===team){await wire(oi,'end_turn',{roomId:states[0].id},false);await until(()=>states[0].currentTeam!==team,'end turn');}
 }
 assert.ok(states[0].winner);assert.equal(states[0].endReason,'normal');
}
try{
 await connectEight();started=performance.now();lastSample=Date.now();await fs.writeFile(path.join(out,'started.json'),JSON.stringify({startedAt:new Date().toISOString(),targetSeconds:duration,eightContexts:true,compiled:true},null,2));await sample('start');
 let number=0;
 do{
  const begin=performance.now(),match=await configureRound(number);await playNormally(number);
  rounds.push({number:++number,...match,seconds:(performance.now()-begin)/1000,winner:states[0].winner});await log('rounds.jsonl',rounds.at(-1));await sample('completed-game');
  if(number<=2)await shot(0,`round-${number}-result`);await button(pages[0],'返回房间').click();await until(()=>states.every(s=>s.phase==='lobby'),'one-click return all eight');
 }while(performance.now()-started<duration*1000);
 const elapsed=(performance.now()-started)/1000;await sample('final');assert.deepEqual(errors,[]);assert.ok(rounds.length>0);assert.ok(elapsed>=duration);
 const report={passed:true,threeHourComplete:full&&elapsed>=10800,requestedSeconds:duration,elapsedSeconds:elapsed,players:8,browserContexts:8,compiled:true,checks,rounds,counters,coverChecks,ackMs:{p50:percentile(latency,.5),p95:percentile(latency,.95),max:Math.max(0,...latency)},uiGuessMs:{p95:percentile(uiLatency,.95)},errors,scope:full?'Real wall-clock three-hour multi-game run; ordinary drafting uses real 180/240/300 second deadlines.':'Short diagnostic only; this is not a three-hour acceptance.'};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
 await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({passed:false,threeHourComplete:false,message:error.stack,elapsedSeconds:started?(performance.now()-started)/1000:0,counters,errors,rounds},null,2));
 for(const [i,p] of pages.entries())try{await fs.writeFile(path.join(out,`failure-${i}.txt`),await p.locator('body').innerText());if(i===0||i===4)await p.screenshot({path:path.join(out,`failure-${i}.png`),fullPage:true});}catch{}
 throw error;
}finally{await browser.close();}
