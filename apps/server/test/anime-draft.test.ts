import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import { animeCatalog } from '../src/anime-catalog.js';
import { candidatesFor, editDraft, sealDraft } from '../src/anime-draft.js';
import type { UserStore } from '../src/types.js';
import type { NextPlan, PlanAction, Room, Team } from '@acg-codenames/shared';

const seriesOf = (title: string) => {
  const work = animeCatalog().find(w => w.fullTitle === title);
  assert.ok(work, `Catalog fixture missing: ${title}`);
  return work.seriesId;
};
assert.equal(seriesOf('轻音少女'), seriesOf('轻音少女 第二季'));
assert.equal(seriesOf('机动战士高达SEED'), seriesOf('机动战士高达SEED DESTINY'));
assert.equal(seriesOf("剧场版 Fate/stay night [Heaven's Feel] I.presage flower"), seriesOf("剧场版 Fate/stay night [Heaven's Feel] III.spring song"));
assert.notEqual(seriesOf('Fate/stay night'), seriesOf('Fate/EXTRA Last Encore'));

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const store = await createRoomStore('',true);
const users = { resolveProfile: async () => ({ accountType:'guest',username:null,avatarUrl:null }), recordRoundResult: async () => {} } as unknown as UserStore;
const game = new GameService(store,users,{enableDebugTools:false,enableAnimeDraft:true},store);
try {
  const {room,player:host} = await game.createRoom('A');
  const players = [host];
  for (const name of ['B','C','D']) players.push((await game.joinRoom(room.id,name)).player);
  for (let i=0;i<4;i++) { await game.setTeam(room.id,players[i].id,i<2?'red':'blue'); if (i%2===0) await game.setRole(room.id,players[i].id,'spymaster'); }
  const current = async () => (await game.getRoom(room.id))!;
  const act = async (index:number, action:Omit<PlanAction,'roomId'|'version'>) => game.planAction(room.id,players[index].id,{roomId:room.id,version:(await current()).nextPlan?.version,...action});
  const start = async () => {
    const first = await game.startGame(room.id,host.id);
    const second = await game.startGame(room.id,host.id);
    assert.equal(first.countdown?.startsAt,second.countdown?.startsAt);
    clock += 4999; await game.tickTimers(); assert.equal((await current()).phase,'lobby');
    clock += 1; await game.tickTimers(); assert.equal((await current()).phase,'playing');
    const board = JSON.stringify((await current()).board); await game.tickTimers(); assert.equal(JSON.stringify((await current()).board),board);
  };
  await start();
  const firstBoard = JSON.stringify((await current()).board);
  const pool = candidatesFor(animeCatalog()).slice(0,65);
  assert.equal(pool.length,65);
  await act(0,{kind:'configure',variant:'anime',boardMode:'6x6',poolIds:pool.map(w=>w.id),poolName:'小池'});
  await act(0,{kind:'nominate',team:'red',targetId:players[1].id});
  assert.equal(JSON.stringify((await current()).board),firstBoard);
  assert.equal((await current()).players[1].role,'operative');
  let next = (await current()).nextPlan!;
  await act(1,{kind:'bookmark',workId:next.candidates[0].id});
  const futureSpyView = game.getPublicRoomState(await current(),players[1].id,'player');
  assert.ok(futureSpyView.board.every(c=>!c.role));
  assert.equal(futureSpyView.nextPlan?.myBookmarks?.length,1);
  assert.equal(game.getPublicRoomState(await current(),players[3].id,'player').nextPlan?.myBookmarks,undefined);
  await assert.rejects(act(1,{kind:'ready'}));
  await game.forceEndGame(room.id,host.id); await game.ensureReplay(room.id);
  const firstReplay = (await current()).replayId!;
  await act(0,{kind:'prepare'});
  await act(1,{kind:'ready'}); await act(2,{kind:'ready'});
  next = (await current()).nextPlan!;
  const beginning = clock;
  assert.equal(next.stage,'draft'); assert.equal(next.endsAt,clock+180000);
  await assert.rejects(game.joinRoom(room.id,'late'));
  const {spectator} = await game.joinSpectator(room.id,'watch');
  const beforePublic = game.getPublicRoomState(await current(),spectator.id,'spectator').nextPlan;
  const contested = next.candidates[0].id;
  const results = await Promise.allSettled([act(1,{kind:'take',workId:contested}),act(2,{kind:'take',workId:contested})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.deepEqual(game.getPublicRoomState(await current(),spectator.id,'spectator').nextPlan,beforePublic);
  assert.equal(game.getPublicRoomState(await current(),spectator.id,'spectator').nextPlan?.captainView,undefined);
  clock+=9999; await assert.rejects(act(2,{kind:'take',workId:contested}),/保护/);
  clock+=1; await act(2,{kind:'take',workId:contested});
  const w = next.candidates[1].id;
  await act(1,{kind:'take',workId:w});
  const protection = (await current()).nextPlan!.claims[w].protectedUntil;
  await act(1,{kind:'release',workId:w}); clock+=1000; await act(1,{kind:'take',workId:w});
  assert.equal((await current()).nextPlan!.claims[w].protectedUntil,protection);
  const saved = JSON.stringify((await current()).nextPlan!.claims);
  await assert.rejects(act(1,{kind:'take',workId:contested,replaceId:w}));
  assert.equal(JSON.stringify((await current()).nextPlan!.claims),saved);
  await act(1,{kind:'interfere',workId:next.candidates[2].id});
  {
    const interfered = next.candidates[2].id;
    const victim = game.getPublicRoomState(await current(),players[2].id,'player').nextPlan!.captainView!;
    const source = game.getPublicRoomState(await current(),players[1].id,'player').nextPlan!.captainView!;
    assert.equal(victim.claims[interfered].kind,'interference');
    assert.equal(victim.claims[interfered].team,'blue');
    assert.equal(victim.claims[interfered].from,'red');
    assert.equal(Object.values(victim.claims).filter(c => c.team === 'blue' && c.kind === 'manual').length,
      Object.values((await current()).nextPlan!.claims).filter(c => c.team === 'blue' && c.kind === 'manual').length);
    assert.equal(game.getPublicRoomState(await current(), players[3].id, 'player').nextPlan!.captainView, undefined);
    assert.deepEqual(game.getPublicRoomState(await current(), spectator.id, 'spectator').nextPlan, beforePublic);
    assert.equal(source.claims[interfered].kind,'interference');
    assert.equal(source.claims[interfered].from,'red');
  }
  await assert.rejects(act(2,{kind:'release',workId:next.candidates[2].id}));
  await act(1,{kind:'done'});
  await act(2,{kind:'take',workId:next.candidates[3].id});
  assert.equal((await current()).nextPlan!.done.red,false);
  await act(0,{kind:'transfer',team:'red',targetId:players[0].id});
  assert.equal((await current()).nextPlan!.endsAt,beginning+180000);
  assert.deepEqual(game.getPublicRoomState(await current(),players[0].id,'player').nextPlan?.myBookmarks,[]);
  await assert.rejects(act(1,{kind:'take',workId:next.candidates[4].id}));
  clock=beginning+160000;
  await assert.rejects(act(0,{kind:'take',workId:contested}),/最后 20/);
  await assert.rejects(act(0,{kind:'interfere',workId:next.candidates[5].id}),/最后 20/);
  await act(0,{kind:'take',workId:next.candidates[5].id});
  await act(0,{kind:'release',workId:next.candidates[5].id});
  await act(0,{kind:'done'}); await act(2,{kind:'done'});
  const sealed = (await current()).nextPlan!;
  assert.equal(sealed.stage,'sealed'); assert.equal(sealed.sealedBoard?.length,36);
  assert.equal(new Set(sealed.sealedBoard!.map(c=>c.anime!.seriesId)).size,36);
  assert.ok(sealed.sealedBoard!.every(c=>pool.some(w=>w.id===c.anime!.id)));
  assert.equal(sealed.sealedBoard!.filter(c=>c.role==='neutral').length,10);
  assert.equal(sealed.sealedBoard!.filter(c=>c.role==='assassin').length,1);
  assert.equal(game.getPublicRoomState(await current(),host.id,'player').nextPlan?.captainView,undefined);
  assert.equal((await current()).board.length,0);
  await start();
  await assert.rejects(game.guessCard(room.id,players[1].id,(await current()).board[0].id),/卸任队长/);
  await game.forceEndGame(room.id,host.id); await game.ensureReplay(room.id);
  const secondReplay = (await current()).replayId!;
  assert.notEqual(firstReplay,secondReplay);
  assert.equal(game.getPublicRoomState(await current(),host.id,'player').interferenceReview,undefined);
  assert.ok(!(JSON.stringify(await game.getReplay(secondReplay))).includes('bookmarks'));
  assert.ok(await game.getReplay(firstReplay));
  await act(0,{kind:'configure',variant:'classic',boardMode:'5x5'});
  await game.restartGame(room.id,host.id); clock+=5000; await game.tickTimers();
  assert.equal((await current()).settings.variant,'classic'); assert.equal((await current()).board.length,25);
  assert.deepEqual((await current()).exposedPlayerIds,[]);
  // Finish the third game via a real final own-card guess, exercising normal end.
  const third = structuredClone(await current());
  third.currentTeam='blue'; third.clue={word:'线索',count:1,team:'blue',usedGuesses:0};
  const last = third.board.find(c=>c.role==='blue')!;
  third.board.forEach(c=>{if(c.role==='blue' && c.id!==last.id)c.revealed=true;}); third.remainingCounts.blue=1;
  await store.setRoom(third); await game.guessCard(room.id,players[3].id,last.id); await game.ensureReplay(room.id);
  assert.equal((await current()).endReason,'normal');
  assert.equal((await current()).replayHistory?.length,3);
  assert.equal((await current()).clueRecords?.[0].guesses[0].cardId,last.id);
  console.log('integration: classic → anime 6x6 → classic; countdown, private preselection, locks, handover, three replays passed');

  // Pure time/quotas: both sizes, empty random, quota exhaustion, exact 180s, stale history reuse.
  for (const mode of ['5x5','6x6'] as const) {
    const plan:NextPlan = {...structuredClone(sealed),settings:{...sealed.settings,boardMode:mode},stage:'draft',claims:{},protection:{},done:{red:false,blue:false},endsAt:clock+180000,sealedBoard:undefined};
    const limit = mode==='5x5' ? (plan.startingTeam==='red'?7:6) : (plan.startingTeam==='red'?10:9);
    for(let i=0;i<limit;i++) editDraft(plan,'red',{roomId:room.id,kind:'take',workId:plan.candidates[i].id},clock);
    assert.throws(()=>editDraft(plan,'red',{roomId:room.id,kind:'take',workId:plan.candidates[limit].id},clock),/手选已满/);
    editDraft(plan,'red',{roomId:room.id,kind:'take',workId:plan.candidates[limit].id,replaceId:plan.candidates[0].id},clock);
    assert.equal(Object.keys(plan.claims).length,limit);
    assert.throws(()=>editDraft(plan,'red',{roomId:room.id,kind:'done'},plan.endsAt!));
    sealDraft(plan); assert.equal(plan.sealedBoard!.length,mode==='5x5'?25:36);
    const once=JSON.stringify(plan.sealedBoard);sealDraft(plan);assert.equal(JSON.stringify(plan.sealedBoard),once);
    plan.stage='draft';plan.claims={};plan.sealedBoard=undefined;sealDraft(plan,Object.fromEntries(pool.map(w=>[w.seriesId,1])));
    assert.equal(plan.sealedBoard!.length,mode==='5x5'?25:36);
  }
  console.log('rules: exact 10/160/180 second boundaries, limits, atomic replace, interference, sealed-once, small-pool reuse passed');
} finally { Date.now=realNow; }
