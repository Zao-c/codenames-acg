import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { roomTurnKey, type PublicRoomState } from '@acg-codenames/shared';
import { ClueRequestLifecycle } from '../../web/src/lib/pending-clue';

mock.timers.enable({apis:['setTimeout']});
const initial = {id:'ROOM-A',matchId:'MATCH-A',roundNumber:1,phase:'playing',currentTeam:'red',updatedAt:100,
  clue:null,clueRecords:[]} as unknown as PublicRoomState;
const accepted = {...initial,updatedAt:101,clue:{id:'clue-new',word:'星河',count:2,team:'red',giverPlayerId:'captain-a',usedGuesses:0},
  clueRecords:[{clueId:'clue-new',word:'星河',count:2,team:'red',giverPlayerId:'captain-a',giverNickname:'A',guesses:[]}]} as PublicRoomState;
const events: string[]=[];
const lifecycle=new ClueRequestLifecycle(event=>events.push(event));
const request={requestId:'request-a',roomId:initial.id,matchId:initial.matchId,roundNumber:1,
  turnVersion:roomTurnKey(initial),roomVersion:100,team:'red' as const,giverPlayerId:'captain-a',recordCount:0,
  word:'星河',count:2,draftRevision:1};
function start(id='request-a'){assert.equal(lifecycle.start({...request,requestId:id}),true);}
start();assert.equal(lifecycle.start({...request,requestId:'duplicate'}),false);
lifecycle.observe(accepted);assert.equal(lifecycle.pending,null);
mock.timers.tick(10_000);assert.deepEqual(events,['pending','accepted']);
lifecycle.acknowledge('request-a',{ok:false,message:'late failure'});assert.equal(events.length,2);
start('request-b');lifecycle.acknowledge('request-a',{ok:true});assert.ok(lifecycle.pending);
lifecycle.acknowledge('request-b',{ok:false,message:'真实拒绝'});assert.equal(events.at(-1),'rejected');
start('request-c');mock.timers.tick(9000);assert.equal(events.at(-1),'syncing');assert.equal(lifecycle.pending?.status,'syncing');
assert.equal(lifecycle.start({...request,requestId:'unsafe-retry'}),false);
lifecycle.observe({...initial,updatedAt:102});assert.ok(lifecycle.pending,'unchanged snapshot is not a rejection');
assert.equal(lifecycle.retry()?.requestId,'request-c','explicit retry keeps original idempotency key');
assert.equal(lifecycle.retry(),null,'retry double entry is locked');
lifecycle.acknowledge('request-c',{ok:true,roomId:initial.id,roomVersion:103});assert.equal(events.at(-1),'accepted');
for(const bad of [
  {...accepted,clue:{...accepted.clue!,count:3}},
  {...accepted,clue:{...accepted.clue!,giverPlayerId:'other-captain'}},
  {...accepted,matchId:'old-match'},
  {...accepted,id:'ROOM-B'},
  {...accepted,currentTeam:'blue'},
  {...accepted,roundNumber:2},
  {...accepted,clueRecords:[...accepted.clueRecords!,...accepted.clueRecords!]}
] as PublicRoomState[]){start();lifecycle.observe(bad);assert.equal(events.at(-1),'invalidated');}
start();lifecycle.observe({...accepted,updatedAt:99});assert.ok(lifecycle.pending,'old snapshot ignored');lifecycle.observe(accepted);assert.equal(events.at(-1),'accepted');
start();lifecycle.cancel();mock.timers.tick(10_000);assert.equal(events.at(-1),'invalidated');
start('new-room');lifecycle.acknowledge('request-a',{ok:false});assert.equal(lifecycle.pending?.requestId,'new-room');lifecycle.cancel();
mock.timers.reset();
console.log('Round 7 clue lifecycle: double entry, state before ACK, lost/reordered ACK, timeout, stale version, wrong giver/count/match/room/turn and cleanup PASS');
