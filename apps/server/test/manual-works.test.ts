import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import { createServer } from 'node:http';
import { animeCatalog, animeCatalogFor, registerManualCatalog } from '../src/anime-catalog.js';
import { AnimePoolStore } from '../src/anime-pool-store.js';
import { ManualWorkStore } from '../src/manual-works.js';
import { manualCoverRouter, manualWorkRouter } from '../src/manual-works-api.js';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import { principalFromKey } from '../src/private-identity.js';
import type { UserStore } from '../src/types.js';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) raw[y * (width * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const dataUrl = (buffer: Buffer, mime = 'image/png') => `data:${mime};base64,${buffer.toString('base64')}`;
const cover = dataUrl(png(240, 320));

const root = path.resolve('artifacts');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, 'cipai-manual-'));
const manual = new ManualWorkStore(path.join(directory, 'manual.json'), path.join(directory, 'covers'));
await manual.initialize();
registerManualCatalog((principal, extraIds) => manual.worksForSync(principal, extraIds));
const pools = new AnimePoolStore(path.join(directory, 'pools.json'), (principal?: string) => animeCatalogFor(principal), {
  canUseWork: (principal, id, allowExisting) => manual.canUseSync(principal, id, allowExisting),
  onPublicationChange: ids => manual.syncPublication(ids),
});
const ownerKey = 'c'.repeat(64), otherKey = 'd'.repeat(64);
const owner = principalFromKey(ownerKey), other = principalFromKey(otherKey);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/manual', manualWorkRouter(manual, { enabled: true }));
app.use('/covers', manualCoverRouter(manual));
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
async function request(url: string, method = 'GET', body?: unknown, key = ownerKey) {
  const response = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', 'x-private-key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const type = response.headers.get('content-type') ?? '';
  return { status: response.status, body: type.includes('json') ? await response.json() : await response.arrayBuffer(), headers: response.headers };
}

