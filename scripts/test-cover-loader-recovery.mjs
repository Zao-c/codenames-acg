import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';

const bundle=await build({entryPoints:['apps/web/src/lib/cover-loader.ts'],bundle:true,write:false,
  platform:'browser',format:'iife',globalName:'CoverProbe',define:{'import.meta.env.VITE_SERVER_URL':'""'}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s3FoX8AAAAASUVORK5CYII=','base64');
let browser;for(const channel of ['chromium','msedge','chrome'])try{browser=await chromium.launch({channel,headless:true});break;}catch{}
assert.ok(browser);const results=[];
async function scenario(name,{metadataMs=0,imageMs=0},exercise){
 const context=await browser.newContext(),page=await context.newPage();let active=0,max=0,localRequests=0;
 const local=request=>new URL(request.url()).pathname.startsWith('/api/anime/cover/');
 const pending=new Set();
 page.on('request',request=>{if(local(request)){pending.add(request);active++;localRequests++;max=Math.max(max,active);}});
 const finish=request=>{if(pending.delete(request))active--;};
 page.on('requestfinished',finish);page.on('requestfailed',finish);
 await page.route('http://cover-recovery.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Cover recovery</title>'}));
 await page.route('**/api/anime/cover-locations?*',async route=>{
  await new Promise(resolve=>setTimeout(resolve,metadataMs));
  await route.fulfill({json:{works:[]}}).catch(()=>{});
 });
 await page.route('https://lain.bgm.tv/**',route=>route.abort());
 await page.route('**/api/anime/cover/*',async route=>{
  await new Promise(resolve=>setTimeout(resolve,imageMs));
  await route.fulfill({contentType:'image/png',body:png}).catch(()=>{});
 });
 const started=performance.now();
 try{
  await page.goto('http://cover-recovery.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const details=await exercise(page,()=>localRequests);
  assert.ok(max<=1,'same-origin image requests keep their one-connection budget');
  results.push({name,passed:true,seconds:(performance.now()-started)/1000,maxLocalRequests:max,localRequests,...details});
 }catch(error){results.push({name,passed:false,seconds:(performance.now()-started)/1000,maxLocalRequests:max,localRequests,error:error.message});}
 finally{await context.close();}
}
try{
 await scenario('healthy cold fallback takes three seconds',{imageMs:3000},async page=>{
  const result=await page.evaluate(async()=>{
   try{return {source:await window.CoverProbe.loadCover({id:1,cover:'https://lain.bgm.tv/pic/cover/l/fixture/1.jpg'},new AbortController().signal)};}
   catch(error){return {error:error.name};}
  });
  assert.ok(result.source?.includes('/api/anime/cover/1?'),JSON.stringify(result));return result;
 });
 await scenario('waiting for a queue slot is not an active download timeout',{imageMs:1000},async page=>{
  const result=await page.evaluate(async()=>{
   const jobs=Array.from({length:8},(_,index)=>window.CoverProbe.loadCover({id:index+10,cover:`https://lain.bgm.tv/pic/cover/l/fixture/${index+10}.jpg`},new AbortController().signal));
   const outcomes=await Promise.allSettled(jobs);
   return {fulfilled:outcomes.filter(value=>value.status==='fulfilled').length,stats:window.CoverProbe.coverLoaderStats()};
  });
  assert.equal(result.fulfilled,8,'all eight healthy queued covers must finish');
  assert.equal(result.stats.queued,0);assert.equal(result.stats.inFlight,0);return result;
 });
 await scenario('cancel then immediately revisit while metadata is pending',{metadataMs:200,imageMs:100},async(page,requestCount)=>{
  const result=await page.evaluate(async()=>{
   const work={id:100,cover:'https://lain.bgm.tv/pic/cover/l/fixture/100.jpg'},first=new AbortController();
   const cancelled=window.CoverProbe.loadCover(work,first.signal).then(()=> 'unexpected-success',error=>error.name);
   first.abort();const firstResult=await cancelled;
   const second=window.CoverProbe.loadCover(work,new AbortController().signal).then(source=>({source}),error=>({error:error.name}));
   await new Promise(resolve=>setTimeout(resolve,300));
   const third=window.CoverProbe.loadCover(work,new AbortController().signal).then(source=>({source}),error=>({error:error.name}));
   return {firstResult,second:await second,third:await third,stats:window.CoverProbe.coverLoaderStats()};
  });
  assert.equal(result.firstResult,'AbortError');assert.ok(result.second.source,JSON.stringify(result));
  assert.equal(result.second.source,result.third.source);assert.equal(requestCount(),1,'fresh subscribers still share one download');
  assert.equal(result.stats.inFlight,0);return result;
 });
 await scenario('offscreen cancellation drains active and queued requests',{imageMs:3000},async page=>{
  const result=await page.evaluate(async()=>{
   const controllers=Array.from({length:8},()=>new AbortController());
   const jobs=controllers.map((controller,index)=>window.CoverProbe.loadCover({id:index+200,cover:`https://lain.bgm.tv/pic/cover/l/fixture/${index+200}.jpg`},controller.signal).then(()=> 'unexpected-success',error=>error.name));
   await new Promise(resolve=>setTimeout(resolve,1000));controllers.forEach(controller=>controller.abort());
   const outcomes=await Promise.all(jobs);await new Promise(resolve=>setTimeout(resolve,30));
   return {outcomes,stats:window.CoverProbe.coverLoaderStats()};
  });
  assert.ok(result.outcomes.every(value=>value==='AbortError'));
  assert.equal(result.stats.queued,0);assert.equal(result.stats.inFlight,0);
  assert.deepEqual(result.stats.active,{bgm:0,remote:0,local:0});return result;
 });
 await scenario('one consumer leaving does not cancel another visible consumer',{metadataMs:100,imageMs:100},async(page,requestCount)=>{
  const result=await page.evaluate(async()=>{
   const work={id:300,cover:'https://lain.bgm.tv/pic/cover/l/fixture/300.jpg'},first=new AbortController();
   const cancelled=window.CoverProbe.loadCover(work,first.signal).then(()=> 'unexpected-success',error=>error.name);
   const visible=window.CoverProbe.loadCover(work,new AbortController().signal);
   first.abort();return {firstResult:await cancelled,source:await visible};
  });
  assert.equal(result.firstResult,'AbortError');assert.ok(result.source);assert.equal(requestCount(),1);return result;
 });
}finally{await browser.close();}
await fs.mkdir('output',{recursive:true});
const report={passed:results.every(result=>result.passed),scope:'Real browser using deterministic failed BGM and delayed healthy same-origin fixtures; no multiplayer or production performance claim.',results};
await fs.writeFile(process.env.COVER_RECOVERY_REPORT??'output/cover-loader-recovery.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
