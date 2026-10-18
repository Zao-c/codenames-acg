import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {io} from 'socket.io-client';
import {applyRoomDelta} from '@acg-codenames/shared';

const out=path.resolve('output/playwright/performance');await fs.mkdir(out,{recursive:true});
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cipai-performance-'));
const base='http://127.0.0.1:3162',metrics=path.join(out,'server-metrics.jsonl');await fs.writeFile(metrics,'');
const fixture=JSON.parse(await fs.readFile('apps/server/resources/anime-catalog.json','utf8')).works;
await fs.writeFile(path.join(dir,'imports.json'),JSON.stringify({schemaVersion:1,works:Array.from({length:5000},(_,i)=>({...fixture[i%fixture.length],id:900000+i,title:'性能夹具'+i,fullTitle:'性能夹具'+i,seriesId:'fixture:'+i,source:'bangumi'}))}));
const server=spawn(process.execPath,['--import','tsx','--import','./scripts/round7-metrics.mjs','apps/server/src/index.ts'],{windowsHide:true,env:{...process.env,PORT:'3162',USE_MEMORY_STORE:'1',ENABLE_ANIME_DRAFT:'1',ENABLE_ANIME_COMMUNITY:'1',ENABLE_ANIME_MANUAL:'1',ROUND7_METRICS_FILE:metrics,USER_STORE_FILE:path.join(dir,'users.json'),ANIME_POOL_STORE_FILE:path.join(dir,'pools.json'),ANIME_IMPORT_FILE:path.join(dir,'imports.json'),MANUAL_WORK_STORE_FILE:path.join(dir,'manual.json'),ANIME_COVER_DIR:path.join(dir,'covers'),REVEAL_IMAGE_DIR:path.join(dir,'images')},stdio:['ignore','pipe','pipe']});
server.stderr.on('data',d=>process.stderr.write(d));
const clients=[],states=[],avatars=new Map(),latencies=[],errors=[];let actualBytes=0,previousEstimatedBytes=0,measuring=false,deltas=0,snapshots=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<300;i++){if(await fn())return;await sleep(50);}throw new Error(label);}
async function api(url,body,headers={}){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
function percentile(values,p){return [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;}
try{
  await until(async()=>{try{return(await fetch(base+'/health')).ok;}catch{return false;}},'server start');
  for(let i=0;i<8;i++){
    const username='性能成员'+i,account=await api('/api/users/login',{username});
    const png=await sharp(crypto.randomBytes(96*96*3),{raw:{width:96,height:96,channels:3}}).webp({quality:80}).toBuffer();
    const avatarUrl='data:image/webp;base64,'+png.toString('base64');
    const update=await fetch(base+'/api/users/'+encodeURIComponent(username),{method:'PUT',headers:{'content-type':'application/json','x-user-session-token':account.sessionToken},body:JSON.stringify({avatarUrl})});assert.ok(update.ok,await update.text());
    const hash=crypto.createHash('sha256').update(avatarUrl).digest('hex');avatars.set('/api/profile-avatars/'+hash,avatarUrl);
    const socket=io(base,{transports:['websocket'],autoConnect:false,forceNew:true});clients.push(socket);
    const observe=(event,data)=>{
      if(event==='room_state'){states[i]=data;if(measuring)snapshots++;}
      else {const next=applyRoomDelta(states[i]??null,data);assert.ok(next,'delta base complete');states[i]=next;if(measuring)deltas++;}
      if(measuring){actualBytes+=Buffer.byteLength(JSON.stringify(data));previousEstimatedBytes+=Buffer.byteLength(JSON.stringify(states[i],(k,v)=>avatars.get(v)??v));}
    };
    socket.on('room_state',d=>observe('room_state',d));socket.on('room_state_delta',d=>observe('room_state_delta',d));socket.on('error_message',e=>errors.push(e.message));
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});socket.emit('enable_room_deltas');
    const sessionPromise=new Promise(resolve=>socket.once('session',resolve));
    socket.emit(i?'join_room':'create_room',{...(i?{roomId:states[0].id}:{}),nickname:username,identityKey:crypto.randomBytes(32).toString('hex'),profile:{accountType:'named',username,avatarUrl,userSessionToken:account.sessionToken}});await sessionPromise;
    await until(()=>states[i]?.players.length===i+1,'roster');
    socket.emit('set_team',{roomId:states[0].id,team:i<4?'red':'blue'});await until(()=>states[i]?.viewer?.team===(i<4?'red':'blue'),'team');
    if(i===0||i===4){socket.emit('set_role',{roomId:states[0].id,role:'spymaster'});await until(()=>states[i]?.viewer?.role==='spymaster','captain');}
  }
  const roomId=states[0].id;
  async function act(i,kind,extra={}){const start=Date.now();const result=await new Promise(resolve=>clients[i].emit('plan_action',{roomId,kind,version:states[i].nextPlan?.version,...extra},resolve));assert.ok(result.ok,result.message);latencies.push(Date.now()-start);await sleep(30);}
  await act(0,'configure',{variant:'anime',boardMode:'6x6',animeSeriesRotation:false,animeRandomSwap:true});await act(0,'prepare');await act(0,'ready');await act(4,'ready');
  assert.equal(states[0].nextPlan.stage,'draft');assert.equal(states[0].nextPlan.candidates.length,180);assert.equal(states[0].players.length,8);
  for(const state of states){assert.ok(!JSON.stringify(state).includes('data:image/'));if(state.viewer.role!=='spymaster')assert.equal(state.nextPlan.captainView,undefined);}
  const catalog=await fetch(base+'/api/anime/catalog');const catalogBytes=(await catalog.arrayBuffer()).byteLength;
  const home=await fetch(base+'/api/anime/home-covers');const homeBytes=(await home.arrayBuffer()).byteLength;assert.ok(homeBytes<catalogBytes/100);
  // Node fetch transparently decompresses, so raw HTTP is used to inspect gzip bytes.
  const {request}=await import('node:http');const compressed=await new Promise((resolve,reject)=>{request(base+'/api/anime/catalog',{headers:{'accept-encoding':'gzip'}},r=>{let bytes=0;r.on('data',b=>bytes+=b.length);r.on('end',()=>resolve({bytes,encoding:r.headers['content-encoding']}));}).on('error',reject).end();});assert.equal(compressed.encoding,'gzip');assert.ok(compressed.bytes<catalogBytes/3);
  const avatar=states[0].players[0].profile.avatarUrl;const avatarResponse=await fetch(base+avatar);assert.ok(avatarResponse.ok);assert.match(avatarResponse.headers.get('cache-control'),/public/);
  latencies.length=0;measuring=true;const started=Date.now();const seconds=Number(process.env.PERFORMANCE_SECONDS??60);
  for(let n=0;n<seconds*4;n++){await act(n%2?0:4,'bookmark',{workId:states[0].nextPlan.candidates[n%180].id});if(n%8===0){const i=1+n%6;clients[i].emit('send_chat_message',{roomId,text:'性能测试 '+n,requestId:'perf-'+n});}await sleep(200);}
  measuring=false;assert.ok(clients.every(s=>s.connected));assert.deepEqual(errors,[]);assert.ok(deltas>100);assert.ok(actualBytes<previousEstimatedBytes*.25);
  // Lost delta recovery and a legacy client both receive authoritative full snapshots.
  const before=states[1].transportRevision;clients[1].emit('sync_room_state',{roomId});await until(()=>states[1].transportRevision>before,'explicit full recovery');
  const samples=(await fs.readFile(metrics,'utf8')).trim().split('\n').map(JSON.parse).filter(s=>s.at>=started);
  const report={passed:true,players:8,candidates:180,extraCatalogWorks:5000,avatarSourceBytes:[...avatars.values()].map(s=>s.length),seconds:(Date.now()-started)/1000,actions:latencies.length,snapshots,deltas,actualRoomBytes:actualBytes,previousFullStateEstimateBytes:previousEstimatedBytes,reductionPercent:100*(1-actualBytes/previousEstimatedBytes),catalog:{uncompressed:catalogBytes,gzip:compressed.bytes,home:homeBytes},latencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),max:Math.max(...latencies)},server:{maxRssMiB:Math.max(...samples.map(s=>s.memory.rss))/1048576,eventLoopP99Ms:Math.max(...samples.map(s=>s.loopP99Ms))},scope:'Loopback synthetic benchmark; previous bytes reconstruct full state and original data-URI avatars; not an internet speed or 3-hour soak guarantee.'};
  await fs.writeFile(path.join(out,'load-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  for(const socket of clients)socket.disconnect();
  if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}else server.kill();
  await fs.rm(dir,{recursive:true,force:true});
}
