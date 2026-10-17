import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';

const store = await createRoomStore('', true);
const users = {
  resolveProfile: async (profile: unknown) => profile ?? ({ accountType: 'guest', username: null, avatarUrl: null }),
  recordRoundResult: async () => {},
  noteRoomHosted: async () => {},
} as unknown as UserStore;
const game = new GameService(store, users, { enableDebugTools: true, disconnectKickDelayMs: 60, hostTakeoverGraceMs: 40 }, store);
const current = async (id: string) => (await game.getRoom(id))!;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let requestSeq = 0;
const rid = (label: string) => `${label}-${Date.now().toString(36)}-${(requestSeq++).toString(36)}`;

async function fourPlayerRoom(prefix: string) {
  const { room, player: host } = await game.createRoom(`${prefix}社长`);
  const second = (await game.joinRoom(room.id, `${prefix}二甲`)).player;
  const third = (await game.joinRoom(room.id, `${prefix}三乙`)).player;
  const fourth = (await game.joinRoom(room.id, `${prefix}四丁`)).player;
  await game.setTeam(room.id, host.id, 'red');
  await game.setRole(room.id, host.id, 'spymaster');
  await game.setTeam(room.id, second.id, 'red');
  await game.setRole(room.id, second.id, 'operative');
  await game.setTeam(room.id, third.id, 'blue');
  await game.setRole(room.id, third.id, 'spymaster');
  await game.setTeam(room.id, fourth.id, 'blue');
  await game.setRole(room.id, fourth.id, 'operative');
  return { roomId: room.id, host, second, third, fourth };
}

/** Deterministic multi-round win: keep guessing the current team's cards until the board ends. */
async function playToNormalWin(roomId: string, players: { host: { id: string }; second: { id: string }; third: { id: string }; fourth: { id: string } }) {
  const actor = (team: 'red' | 'blue', role: 'spymaster' | 'operative') => {
    const byTeam = { red: [players.host, players.second], blue: [players.third, players.fourth] } as const;
    const pair = byTeam[team];
    return role === 'spymaster' ? pair[0] : pair[1];
  };
  let rounds = 0;
  while ((await current(roomId)).phase === 'playing') {
    const room = await current(roomId);
    if (!room.clue) {
      await game.submitClue(roomId, actor(room.currentTeam, 'spymaster').id, `线索${rounds}`, 1, rid('clue'));
      continue;
    }
    const target = room.board.find(card => !card.revealed && card.role === room.currentTeam);
    if (target) await game.guessCard(roomId, actor(room.currentTeam, 'operative').id, target.id, rid('guess'));
    else await game.endTurn(roomId, actor(room.currentTeam, 'operative').id, rid('end'));
    rounds += 1;
    assert.ok(rounds < 80, 'normal win must terminate');
  }
  return rounds;
}

// ── 1. idempotent clue / guess / end-turn ────────────────────────────────
{
  const p = await fourPlayerRoom('幂等');
  await game.startGame(p.roomId, p.host.id);
  {
    const waiting = await current(p.roomId);
    if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); }
  }
  const room = await current(p.roomId);
  const redCaptain = room.players.find(x => x.team === room.currentTeam && x.role === 'spymaster')!;
  const redOperative = room.players.find(x => x.team === room.currentTeam && x.role === 'operative')!;
  const clueRequest = rid('clue');
  await game.submitClue(p.roomId, redCaptain.id, '唯一提示', 2, clueRequest);
  assert.equal(game.takeDuplicateRequest(p.roomId, clueRequest), false);
  await game.submitClue(p.roomId, redCaptain.id, '唯一提示', 2, clueRequest);
  assert.equal(game.takeDuplicateRequest(p.roomId, clueRequest), true);
  assert.equal((await current(p.roomId)).clue?.word, '唯一提示');
  await assert.rejects(game.submitClue(p.roomId, redCaptain.id, '第二提示', 2, rid('other')), /已经有提示/);

  const guess = (await current(p.roomId)).board.find(card => !card.revealed && card.role === room.currentTeam)!;
  const guessRequest = rid('guess');
  await game.guessCard(p.roomId, redOperative.id, guess.id, guessRequest);
  const afterFirst = await current(p.roomId);
  await game.guessCard(p.roomId, redOperative.id, guess.id, guessRequest);
  const afterDuplicate = await current(p.roomId);
  assert.equal(afterDuplicate.board.filter(card => card.revealed).length, afterFirst.board.filter(card => card.revealed).length);
  assert.equal(game.takeDuplicateRequest(p.roomId, guessRequest), true);

  const turnRequest = rid('end');
  const beforeTurn = await current(p.roomId);
  await game.endTurn(p.roomId, redOperative.id, turnRequest);
  await game.endTurn(p.roomId, redOperative.id, turnRequest);
  assert.equal(game.takeDuplicateRequest(p.roomId, turnRequest), true);
  assert.notEqual((await current(p.roomId)).currentTeam, beforeTurn.currentTeam);
  await assert.rejects(game.endTurn(p.roomId, redOperative.id, rid('end')), /当前队伍|没有/);
  await game.forceEndGame(p.roomId, p.host.id, 'abort');
  console.log('stability: clue/guess/end-turn request ids are idempotent; conflicting retries rejected');
}

