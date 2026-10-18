import assert from 'node:assert/strict';
import { MatchEventLedger, type AnimeWork, type GameReplay, type NextPlan, type PlanAction } from '@acg-codenames/shared';
import { MatchNotifications } from '../../web/src/lib/match-notifications';
import { cumulativeReplayBoard } from '../../web/src/lib/replay-board';
import { candidatesFor, sealDraft, makePlan } from '../src/anime-draft.js';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import { animeCatalog } from '../src/anime-catalog.js';
import { fetchReplayCover } from '../src/replay-cover.js';
import type { UserStore } from '../src/types.js';

const ledger=new MatchEventLedger();
assert.ok(ledger.claim('room','game1','highlight:1'));assert.ok(!ledger.claim('room','game1','highlight:1'));
assert.ok(ledger.claim('room','game1','achievement:1'));assert.ok(ledger.claim('room','game2','highlight:1'));
const notifications=new MatchNotifications(),scope={roomId:'r',matchId:'m',roundNumber:2,latestTurn:3};
const notification={id:'a',roomId:'r',matchId:'m',roundNumber:2,roundIndex:3};
assert.deepEqual(notifications.receive('highlight',notification,scope),{toast:true});
assert.equal(notifications.receive('highlight',notification,scope),null);
assert.deepEqual(notifications.receive('highlight',{...notification,id:'late',roundIndex:2},scope),{toast:false});
for(const wrong of [{roomId:'other'},{matchId:'old'},{roundNumber:1}])assert.equal(notifications.receive('highlight',{...notification,id:'bad',...wrong},scope),null);

const replay={finalBoard:[{id:'a',word:'一',role:'red',revealed:true},{id:'b',word:'二',role:'blue',revealed:true},{id:'c',word:'三',role:'assassin',revealed:false}],rounds:[
  {index:1,team:'red',guesses:[{cardId:'a',word:'一',role:'red',guessedByNickname:'甲'}]},
  {index:2,team:'blue',guesses:[]},
  {index:3,team:'blue',guesses:[{word:'二',role:'blue',guessedByNickname:'乙'}]},
]} as unknown as GameReplay;
assert.equal(cumulativeReplayBoard(replay,0).filter(c=>c.revealed).length,0);
assert.equal(cumulativeReplayBoard(replay,1).filter(c=>c.revealed).length,1);
assert.equal(cumulativeReplayBoard(replay,2).filter(c=>c.revealed).length,1);
assert.equal(cumulativeReplayBoard(replay,3).filter(c=>c.revealed).length,2);
assert.equal(cumulativeReplayBoard(replay,3,0).filter(c=>c.revealed).length,1);
assert.equal(cumulativeReplayBoard(replay,3,1).filter(c=>c.revealed).length,2);
assert.equal(cumulativeReplayBoard(replay,2)[1].role,undefined);
assert.equal(cumulativeReplayBoard(replay,null)[2].role,'assassin');

const pool=candidatesFor(animeCatalog()).slice(0,171);assert.equal(pool.length,171);
const history=Object.fromEntries(pool.slice(0,50).map(w=>[w.seriesId,1]));
assert.equal(candidatesFor([...pool,{...pool[0],id:999999}],history,()=>.4,true).length,121);
assert.equal(candidatesFor(pool,history,()=>.4,false).length,171);
assert.ok(candidatesFor(pool,history,()=>.4,true).every(w=>history[w.seriesId]===undefined));
for(const size of ['5x5','6x6'] as const)for(const manual of [0,1,2,3])for(const enabled of [false,true]){
  const plan={stage:'draft',settings:{boardMode:size,animeRandomSwap:enabled},startingTeam:'red',candidates:pool,claims:{...(manual&1?{[pool[0].id]:{team:'red',kind:'manual'}}:{}),...(manual&2?{[pool[1].id]:{team:'blue',kind:'manual'}}:{}),[pool[2].id]:{team:'blue',kind:'interference',from:'red'}}} as unknown as NextPlan;
  sealDraft(plan,{},()=>.35);const board=plan.sealedBoard!;
  assert.equal(board.length,size==='5x5'?25:36);assert.equal(new Set(board.map(c=>c.anime!.seriesId)).size,board.length);
  assert.equal(board.filter(c=>c.role==='red').length,size==='5x5'?9:13);assert.equal(board.filter(c=>c.role==='blue').length,size==='5x5'?8:12);
  assert.equal(board.find(c=>c.anime!.id===pool[2].id)?.role,'blue');
  assert.equal(!!plan.randomSwap,enabled);
  if(enabled){const red=board.find(c=>c.id===plan.randomSwap!.redCardId)!,blue=board.find(c=>c.id===plan.randomSwap!.blueCardId)!;assert.equal(red.role,'blue');assert.equal(blue.role,'red');if(manual&1)assert.equal(red.anime!.id,pool[0].id);else assert.equal(plan.claims[red.anime!.id],undefined);if(manual&2)assert.equal(blue.anime!.id,pool[1].id);else assert.equal(plan.claims[blue.anime!.id],undefined);}
  const sealed=JSON.stringify(plan);sealDraft(plan,{},()=>.99);assert.equal(JSON.stringify(plan),sealed);
}
for(const url of ['http://lain.bgm.tv/a','https://127.0.0.1/a','https://lain.bgm.tv.evil/a','https://user@lain.bgm.tv/a','https://lain.bgm.tv:1234/a'])await assert.rejects(fetchReplayCover(url));
await assert.rejects(fetchReplayCover('https://lain.bgm.tv/a',async()=>new Response('svg',{headers:{'Content-Type':'image/svg+xml'}})));
await assert.rejects(fetchReplayCover('https://lain.bgm.tv/a',async()=>new Response(new Uint8Array(2*1024*1024+1),{headers:{'Content-Type':'image/png'}})));
const image=await fetchReplayCover('https://lain.bgm.tv/a',async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}}));assert.equal(image.data.length,3);

