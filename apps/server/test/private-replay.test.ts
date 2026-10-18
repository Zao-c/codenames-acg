import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore, REPLAY_TTL_SECONDS } from '../src/store.js';
import type { UserStore } from '../src/types.js';
import type { PlanAction } from '@acg-codenames/shared';

const realNow = Date.now;
let clock = realNow(); Date.now = () => clock;
const store = await createRoomStore('', true);
let failSave = false;
const replayStore = { getReplay: store.getReplay.bind(store), saveReplay: async (replay: Parameters<typeof store.saveReplay>[0]) => { if (failSave) { failSave = false; throw new Error('injected replay failure'); } await store.saveReplay(replay); } };
const users = { resolveProfile: async () => ({ accountType: 'guest', username: null, avatarUrl: null }), recordRoundResult: async () => {} } as unknown as UserStore;
const game = new GameService(store, users, { enableDebugTools: false, enableAnimeDraft: true, enableMatchAnalysis: true, enablePredictions: true }, replayStore);
try {
  const { room, player: host } = await game.createRoom('archive-A', undefined, undefined, 'owner-A');
  const players = [host];
  for (let i = 1; i < 4; i++) players.push((await game.joinRoom(room.id, `archive-${i}`, undefined, undefined, `owner-${i}`)).player);
  for (let i = 0; i < 4; i++) { await game.setTeam(room.id, players[i].id, i < 2 ? 'red' : 'blue'); if (i % 2 === 0) await game.setRole(room.id, players[i].id, 'spymaster'); }
  const current = async () => (await game.getRoom(room.id))!;
  const plan = async (i: number, action: Omit<PlanAction, 'roomId' | 'version'>) => game.planAction(room.id, players[i].id, { roomId: room.id, version: (await current()).nextPlan?.version, ...action });
  const start = async () => {
    await plan(0, { kind: 'configure', variant: 'anime', boardMode: '6x6' });
    await plan(0, { kind: 'prepare' }); await plan(0, { kind: 'ready' }); await plan(2, { kind: 'ready' }); await plan(0, { kind: 'done' }); await plan(2, { kind: 'done' });
    await game.startGame(room.id, host.id); clock += 5000; await game.tickTimers();
  };
  await start();
  const spectator = (await game.joinSpectator(room.id, 'predict', undefined, undefined, 'predict-owner')).spectator;
  const queued = (await game.joinSpectator(room.id, 'queued', undefined, undefined, 'queued-owner')).spectator;
  await game.queueForNextRound(room.id, queued.id);
  const active = await current(), matchId = active.matchId!;
  const assassinId = active.board.find(c => c.role === 'assassin')!.id;
  const untouched = active.board.find(c => c.role === 'red')!.id;
  const graphAction = { roomId: room.id, matchId, target: 'team', scope: 'match', expectedRevision: 0, requestId: 'private-graph', operation: { kind: 'node', node: { id: 'private-note', text: 'PRIVATE_ARCHIVE_SENTINEL', x: .2, y: .4 } } };
  await game.analysisAction(room.id, players[1].id, 'player', graphAction);
  for (const cardId of [assassinId, untouched]) { clock += 1100; await game.predictionAction(room.id, spectator.id, 'spectator', { matchId, requestId: `predict-${cardId}`, kind: 'set', cardId, choice: 'red', expectedRevision: 0 }); }
  assert.throws(() => game.getPrivateReplay(matchId, 'owner-A'));
  const captain = active.currentTeam === 'red' ? 0 : 2;
  await game.submitClue(room.id, players[captain].id, '终局', 1);
  await game.guessCard(room.id, players[captain + 1].id, assassinId);
  assert.equal((await current()).endReason, 'normal');
  failSave = true;
  await assert.rejects(game.ensureReplay(room.id), /injected/);
  const pendingId = game.getPrivateReplay(matchId, 'owner-A').replayId;
  const replayId = await game.ensureReplay(room.id);
  assert.equal(replayId, pendingId);
  assert.equal(await game.ensureReplay(room.id), replayId);
  assert.equal((await current()).players.some(p => p.id === queued.id), true);
  const review = game.getPrivateReplay(matchId, 'owner-1');
  assert.equal(review.teamGraphs!.red.match.nodes[0].text, 'PRIVATE_ARCHIVE_SENTINEL');
  assert.equal(review.snapshots!.length, 1);
  assert.equal(review.sharedPredictions!.length, 0);
  assert.equal(JSON.stringify(review).includes('predict-owner'), false);
  assert.throws(() => game.getPrivateReplay(matchId, 'queued-owner'));
  assert.throws(() => game.getPrivateReplay(matchId, 'unknown-owner'));
  const mine = game.getPrivateReplay(matchId, 'predict-owner');
  assert.equal(mine.teamGraphs, undefined);
  assert.equal(mine.snapshots, undefined);
  assert.deepEqual(mine.predictionResult, { total: 1, correct: 0 });
  assert.equal(JSON.stringify(await game.getReplay(replayId!)).includes('PRIVATE_ARCHIVE_SENTINEL'), false);
  assert.equal(JSON.stringify(await game.getReplay(replayId!)).includes('predict-owner'), false);
  await game.sharePrivatePrediction(matchId, 'predict-owner', true);
  assert.equal(game.getPrivateReplay(matchId, 'owner-A').sharedPredictions!.length, 1);
  await game.sharePrivatePrediction(matchId, 'predict-owner', false);
  assert.equal(game.getPrivateReplay(matchId, 'owner-A').sharedPredictions!.length, 0);
  // Start a new match in the same room: old snapshots/ACL remain in the separate archive.
  await game.returnToLobby(room.id, host.id);
  await start();
  assert.notEqual((await current()).matchId, matchId);
  assert.equal((await current()).privateMatch!.snapshots.length, 0);
  assert.equal(game.getPrivateReplay(matchId, 'owner-A').snapshots![0].cardId, assassinId);
  assert.throws(() => game.getPrivateReplay(matchId, 'queued-owner'));
  clock += REPLAY_TTL_SECONDS * 1000 + 1;
  assert.throws(() => game.getPrivateReplay(matchId, 'owner-A'));
  console.log('private replay: normal finish, pre-flip snapshots, spectator privacy, promotion ACL, sharing, retry, next match and expiry passed');
} finally { Date.now = realNow; }
