import assert from 'node:assert/strict';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';

const store = await createRoomStore('', true);
const users = {
  resolveProfile: async () => ({ accountType: 'guest', username: null, avatarUrl: null }),
  recordRoundResult: async () => {},
} as unknown as UserStore;
const game = new GameService(store, users, { enableDebugTools: true }, store);
const { room, player: host } = await game.createRoom('房主');
const { player: second } = await game.joinRoom(room.id, '第二人');
const { player: third } = await game.joinRoom(room.id, '第三人');
await game.transferHost(room.id, host.id, second.id);
assert.equal((await game.leaveRoom(room.id, third.id, 'player'))?.hostPlayerId, second.id);
await game.transferHost(room.id, second.id, host.id);
await game.leaveRoom(room.id, second.id, 'player');
await game.debugFillRoom(room.id, host.id);
await game.startGame(room.id, host.id);
{ const waiting = (await game.getRoom(room.id))!; if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); } }
await game.forceEndGame(room.id, host.id);
const first = await game.ensureReplay(room.id);
const firstBoard = (await store.getReplay(first!))!.finalBoard;
await game.restartGame(room.id, host.id);
assert.equal((await game.getRoom(room.id))!.replayId, undefined);
{ const waiting = (await game.getRoom(room.id))!; if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await store.setRoom(waiting); await game.tickTimers(); } }
await game.forceEndGame(room.id, host.id);
const secondReplay = await game.ensureReplay(room.id);
assert.notEqual(first, secondReplay);
assert.deepEqual((await store.getReplay(first!))!.finalBoard, firstBoard);
assert.notDeepEqual((await store.getReplay(secondReplay!))!.finalBoard, firstBoard);
console.log('lifecycle: transferred host survives ordinary leave; consecutive replays remain independent');