const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
const store=await createRoomStore('',true),users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
const game=new GameService(store,users,{enableAnimeDraft:true,enableMatchAnalysis:true},store);
try{
  const {room,player}=await game.createRoom('R8甲'),players=[player];for(const name of ['乙','丙','丁'])players.push((await game.joinRoom(room.id,name)).player);
  for(let i=0;i<4;i++){await game.setTeam(room.id,players[i].id,i<2?'red':'blue');if(i%2===0)await game.setRole(room.id,players[i].id,'spymaster');}
  const current=async()=>(await game.getRoom(room.id))!;
  const act=async(i:number,action:Omit<PlanAction,'roomId'|'version'>)=>game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,...action});
  const seen=new Set<string>();
  for(let round=0;round<3;round++){
    await act(0,{kind:'configure',variant:'anime',boardMode:round===1?'6x6':'5x5',poolIds:pool.map(w=>w.id),animeRandomSwap:round!==0});
    let plan=(await current()).nextPlan!;assert.equal(plan.settings.animeSeriesRotation,true);
    if(round===0){await act(0,{kind:'prepare'});await act(0,{kind:'cancel'});assert.equal(Object.keys((await current()).seriesHistory??{}).length,0);}
    await act(0,{kind:'prepare'});await act(0,{kind:'ready'});await act(2,{kind:'ready'});
    plan=(await current()).nextPlan!;
    await act(0,{kind:'take',workId:plan.candidates[0].id});await act(2,{kind:'take',workId:plan.candidates[1].id});
    await act(0,{kind:'interfere',workId:plan.candidates[2].id});await act(0,{kind:'done'});await act(2,{kind:'done'});
    const sealed=(await current()).nextPlan!,serialized=JSON.stringify(sealed.sealedBoard);
    await act(0,{kind:'done'}).catch(()=>{});assert.equal(JSON.stringify((await current()).nextPlan!.sealedBoard),serialized);
    const publicPlan=game.getPublicRoomState(await current(),players[1].id,'player').nextPlan!;assert.equal(publicPlan.captainView,undefined);assert.equal(publicPlan.poolPreview,undefined);assert.ok(!JSON.stringify(publicPlan).includes('redCardId'));
    await game.startGame(room.id,player.id);clock+=5000;await game.tickTimers();
    for(const c of (await current()).board){assert.ok(!seen.has(c.anime!.seriesId));seen.add(c.anime!.seriesId);}
    await game.forceEndGame(room.id,player.id);await game.ensureReplay(room.id);await game.returnToLobby(room.id,player.id);
  }
  assert.equal(seen.size,86);assert.equal((await current()).replayHistory?.length,3);
  assert.equal((await current()).nextPlan!.candidates.length,85);
  const smaller=pool.slice(0,25),exhausted={...(await current()),seriesHistory:Object.fromEntries(smaller.map(w=>[w.seriesId,1]))};await store.setRoom(exhausted);
  await assert.rejects(act(0,{kind:'configure',variant:'anime',poolIds:smaller.map(w=>w.id)}),/当前可用 0.*需要 25/);
  await assert.rejects(act(1,{kind:'reset-series-history'}),/仅房主/);
  await act(0,{kind:'reset-series-history'});assert.deepEqual((await current()).seriesHistory,{});
  await act(0,{kind:'configure',variant:'anime',poolIds:smaller.map(w=>w.id)});
  const old=await current();delete old.nextPlan!.settings.animeRandomSwap;delete old.nextPlan!.settings.animeSeriesRotation;await store.setRoom(old);
  await act(0,{kind:'configure',variant:'anime'});assert.equal((await current()).nextPlan!.settings.animeRandomSwap,false);assert.equal((await current()).nextPlan!.settings.animeSeriesRotation,false);
  await assert.rejects(act(0,{kind:'configure',variant:'anime',animeRandomSwap:'yes' as unknown as boolean}),/布尔/);
  await act(0,{kind:'configure',variant:'anime',animeRandomSwap:true,animeSeriesRotation:true});
  await act(0,{kind:'prepare'});await act(0,{kind:'ready'});await act(2,{kind:'ready'});clock+=180_000;await game.tickTimers();
  assert.equal((await current()).nextPlan!.stage,'sealed');assert.ok((await current()).nextPlan!.randomSwap);
  const timeoutBoard=JSON.stringify((await current()).nextPlan!.sealedBoard);await game.tickTimers();assert.equal(JSON.stringify((await current()).nextPlan!.sealedBoard),timeoutBoard);
  console.log('Round 8: event scopes/dedup, cumulative replay, cover security, swap 16 combinations/one seal, 3 consecutive 25→36→25 games/86 unique series, privacy/exhaustion/reset/cancel/old compatibility PASS');
}finally{Date.now=realNow;}
