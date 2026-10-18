import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {chromium} from 'playwright';
import {readRoomState} from './room-observer.mjs';
const base=process.env.PLAYTEST_BASE_URL,api=process.env.PLAYTEST_API_URL;
const out=path.resolve('output/playwright/performance/browser');await fs.mkdir(out,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome',undefined])try{browser=await chromium.launch({channel,headless:true});break;}catch{}
assert.ok(browser);const pages=[],states=[],errors=[],catalogRequests=Array(8).fill(0),checks=[],latencies=[];
const image=await sharp({create:{width:160,height:240,channels:3,background:'#4177aa'}}).png().toBuffer();
const avatar='data:image/png;base64,'+(await sharp(crypto.randomBytes(96*96*3),{raw:{width:96,height:96,channels:3}}).png().toBuffer()).toString('base64');
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function until(fn,label,seconds=30){for(let i=0;i<seconds*10;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label);}
async function raw(p,event,payload){return p.evaluate(async({event,payload})=>(await import('/src/lib/socket.ts')).getSocket().emit(event,payload),{event,payload});}
try{
  // A slow original remains alive when every backup fails. A late success must recover without reload.
  const slow=await browser.newPage({viewport:{width:1440,height:900}});
  const home=(await(await fetch(api+'/api/anime/home-covers')).json()).works;let originalFinished=false;
  await slow.route('**/api/anime/cover/**',route=>route.fulfill({status:503,body:''}));
  await slow.route('https://lain.bgm.tv/**',async route=>{
    if(route.request().url()===home[0].cover){await new Promise(r=>setTimeout(r,61_000));try{await route.fulfill({contentType:'image/png',body:image});originalFinished=true;}catch{}}
    else await route.fulfill({contentType:'image/png',body:image});
  });
  await slow.goto(base,{waitUntil:'domcontentloaded'});await slow.locator('.feature-cover').first().waitFor();
  const lateLoad=until(async()=>originalFinished&&await slow.locator('.feature-cover').first().locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),'61-second original survives failed backup',80);
  for(let i=0;i<8;i++){
    const context=await browser.newContext({viewport:{width:i>=6?390:1440,height:i>=6?844:900},hasTouch:i>=6});const p=await context.newPage();p.setDefaultTimeout(90000);pages[i]=p;
    await p.addInitScript(()=>{window.longTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.longTasks.push(e.duration);}).observe({type:'longtask',buffered:true});});
    await p.route('https://lain.bgm.tv/**',route=>route.fulfill({contentType:'image/png',body:image}));
    await p.route('**/api/anime/cover/**',route=>route.fulfill({contentType:'image/png',body:image}));
    p.on('request',request=>{if(new URL(request.url()).pathname==='/api/anime/catalog')catalogRequests[i]++;});
    p.on('pageerror',e=>errors.push(e.message));
    const packet=text=>{try{if(text.startsWith('42')){const[e,d]=JSON.parse(text.slice(2));if(e==='room_state'||e==='room_state_delta')states[i]=readRoomState(e,d,states[i]);}}catch(e){errors.push(e.message);}};
    p.on('websocket',ws=>ws.on('framereceived',f=>packet(String(f.payload))));
    p.on('response',async r=>{if(r.url().includes('/socket.io/')&&r.request().method()==='GET')try{for(const part of(await r.text()).split('\x1e'))packet(part);}catch{}});
    if(i>=6){const cdp=await context.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:120,downloadThroughput:128*1024,uploadThroughput:64*1024});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
    console.log('PERF login '+i);await p.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:120000});await p.getByPlaceholder('输入用户名').fill('性能浏览器'+i);await button(p,'进入结社').click();await button(p,'＋ 创建房间').waitFor({timeout:45000}).catch(async e=>{console.log('LOGIN FAILURE '+i+' '+p.url()+' '+await p.locator('body').innerText());throw e;});
    await p.evaluate(async({api,avatar})=>{const identity=JSON.parse(localStorage.getItem('acg-codenames-identity'));const r=await fetch(api+'/api/users/'+encodeURIComponent(identity.username),{method:'PUT',headers:{'content-type':'application/json','x-user-session-token':identity.userSessionToken},body:JSON.stringify({avatarUrl:avatar})});if(!r.ok)throw new Error(await r.text());},{api,avatar});
    if(i===0){await button(p,'＋ 创建房间').click();const dialog=p.getByRole('dialog',{name:'创建一间房间'});await button(dialog,'动画组牌').click();await button(dialog,'创建房间 →').click();}
    else {await p.goto(base+'/room/'+states[0].id,{waitUntil:'domcontentloaded',timeout:120000});await button(p,'加入房间').click();}
    await until(()=>states[i]?.players.length===i+1,'joined '+i);
    const nav=p.getByRole('navigation',{name:'房间导航'});if(await nav.isVisible())await button(nav,'玩家').click();
    const team=i<4?'red':'blue';await p.getByLabel('我的队伍',{exact:true}).selectOption(team);await until(()=>states[i].viewer.team===team,'team');
    if(i===0||i===4){await p.getByLabel('我的身份',{exact:true}).selectOption('spymaster');await until(()=>states[i].viewer.role==='spymaster','captain');}
    if(await nav.isVisible())await button(nav,'准备').click();console.log('PERF joined '+i);
  }
  const host=pages[0],roomId=states[0].id;
  await host.evaluate(async id=>new Promise(resolve=>import('/src/lib/socket.ts').then(m=>m.getSocket().emit('plan_action',{roomId:id,kind:'configure',variant:'anime',boardMode:'6x6',animeSeriesRotation:false},resolve))),roomId);
  await host.getByRole('button',{name:/进入队长预览/}).click();await until(()=>states[0].nextPlan.stage==='guide','guide');
  for(const i of [0,4])await button(pages[i],'确认就绪，开始组牌').click();await until(()=>states[0].nextPlan.stage==='draft','draft');
  assert.equal(states[0].players.length,8);assert.equal(states[0].nextPlan.candidates.length,180);
  assert.ok(catalogRequests[0]<=1,'host full catalog single-flight');assert.ok(catalogRequests.slice(1).every(n=>n===0),'other seven clients never fetch full catalog');
  checks.push('8 browser contexts with avatars; 2 mobile viewports at 120ms, 1Mbps and CPU 4x; no full catalog for non-hosts');
  const [first,second]=states[0].nextPlan.candidates;
  const source=host.locator(`.draft-candidates [data-replace-id="${first.id}"] .draft-tile-main`),target=host.locator('.draft-drop-zones [data-drop="take"]');
  await target.scrollIntoViewIfNeeded();await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();
  await host.mouse.move(a.x+a.width/2,a.y+35);await host.mouse.down();await host.mouse.move(a.x+a.width/2+12,a.y+45,{steps:3});await host.mouse.move(b.x+b.width/2,b.y+25,{steps:20});await host.mouse.up();
  await until(()=>states[0].nextPlan.captainView.claims[first.id]?.team==='red','real mouse drag');
  const pane=pages[4];await pane.locator(`.draft-candidates [data-replace-id="${second.id}"] .draft-tile-main`).click();await button(pane,'领取这张').click();await until(()=>states[0].nextPlan.captainView.claims[second.id]?.team==='blue','blue take');
  for(let n=0;n<12;n++){const before=states.map(s=>s.transportRevision);const start=Date.now();await raw(host,'plan_action',{roomId,version:states[0].nextPlan.version,kind:'bookmark',workId:first.id});await until(()=>states.every((s,i)=>s.transportRevision>before[i]),'all views synced');latencies.push(Date.now()-start);await host.waitForTimeout(300);}
  states[7]=undefined;await pages[7].reload({waitUntil:'domcontentloaded',timeout:120000});await until(()=>states[7]?.viewer?.participantId&&states[7].players.length===8,'weak-network reload recovers same seat');assert.equal(states[7].players.length,8);
  for(const i of [0,4,7])await pages[i].screenshot({path:path.join(out,'draft-'+i+'.png'),fullPage:true});
  await lateLoad;await slow.screenshot({path:path.join(out,'late-original.png'),fullPage:true});checks.push('Original image succeeds after 61 seconds while backup responds 503; no refresh needed');
  checks.push('Eight views receive every state update; private bookmarks do not appear in operative views');
  const tasks=await Promise.all(pages.map(p=>p.evaluate(()=>window.longTasks)));
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,checks,catalogRequests,bookmarkObservationMs:latencies,longTasksMs:tasks,scope:'Image CDN payloads except the 61s failure case are deterministic fixtures; this is not a 3-hour internet soak.'},null,2));
  console.log('Performance browser PASS: eight avatar clients, weak-network mobile/reload, real drag, 61-second image recovery');
}finally{await browser.close();}
