import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
import sharp from 'sharp';
import {CoverService,CoverUnavailable,type CoverWork} from './cover-service.js';
import {CoverUpstreams,cosConfiguration} from './cover-upstreams.js';

dotenv.config({path:process.env.COVER_ENV_FILE||'.env.covers',quiet:true});
// This process has its own CPU/memory budget; it never imports GameService.
sharp.concurrency(1);sharp.cache({memory:8,files:0,items:32});
const port=Number(process.env.COVER_PORT||3003),directory=path.resolve(process.env.COVER_CACHE_DIR||'data/cover-cache-v2');
const resourceFile=path.resolve(process.env.COVER_RESOURCE_FILE||'resources/anime-catalog.json'),importFile=path.resolve(process.env.COVER_IMPORT_FILE||'data/anime-imports.json');
async function catalog(){
 const files=await Promise.all([resourceFile,importFile].map(async file=>{try{return JSON.parse(await fs.readFile(file,'utf8')).works as CoverWork[];}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}}));
 return [...new Map(files.flat().filter(w=>w&&typeof w.cover==='string').map(w=>[w.id,{id:w.id,cover:w.cover}])).values()];
}
const upstreams=new CoverUpstreams(cosConfiguration(process.env),process.env.COVER_OUTBOUND_PROXY_URL);
const service=new CoverService(directory,path.join(directory,'manifest.json'),upstreams);
await service.initialize(await catalog());
setInterval(()=>{void catalog().then(works=>service.setCatalog(works)).catch(()=>{});},60000).unref();
const requestCounts=new Map<string,{at:number;count:number}>();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
 const url=new URL(req.url||'/','http://127.0.0.1');
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,...service.stats()}));return;}
 // Nginx forwards only these two public paths; health/metrics stay loopback-only.
 const peer=req.socket.remoteAddress||'local',counter=requestCounts.get(peer),now=Date.now();
 if(counter&&counter.at+60000>now){if(++counter.count>6000){res.writeHead(429,{'Retry-After':'5'}).end();return;}}
 else{if(requestCounts.size>1024)requestCounts.clear();requestCounts.set(peer,{at:now,count:1});}
 if(url.pathname==='/api/anime/cover-locations'){
  const raw=url.searchParams.get('ids')||'';if(raw.length>1000||!/^[0-9]+(?:,[0-9]+)*$/.test(raw)){res.writeHead(400).end();return;}
  const ids=[...new Set(raw.split(',').map(Number))];if(ids.length>60||ids.some(id=>!Number.isSafeInteger(id)||id<=0)){res.writeHead(400).end();return;}
  const works=service.locations(ids);res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control',works.every(w=>w.cdn)?'public, max-age=3600':'public, max-age=2');
  res.end(JSON.stringify({works}));service.warm(ids);return;
 }
 const match=url.pathname.match(/^\/api\/anime\/cover\/(\d+)$/);
 if(!match){res.writeHead(404).end();return;}
 try{
  const bytes=await service.cover(Number(match[1]),url.searchParams.get('v')??undefined);
  if(res.destroyed)return;
  res.writeHead(200,{'Content-Type':'image/webp','Content-Length':bytes.length,'Cache-Control':'public, max-age=31536000, immutable'});res.end(bytes);
 }catch(error){if(!res.destroyed)res.writeHead(error instanceof CoverUnavailable&&error.reason==='missing'?404:503,{'Cache-Control':'no-store','Retry-After':'5'}).end();}
});
server.headersTimeout=10000;server.requestTimeout=12000;server.keepAliveTimeout=5000;
server.listen(port,'127.0.0.1',()=>console.log(`Cover service ready on 127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();void service.flush().finally(()=>process.exit(0));});
