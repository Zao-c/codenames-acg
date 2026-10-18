import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';
import type { PlanAction } from '@acg-codenames/shared';

const store=await createRoomStore('',true);
const users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
const game=new GameService(store,users,{enableAnimeDraft:true,enableMatchAnalysis:true},store);
const principals=['a','b','c','d'].map(c=>c.repeat(64));
const {room,player:host}=await game.createRoom('恢复房主',undefined,undefined,principals[0]);
const players=[host];
for(let i=1;i<4;i++)players.push((await game.joinRoom(room.id,`恢复成员${i}`,undefined,undefined,principals[i])).player);
for(let i=0;i<4;i++){await game.setTeam(room.id,players[i].id,i<2?'red':'blue');if(i%2===0)await game.setRole(room.id,players[i].id,'spymaster');}
const current=async()=>(await game.getRoom(room.id))!;
const act=async(i:number,a:Omit<PlanAction,'roomId'|'version'>)=>game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,...a});
await act(0,{kind:'configure',variant:'anime',boardMode:'6x6'});
// A cleanup timer scheduled in planning must not delete a player once drafting has locked.
const realTimeout=global.setTimeout;const delayed:Array<()=>Promise<void>>=[];
global.setTimeout=((callback:()=>Promise<void>)=>{delayed.push(callback);return {unref(){}};}) as unknown as typeof setTimeout;
try{await game.markDisconnected(room.id,players[1].id,'player');}finally{global.setTimeout=realTimeout;}
await act(0,{kind:'prepare'});await act(0,{kind:'ready'});await act(2,{kind:'ready'});
const work=(await current()).nextPlan!.candidates[0].id;
await act(0,{kind:'take',workId:work});const claims=JSON.stringify((await current()).nextPlan!.claims);
for(const callback of delayed)await callback();
assert.equal((await current()).players.length,4);
await assert.rejects(game.reconnectRoom(room.id,players[1].sessionToken!,principals[3]),/身份/);
await game.reconnectRoom(room.id,players[1].sessionToken!,principals[1]);
assert.equal((await current()).players.find(p=>p.id===players[1].id)!.team,'red');
assert.equal(JSON.stringify((await current()).nextPlan!.claims),claims);
await game.markDisconnected(room.id,players[1].id,'player');
await assert.rejects(game.reconnectRoom(room.id,'expired',principals[1]),/凭证/);
const recovered=await game.joinRoom(room.id,players[1].nickname,undefined,undefined,principals[1]);
assert.equal(recovered.player.id,players[1].id);
assert.equal(recovered.player.role,'operative');
await assert.rejects(game.joinRoom(room.id,'陌生人',undefined,undefined,'e'.repeat(64)),/锁定/);
assert.equal(JSON.stringify((await current()).nextPlan!.claims),claims);
// Explicit withdrawal safely abandons preparation; fresh players still cannot inherit old secrets.
await game.leaveRoom(room.id,players[1].id,'player');
const reset=await current();assert.equal(reset.players.length,3);assert.equal(reset.nextPlan!.stage,'planning');
assert.equal(reset.nextPlan!.lockedPlayerIds,undefined);assert.deepEqual(reset.nextPlan!.claims,{});
await assert.rejects(game.reconnectRoom(room.id,players[1].sessionToken!,principals[1]),/玩家不存在/);
await game.joinRoom(room.id,'新队员',undefined,undefined,'f'.repeat(64));
await game.randomizeTeams(room.id,host.id,'all');
assert.equal((await current()).players.length,4);
await game.disbandRoom(room.id,host.id);
console.log('recovery: delayed cleanup respects draft locks; owned guest restores same seat and claims; wrong identity rejected; explicit withdrawal safely resets preparation');
