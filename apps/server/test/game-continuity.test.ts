import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';
const store=await createRoomStore('',true);
let recorded=0;
const users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{recorded++;}} as unknown as UserStore;
const game=new GameService(store,users,{enableAnimeDraft:true},store);
const {room,player:host}=await game.createRoom('连续性房主');const players=[host];
for(const name of ['红队员','蓝队长','蓝队员'])players.push((await game.joinRoom(room.id,name)).player);
for(let i=0;i<4;i++){await game.setTeam(room.id,players[i].id,i<2?'red':'blue');if(i%2===0)await game.setRole(room.id,players[i].id,'spymaster');}
const current=async()=>(await game.getRoom(room.id))!;
const act=async(i:number,kind:string,extra={})=>game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,kind,...extra} as any);
await act(0,'configure',{variant:'anime',boardMode:'6x6'});await act(0,'prepare');await act(0,'ready');await act(2,'ready');await act(0,'done');await act(2,'done');
const sealed=JSON.stringify((await current()).nextPlan?.sealedBoard);
await game.markDisconnected(room.id,players[2].id,'player');
await assert.rejects(game.startGame(room.id,host.id),/在线|离线/);
await game.reconnectRoom(room.id,players[2].sessionToken!);
await game.startGame(room.id,host.id);await game.markDisconnected(room.id,players[2].id,'player');
let waiting=await current();waiting.countdown!.startsAt=Date.now()-1;await store.setRoom(waiting);await game.tickTimers();
assert.equal((await current()).phase,'lobby');assert.equal((await current()).countdown,undefined);assert.equal(JSON.stringify((await current()).nextPlan?.sealedBoard),sealed);
await game.reconnectRoom(room.id,players[2].sessionToken!);await game.startGame(room.id,host.id);waiting=await current();waiting.countdown!.startsAt=Date.now()-1;await store.setRoom(waiting);await game.tickTimers();
await game.markDisconnected(room.id,players[2].id,'player');
await assert.rejects(act(1,'transfer',{team:'blue',targetId:players[3].id}),/权限/);
await act(0,'transfer',{team:'blue',targetId:players[3].id});
assert.equal((await current()).players.find(p=>p.id===players[3].id)?.role,'spymaster');
assert.ok((await current()).exposedPlayerIds?.includes(players[2].id));
for(const team of ['red','blue'] as const){const live=await current();live.currentTeam=team;await store.setRoom(live);const before={...live.scores};const end=await game.forceEndGame(room.id,host.id);assert.equal(end.winner,null);assert.equal(end.endReason,'aborted');assert.deepEqual(end.scores,before);assert.equal(recorded,0);if(team==='red'){await game.restartGame(room.id,host.id);await act(0,'cancel');await act(0,'configure',{variant:'classic',boardMode:'5x5'});await act(0,'prepare');await game.reconnectRoom(room.id,players[2].sessionToken!);await game.startGame(room.id,host.id);const w=await current();w.countdown!.startsAt=Date.now()-1;await store.setRoom(w);await game.tickTimers();}}
await game.returnToLobby(room.id,host.id);await act(0,'configure',{variant:'classic',boardMode:'5x5',scoringMode:'scoring'});await act(0,'prepare');
const start=async()=>{await game.startGame(room.id,host.id);const r=await current();r.countdown!.startsAt=Date.now()-1;await store.setRoom(r);await game.tickTimers();};
await start();let live=await current();const scoreBefore={...live.scores},team=live.currentTeam,ci=team==='red'?0:2,oi=team==='red'?1:3;
await game.submitClue(room.id,players[ci].id,'积分检查',2);await game.guessCard(room.id,players[oi].id,(await current()).board.find(c=>c.role===team)!.id);assert.notDeepEqual((await current()).scores,scoreBefore);
await assert.rejects(game.forceEndGame(room.id,players[1].id,'abort'),/房主/);await game.forceEndGame(room.id,host.id,'abort');assert.deepEqual((await current()).scores,scoreBefore);assert.equal(recorded,0);
for(const turn of ['red','blue'] as const){await game.restartGame(room.id,host.id);const w=await current();w.countdown!.startsAt=Date.now()-1;await store.setRoom(w);await game.tickTimers();live=await current();live.currentTeam=turn;await store.setRoom(live);const finished=await game.forceEndGame(room.id,host.id,'surrender');assert.equal(finished.winner,'blue');assert.equal(finished.endReason,'forfeit');assert.deepEqual(finished.scores,scoreBefore);assert.equal(recorded,0);}
await game.disbandRoom(room.id,host.id);
console.log('continuity: sealed captain online guard, countdown boundary, controlled handover and no-score host abort in either turn passed');
