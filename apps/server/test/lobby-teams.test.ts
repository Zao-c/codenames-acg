import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';
import { buildRoomSummary, type PlanAction, type Room } from '@acg-codenames/shared';

const store = await createRoomStore('',true);
const users = {resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
const game = new GameService(store,users,{enableAnimeDraft:true},store);
for(const count of [4,5,8]) {
  const {room,player:host}=await game.createRoom(`分队${count}`);
  for(let i=1;i<count;i++)await game.joinRoom(room.id,`成员${i}`);
  const current=async()=>(await game.getRoom(room.id))!;
  const act=async(id:string,action:Omit<PlanAction,'roomId'|'version'>)=>game.planAction(room.id,id,{roomId:room.id,version:(await current()).nextPlan?.version,...action});
  const check=(r:Room)=>{
    assert.equal(r.players.length,count);
    assert.equal(new Set(r.players.map(p=>p.id)).size,count);
    assert.ok(Math.abs(r.players.filter(p=>p.team==='red').length-r.players.filter(p=>p.team==='blue').length)<=1);
    for(const t of ['red','blue'] as const){const captains=r.players.filter(p=>p.team===t&&p.role==='spymaster');assert.equal(captains.length,1);if(r.nextPlan)assert.equal(r.nextPlan.captains[t],captains[0].id);}
  };
  await assert.rejects(game.randomizeTeams(room.id,host.id,'keep-captains'),/队长/);
  await game.randomizeTeams(room.id,host.id); // Legacy payload stays compatible.
  await act(host.id,{kind:'configure',variant:'anime',boardMode:'6x6',scoringMode:'gamble'});
  assert.equal(buildRoomSummary(await current()).variant,'anime');
  assert.equal(buildRoomSummary(await current()).boardMode,'6x6');
  for(let i=0;i<20;i++){
    check(await game.randomizeTeams(room.id,host.id,'all'));
    const locked={...(await current()).nextPlan!.captains};
    for(let j=0;j<3;j++){const r=await game.randomizeTeams(room.id,host.id,'keep-captains');check(r);assert.deepEqual(r.nextPlan!.captains,locked);}
  }
  const before=JSON.stringify(await current());
  const other=(await current()).players.find(p=>p.id!==host.id)!;
  await assert.rejects(game.randomizeTeams(room.id,other.id),/房主/);
  await assert.rejects(game.randomizeTeams(room.id,host.id,'invalid' as 'all'),/无效/);
  assert.equal(JSON.stringify(await current()),before);
  const target=(await current()).players.find(p=>p.team==='red'&&p.role==='operative')!;
  await act(host.id,{kind:'nominate',team:'red',targetId:target.id});check(await current());
  await act(host.id,{kind:'prepare'});
  await act(target.id,{kind:'ready'});
  assert.equal((await current()).nextPlan!.stage,'guide');
  assert.equal((await current()).nextPlan!.endsAt,undefined);
  await game.randomizeTeams(room.id,host.id,'keep-captains');
  assert.deepEqual((await current()).nextPlan!.ready,{red:false,blue:false});
  await game.setRole(room.id,target.id,'operative');
  assert.equal((await current()).nextPlan!.captains.red,undefined);
  await game.setRole(room.id,target.id,'spymaster');check(await current());
  const caps=(await current()).nextPlan!.captains;
  await act(caps.red!,{kind:'ready'});await act(caps.blue!,{kind:'ready'});
  assert.equal((await current()).nextPlan!.stage,'draft');
  assert.ok((await current()).nextPlan!.endsAt!>=Date.now()+179_000);
  for(const mode of ['all','keep-captains'] as const)await assert.rejects(game.randomizeTeams(room.id,host.id,mode),/准备阶段/);
  await assert.rejects(game.setTeam(room.id,target.id,'blue'),/准备阶段/);
  await act(caps.red!,{kind:'done'});await act(caps.blue!,{kind:'done'});
  assert.equal((await current()).nextPlan!.stage,'sealed');
  await assert.rejects(game.randomizeTeams(room.id,host.id),/准备阶段/);
  await game.startGame(room.id,host.id);
  await assert.rejects(game.randomizeTeams(room.id,host.id),/准备阶段/);
  assert.equal((await current()).nextPlan!.settings.scoringMode,'gamble');
  await game.disbandRoom(room.id,host.id);
}
// Classic nomination/configuration must also work when anime drafting is disabled.
{
  const classic = new GameService(store,users,{enableAnimeDraft:false},store);
  const {room,player:host}=await classic.createRoom('经典房主');
  for(let i=1;i<4;i++)await classic.joinRoom(room.id,`经典成员${i}`);
  await classic.randomizeTeams(room.id,host.id);
  const roster=(await classic.getRoom(room.id))!;
  const target=roster.players.find(p=>p.team==='red'&&p.role==='operative')!;
  await classic.planAction(room.id,host.id,{roomId:room.id,kind:'nominate',team:'red',targetId:target.id});
  await classic.planAction(room.id,host.id,{roomId:room.id,kind:'configure',variant:'classic',timerMode:'timed',timerClueSeconds:60,timerGuessSeconds:120,flipMode:'color-only'});
  const configured=JSON.stringify(await classic.getRoom(room.id));
  await assert.rejects(classic.planAction(room.id,host.id,{roomId:room.id,kind:'configure',variant:'classic',timerClueSeconds:0}),/计时/);
  assert.equal(JSON.stringify(await classic.getRoom(room.id)),configured);
  assert.equal((await classic.getRoom(room.id))!.nextPlan!.settings.timerGuessSeconds,120);
  await classic.startGame(room.id,host.id);
  await classic.disbandRoom(room.id,host.id);
}
console.log('lobby teams: 4/5/8 players, 240 repeated shuffles, fixed captains, synchronized anime roles, permission and phase locks passed');
