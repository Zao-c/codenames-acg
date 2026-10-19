import assert from 'node:assert/strict';
import {GameService} from '../src/game.js';
import {createRoomStore} from '../src/store.js';
import {animeCatalog} from '../src/anime-catalog.js';
import {validateDraftRules} from '../src/staged-draft.js';
import {draftQuota,type PlanAction,type Team} from '@acg-codenames/shared';
import type {UserStore} from '../src/types.js';

const actualNow=Date.now;let clock=actualNow(),sequence=0;Date.now=()=>clock;
const users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
const store=await createRoomStore('',true),game=new GameService(store,users,{enableDebugTools:false,enableAnimeDraft:true},store);
const pool=[...new Map(animeCatalog().map(w=>[w.seriesId,w])).values()].slice(0,320);
assert.ok(pool.length>180);
try{
 const made=await game.createRoom('时长房主',undefined,'session-0','principal-0'),id=made.room.id,players=[made.player];
 for(let i=1;i<8;i++)players.push((await game.joinRoom(id,'队员'+i,undefined,'session-'+i,'principal-'+i)).player);
 for(let i=0;i<8;i++){await game.setTeam(id,players[i].id,i<4?'red':'blue');if(i===0||i===4)await game.setRole(id,players[i].id,'spymaster');}
 const current=async()=>(await game.getRoom(id))!;
 const envelope=async(action:Omit<PlanAction,'roomId'>):Promise<PlanAction>=>{const p=(await current()).nextPlan;return {roomId:id,version:p?.version,planId:p?.id,stageVersion:p?.stageVersion??0,draftProtocol:2,requestId:'staged-test-'+(++sequence),...action};};
 const act=async(i:number,action:Omit<PlanAction,'roomId'>)=>game.planAction(id,players[i].id,await envelope(action));
 const configure=async(size:'5x5'|'6x6',seconds:180|240|300,interference:30|60|null)=>{
  if((await current()).nextPlan?.stage!=='planning')await act(0,{kind:'cancel'});
  await act(0,{kind:'configure',variant:'anime',boardMode:size,poolIds:pool.map(w=>w.id),animeSeriesRotation:false,animeRandomSwap:false,animeDraft:{version:2,selectionSeconds:seconds,interferenceSeconds:interference}});
  assert.equal((await current()).nextPlan!.settings.animeRandomSwap,true);
  await act(0,{kind:'prepare'});await act(0,{kind:'ready'});await act(4,{kind:'ready'});
  assert.equal((await current()).nextPlan!.endsAt,clock+seconds*1000);
 };
 for(const value of [{version:2,selectionSeconds:0,interferenceSeconds:30},{version:2,selectionSeconds:180,interferenceSeconds:45},{version:1,selectionSeconds:180,interferenceSeconds:30}])assert.throws(()=>validateDraftRules(value));
 await act(0,{kind:'configure',variant:'anime',boardMode:'5x5',animeDraft:{version:2,selectionSeconds:180,interferenceSeconds:30}});
 assert.equal((await current()).nextPlan!.pool.length,0,'a new v2 room never silently chooses the whole catalog');
 assert.equal((await current()).nextPlan!.candidates.length,0);
 await assert.rejects(act(0,{kind:'prepare'}),/当前可用 0/);
 await assert.rejects(act(0,{kind:'configure',variant:'anime',animePoolId:'does-not-exist'}),/预设作品池已失效/);
 await assert.rejects(act(0,{kind:'configure',variant:'anime',animePoolId:'all',poolIds:[pool[0].id]}),/引用无效/);
 await act(0,{kind:'configure',variant:'anime',animePoolId:'all'});
 assert.ok((await current()).nextPlan!.pool.length>0,'whole catalog is still available when explicitly selected by trusted preset ID');
 await configure('6x6',300,30);
 let p=(await current()).nextPlan!,start=clock;
 await assert.rejects(act(1,{kind:'take',workId:p.candidates[0].id}),/队长/);
 const oldClient=await envelope({kind:'take',workId:p.candidates[0].id});delete oldClient.draftProtocol;
 await assert.rejects(game.planAction(id,players[0].id,oldClient),/刷新/);
 for(const [i,offset] of [[0,0],[4,2]])for(let k=0;k<2;k++)await act(i,{kind:'take',workId:p.candidates[offset+k].id});
 await assert.rejects(act(0,{kind:'interfere',workId:p.candidates[8].id}),/独立干扰/);
 await act(0,{kind:'done'});assert.equal((await current()).nextPlan!.stage,'draft','one captain alone never skips the selection timer');await act(0,{kind:'unready'});
 clock=start+10000;await act(0,{kind:'take',workId:p.candidates[2].id});
 clock=p.endsAt!-20000;
 await assert.rejects(act(0,{kind:'take',workId:p.candidates[3].id}),/最后 20/);
 await act(0,{kind:'release',workId:p.candidates[0].id});await act(0,{kind:'take',workId:p.candidates[7].id});
 const stale=await envelope({kind:'take',workId:p.candidates[8].id});
 clock=p.endsAt!-1;await game.tickTimers();assert.equal((await current()).nextPlan!.stage,'draft');
 clock++;await game.tickTimers();p=(await current()).nextPlan!;assert.equal(p.stage,'interference');assert.equal(p.endsAt,clock+30000);
 await assert.rejects(game.planAction(id,players[0].id,stale),/阶段已更新/);
 await assert.rejects(act(0,{kind:'release',workId:p.candidates[7].id}),/普通选牌已结束/);
 await assert.rejects(game.getInterferencePool(id,'principal-1',p.id,p.stageVersion!, '',1),/队长/);
 await assert.rejects(game.getInterferencePool(id,'principal-0',p.id,p.stageVersion!-1,'',1),/阶段已更新/);
 const page=await game.getInterferencePool(id,'principal-0',p.id,p.stageVersion!,'',1);assert.equal(page.works.length,60);assert.ok(page.total>180);
 const outside=pool.find(w=>!p.candidates.some(c=>c.id===w.id))!;assert.ok(outside);
 await act(0,{kind:'interfere',workId:outside.id});await assert.rejects(act(4,{kind:'interfere',workId:outside.id}),/重复|选中/);
 p=(await current()).nextPlan!;
 const operative=game.getPublicRoomState(await current(),players[1].id,'player');
 assert.equal(operative.nextPlan!.captainView,undefined);assert.ok(!operative.nextPlan!.publicSelectedWorkIds?.includes(outside.id));assert.ok(!operative.nextPlan!.candidates.some(w=>w.id===outside.id));
 assert.ok(game.getPublicRoomState(await current(),players[0].id,'player').nextPlan!.captainView!.interferenceWorks!.some(w=>w.id===outside.id));
 const timeout=p.endsAt!;clock=timeout-1;await game.tickTimers();assert.equal((await current()).nextPlan!.stage,'interference');
 clock++;await Promise.all([game.tickTimers(),game.tickTimers()]);p=(await current()).nextPlan!;
 assert.equal(p.stage,'sealed');assert.equal(Object.values(p.claims).filter(c=>c.kind==='interference').length,2);
 assert.equal(p.sealedBoard!.length,36);assert.equal(new Set(p.sealedBoard!.map(c=>c.anime!.seriesId)).size,36);
 for(const team of ['red','blue'] as const)assert.equal(p.sealedBoard!.filter(c=>c.role===team).length,draftQuota(36,p.startingTeam,team).total);
 for(const cardId of [p.randomSwap!.redCardId,p.randomSwap!.blueCardId]){const c=p.sealedBoard!.find(c=>c.id===cardId)!;assert.equal(p.claims[c.anime!.id].kind,'manual');}
 const sealed=JSON.stringify(p.sealedBoard),swap=JSON.stringify(p.randomSwap);clock+=100000;await game.tickTimers();assert.equal(JSON.stringify((await current()).nextPlan!.sealedBoard),sealed);assert.equal(JSON.stringify((await current()).nextPlan!.randomSwap),swap);

 // Every supported time choice; final confirmations are idempotent across sealing.
 for(const [n,seconds] of [180,240,300].entries()){
  await configure(n%2?'6x6':'5x5',seconds as 180|240|300,n===0?30:n===1?60:null);
  p=(await current()).nextPlan!;
  await act(0,{kind:'take',workId:p.candidates[0].id});await act(4,{kind:'take',workId:p.candidates[1].id});
  clock=p.endsAt!;await game.tickTimers();p=(await current()).nextPlan!;
  if(n===2){assert.equal(p.endsAt,undefined);clock+=3600000;await game.tickTimers();assert.equal((await current()).nextPlan!.stage,'interference');}
  for(const i of [0,4]){const pp=(await current()).nextPlan!,page=await game.getInterferencePool(id,'principal-'+i,pp.id,pp.stageVersion!,'',1);await act(i,{kind:'interfere',workId:page.works[0].id});}
  await act(0,{kind:'confirm-interference'});await act(0,{kind:'unready'});assert.equal((await current()).nextPlan!.done.red,false);
  await act(0,{kind:'confirm-interference'});
  const last=await envelope({kind:'confirm-interference'});await game.planAction(id,players[4].id,last);p=(await current()).nextPlan!;assert.equal(p.stage,'sealed');
  const once=JSON.stringify(p.sealedBoard);await game.planAction(id,players[4].id,last);assert.equal(JSON.stringify((await current()).nextPlan!.sealedBoard),once);
  await assert.rejects(game.planAction(id,players[4].id,{...last,kind:'take',workId:p.candidates[3].id}),/不同请求/);
 }
 // Timeout prepares both teams, but a zero-manual team must actually select before a swap can happen.
 await configure('5x5',180,30);p=(await current()).nextPlan!;clock=p.endsAt!;await game.tickTimers();clock=(await current()).nextPlan!.endsAt!;await game.tickTimers();
 p=(await current()).nextPlan!;assert.equal(p.stage,'interference');assert.equal(p.interferenceClosed,true);assert.ok(!p.randomSwap);
 await assert.rejects(act(0,{kind:'confirm-interference'}),/补选/);
 for(const i of [0,4]){p=(await current()).nextPlan!;const free=p.candidates.find(w=>!p.claims[w.id])!;await act(i,{kind:'take',workId:free.id});}
 p=(await current()).nextPlan!;assert.equal(p.stage,'sealed');assert.ok(p.randomSwap);assert.equal(p.sealedBoard!.length,25);
 await act(0,{kind:'cancel'});assert.equal((await current()).nextPlan!.stage,'planning');assert.equal((await current()).nextPlan!.requests?.length,1);
 // Both captains may finish at two minutes; a single ready captain can cancel,
 // and the other captain's own ordinary edits do not revoke that readiness.
 await configure('5x5',300,60);p=(await current()).nextPlan!;
 await assert.rejects(act(0,{kind:'done'}),/至少一张/);
 await act(0,{kind:'take',workId:p.candidates[0].id});await act(4,{kind:'take',workId:p.candidates[1].id});
 clock+=120000;await act(0,{kind:'done'});await act(4,{kind:'take',workId:p.candidates[2].id});
 assert.equal((await current()).nextPlan!.done.red,true);
 await act(0,{kind:'unready'});assert.equal((await current()).nextPlan!.done.red,false);
 await act(0,{kind:'done'});const early=await envelope({kind:'done'});
 await game.planAction(id,players[4].id,early);p=(await current()).nextPlan!;
 assert.equal(p.stage,'interference');assert.equal(p.endsAt,clock+60000);
 const phaseVersion=p.stageVersion;await game.planAction(id,players[4].id,early);assert.equal((await current()).nextPlan!.stageVersion,phaseVersion,'retry does not restart interference');
 // A replacement captain inherits the frozen selection, not the old captain's
 // authority or readiness. The opposite team's confirmation remains valid.
 await configure('5x5',180,null);p=(await current()).nextPlan!;
 await act(0,{kind:'take',workId:p.candidates[0].id});await act(4,{kind:'take',workId:p.candidates[1].id});
 clock=p.endsAt!;await game.tickTimers();
 for(const i of [0,4]){p=(await current()).nextPlan!;const options=await game.getInterferencePool(id,'principal-'+i,p.id,p.stageVersion!,'',1);await act(i,{kind:'interfere',workId:options.works[0].id});}
 await act(4,{kind:'confirm-interference'});
 await act(0,{kind:'transfer',team:'red',targetId:players[1].id});p=(await current()).nextPlan!;
 assert.equal(p.done.blue,true);assert.equal(p.done.red,false);
 await assert.rejects(act(0,{kind:'confirm-interference'}),/队长/);
 await assert.rejects(game.getInterferencePool(id,'principal-0',p.id,p.stageVersion!,'',1),/队长/);
 assert.equal(game.getPublicRoomState(await current(),players[0].id,'player').nextPlan!.captainView,undefined);
 assert.ok((await game.getInterferencePool(id,'principal-1',p.id,p.stageVersion!,'',1)).works.length);
 await act(1,{kind:'confirm-interference'});assert.equal((await current()).nextPlan!.stage,'sealed');
 console.log('Staged draft PASS: empty new rooms, trusted preset references, both captains early finish/cancel, eight players, 3/4/5 minute boundaries, last20 protection, full-pool ACL, timed/unlimited interference, zero-manual repair and atomic manual-only swaps');
}finally{Date.now=actualNow;}
