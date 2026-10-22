import {io} from 'socket.io-client';
import {applyRoomDelta} from '@acg-codenames/shared';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.CHAT_BASE??'http://127.0.0.1:5394',clients=[],states=[],times=[];
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Isolated loopback test endpoint required');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await sleep(50);}throw new Error('state timeout');}
async function emit(i,event,payload){const start=performance.now();const r=await clients[i].timeout(15000).emitWithAck(event,payload);assert.ok(r.ok,r.message);times.push(performance.now()-start);return r;}
try{
 for(let i=0;i<28;i++){
  const s=io(base,{transports:['websocket'],autoConnect:false,forceNew:true});clients.push(s);
  s.on('room_state',v=>states[i]=v);s.on('room_state_delta',d=>states[i]=applyRoomDelta(states[i]??null,d));
  await new Promise((r,j)=>{s.once('connect',r);s.once('connect_error',j);s.connect();});s.emit('enable_room_deltas');
  const session=new Promise(r=>s.once('session',r));s.emit(i===0?'create_room':i<8?'join_room':'join_spectator',{...(i?{roomId:states[0].id}:{}),nickname:'Burst'+i,identityKey:crypto.randomBytes(32).toString('hex')});await session;await until(()=>states[i]);
  if(i<8){s.emit('set_team',{roomId:states[0].id,team:i<4?'red':'blue'});await until(()=>states[i].viewer.team===(i<4?'red':'blue'));if(i===0||i===4){s.emit('set_role',{roomId:states[0].id,role:'spymaster'});await until(()=>states[i].viewer.role==='spymaster');}}
 }
 const roomId=states[0].id;
 const act=async(i,kind,extra={})=>{await emit(i,'plan_action',{roomId,version:states[i].nextPlan?.version,kind,...extra});await sleep(60);};
 await act(0,'configure',{variant:'anime',boardMode:'6x6',animeSeriesRotation:false});await act(0,'prepare');await act(0,'ready');await act(4,'ready');await act(0,'done');await act(4,'done');
 clients[0].emit('start_game',{roomId});await until(()=>states[0].phase==='playing');times.length=0;
 for(let wave=0;wave<5;wave++){
  await Promise.all(Array.from({length:17},(_,n)=>emit(n+8,'send_chat_message',{roomId,text:'Diagnostic '+wave+' '+n,requestId:'burst-'+wave+'-'+n})));
  console.log(JSON.stringify({wave,maxMs:Math.max(...times),messages:states[0].messages.length}));
 }
 await sleep(5200);await Promise.all(Array.from({length:17},(_,n)=>emit(n+8,'send_chat_message',{roomId,text:'Diagnostic final '+n,requestId:'burst-final-'+n})));
 const report={passed:true,roomId,players:8,spectators:20,acks:times.length,maxMs:Math.max(...times),p95Ms:[...times].sort((a,b)=>a-b)[Math.floor(times.length*.95)]};
 await fs.writeFile(process.env.CHAT_OUT??'output/playwright/staged-draft/chat-burst-linux.json',JSON.stringify(report,null,2));console.log(report);assert.ok(report.p95Ms<5000,'Burst ACK p95 must stay below five seconds');
 clients[0].emit('disband_room',{roomId});
}finally{for(const s of clients)s.disconnect();}