// ── 2. host failover with grace, majority, isolation and no re-grab ───────
{
  const p = await fourPlayerRoom('接任');
  await game.startGame(p.roomId, p.host.id);
  {
    const waiting = await current(p.roomId);
    if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); }
  }
  const before = await current(p.roomId);
  const roles = JSON.stringify(before.players.map(x => [x.id, x.team, x.role]));
  await game.markDisconnected(p.roomId, p.host.id, 'player', () => true);
  await assert.rejects(game.hostTakeover(p.roomId, p.fourth.id, 'request'), /宽限期/);
  // Reset the offline timestamp to simulate the grace period having elapsed without waiting 120s.
  {
    const room = await current(p.roomId);
    room.hostOfflineSince = Date.now() - 5000;
    await store.setRoom(room);
  }
  await game.hostTakeover(p.roomId, p.fourth.id, 'request');
  let room = await current(p.roomId);
  assert.equal(room.hostTakeover?.candidateId, p.fourth.id);
  assert.equal(room.hostPlayerId, p.host.id);
  // The requester cannot self-approve; one of two eligible voters is not a majority.
  await assert.rejects(game.hostTakeover(p.roomId, p.fourth.id, 'approve'), /自己/);
  await game.hostTakeover(p.roomId, p.third.id, 'approve');
  room = await current(p.roomId);
  assert.equal(room.hostPlayerId, p.host.id, 'one of two approvals is not enough');
  await game.hostTakeover(p.roomId, p.second.id, 'approve');
  room = await current(p.roomId);
  assert.equal(room.hostPlayerId, p.fourth.id);
  assert.equal(room.players.find(x => x.id === p.fourth.id)?.role, 'operative');
  assert.equal(JSON.stringify(room.players.map(x => [x.id, x.team, x.role]).sort()), JSON.stringify(JSON.parse(roles).sort()), 'takeover must not alter team/role secrets');
  const view = game.getPublicRoomState(room, p.fourth.id, 'player');
  assert.equal(view.viewer?.isHost, true);
  assert.ok(view.board.some(card => card.role === undefined), 'the new host must not see unrevealed roles');

  // Returning original host does not regain host rights.
  await game.reconnectRoom(p.roomId, before.players.find(x => x.id === p.host.id)!.sessionToken!);
  room = await current(p.roomId);
  assert.equal(room.hostPlayerId, p.fourth.id);
  const oldHostView = game.getPublicRoomState(room, p.host.id, 'player');
  assert.equal(oldHostView.viewer?.isHost, false);

  // New host can safely terminate a locked game (no automatic win for the other team).
  const ended = await game.forceEndGame(p.roomId, p.fourth.id, 'abort');
  assert.equal(ended.phase, 'finished');
  assert.equal(ended.endReason, 'aborted');
  console.log('stability: host takeover requires grace + majority, preserves secrets, blocks re-grab, and allows safe abort');
}

// ── 3. single online member can take over after grace (no vote needed) ────
{
  const { room, player: host } = await game.createRoom('独自');
  await game.markDisconnected(room.id, host.id, 'player', () => true);
  {
    const stored = await current(room.id);
    stored.hostOfflineSince = Date.now() - 5000;
    await store.setRoom(stored);
    const { player: second } = await game.joinRoom(room.id, '独自替补');
    await game.hostTakeover(room.id, second.id, 'request');
    assert.equal((await current(room.id)).hostPlayerId, second.id);
  }
  console.log('stability: sole online player can safely take over after the grace period');
}

