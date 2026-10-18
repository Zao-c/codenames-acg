import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {io} from 'socket.io-client';
import crypto from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cipai-r7-load-'));
const out=path.resolve('output/playwright/round7/load');await fs.mkdir(out,{recursive:true});
const metrics=path.join(out,'server-metrics.jsonl');await fs.writeFile(metrics,'');
const port='3142',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['--import','tsx','--import','./scripts/round7-metrics.mjs','apps/server/src/index.ts'],{windowsHide:true,env:{...process.env,PORT:port,USE_MEMORY_STORE:'1',ENABLE_DEBUG_TOOLS:'0',ENABLE_ANIME_DRAFT:'1',ROUND7_METRICS_FILE:metrics,USER_STORE_FILE:path.join(dir,'users.json'),ANIME_POOL_STORE_FILE:path.join(dir,'pools.json'),ANIME_IMPORT_FILE:path.join(dir,'imports.json'),MANUAL_WORK_STORE_FILE:path.join(dir,'manual.json'),ANIME_COVER_DIR:path.join(dir,'covers'),REVEAL_IMAGE_DIR:path.join(dir,'images')},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',d=>process.stdout.write(d));server.stderr.on('data',d=>process.stderr.write(d));
const clients=[],states=new Map(),reports=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await sleep(100);}throw new Error(label);}
async function client(){const socket=io(base,{transports:['websocket'],autoConnect:false,forceNew:true});clients.push(socket);socket.on('room_state',state=>states.set(socket,state));await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return socket;}
async function session(socket,event,payload){payload.identityKey=crypto.randomBytes(32).toString('hex');const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('session timeout '+event)),10000);const error=p=>{clearTimeout(timer);reject(new Error(p.message));};socket.once('error_message',error);socket.once('session',s=>{clearTimeout(timer);socket.off('error_message',error);resolve(s);});});socket.emit(event,payload);return promise;}
function percentile(values,p){return [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;}
try{
 await until(async()=>{try{return(await fetch(base+'/health')).ok;}catch{return false;}},'server');
 const host=await client();const created=await session(host,'create_room',{nickname:'R7压测主',identityKey:'load-host-identity-0000000000',profile:{accountType:'guest',username:null,avatarUrl:null}});const roomId=created.roomId;
 for(let i=0;i<3;i++){const p=await client();await session(p,'join_room',{roomId,nickname:`R7玩家${i}`,identityKey:`load-player-identity-00000000-${i}`,profile:{accountType:'guest',username:null,avatarUrl:null}});}
 for(const n of [20,50]){
  while(clients.length<4+n){const i=clients.length-4,s=await client();await session(s,'join_spectator',{roomId,nickname:`观战${i}`,identityKey:`load-spectator-identity-00000000-${i}`,profile:{accountType:'guest',username:null,avatarUrl:null}});}
  await until(()=>states.get(host)?.spectators.length===n,'all spectators');
  for(const hz of [2,10]){
   const latencies=[],seen=new Map(),listeners=[],start=Date.now();let bytes=0,packets=0;
   for(const s of clients){const listener=state=>{const message=state.messages.findLast(m=>m.text.startsWith('R7负载:'));if(!message)return;const key=s.id+':'+message.text;if(seen.has(key))return;const sent=Number(message.text.split(':')[1]);if(sent<start)return;seen.set(key,true);latencies.push(Date.now()-sent);};const count=state=>{bytes+=Buffer.byteLength(JSON.stringify(state));packets++;};s.on('room_state',listener);s.on('room_state',count);listeners.push([s,listener,count]);}
   const sampleStart=Date.now();let actions=0;
   for(let tick=0;tick<hz*12;tick++){const sender=clients[4+(tick%n)];sender.emit('send_chat_message',{roomId,text:`R7负载:${Date.now()}`,requestId:`load-${n}-${hz}-${tick}`});actions++;await sleep(1000/hz);}
   await sleep(500);const end=Date.now();for(const[s,a,b]of listeners){s.off('room_state',a);s.off('room_state',b);}
   const samples=(await fs.readFile(metrics,'utf8')).trim().split('\n').map(JSON.parse).filter(s=>s.at>=sampleStart&&s.at<=end);assert.ok(samples.length>1);const first=samples[0],last=samples.at(-1),cpu=(last.cpu.user-first.cpu.user+last.cpu.system-first.cpu.system)/1000;
   const result={spectators:n,players:4,hz,seconds:(end-sampleStart)/1000,actions,packets,receivedUniqueUpdates:latencies.length,latencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),p99:percentile(latencies,.99),max:Math.max(...latencies)},server:{cpuCorePercent:100*cpu/(last.at-first.at),maxRssMiB:Math.max(...samples.map(s=>s.memory.rss))/1048576,maxHeapMiB:Math.max(...samples.map(s=>s.memory.heapUsed))/1048576,eventLoopP99Ms:Math.max(...samples.map(s=>s.loopP99Ms))},payloadMiB:bytes/1048576,approxMiBPerSecond:bytes/1048576/((end-sampleStart)/1000),transport:'WebSocket; JSON payload bytes exclude framing',environment:{platform:process.platform,node:process.version}};
   assert.ok(latencies.length>=(n+4)*actions*.95,'broadcast delivery');assert.ok(clients.every(s=>s.connected),'no disconnected clients');reports.push(result);console.log(JSON.stringify(result));
  }
 }
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,reports,scope:'isolated synthetic lobby broadcasts; not an internet capacity guarantee; no spectator/product limits changed'},null,2));
}finally{for(const socket of clients)socket.disconnect();if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}else server.kill();await fs.rm(dir,{recursive:true,force:true});}
