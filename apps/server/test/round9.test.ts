import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';

const store=await createRoomStore('',true);
const users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
const game=new GameService(store,users,{enableDebugTools:false,enableAnimeDraft:true,enableMatchAnalysis:true},store);
const {room,player:host}=await game.createRoom('管理房主',undefined,undefined,'owner');
const players=[host];for(let i=1;i<8;i++)players.push((await game.joinRoom(room.id,'管理成员'+i,undefined,undefined,'member'+i)).player);
const {spectator}=await game.joinSpectator(room.id,'长昵称旁观者',undefined,undefined,'spectator');
const current=async()=>(await game.getRoom(room.id))!;
const original=JSON.stringify(await current());
await assert.rejects(game.manageMember(room.id,players[1].id,host.id,{kind:'remove'}),/房主/);
await assert.rejects(game.manageMember(room.id,host.id,'other-room-member',{kind:'remove'}),/不在本房间/);
await assert.rejects(game.manageMember(room.id,host.id,host.id,{kind:'remove'}),/退出/);
await assert.rejects(game.manageMember(room.id,host.id,spectator.id,{kind:'team',team:'red'}),/旁观者/);
await assert.rejects(game.manageMember(room.id,host.id,players[1].id,{kind:'team',team:undefined}),/队伍无效/);
assert.equal(JSON.stringify(await current()),original);
for(let i=0;i<8;i++)await game.manageMember(room.id,host.id,players[i].id,{kind:'team',team:i<4?'red':'blue'});
await game.manageMember(room.id,host.id,players[0].id,{kind:'role',role:'spymaster'});
await game.manageMember(room.id,host.id,players[1].id,{kind:'role',role:'spymaster'});
await game.manageMember(room.id,host.id,players[4].id,{kind:'role',role:'spymaster'});
assert.equal((await current()).players.filter(p=>p.team==='red'&&p.role==='spymaster').length,1);
assert.equal((await current()).players[0].role,'operative');
await game.planAction(room.id,host.id,{roomId:room.id,kind:'configure',variant:'anime',boardMode:'6x6'});
const plan=(await current()).nextPlan!;
await game.planAction(room.id,host.id,{roomId:room.id,kind:'prepare',version:plan.version});
for(const stage of ['guide','draft','sealed'] as const){
  const snapshot=structuredClone(await current());snapshot.nextPlan!.stage=stage;await store.setRoom(snapshot);
  for(const action of [{kind:'team',team:'blue'},{kind:'role',role:'spymaster'},{kind:'remove'}] as const)await assert.rejects(game.manageMember(room.id,host.id,players[1].id,action),/未锁定大厅/);
}
const reset=structuredClone(await current());reset.nextPlan!.stage='planning';reset.countdown={endsAt:Date.now()+5000} as typeof reset.countdown;await store.setRoom(reset);
await assert.rejects(game.manageMember(room.id,host.id,players[1].id,{kind:'remove'}),/未锁定大厅/);
reset.countdown=undefined;reset.phase='playing';await store.setRoom(reset);
await assert.rejects(game.manageMember(room.id,host.id,players[1].id,{kind:'remove'}),/未锁定大厅/);
reset.phase='lobby';await store.setRoom(reset);

// Ten short disconnects: immediate presence, one record with precise diagnostics, same token.
for(let n=0;n<10;n++){
  await game.markDisconnected(room.id,players[2].id,'player');assert.equal((await current()).players.find(p=>p.id===players[2].id)!.connected,false);
  await game.markDisconnected(room.id,players[2].id,'player');
  await game.reconnectRoom(room.id,players[2].sessionToken!,'member2');assert.equal((await current()).players.find(p=>p.id===players[2].id)!.connected,true);
  await game.reconnectRoom(room.id,players[2].sessionToken!,'member2');
}
const diagnostics=(await current()).messages.filter(m=>m.connection?.participantId===players[2].id);
assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].connection!.disconnects,10);assert.equal(diagnostics[0].connection!.reconnects,10);
const otherRoom=await game.createRoom('同设备另一房',undefined,undefined,'member2');
await game.markDisconnected(room.id,players[2].id,'player');
await game.manageMember(room.id,host.id,players[2].id,{kind:'remove'});
await assert.rejects(game.reconnectRoom(room.id,players[2].sessionToken!,'member2'));
await game.reconnectRoom(otherRoom.room.id,otherRoom.player.sessionToken!,'member2');
await game.manageMember(room.id,host.id,spectator.id,{kind:'remove'});
await assert.rejects(game.reconnectRoom(room.id,spectator.sessionToken!,'spectator'));
assert.equal((await current()).spectators.length,0);
assert.equal((await current()).participantPrincipals?.[players[2].id],undefined);
const publicView=game.getPublicRoomState(await current(),players[3].id,'player');
assert.equal(publicView.nextPlan?.captainView,undefined);
await game.disbandRoom(room.id,host.id);await game.disbandRoom(otherRoom.room.id,otherRoom.player.id);
console.log('Round9 PASS: 8 players, host/target/phase validation, captain replacement, offline + spectator removal, old-token rejection, unrelated-room recovery, 10 flaps / 1 diagnostic entry, public privacy');
