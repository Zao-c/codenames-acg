import {build} from 'esbuild';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
await fs.mkdir('output',{recursive:true});
const bundle=await build({entryPoints:['apps/web/src/lib/cover-loader.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'CoverProbe',define:{'import.meta.env.VITE_SERVER_URL':'""'}});
let browser;for(const channel of ['chromium','msedge','chrome'])try{browser=await chromium.launch({channel,headless:true});break;}catch{}assert.ok(browser);
let active=0,max=0,requests=0;
try{
 const page=await browser.newPage();await page.route('http://cover-unit.local/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Cover queue unit</title>'}));
 await page.route('**/api/anime/cover-locations?*',async route=>{active++;max=Math.max(max,active);requests++;await new Promise(r=>setTimeout(r,180));const ids=new URL(route.request().url()).searchParams.get('ids').split(',').map(Number);await route.fulfill({json:{works:ids.map(id=>({id,source:`https://lain.bgm.tv/pic/cover/l/unit/${id}.jpg`,version:'0'}))}});active--;});
 await page.route('https://lain.bgm.tv/**',route=>route.abort());await page.route('**/api/anime/cover/*',route=>route.abort());
 await page.goto('http://cover-unit.local/');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async()=>{window.unitControllers=[];window.unitJobs=[];for(let group=0;group<6;group++){for(let i=1;i<=20;i++){const c=new AbortController();window.unitControllers.push(c);window.unitJobs.push(window.CoverProbe.loadCover({id:group*20+i,cover:`https://lain.bgm.tv/pic/cover/l/unit/${group*20+i}.jpg`},c.signal).catch(()=>{}));}await new Promise(r=>setTimeout(r,30));}await new Promise(r=>setTimeout(r,1400));window.unitControllers.forEach(c=>c.abort());await Promise.all(window.unitJobs);});
 assert.equal(max,1,'a fast scroll keeps metadata fetches serialized');assert.ok(requests>=2);
 const stats=await page.evaluate(()=>window.CoverProbe.coverLoaderStats());assert.ok(stats.maxLocal<=1);assert.equal(stats.queued,0);assert.equal(stats.inFlight,0);assert.deepEqual(stats.active,{bgm:0,remote:0,local:0});await fs.writeFile('output/metadata-scroll-unit.json',JSON.stringify({passed:true,works:120,maxMetadataRequests:max,requests,stats},null,2));console.log(JSON.stringify({passed:true,maxMetadataRequests:max,requests,stats}));
}finally{await browser.close();}