try {
  const created = await request('/manual', 'POST', { title: '没有 Bangumi 收录的原创短片', aliases: ['オリジナル短編'], type: 'OVA', airDate: '2026', tags: ['原创', '短片'], coverDataUrl: cover });
  assert.equal(created.status, 201);
  const work = created.body;
  assert.ok(work.id < 0, 'manual ids must not masquerade as Bangumi subject ids');
  assert.equal(work.source, 'manual');
  assert.match(work.seriesId, /^manual:[a-f0-9-]{36}$/);
  assert.equal(work.aliases[0], 'オリジナル短編');
  assert.equal(work.airDate, '2026');
  assert.match(work.cover, /^\/api\/anime\/covers\/[a-f0-9-]{36}\.png$/);
  const coverFile = work.cover.split('/').pop();
  const served = await request(`/covers/${coverFile}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await request(`/covers/${'../'.repeat(4)}etc/passwd`)).status, 404);
  assert.equal((await request('/covers/not-a-real-file.png')).status, 404);

  // Metadata (tEXt/eXIf) is stripped from the persisted file.
  const withText = await request('/manual', 'POST', { title: '带元数据的作品', coverDataUrl: dataUrl(png(120, 160, [chunk('tEXt', Buffer.from('Comment\0secret location', 'ascii'))])) });
  assert.equal(withText.status, 201);
  const stored = await readFile(path.join(directory, 'covers', withText.body.cover.split('/').pop()!), 'latin1');
  assert.equal(stored.includes('tEXt'), false);
  assert.equal(stored.includes('secret location'), false);

  // Rejections: wrong MIME/SVG, wrong magic, too small, missing title, oversized payload.
  assert.equal((await request('/manual', 'POST', { title: 'SVG', coverDataUrl: dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml') })).status, 400);
  assert.equal((await request('/manual', 'POST', { title: '伪装 PNG', coverDataUrl: dataUrl(Buffer.from('not really a png')) })).status, 400);
  assert.equal((await request('/manual', 'POST', { title: '太小', coverDataUrl: dataUrl(png(8, 8)) })).status, 400);
  assert.equal((await request('/manual', 'POST', { title: '   ', coverDataUrl: cover })).status, 400);
  assert.equal((await request('/manual', 'POST', { title: '没有封面' })).status, 201, 'cover is optional');
  assert.equal((await request('/manual', 'POST', { title: '超大', coverDataUrl: dataUrl(Buffer.concat([png(240, 320), Buffer.alloc(5 * 1024 * 1024)])) })).status, 400);

  // Ownership: others can neither see nor edit the private work.
  assert.equal((await request(`/manual/${work.id}`, 'GET', undefined, otherKey)).status, 404);
  assert.equal((await request(`/manual/${work.id}`, 'PUT', { title: '越权改名' }, otherKey)).status, 403);
  assert.equal((await request('/manual', 'GET', undefined, otherKey)).body.items.length, 0);
  assert.equal((await request(`/manual/${work.id}`, 'DELETE', undefined, otherKey)).status, 403);
  assert.equal((await request(`/manual/${work.id}`, 'PUT', { title: '更新后的标题', expectedUpdatedAt: work.updatedAt }, ownerKey)).body.title, '更新后的标题');
  assert.equal((await request(`/manual/${work.id}`, 'PUT', { title: '并发冲突', expectedUpdatedAt: work.updatedAt }, ownerKey)).status, 409);

  // Pool ownership: private manual work cannot be used by another identity.
  const series = [...new Map(animeCatalog().map(w => [w.seriesId, w])).values()];
  const baseIds = series.slice(0, 33).map(w => w.id);
  const mixed = [...baseIds, work.id];
  const privatePool = await pools.create(owner, { name: '混合私人池', description: '', author: '测试', workIds: mixed, isPublic: false });
  assert.equal(privatePool.workCount, 34);
  assert.ok(privatePool.seriesCount >= 25);
  await assert.rejects(pools.create(other, { name: '越权池', description: '', author: '测试', workIds: [work.id], isPublic: false }), /目录|无权使用/);
  await assert.rejects(pools.create(other, { name: '越权公开池', description: '', author: '测试', workIds: [work.id], isPublic: true }), /目录|无权使用/);

  // Publishing shares manual works; copies stay usable after the source pool is deleted.
  const publicPool = await pools.update(privatePool.id, owner, { name: '混合公开池', description: '含自建作品', author: '测试', workIds: mixed, isPublic: true, expectedRevision: privatePool.revision });
  assert.equal((await manual.listPublished('')).items.some(item => item.id === work.id), true);
  const copy = await pools.copy(publicPool.id, other);
  assert.deepEqual(copy.workIds, mixed);
  assert.equal((await pools.get(copy.id, other)).workCount, 34);
  const otherCopyAllowsManual = await pools.update(copy.id, other, { ...copy, author: '测试', expectedRevision: copy.revision, workIds: mixed, isPublic: false });
  assert.equal(otherCopyAllowsManual.workCount, 34);
  await pools.delete(publicPool.id, owner);
  assert.equal((await pools.get(copy.id, other)).workCount, 34);

  // End-to-end: room config from the mixed pool, 5x5 draft seal, board identity, replay snapshot.
  const rooms = await createRoomStore('', true);
  const users = { resolveProfile: async (profile: unknown) => profile ?? ({ accountType: 'guest', username: null, avatarUrl: null }), recordRoundResult: async () => {}, noteRoomHosted: async () => {} } as unknown as UserStore;
  const game = new GameService(rooms, users, {
    enableDebugTools: false,
    enableAnimeDraft: true,
    hostTakeoverGraceMs: 1,
    resolveCommunityPool: (id, principal) => pools.get(id, principal),
    resolveManualWorks: ids => manual.resolveIds(ids),
  }, rooms);
  const { room, player: host } = await game.createRoom('混合房主', undefined, undefined, other);
  const players = [host];
  for (const name of ['乙', '丙', '丁']) players.push((await game.joinRoom(room.id, name, undefined, undefined, other)).player);
  for (let i = 0; i < 4; i += 1) {
    await game.setTeam(room.id, players[i].id, i < 2 ? 'red' : 'blue');
    if (i % 2 === 0) await game.setRole(room.id, players[i].id, 'spymaster');
  }
  const configured = await game.planAction(room.id, host.id, { roomId: room.id, kind: 'configure', variant: 'anime', boardMode: '5x5', communityPoolId: copy.id, communityPoolRevision: otherCopyAllowsManual.revision });
  assert.equal(configured.nextPlan?.pool.length, 34);
  assert.ok(configured.nextPlan?.pool.some(item => item.id === work.id && item.source === 'manual'));

  // Deleting the manual work after the pool copy is configured must not break this frozen plan.
  await manual.remove(owner, work.id);
  assert.equal((await manual.listMine(owner)).items.some(item => item.id === work.id), false);
  const reconfigured = await game.planAction(room.id, host.id, { roomId: room.id, kind: 'configure', variant: 'anime', boardMode: '5x5', communityPoolId: copy.id, communityPoolRevision: otherCopyAllowsManual.revision });
  assert.ok(reconfigured.nextPlan?.pool.some(item => item.id === work.id), 'retired manual works stay resolvable for existing pools');

  await game.planAction(room.id, host.id, { roomId: room.id, kind: 'prepare', version: reconfigured.nextPlan!.version });
  let plan = (await game.getRoom(room.id))!.nextPlan!;
  await game.planAction(room.id, plan.captains.red!, { roomId: room.id, kind: 'ready', version: plan.version });
  plan = (await game.getRoom(room.id))!.nextPlan!;
  await game.planAction(room.id, plan.captains.blue!, { roomId: room.id, kind: 'ready', version: plan.version });
  plan = (await game.getRoom(room.id))!.nextPlan!;
  const manualCandidate = plan.candidates.find(item => item.id === work.id);
  assert.ok(manualCandidate, 'the manual work must participate in the draft candidates');
  await game.planAction(room.id, plan.captains.red!, { roomId: room.id, kind: 'take', workId: manualCandidate.id, version: plan.version });
  plan = (await game.getRoom(room.id))!.nextPlan!;
  await game.planAction(room.id, plan.captains.red!, { roomId: room.id, kind: 'done', version: plan.version });
  plan = (await game.getRoom(room.id))!.nextPlan!;
  await game.planAction(room.id, plan.captains.blue!, { roomId: room.id, kind: 'done', version: plan.version });
  const sealed = (await game.getRoom(room.id))!.nextPlan!;
  assert.equal(sealed.stage, 'sealed');
  const manualCard = sealed.sealedBoard!.find(card => card.anime?.id === work.id);
  assert.ok(manualCard);
  assert.equal(manualCard.wordId, `manual:${manualCandidate.manualId}`);
  assert.equal(manualCard.anime?.source, 'manual');
  // Sealing must not manufacture a Bangumi link for a manual entry.
  assert.equal(JSON.stringify(sealed.sealedBoard).includes('bgm.tv/subject/manual'), false);
  assert.equal(JSON.stringify(sealed.sealedBoard).includes('bgm:-'), false);

  await game.startGame(room.id, host.id);
  const waiting = (await game.getRoom(room.id))!;
  if (waiting.countdown) { waiting.countdown.startsAt = Date.now() - 1; await rooms.setRoom(waiting); await game.tickTimers(); }
  await game.forceEndGame(room.id, host.id, 'abort');
  await game.ensureReplay(room.id);
  const replay = await game.getReplay((await game.getRoom(room.id))!.replayId!);
  assert.ok(replay?.finalBoard.some(card => card.anime?.id === work.id && card.anime.source === 'manual'));
  assert.equal(JSON.stringify(replay).includes('bgm.tv/subject/manual'), false);
  console.log('manual works: upload validation, metadata stripping, ownership, publish/copy durability, mixed draft, manual board ids and replay snapshot passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), root);
  assert.ok(path.basename(resolved).startsWith('cipai-manual-'));
  await rm(resolved, { recursive: true, force: true });
}