// ── 4. offline queued spectators are never promoted ───────────────────────
{
  const p = await fourPlayerRoom('候补');
  const { roomId, host } = p;
  await game.startGame(roomId, host.id);
  {
    const waiting = await current(roomId);
    if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); }
  }
  const { spectator: first } = await game.joinSpectator(roomId, '候补一号');
  const { spectator: secondSpec } = await game.joinSpectator(roomId, '候补二号');
  await game.queueForNextRound(roomId, first.id);
  await game.queueForNextRound(roomId, secondSpec.id);
  await game.markDisconnected(roomId, first.id, 'spectator', () => true);
  await game.forceEndGame(roomId, host.id, 'abort');
  await game.ensureReplay(roomId);
  const roomAfter = await current(roomId);
  assert.ok(roomAfter.players.some(p => p.id === secondSpec.id), 'online queued spectator is promoted');
  assert.ok(!roomAfter.players.some(p => p.id === first.id), 'offline queued spectator is not promoted');
  assert.ok(roomAfter.spectators.some(s => s.id === first.id), 'offline spectator keeps a seat');
  assert.ok(roomAfter.joinQueue.some(q => q.spectatorId === first.id), 'offline candidate keeps queue order');
  console.log('stability: offline queue candidates keep order but are never silently promoted');
}

// ── 5. disconnect → reconnect → disconnect timer race ─────────────────────
{
  const { room, player: host } = await game.createRoom('竞态');
  const second = (await game.joinRoom(room.id, '竞态二甲')).player;
  await game.markDisconnected(room.id, second.id, 'player', () => true);
  await sleep(20);
  await game.reconnectRoom(room.id, second.sessionToken!);
  await game.markDisconnected(room.id, second.id, 'player', () => true);
  await sleep(45); // past the first timer's deadline but before the second''s
  let roomAfter = await current(room.id);
  assert.ok(roomAfter.players.some(p => p.id === second.id), 'stale timer must not drop the reconnected seat');
  // Concurrent re-entrant operations at the expiry moment must stay serialized.
  await Promise.allSettled([
    game.setTeam(room.id, second.id, 'blue'),
    game.setTeam(room.id, second.id, 'red'),
    game.markDisconnected(room.id, second.id, 'player', () => false),
    game.reconnectRoom(room.id, second.sessionToken!),
  ]);
  roomAfter = await current(room.id);
  assert.ok(roomAfter.players.some(p => p.id === second.id));
  assert.equal(roomAfter.players.find(p => p.id === second.id)?.connected, true);
  console.log('stability: disconnect timers cannot inherit a released room lock or drop reconnected seats');
}

// ── 6. switching rooms never deletes the original locked roster ───────────
{
  const a = await fourPlayerRoom('原房');
  await game.planAction(a.roomId, a.host.id, { roomId: a.roomId, kind: 'configure', variant: 'anime', boardMode: '5x5', poolIds: [], poolName: 'x' }).catch(() => {});
  const b = await fourPlayerRoom('他房');
  for (const name of ['五', '六', '七', '八']) await game.joinRoom(b.roomId, `他房${name}人`);
  // A full room rejects the join; A remains untouched with its four players and roles.
  await assert.rejects(game.joinRoom(b.roomId, '他房第九人'), /满/);
  const roomA = await current(a.roomId);
  assert.equal(roomA.players.length, 4);
  assert.deepEqual(roomA.players.map(p => p.team), ['red', 'red', 'blue', 'blue']);
  await assert.rejects(game.joinRoom('ZZZZZZ', '无效房'), /不存在/);
  assert.equal((await current(a.roomId)).players.length, 4);
  console.log('stability: failed joins to full/missing rooms leave the original room intact');
}

// ── 7. a full multi-round match survives disconnects and reachable win ────
{
  const p = await fourPlayerRoom('完整');
  await game.startGame(p.roomId, p.host.id);
  {
    const waiting = await current(p.roomId);
    if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); }
  }
  await game.markDisconnected(p.roomId, p.second.id, 'player', () => true);
  await game.reconnectRoom(p.roomId, p.second.sessionToken!);
  const rounds = await playToNormalWin(p.roomId, p);
  const finished = await current(p.roomId);
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.endReason, 'normal');
  assert.ok(finished.winner === 'red' || finished.winner === 'blue');
  assert.ok(rounds >= 3, `expected a multi-round win, got ${rounds}`);
  const replay = await game.ensureReplay(p.roomId);
  assert.ok(replay);
  console.log(`stability: normal multi-round win after disconnect/reconnect (${rounds} clue rounds)`);
}

console.log('stability round: all P0 scenarios passed');
