import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import { animeCatalog } from '../src/anime-catalog.js';
import type { PlanAction, UserStore } from '../src/types.js';

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

const store = await createRoomStore('', true);
const users = {
  resolveProfile: async (profile: unknown) => profile ?? ({ accountType: 'guest', username: null, avatarUrl: null }),
  recordRoundResult: async () => {},
  noteRoomHosted: async () => {},
} as unknown as UserStore;
const game = new GameService(store, users, { enableDebugTools: false, enableAnimeDraft: true, disconnectKickDelayMs: 40 }, store);
const current = async (id: string) => (await game.getRoom(id))!;

async function setup() {
  const { room, player: host } = await game.createRoom('房主');
  const players = [host];
  for (const name of ['甲', '乙', '丙']) players.push((await game.joinRoom(room.id, name)).player);
  for (let i = 0; i < 4; i += 1) {
    await game.setTeam(room.id, players[i].id, i < 2 ? 'red' : 'blue');
    if (i % 2 === 0) await game.setRole(room.id, players[i].id, 'spymaster');
  }
  const spectator = (await game.joinSpectator(room.id, '旁观者')).spectator;
  const works = [...new Map(animeCatalog().map(work => [work.seriesId, work])).values()].slice(0, 42);
  const act = async (index: number, action: Omit<PlanAction, 'roomId' | 'version'>) => game.planAction(room.id, players[index].id, { roomId: room.id, version: (await current(room.id)).nextPlan?.version, ...action });
  await act(0, { kind: 'configure', variant: 'anime', boardMode: '5x5', poolIds: works.map(work => work.id), poolName: 'Round5 隐私池' });
  return { roomId: room.id, players, spectator, act };
}

try {
  const { roomId, players, spectator, act } = await setup();
  await act(0, { kind: 'prepare' });
  for (const captain of [0, 2]) await act(captain, { kind: 'ready' });
  assert.equal((await current(roomId)).nextPlan!.stage, 'draft');
  const plan = () => current(roomId).then(room => room.nextPlan!);
  async function stateFor(participantId: string, type: 'player' | 'spectator' = 'player') { return game.getPublicRoomState(await current(roomId), participantId, type); }

  const candidates = (await plan()).candidates;
  const [a, b, c, d, e] = candidates.map(work => work.id);

  await act(0, { kind: 'take', workId: a });
  await act(2, { kind: 'take', workId: b });
  let viewer = await stateFor(players[1].id);
  assert.deepEqual(viewer.nextPlan!.publicSelectedWorkIds, [a, b].sort((x, y) => x - y));
  assert.equal(viewer.nextPlan!.captainView, undefined);
  assert.equal(JSON.stringify(viewer.nextPlan).includes('protectedUntil'), false);
  assert.equal(JSON.stringify(viewer.nextPlan).includes('"claims"'), false);
  const spectatorView = await stateFor(spectator.id, 'spectator');
  assert.deepEqual(spectatorView.nextPlan!.publicSelectedWorkIds, [a, b].sort((x, y) => x - y));
  assert.equal(spectatorView.nextPlan!.captainView, undefined);

  // Interference never enters the neutral list, but remains visible to both captains.
  await act(0, { kind: 'interfere', workId: c });
  viewer = await stateFor(players[1].id);
  assert.equal(viewer.nextPlan!.publicSelectedWorkIds!.includes(c), false);
  const redCaptain = await stateFor(players[0].id);
  assert.equal(redCaptain.nextPlan!.captainView!.claims[c].kind, 'interference');

  // Release and atomic replacement update only the neutral current set.
  await act(0, { kind: 'release', workId: a });
  viewer = await stateFor(players[3].id);
  assert.deepEqual(viewer.nextPlan!.publicSelectedWorkIds, [b].sort((x, y) => x - y));
  await act(0, { kind: 'take', workId: a });
  await act(0, { kind: 'take', workId: d, replaceId: a });
  viewer = await stateFor(players[3].id);
  assert.ok(viewer.nextPlan!.publicSelectedWorkIds!.includes(d));
  assert.equal(viewer.nextPlan!.publicSelectedWorkIds!.includes(a), false);

  // Bookmarks and steals never change the neutral list.
  const beforeBookmark = [...viewer.nextPlan!.publicSelectedWorkIds!].sort();
  await act(0, { kind: 'bookmark', workId: e });
  viewer = await stateFor(players[3].id);
  assert.deepEqual([...viewer.nextPlan!.publicSelectedWorkIds!].sort(), beforeBookmark);
  clock += 10_500;
  await act(2, { kind: 'take', workId: d });
  viewer = await stateFor(players[1].id);
  assert.deepEqual([...viewer.nextPlan!.publicSelectedWorkIds!].sort(), beforeBookmark);
  assert.equal(JSON.stringify(viewer.nextPlan).includes('红队'), false);
  assert.equal(JSON.stringify(viewer.nextPlan).includes('蓝队'), false);

  // Non-captains cannot mutate the draft.
  const version = (await plan()).version;
  await assert.rejects(game.planAction(roomId, players[1].id, { roomId, version, kind: 'take', workId: candidates[6].id }), /队长/);

  await act(0, { kind: 'done' });
  await act(2, { kind: 'done' });
  const sealed = await plan();
  assert.equal(sealed.stage, 'sealed');
  const sealedView = await stateFor(players[1].id);
  assert.equal(sealedView.nextPlan!.publicSelectedWorkIds, undefined, 'sealed view no longer exposes a live selection list');
  assert.equal(JSON.stringify(sealedView.nextPlan).includes('sealedBoard'), false);

  // Guide-stage disconnect must not be kicked by the lobby cleanup timer.
  const second = await setup();
  await second.act(0, { kind: 'prepare' });
  assert.equal((await current(second.roomId)).nextPlan!.stage, 'guide');
  const captainToken = (await current(second.roomId)).players[0].sessionToken!;
  await game.markDisconnected(second.roomId, second.players[0].id, 'player', () => true);
  await new Promise(resolve => setTimeout(resolve, 120));
  const afterWait = await current(second.roomId);
  assert.ok(afterWait.players.some(player => player.id === second.players[0].id), 'guide captain keeps the seat beyond the lobby kick delay');
  assert.equal(afterWait.players.find(player => player.id === second.players[0].id)?.connected, false);
  await game.reconnectRoom(second.roomId, captainToken);
  for (const captain of [0, 2]) await second.act(captain, { kind: 'ready' });
  assert.equal((await current(second.roomId)).nextPlan!.stage, 'draft');

  // Explicit withdrawal during guide invalidates readiness and returns to planning.
  const third = await setup();
  await third.act(0, { kind: 'prepare' });
  const versionBeforeLeave = (await current(third.roomId)).nextPlan!.version;
  await game.leaveRoom(third.roomId, third.players[2].id, 'player');
  const afterLeave = await current(third.roomId);
  assert.equal(afterLeave.nextPlan!.stage, 'planning');
  assert.ok(afterLeave.nextPlan!.version > versionBeforeLeave);
  assert.deepEqual(afterLeave.nextPlan!.ready, { red: false, blue: false });
  // Host can nominate a replacement captain and continue.
  await third.act(0, { kind: 'nominate', team: 'blue', targetId: third.players[3].id });
  assert.equal((await current(third.roomId)).nextPlan!.captains.blue, third.players[3].id);

  console.log('round5 privacy: neutral draft set for players/spectators, no claims/protection/interference/team leakage, steal neutrality, guide disconnect protection and safe withdrawal passed');
} finally {
  Date.now = realNow;
}
