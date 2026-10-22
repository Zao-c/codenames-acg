// Read-only production probe: replaces only this browser's public home covers.
import {chromium} from 'playwright';
import {browserProxy} from './browser-network.mjs';
import {theme} from './browser-support.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base='http://182.61.136.105',out='output/playwright/cover-delivery';await fs.mkdir(out,{recursive:true});
const work={id:413619,title:'非人哉 第二季 13-24集',fullTitle:'非人哉 第二季 13-24集',aliases:[],type:'WEB',seriesId:'bgm:413619',cover:'https://lain.bgm.tv/r/400/pic/cover/l/51/80/413619_W1Prc.jpg'};
const proxy=browserProxy();if(proxy.proxy)proxy.proxy.bypass+=',182.61.136.105';
let browser;for(const channel of ['chromium','msedge','chrome'])try{browser=await chromium.launch({channel,headless:true,...proxy});break;}catch{}assert.ok(browser);
const errors=[],images=[],mutations=[],active=new Set();let blocked=0,maxLocal=0;
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/anime/home-covers',route=>route.fulfill({json:{works:[work]}}));
 await page.route('**/*',route=>{
  const request=route.request();
  if(!['GET','HEAD'].includes(request.method())){mutations.push(new URL(request.url()).pathname);return route.abort();}
  if(request.resourceType()==='image'&&/lain\.(bgm|bangumi)\.tv|\.cos\.[a-z0-9-]+\.myqcloud\.com|weserv\.nl|wsrv\.nl/.test(request.url())){blocked++;return route.abort();}
  return route.fallback();
 });
 const local=request=>request.resourceType()==='image'&&new URL(request.url()).pathname==='/api/anime/cover/'+work.id;
 page.on('request',request=>{if(local(request)){active.add(request);maxLocal=Math.max(maxLocal,active.size);}});
 page.on('requestfinished',request=>active.delete(request));page.on('requestfailed',request=>active.delete(request));
 page.on('response',response=>{if(local(response.request()))images.push({url:response.url(),status:response.status()});});
 const start=performance.now();assert.equal((await page.goto(base,{waitUntil:'domcontentloaded'})).status(),200);
 const wait=()=>page.waitForFunction(()=>{
  const images=[...document.querySelectorAll('.feature-cover img')].filter(image=>{const r=image.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0;});
  return images.length>0&&images.every(image=>image.complete&&image.naturalWidth>0&&image.currentSrc.includes('/api/anime/cover/413619?'));
 },undefined,{timeout:30000});
 await wait();const desktopSeconds=(performance.now()-start)/1000;
 await theme(page,true);await page.screenshot({path:out+'/mirror-recovery-desktop-light.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await theme(page,false);await wait();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:out+'/mirror-recovery-mobile-dark.png',fullPage:true});
 assert.ok(blocked>0);assert.ok(images.some(image=>image.status===200));assert.ok(maxLocal<=2);assert.deepEqual(errors,[]);
 const audit=JSON.parse((await fs.readFile('output/production-audit-mirror.json','utf8')).replace(/^\uFEFF/,''));
 const html=await(await page.request.get(base)).text();for(const asset of Object.keys(audit.assetHashes))assert.ok(html.includes(asset));
 const report={passed:true,id:work.id,frontendSha:audit.frontendSha,workerSha:audit.coverWorkerSha,gamePid:audit.mainPid,remoteImagesBlocked:blocked,localImages:images,maxConcurrentLocalImageRequests:maxLocal,desktopVisibleCoverSeconds:desktopSeconds,errors,blockedMutations:mutations,scope:'Read-only production home; BGM/COS/public-mirror browser requests blocked. The previously failed real work renders via the production isolated cache. No room/account mutation allowed.'};
 await fs.writeFile(out+'/mirror-production-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
