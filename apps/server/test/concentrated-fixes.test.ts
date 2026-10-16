import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';
import type { BoardMode, Team } from '@acg-codenames/shared';
const users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
async function setup(size:BoardMode='5x5',anime=false){
 const store=await createRoomStore('',true),game=new GameService(store,users,{enableDebugTools:false,enableAnimeDraft:true},store);
 const {room,player}=await game.createRoom('房主');const players=[player];
 for(const name of ['红队员','蓝队长','蓝队员'])players.push((await game.joinRoom(room.id,name)).player);
 for(let i=0;i<4;i++){await game.setTeam(room.id,players[i].id,i<2?'red':'blue');if(i%2===0)await game.setRole(room.id,players[i].id,'spymaster');}
 const current=async()=>(await game.getRoom(room.id))!;
 const plan=async(kind:string,extra={})=>game.planAction(room.id,player.id,{roomId:room.id,version:(await current()).nextPlan?.version,kind,...extra} as any);
 await plan('configure',{variant:anime?'anime':'classic',boardMode:size,scoringMode:'scoring'});await plan('prepare');
 if(anime){for(const i of [0,2])await game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,kind:'ready'});for(const i of [0,2])await game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,kind:'done'});}
 const start=async()=>{await game.startGame(room.id,player.id);const r=await current();r.countdown!.startsAt=Date.now()-1;await store.setRoom(r);await game.tickTimers();};await start();
 const actor=(team:Team,captain=false)=>players[(team==='red'?0:2)+(captain?0:1)].id;
 const clue=async(count=3)=>{const r=await current();await game.submitClue(room.id,actor(r.currentTeam,true),'重复线索',count);};
 const guess=async(role:Team|'neutral'|'assassin')=>{const r=await current();return game.guessCard(room.id,actor(r.currentTeam),r.board.find(c=>!c.revealed&&c.role===role)!.id);};
 return {store,game,room,players,current,actor,clue,guess,start};
}
for(const [size,anime] of [['5x5',true],['6x6',true],['7x7',false],['9x9',false]] as const){
 const f=await setup(size,anime);const team=(await f.current()).currentTeam;
 // A nonzero match carry verifies round details never contain accumulated session scores.
 let r=await f.current();r.scores={red:100,blue:100};r.settings.timerMode='timed';await f.store.setRoom(r);await f.clue(3);
 assert.equal((await f.current()).clueRecords?.length,1);assert.equal((await f.current()).clueRecords?.[0].guesses.length,0);
 for(const total of [12,26,42]){r=await f.guess(team);assert.equal(r.scores[team],100+total,`${size}: score ${total}`);assert.equal(r.currentRoundScore!.totalRound,total);}
 r=await f.game.endTurn(f.room.id,f.actor(team));assert.equal(r.scores[team],152);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,52);
 await assert.rejects(f.game.endTurn(f.room.id,f.actor(r.currentTeam)),/没有/);assert.equal((await f.current()).scores[team],152);
 const opponent=r.currentTeam;await f.clue(2);r=await f.guess(opponent);assert.equal(r.currentRoundScore!.totalRound,12);
 r=await f.guess('neutral');assert.equal(r.timerPhase,'clue');assert.ok(r.timerEndsAt!>Date.now());assert.equal(r.scores[opponent],109);assert.equal(r.currentRoundScore,undefined);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,9);
 await f.clue(1);r=await f.guess(opponent);assert.equal(r.scores[team],147);assert.equal(r.scores[opponent],114);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,-5);
 // Timer settles exact precision once, keeping already-earned points in the round record.
 await f.clue(1);const nowTeam=(await f.current()).currentTeam;r=await f.guess(nowTeam);const before=r.scores[nowTeam];r.timerPhase='guess';r.timerEndsAt=Date.now()-1;r.settings.timerMode='timed';await f.store.setRoom(r);await f.game.tickTimers();
 r=await f.current();assert.equal(r.scores[nowTeam],before+10);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,22);const history=r.roundScoreHistory!.length;await f.game.tickTimers();assert.equal((await f.current()).roundScoreHistory!.length,history);
 r.timerEndsAt=Date.now()-1;r.timerPhase='clue';const timeoutTeam=r.currentTeam,timeoutBefore=r.scores[timeoutTeam];await f.store.setRoom(r);await f.game.tickTimers();assert.equal((await f.current()).scores[timeoutTeam],timeoutBefore-10);
 await f.game.disbandRoom(f.room.id,f.players[0].id);
 console.log(`scoring ${size}: 12/26/42, precision once, separate round history, wrong guesses and timers PASS`);
}
// Three complete normal matches, both teams submit clues, wrong guesses and explicit turn ends.
{
 const f=await setup();
 for(let match=0;match<3;match++){
  let turns=0;
  while((await f.current()).phase==='playing'){
   const r=await f.current(),team=r.currentTeam;await f.clue(3);
   const count=Math.min(3,r.remainingCounts[team]);for(let i=0;i<count&&(await f.current()).phase==='playing';i++)await f.guess(team);
   if((await f.current()).phase==='playing')await f.game.endTurn(f.room.id,f.actor(team));
   assert.ok(++turns<50);
  }
  const end=await f.current();assert.equal(end.endReason,'normal');assert.ok(end.winner);assert.equal(end.remainingCounts[end.winner!],0);assert.equal(end.currentRoundScore,undefined);
  await f.game.ensureReplay(f.room.id);assert.equal((await f.current()).replayHistory!.length,match+1);
  if(match<2){await f.game.restartGame(f.room.id,f.players[0].id);const r=await f.current();r.countdown!.startsAt=Date.now()-1;await f.store.setRoom(r);await f.game.tickTimers();assert.equal((await f.current()).clueRecords?.length,0);}
 }
 await f.game.disbandRoom(f.room.id,f.players[0].id);console.log('three normal complete matches and replay/next-match cleanup PASS');
}
// End boundaries: exhausted extra guess, score floors, assassin/opponent rewards and victory bonus.
for(const outcome of ['extra','assassin','opponent-last','own-last'] as const){
 const f=await setup(),initial=await f.current(),team=initial.currentTeam,other=team==='red'?'blue':'red';
 if(outcome.endsWith('last')){
  const role=outcome==='own-last'?team:other;let kept=false;
  for(const c of initial.board)if(c.role===role){if(!kept){kept=true;continue;}c.revealed=true;}
  initial.remainingCounts[role]=1;await f.store.setRoom(initial);
 }
 await f.clue(1);
 if(outcome==='extra'){
  await f.guess(team);const r=await f.guess(team);assert.equal(r.scores[team],26);assert.equal(r.currentRoundScore,undefined);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,26);assert.equal(r.currentTeam,other);
 }else if(outcome==='assassin'){
  const r=await f.guess('assassin');assert.equal(r.winner,other);assert.equal(r.scores[team],0);assert.equal(r.scores[other],45);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,-25);
 }else if(outcome==='opponent-last'){
  const r=await f.guess(other);assert.equal(r.winner,other);assert.equal(r.scores[team],0);assert.equal(r.scores[other],25);
 }else{
  const r=await f.guess(team);assert.equal(r.winner,team);assert.equal(r.scores[team],42);assert.equal(r.roundScoreHistory!.at(-1)!.totalRound,42);assert.equal(r.roundScoreHistory!.at(-1)!.victoryBonus,20);
 }
 await f.game.sendChatMessage(f.room.id,f.players[1].id,'player','重试同一消息','message-once');
 await f.game.sendChatMessage(f.room.id,f.players[1].id,'player','重试同一消息','message-once');
 assert.equal((await f.current()).messages.filter(m=>m.requestId==='message-once').length,1);
 await f.game.disbandRoom(f.room.id,f.players[0].id);
}
console.log('extra guess settlement, score floors, assassin/opponent/victory transfers and idempotent chat PASS');
// Fake clock: the first disconnect's deadline must not remove a second disconnect.
mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
try{
 const store=await createRoomStore('',true),game=new GameService(store,users,{enableDebugTools:false});
 const {room,player:host}=await game.createRoom('定时房主');const p=(await game.joinRoom(room.id,'计时玩家')).player;
 const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
 await game.markDisconnected(room.id,p.id,'player');mock.timers.tick(30_000);await game.reconnectRoom(room.id,p.sessionToken!);mock.timers.tick(30_000);await game.markDisconnected(room.id,p.id,'player');
 mock.timers.tick(60_000);await flush();assert.equal((await game.getRoom(room.id))!.players.length,2);
 mock.timers.tick(59_999);await flush();assert.equal((await game.getRoom(room.id))!.players.length,2);
 mock.timers.tick(1);await flush();assert.equal((await game.getRoom(room.id))!.players.length,1);
 assert.equal((game as any).disconnectKickTimers.size,0);
 const spectator=(await game.joinSpectator(room.id,'旁观者')).spectator;await game.markDisconnected(room.id,spectator.id,'spectator');await game.reconnectRoom(room.id,spectator.sessionToken!);assert.equal((game as any).disconnectKickTimers.size,0);
 await game.markDisconnected(room.id,host.id,'player',()=>false);assert.equal((await game.getRoom(room.id))!.players[0].connected,true);
 await game.markDisconnected(room.id,host.id,'player');await game.disbandRoom(room.id,host.id);assert.equal((game as any).disconnectKickTimers.size,0);
 console.log('fake clock T0/T30/T60/T120/T180, spectator recovery, multi-socket guard and destroy cleanup PASS');
}finally{mock.timers.reset();}

