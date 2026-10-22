import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {observeSoakNetwork} from './soak-network-observer.mjs';

const out=path.resolve('output/soak-network-memory');await fs.mkdir(out,{recursive:true});
const mode=process.argv[2];
if(!mode){
 for(const value of ['legacy','cdp']){
  const child=spawn(process.execPath,['--expose-gc','--max-old-space-size=192',import.meta.filename,value],{stdio:'inherit',windowsHide:true});
  assert.equal(await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);}),0);
 }
 const legacy=JSON.parse(await fs.readFile(path.join(out,'legacy.json'))),cdp=JSON.parse(await fs.readFile(path.join(out,'cdp.json')));
 assert.ok(legacy.records.at(-1).retainedRequests>=6400);
 assert.ok(cdp.records.at(-1).retainedRequests<200);
 assert.ok(cdp.records.at(-1).heapUsed-cdp.records[0].heapUsed<32*1024*1024);
 assert.equal(cdp.pending,0);assert.equal(cdp.catalog,8);assert.equal(cdp.packets,8);
 assert.equal(cdp.imageResponses,6408);assert.equal(cdp.httpErrors,8);assert.equal(cdp.networkErrors,8);
 console.log('SOAK_NETWORK_MEMORY_PASS: same eight contexts and 6,400 images; counters retained, channel retention removed');
}else{
 assert.ok(['legacy','cdp'].includes(mode));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6E8AAAAASUVORK5CYII=','base64');
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/broken')){req.socket.destroy();return;}
  if(req.url.startsWith('/image')||req.url.startsWith('/missing')){res.statusCode=req.url.startsWith('/missing')?503:200;res.setHeader('Content-Type','image/png');res.end(png);return;}
  res.setHeader('Content-Type','text/html');res.end(req.url.startsWith('/socket.io/')?'42["fixture",{}]':'<!doctype html><title>isolated memory control</title>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 let browser;for(const channel of ['chromium','msedge','chrome'])try{browser=await chromium.launch({channel,headless:true});break;}catch{}
 assert.ok(browser);const pages=[],observers=[],records=[];let catalog=0,packets=0,imageResponses=0,httpErrors=0,networkErrors=0;
 const image=r=>{if(r.error)networkErrors++;else{imageResponses++;if(r.status>=400)httpErrors++;}};
 const sample=label=>{
  global.gc();const objects=[...browser._connection._objects.values()]; // Diagnostic read only; never change Playwright's GC.
  const record={label,...process.memoryUsage(),retainedRequests:objects.filter(o=>o._type==='Request').length};records.push(record);console.log(JSON.stringify({mode,...record}));
 };
 try{
  for(let i=0;i<8;i++){
   const p=await browser.newPage();pages.push(p);
   if(mode==='legacy'){
    p.on('request',r=>{if(new URL(r.url()).pathname==='/api/anime/catalog')catalog++;});
    p.on('response',r=>{if(r.request().resourceType()==='image')image({status:r.status()});});
    p.on('requestfailed',r=>{if(r.resourceType()==='image'&&!r.failure()?.errorText.includes('ERR_ABORTED'))image({error:r.failure()?.errorText});});
   }else observers.push(await observeSoakNetwork(await p.context().newCDPSession(p),{onCatalog:()=>catalog++,onImage:image,onPacket:p=>{if(p==='42["fixture",{}]')packets++;}}));
   await p.goto(base);
  }
  sample('start');
  for(let round=0;round<8;round++){
   await Promise.all(pages.map(p=>p.evaluate(async round=>{for(let b=0;b<10;b++)await Promise.all(Array.from({length:10},(_,i)=>new Promise(resolve=>{const img=new Image();img.onload=img.onerror=resolve;img.src='/image?'+round+'-'+b+'-'+i;})));},round)));
   sample((round+1)*800);
  }
  await Promise.all(pages.map(p=>p.evaluate(async()=>{
   await fetch('/api/anime/catalog');await(await fetch('/socket.io/?fixture')).text();
   for(const src of ['/missing','/broken'])await new Promise(resolve=>{const img=new Image();img.onload=img.onerror=resolve;img.src=src;});
  })));
  await new Promise(r=>setTimeout(r,250));
  await fs.writeFile(path.join(out,mode+'.json'),JSON.stringify({scope:'Loopback HTTP only, eight persistent browser contexts, 192 MiB driver heap; no game traffic or production requests',records,catalog,packets,imageResponses,httpErrors,networkErrors,pending:observers.reduce((n,o)=>n+o.pending(),0)},null,2));
 }finally{for(const observer of observers)observer.dispose();await browser.close();await new Promise(r=>server.close(r));}
}
