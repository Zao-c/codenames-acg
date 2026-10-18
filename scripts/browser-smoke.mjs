import { theme } from './browser-support.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.PLAYTEST_BASE_URL??'http://127.0.0.1:5177';
const api=process.env.PLAYTEST_API_URL??'http://127.0.0.1:3022';
const artifacts=path.resolve(process.env.PLAYTEST_ARTIFACTS??'artifacts/ui-acceptance');await fs.mkdir(artifacts,{recursive:true});
let browser;for(const channel of ['chromium','msedge','chrome',undefined]){try{browser=await chromium.launch({channel,headless:true});break;}catch{}}
if(!browser)throw new Error('No browser available');
const pages=[],states=[],errors=[],checks=[];
const button=(p,name)=>p.getByRole('button',{name,exact:true});
const visible=loc=>loc.waitFor({state:'visible',timeout:20000});
async function until(fn,label){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`Timed out: ${label}`);}
async function shot(p,name){await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(artifacts,`${name}.png`),fullPage:false});const bounds=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(bounds.scroll<=bounds.width+1,`${name}: horizontal overflow ${JSON.stringify(bounds)}`);}
async function mobileTab(p,label){const nav=p.getByRole('navigation',{name:'房间导航'});if(await nav.isVisible()){const actual=label==='棋盘'&&!(await nav.getByRole('button',{name:label,exact:true}).count())?'准备':label;await nav.getByRole('button',{name:actual,exact:true}).click();}}
async function controls(p){const b=button(p,'选牌与操作');if(await b.isVisible())await b.click();}
async function pool(p){const b=button(p,'候选池');if(await b.isVisible())await b.click();}
async function openPlan(p){await mobileTab(p,'棋盘');if(await button(p,'查看准备').isVisible())await button(p,'查看准备').click();else if(await button(p,'准备下一局').isVisible())await button(p,'准备下一局').click();}
async function closePlan(p){const b=button(p,'关闭下一局计划');if(await b.isVisible())await b.click();}
async function config(p){await openPlan(p);const d=p.locator('.anime-config');if(!(await d.getAttribute('open')!==null))await d.locator('summary').click();return d;}
async function playToVictory(anime=false){
 for(let step=0;step<45&&states[0]?.phase==='playing';step++){
  const team=states[0].currentTeam, captain=team==='red'?0:2, operative=team==='red'?1:3;
  await closePlan(pages[captain]);await closePlan(pages[operative]);await mobileTab(pages[captain],'棋盘');await mobileTab(pages[operative],'棋盘');
  if(!states[0].clue){
   await visible(pages[captain].getByPlaceholder('例如：机甲 / 学园 / 主角团'));
   await pages[captain].getByPlaceholder('例如：机甲 / 学园 / 主角团').fill('默契');await pages[captain].getByLabel('数字',{exact:true}).fill('9');await button(pages[captain],'提交提示').click();await until(()=>!!states[0].clue,'clue');
  }
  const card=states[captain].board.find(c=>c.role===team&&!c.revealed);assert.ok(card);
  const index=states[captain].board.indexOf(card), p=pages[operative];
  if(anime){await p.locator('.anime-board-card').nth(index).click();await visible(p.getByRole('dialog'));assert.equal(states[0].board.find(c=>c.id===card.id).revealed,false);await button(p,'猜牌').click();assert.equal(states[0].board.find(c=>c.id===card.id).revealed,false);await button(p,'确认猜牌').click();}
  else await p.locator('.card-tile').nth(index).click();
  await until(()=>states[0].board.find(c=>c.id===card.id)?.revealed,'guess');await p.waitForTimeout(700);
 }
 await until(()=>states[0]?.phase==='finished','normal victory');assert.equal(states[0].endReason,'normal');checks.push(anime?'anime normal victory + explicit confirmation':'classic normal victory');
}
try{
 for(let i=0;i<4;i++){
  const context=await browser.newContext(i>=2?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
  const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));p.on('websocket',ws=>ws.on('framereceived',f=>{try{const s=String(f.payload);if(s.startsWith('42')){const [event,data]=JSON.parse(s.slice(2));if(event==='room_state')states[i]=data;}}catch{}}));
  await p.goto(`${url}/login`);await button(p,'游客').click();await p.getByPlaceholder('输入昵称直接开玩').fill(`验收${Date.now().toString().slice(-6)}${i}`);await button(p,'快速进入').click();await p.goto(url);await visible(p.getByRole('button',{name:'＋ 创建房间',exact:true}));
 }
 const host=pages[0];await shot(host,'01-home-desktop-dark');await host.setViewportSize({width:1920,height:1080});await theme(host,true);await shot(host,'02-home-desktop-light-1920');await theme(host,false);await host.setViewportSize({width:1440,height:900});await shot(pages[3],'03-home-mobile');await pages[3].setViewportSize({width:360,height:740});await theme(pages[3],true);await shot(pages[3],'04-home-small-light');await theme(pages[3],false);await pages[3].setViewportSize({width:390,height:844});
 for(const route of ['create','packs','gallery','profile']){await pages[1].goto(`${url}/${route}`);await shot(pages[1],`page-${route}-desktop`);await pages[3].goto(`${url}/${route}`);await theme(pages[3],true);await shot(pages[3],`page-${route}-mobile-light`);await theme(pages[3],false);}await pages[1].goto(url);await pages[3].goto(url);
 await button(host,'＋ 创建房间').click();await button(host.getByRole('dialog'),'创建房间 →').click();await visible(host.locator('.room-code').first());const id=await host.locator('.room-code').first().innerText();
 for(let i=1;i<4;i++){await pages[i].goto(`${url}/room/${id}`);await button(pages[i],'加入房间').click();await visible(pages[i].locator('.preparation-lobby'));}
 for(let i=0;i<4;i++){await mobileTab(pages[i],'玩家');await pages[i].getByLabel('我的队伍',{exact:true}).selectOption(i<2?'red':'blue');if(i%2===0)await pages[i].getByLabel('我的身份',{exact:true}).selectOption('spymaster');await mobileTab(pages[i],'准备');}
 await shot(host,'05-lobby-desktop');await theme(host,true);await shot(host,'06-lobby-light');await theme(host,false);await shot(pages[2],'07-lobby-mobile');
 await button(host,'开始游戏').click();await visible(host.locator('.start-countdown'));await host.reload();await visible(host.locator('.board-grid .card-tile').first());assert.equal(await host.locator('.card-tile').count(),25);checks.push('countdown reload');
 const cfg=await config(host);await cfg.getByLabel('玩法',{exact:true}).selectOption('anime');await cfg.getByLabel('棋盘',{exact:true}).selectOption('6x6');await cfg.getByLabel('动画作品池',{exact:true}).selectOption('2026-Q3');await button(host,'保存配置并更新候选池').click();await until(()=>states[0].nextPlan?.variant==='anime','future anime plan');assert.equal(await host.locator('.card-tile').count(),25);await shot(host,'08-private-next-plan');await closePlan(host);assert.equal(await host.locator('.draft-candidates:visible').count(),0);checks.push('next plan isolated drawer');
 await playToVictory();await visible(button(host,'准备下一局'));await shot(host,'09-classic-results');await shot(pages[3],'10-results-mobile');
 await openPlan(host);await button(host,'进入队长预览').click();await visible(button(host,'确认就绪，开始组牌'));await button(host,'预览候选作品 →').click();await host.locator('.draft-tile').first().getByRole('button',{name:/添加书签/}).click();await button(host,'关闭队长预览').click();
 await mobileTab(pages[2],'准备');await button(host,'确认就绪，开始组牌').click();await button(pages[2],'确认就绪，开始组牌').click();await visible(host.locator('.draft-clock'));const deadline=states[2].nextPlan.endsAt;await pages[2].reload();await visible(pages[2].locator('.draft-clock'));assert.equal(states[2].nextPlan.endsAt,deadline);checks.push('captain reconnect keeps draft timer');await pool(pages[2]);
 const first=host.locator('.draft-tile').first();const firstId=states[0].nextPlan.candidates[0].id;await first.locator('.draft-tile-main').click();const dlg=host.getByRole('dialog');await visible(dlg);
 assert.equal(await dlg.getByText('关闭预览',{exact:true}).count(),0);assert.equal(await dlg.locator('button[aria-label^="关闭"]').count(),1);assert.equal(!!states[0].nextPlan.captainView.claims[firstId],false);
 const bgm=dlg.getByRole('link',{name:'在 Bangumi 查看'});assert.equal(await bgm.getAttribute('target'),'_blank');const rel=await bgm.getAttribute('rel')??'';assert.ok(rel.includes('noopener')&&rel.includes('noreferrer'));assert.equal(await bgm.getAttribute('href'),`https://bgm.tv/subject/${firstId}`);
 await button(host,'领取这张').click();await until(()=>!!states[0].nextPlan?.captainView?.claims?.[firstId],'preview claim');await visible(first.getByText(/保护/));
 assert.equal(await host.locator('.draft-tile').getByText('详情',{exact:true}).count(),0);
 const drag=host.locator('.draft-tile').nth(4);const dragId=states[0].nextPlan.candidates[4].id;await drag.scrollIntoViewIfNeeded();
 const takeZone=host.locator('.draft-drop-zones [data-drop="take"]');await takeZone.scrollIntoViewIfNeeded();
 const dbox=await drag.locator('.draft-tile-main').boundingBox(),tbox=await takeZone.boundingBox();
 await host.mouse.move(dbox.x+dbox.width/2,dbox.y+20);await host.mouse.down();await host.mouse.move(dbox.x+dbox.width/2+24,dbox.y+34,{steps:3});await host.mouse.move(tbox.x+tbox.width/2,tbox.y+tbox.height/2,{steps:8});await shot(host,'25-drag-desktop');await host.mouse.up();
 await until(()=>!!states[0].nextPlan?.captainView?.claims?.[dragId],'mouse drag claim');assert.equal(await host.locator('.draft-drag-ghost').count(),0);
 await drag.scrollIntoViewIfNeeded();const dbox2=await drag.locator('.draft-tile-main').boundingBox(),poolBox=await host.locator('.draft-candidates').boundingBox();
 await host.mouse.move(dbox2.x+dbox2.width/2,dbox2.y+20);await host.mouse.down();await host.mouse.move(dbox2.x+dbox2.width/2+24,dbox2.y+34,{steps:3});await host.mouse.move(poolBox.x+poolBox.width-24,poolBox.y+36,{steps:8});await host.mouse.up();
 await until(()=>!states[0].nextPlan?.captainView?.claims?.[dragId],'mouse drag release');
 await openPlan(pages[1]);assert.equal(await pages[1].locator('.draft-tile small').count(),0);assert.equal(states[1].nextPlan.captainView,undefined);assert.equal(states[1].nextPlan.myBookmarks,undefined);
 checks.push('candidate click opens preview (no detail button, single close, real Bangumi link), preview claim, mouse drag take/release');
 const second=pages[2].locator('.draft-tile').nth(1);const secondId=states[2].nextPlan.candidates[1].id;await second.scrollIntoViewIfNeeded();const sbox=await second.locator('.draft-tile-main').boundingBox();
 const ibox=await pages[2].locator('.draft-dock [data-drop="interfere"]').boundingBox();
 const cdp=await pages[2].context().newCDPSession(pages[2]);const sx=sbox.x+sbox.width/2,sy=sbox.y+25,fx=ibox.x+ibox.width/2,fy=ibox.y+ibox.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});await new Promise(r=>setTimeout(r,500));
 for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+(fx-sx)*i/6,y:sy+(fy-sy)*i/6}]});
 await shot(pages[2],'26-drag-mobile');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const confirmDlg=pages[2].getByRole('dialog');await visible(confirmDlg);await button(pages[2],'确认投放').click();
 await until(()=>!!states[2].nextPlan?.captainView?.claims?.[secondId],'touch interference');await visible(second.getByText(/干扰/));
 assert.equal(states[2].nextPlan.captainView.claims[secondId].kind,'interference');assert.equal(states[0].nextPlan.captainView.claims[secondId].kind,'interference');assert.equal(states[0].nextPlan.captainView.claims[secondId].from,states[2].nextPlan.myTeam);
 await visible(host.locator('.draft-tile').nth(1).getByText(/干扰/));
 checks.push('real touch long-press interference with confirmation; both captains see interference without consuming manual quota');
 await host.evaluate(()=>scrollTo(0,0));await pages[2].evaluate(()=>scrollTo(0,0));await shot(host,'11-draft-desktop');await theme(host,true);await host.setViewportSize({width:1920,height:1080});await shot(host,'12-draft-light-1920');await theme(host,false);await host.setViewportSize({width:1440,height:900});await shot(pages[2],'13-draft-mobile');await pages[2].setViewportSize({width:360,height:740});await shot(pages[2],'14-draft-small');await pages[2].setViewportSize({width:390,height:844});
 await button(host,'手选完成，剩余随机补齐').click();await controls(pages[2]);await button(pages[2],'手选完成，剩余随机补齐').click();await visible(button(host,'开始五秒倒计时'));assert.equal(await host.locator('.anime-board-card').count(),0);await shot(host,'15-sealed');
 await button(host,'开始五秒倒计时').click();await visible(host.locator('.anime-board-card').first());await until(()=>states[3]?.board?.length===36,'operative board');assert.equal(await host.locator('.anime-board-card').count(),36);await mobileTab(pages[3],'棋盘');
 await host.evaluate(()=>scrollTo(0,0));await shot(host,'16-board-desktop');const board=await host.locator('.anime-board').boundingBox();assert.ok(board.y+board.height<=900,`Desktop full board clipped: ${JSON.stringify(board)}`);
 await theme(host,true);await host.setViewportSize({width:1920,height:1080});await shot(host,'17-board-light-1920');await theme(host,false);await host.setViewportSize({width:1440,height:900});await pages[3].evaluate(()=>scrollTo(0,0));await shot(pages[3],'18-board-mobile');await pages[3].setViewportSize({width:360,height:740});await theme(pages[3],true);await shot(pages[3],'19-board-small-light');await theme(pages[3],false);await pages[3].setViewportSize({width:390,height:844});
 await pages[3].locator('.anime-board-card').first().click();const boardDlg=pages[3].getByRole('dialog');await visible(boardDlg);assert.equal(await pages[3].locator('.anime-board-card.is-revealed').count(),0);assert.equal(await boardDlg.getByText('关闭预览',{exact:true}).count(),0);assert.equal(await boardDlg.locator('button[aria-label^="关闭"]').count(),1);const bgmBoard=boardDlg.getByRole('link',{name:'在 Bangumi 查看'});assert.equal(await bgmBoard.getAttribute('target'),'_blank');assert.ok(String(await bgmBoard.getAttribute('href')).startsWith('https://bgm.tv/subject/'));await shot(pages[3],'20-preview-mobile');await boardDlg.locator('.dialog-heading button').click();await boardDlg.waitFor({state:'hidden'});await button(pages[3],'纯文字显示').click();assert.equal(await pages[3].locator('.anime-board-card img').count(),0);await button(pages[3],'封面显示').click();await button(pages[3],'放大棋盘').click();
 const pan=await pages[3].locator('.anime-board-scroll').boundingBox();const touch=await pages[3].context().newCDPSession(pages[3]);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pan.x+pan.width-20,y:pan.y+80}]});for(let dx=40;dx<220;dx+=30)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pan.x+pan.width-dx,y:pan.y+80}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pages[3].waitForTimeout(200);assert.ok(await pages[3].locator('.anime-board-scroll').evaluate(el=>el.scrollLeft)>0,'touch pan');await button(pages[3],'重置视图').click();assert.equal(await pages[3].locator('.anime-board-scroll').evaluate(el=>el.scrollLeft),0);checks.push('preview no flip; text; zoom; actual touch pan/reset');
 await mobileTab(pages[3],'聊天');assert.equal(await pages[3].locator('.anime-board-card:visible').count(),0);await shot(pages[3],'21-mobile-chat');await mobileTab(pages[3],'玩家');await shot(pages[3],'22-mobile-players');await mobileTab(pages[3],'棋盘');assert.equal(await pages[3].locator('.anime-board-card:visible').count(),36);
 const next=await config(host);await next.getByLabel('玩法',{exact:true}).selectOption('classic');await button(host,'保存配置并更新候选池').click();await until(()=>states[0].nextPlan?.variant==='classic','third plan');await closePlan(host);await playToVictory(true);await shot(host,'23-anime-results');await theme(host,true);await shot(host,'24-results-light');await theme(host,false);await button(host,'准备下一局').click();await button(host,'进入下一局准备').click();await button(host,'开始五秒倒计时').click();await visible(host.locator('.card-tile').first());assert.equal(await host.locator('.card-tile').count(),25);
 await host.locator('.private-review-entry>details').evaluate(el=>el.open=true);const links=await host.getByRole('navigation',{name:'历史对局'}).getByRole('link',{name:'公开复盘 ↗',exact:true}).all();assert.equal(links.length,2);for(const link of links){const href=await link.getAttribute('href');assert.equal((await host.request.get(`${api}${href.replace('/replay/','/api/replays/')}`)).status(),200);const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(`replay: ${e.message}`));await p.goto(`${url}${href}`);await visible(p.locator('.replay-board')).catch(async e=>{await p.screenshot({path:path.join(artifacts,`failure-replay-${links.indexOf(link)}.png`)}).catch(()=>{});await fs.writeFile(path.join(artifacts,`failure-replay-${links.indexOf(link)}.txt`),await p.locator('body').innerText().catch(()=>''));throw e;});await shot(p,`replay-${links.indexOf(link)}`);await p.close();}await closePlan(host);
 assert.deepEqual(errors,[]);checks.push('three consecutive rounds and independent replay pages','dark/light desktop 1440/1920 and touch mobile 390/360');await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify({passed:true,checks,errors},null,2));console.log('UI browser acceptance passed',checks);
}catch(e){await fs.writeFile(path.join(artifacts,'failure-errors.txt'),JSON.stringify(errors,null,2)).catch(()=>{});for(let i=0;i<pages.length;i++){await pages[i].screenshot({path:path.join(artifacts,`failure-${i}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(artifacts,`failure-${i}.txt`),await pages[i].locator('body').innerText().catch(()=>''));}throw e;}
finally{const host=pages[0];if(host){await closePlan(host).catch(()=>{});host.removeAllListeners('dialog');host.once('dialog',d=>d.accept());const management=host.locator('.match-members');if(await management.count())await management.evaluate(el=>el.open=true).catch(()=>{});const manage=button(host,'房间管理');if(await manage.isVisible().catch(()=>false))await manage.click().catch(()=>{});const close=button(host,'解散房间').first();if(await close.isVisible().catch(()=>false)){await close.click().catch(()=>{});await host.waitForTimeout(500);}}await browser.close();}
