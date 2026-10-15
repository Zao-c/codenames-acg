import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.PLAYTEST_BASE_URL??'http://127.0.0.1:5177';
const artifacts=path.resolve('artifacts/browser-smoke');await fs.mkdir(artifacts,{recursive:true});
let browser;for(const channel of ['msedge','chrome',undefined]){try{browser=await chromium.launch({channel,headless:true});break;}catch{}}
if(!browser)throw new Error('No browser available');
const pages=[];const errors=[];
const visible=async loc=>loc.waitFor({state:'visible',timeout:20000});
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function end(page){page.once('dialog',d=>d.accept());await button(page,'结束对局').click();await visible(button(page,'再来一局'));}
try{
 for(let i=0;i<4;i++){
  const context=await browser.newContext(i>=2?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1000}});
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}/login`);await button(page,'游客').click();await page.getByPlaceholder('输入昵称直接开玩').fill(`Browser${i}`);await button(page,'快速进入').click();await page.goto(url);await visible(button(page,'创建房间'));
 }
 const host=pages[0];await button(host,'创建房间').click();await visible(host.locator('.room-code').first());const id=await host.locator('.room-code').first().innerText();
 for(let i=1;i<4;i++){await pages[i].goto(`${url}/room/${id}`);await button(pages[i],'加入房间').click();await visible(pages[i].locator('.room-layout'));}
 for(let i=0;i<4;i++){await button(pages[i],i<2?'红队':'蓝队').click();if(i%2===0)await button(pages[i],'队长').click();}
 await button(host,'开始游戏').click();await visible(host.locator('.start-countdown'));await host.reload();await visible(host.locator('.board-grid .card-tile').first());assert.equal(await host.locator('.card-tile').count(),25);console.log('browser classic + reload countdown passed');
 // Plan a future anime game while current board is still in play.
 const panel=host.locator('.next-match-panel');await button(host,'查看准备').click();await panel.locator('summary').filter({hasText:'配置'}).click();
 await panel.getByLabel('玩法',{exact:true}).selectOption('anime');await panel.getByLabel('棋盘',{exact:true}).selectOption('6x6');
 await panel.getByLabel('动画作品池',{exact:true}).selectOption('2026-Q3');await button(host,'保存配置并更新候选池').click();
 await visible(panel.getByText('动画组牌 · 6x6',{exact:false}));assert.equal(await host.locator('.card-tile').count(),25);
 await end(host);await button(host,'进入无时限准备').click();await visible(button(host,'准备好了 / 跳过引导'));
 await host.locator('.draft-tile').first().getByRole('button',{name:/添加书签/}).click();
 // Mobile blue captain opens its independent preparation pane.
 if(await button(pages[2],'查看准备').isVisible())await button(pages[2],'查看准备').click();
 await button(host,'准备好了 / 跳过引导').click();await button(pages[2],'准备好了 / 跳过引导').click();await visible(host.locator('.draft-clock'));
 const first=host.locator('.draft-tile').first();await first.locator(':scope > button').click();await visible(first.getByText(/保护/));
 // An operative receives the same static pool, without ownership/protection widgets.
 if(await button(pages[1],'查看准备').isVisible())await button(pages[1],'查看准备').click();assert.equal(await pages[1].locator('.draft-tile small').count(),0);
 const second=pages[2].locator('.draft-tile').nth(1);await second.scrollIntoViewIfNeeded();
 const box=await second.locator(':scope > button').boundingBox();const cdp=await pages[2].context().newCDPSession(pages[2]);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+30}]});await new Promise(r=>setTimeout(r,700));await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await visible(second.getByText(/干扰/));
 await host.screenshot({path:path.join(artifacts,'01-draft-desktop.png'),fullPage:true});await pages[2].screenshot({path:path.join(artifacts,'02-draft-mobile.png'),fullPage:true});
 await button(host,'手选完成，剩余随机补齐').click();await button(pages[2],'手选完成，剩余随机补齐').click();await visible(button(host,'开始五秒倒计时'));assert.equal(await host.locator('.anime-board-card').count(),0);
 await button(host,'开始五秒倒计时').click();await visible(host.locator('.anime-board-card').first());assert.equal(await host.locator('.anime-board-card').count(),36);assert.equal(await pages[3].locator('.anime-board-card').count(),36);
 await pages[3].locator('.anime-board-card').first().click();await visible(pages[3].getByRole('dialog'));assert.equal(await pages[3].locator('.anime-board-card.is-revealed').count(),0);await button(pages[3],'关闭预览').click();await button(pages[3],'纯文字显示').click();assert.equal(await pages[3].locator('.anime-board-card img').count(),0);await button(pages[3],'放大棋盘').click();await button(pages[3],'重置视图').click();
 await host.screenshot({path:path.join(artifacts,'03-board-desktop.png'),fullPage:true});await pages[3].screenshot({path:path.join(artifacts,'04-board-mobile.png'),fullPage:true});
 // Third round changes back to classic without rebuilding the room.
 await panel.locator('summary').filter({hasText:'配置'}).click();await panel.getByLabel('玩法',{exact:true}).selectOption('classic');await button(host,'保存配置并更新候选池').click();await end(host);await button(host,'再来一局').click();await visible(host.locator('.card-tile').first());assert.equal(await host.locator('.card-tile').count(),25);
 const replayLinks=await host.getByRole('navigation',{name:'历局回放'}).getByRole('link').all();assert.equal(replayLinks.length,2);
 for(const link of replayLinks){const response=await host.request.get((await link.getAttribute('href')).replace('/replay/','http://127.0.0.1:3022/api/replays/'));assert.equal(response.status(),200);}
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(artifacts,'smoke-report.json'),JSON.stringify({passed:true,players:4,mobilePlayers:2,sequence:['classic','anime-6x6','classic'],checks:['refresh countdown','private preselection','touch interference','preview does not flip','text mode','zoom reset','independent replays'],errors},null,2));console.log('browser: 4 clients / 2 mobile / 3 rounds passed');
}catch(e){for(let i=0;i<pages.length;i++){await pages[i].screenshot({path:path.join(artifacts,`failure-${i}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(artifacts,`failure-${i}.txt`),await pages[i].locator('body').innerText().catch(()=>''));}throw e;}finally{await browser.close();}
