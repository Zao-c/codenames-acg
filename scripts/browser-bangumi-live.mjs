// Real Bangumi + real local application. No fixture upstream or prototype records are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base=process.env.PLAYTEST_BASE_URL??'http://127.0.0.1:5217';
const out=path.resolve('output/playwright/bangumi/live');await fs.mkdir(out,{recursive:true});
let browser;for(const channel of ['msedge','chrome',undefined]){try{browser=await chromium.launch({channel,headless:true});break;}catch{}}
if(!browser)throw new Error('Browser unavailable');
const errors=[],checks=[];const button=(p,name)=>p.getByRole('button',{name,exact:true});const visible=l=>l.waitFor({state:'visible',timeout:35000});
async function shot(p,name){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,name+'.png'),fullPage:false});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
async function sign(p,name){p.on('pageerror',e=>errors.push(e.message));await p.goto(`${base}/login`);await button(p,'游客').click();await p.getByPlaceholder('输入昵称直接开玩').fill(name);await button(p,'快速进入').click();await visible(button(p,'＋ 创建房间'));await p.goto(`${base}/anime-pools`);await visible(p.locator('.discovery-poster').first());}
try{
  const desktop=await browser.newPage({viewport:{width:1440,height:900}});await sign(desktop,'动画发现验收');let editor=desktop.locator('.anime-discovery');
  await editor.getByLabel('最低 Bangumi 评分').selectOption('8');await editor.getByLabel('最低评分人数').selectOption('1000');await editor.getByLabel('结果排序',{exact:true}).first().selectOption('score');await visible(editor.getByText(/Bangumi 原始结果每页 24 条/).first());assert.ok(await editor.locator('.discovery-poster').count()>0);
  await button(editor,'＋ 链接或 ID 导入').click();const d=desktop.getByRole('dialog',{name:'通过 Bangumi 链接或 ID 添加'});await d.getByLabel('条目链接或 ID').fill('https://bgm.tv/subject/302');await button(d,'解析并加入作品池').click();await d.waitFor({state:'hidden',timeout:35000});await visible(editor.locator('[data-work-id="302"]'));
  for(const card of (await editor.locator('.discovery-poster').all()).slice(1,4))await card.locator('.discovery-poster-actions button').first().click();
  await editor.getByLabel('作品池名称',{exact:true}).fill('周末动画局');await editor.getByLabel('作品池介绍').fill('从真实 Bangumi 公开条目里，挑选想和朋友一起玩的动画。');await button(editor,'保存作品池').click();await visible(desktop.getByText('作品池已保存。',{exact:true}));
  // Show the real queried metadata again after saving the server-backed pool.
  await editor.getByLabel('最低 Bangumi 评分').selectOption('8');await editor.getByLabel('最低评分人数').selectOption('1000');await editor.getByLabel('结果排序',{exact:true}).first().selectOption('score');await visible(editor.getByText(/Bangumi 原始结果每页 24 条/).first());
  await shot(desktop,'01-discovery-desktop-dark');await button(desktop,'切换亮色主题').click();await shot(desktop,'02-discovery-desktop-light');
  const key=await desktop.evaluate(()=>localStorage.getItem('cipai.private-identity.v1'));
  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await sign(mobile,'动画发现手机');await mobile.locator('.community-identity summary').click();await mobile.getByLabel('恢复身份凭证').fill(key);await button(mobile,'恢复并切换身份').click();await button(mobile,'我的作品池').click();const poolCard=mobile.locator('.community-pool-card').filter({has:mobile.getByRole('heading',{name:'周末动画局',exact:true})});await visible(poolCard);await button(poolCard,'编辑').click();editor=mobile.locator('.anime-discovery');
  await button(mobile,'筛选条件').click();await editor.getByLabel('查询范围').selectOption('cache');await editor.getByLabel('最低 Bangumi 评分').selectOption('8');await editor.getByLabel('最低评分人数').selectOption('1000');await button(editor,'应用筛选').click();await visible(editor.locator('.discovery-poster').first());
  await shot(mobile,'03-discovery-mobile-dark');await button(mobile,'切换亮色主题').click();await shot(mobile,'04-discovery-mobile-light');await button(mobile,'筛选条件').click();await shot(mobile,'05-filters-mobile-light');await mobile.getByRole('group',{name:'手机组池视图'}).getByRole('button',{name:/我的已选/}).click();await shot(mobile,'06-selected-mobile-light');
  await button(editor,'预览作品池').click();await visible(mobile.getByRole('dialog',{name:'作品池预览'}));await button(mobile,'关闭作品池预览').click();assert.deepEqual(errors,[]);
  checks.push('real API filter-only query and score/vote metadata','official previously uncached ID 302 import, server pool save, credential-backed second device editing','1440x900 and 390x844 dark/light, filters/selected/preview reachable, no overflow or pageerror');
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,realBangumi:true,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks}));
}catch(error){for(const [i,p] of browser.contexts().flatMap(c=>c.pages()).entries()){await p.screenshot({path:path.join(out,`failure-${i}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(out,`failure-${i}.txt`),await p.locator('body').innerText().catch(()=>''));}throw error;}finally{await browser.close();}
