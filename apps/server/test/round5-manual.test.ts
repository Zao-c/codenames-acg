import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { animeCatalog, animeCatalogFor, registerManualCatalog } from '../src/anime-catalog.js';
import { AnimePoolStore } from '../src/anime-pool-store.js';
import { ManualWorkStore } from '../src/manual-works.js';
import { manualCoverRouter, manualWorkRouter } from '../src/manual-works-api.js';
import { principalFromKey } from '../src/private-identity.js';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      raw[offset] = rgb[0]; raw[offset + 1] = rgb[1]; raw[offset + 2] = rgb[2]; raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (buffer: Buffer, mime = 'image/png') => `data:${mime};base64,${buffer.toString('base64')}`;

const root = path.resolve('artifacts');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, 'cipai-round5-manual-'));
const manual = new ManualWorkStore(path.join(directory, 'manual.json'), path.join(directory, 'covers'));
await manual.initialize();
registerManualCatalog((principal, extraIds) => manual.worksForSync(principal, extraIds));
const pools = new AnimePoolStore(path.join(directory, 'pools.json'), (principal?: string) => animeCatalogFor(principal), {
  canUseWork: (principal, id, allowExisting) => manual.canUseSync(principal, id, allowExisting),
  onPublicationChange: ids => manual.syncPublication(ids),
});
const ownerKey = 'e'.repeat(64), otherKey = 'f'.repeat(64);
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
  return { status: response.status, body: type.includes('json') ? await response.json() : await response.arrayBuffer() };
}
async function coverExists(cover: string): Promise<number> {
  const response = await fetch(`${base}/covers/${cover.split('/').pop()}`);
  return response.status;
}

try {
  // Cover history: updates/removal/soft delete keep old replay URLs readable.
  const created = await request('/manual', 'POST', { title: '封面历史验收', coverDataUrl: dataUrl(png(240, 320, [40, 90, 160])) });
  assert.equal(created.status, 201);
  const work = created.body;
  const firstCover = work.cover;
  assert.equal(await coverExists(firstCover), 200);
  const updated = await request(`/manual/${work.id}`, 'PUT', { title: '封面历史验收', coverDataUrl: dataUrl(png(300, 400, [160, 60, 90])), expectedUpdatedAt: work.updatedAt });
  assert.equal(updated.status, 200);
  const secondCover = updated.body.cover;
  assert.notEqual(firstCover, secondCover);
  assert.equal(await coverExists(firstCover), 200, 'previous cover must survive for old replays');
  assert.equal(await coverExists(secondCover), 200);
  const removedCover = await request(`/manual/${work.id}`, 'PUT', { removeCover: true, expectedUpdatedAt: updated.body.updatedAt });
  assert.equal(removedCover.status, 200);
  assert.equal(removedCover.body.cover, '');
  assert.equal(await coverExists(firstCover), 200);
  assert.equal(await coverExists(secondCover), 200);
  await request(`/manual/${work.id}`, 'DELETE');
  assert.equal(await coverExists(secondCover), 200, 'soft-deleted work keeps historical covers');

  // Real decoding rejects truncated/corrupt bodies that have a valid magic header.
  const validPng = png(240, 320, [60, 120, 70]);
  const truncatedPng = validPng.subarray(0, Math.floor(validPng.length * 0.6));
  const pngResponse = await request('/manual', 'POST', { title: '截断 PNG', coverDataUrl: dataUrl(truncatedPng) });
  assert.equal(pngResponse.status, 400);
  assert.match(pngResponse.body.message, /损坏|解码|重编码/);
  const validJpeg = await sharp(validPng).jpeg().toBuffer();
  const truncatedJpeg = validJpeg.subarray(0, Math.floor(validJpeg.length * 0.55));
  const jpegResponse = await request('/manual', 'POST', { title: '截断 JPEG', coverDataUrl: dataUrl(truncatedJpeg, 'image/jpeg') });
  assert.equal(jpegResponse.status, 400);
  const goodJpeg = await request('/manual', 'POST', { title: '正常 JPEG', coverDataUrl: dataUrl(validJpeg, 'image/jpeg') });
  assert.equal(goodJpeg.status, 201);
  assert.ok((await coverExists(goodJpeg.body.cover)) === 200);

  // Concurrent two-tab update: exactly one wins, the other gets 409.
  const concurrent = await request('/manual', 'POST', { title: '并发编辑验收' });
  assert.equal(concurrent.status, 201);
  const expected = concurrent.body.updatedAt;
  const results = await Promise.allSettled([
    manual.update(owner, concurrent.body.id, { title: '标签页 A', expectedUpdatedAt: expected }),
    manual.update(owner, concurrent.body.id, { title: '标签页 B', expectedUpdatedAt: expected }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.match(String(rejected.reason?.message), /已被更新/);

  // Pagination: 30 works => 24 + 6, and the search API honours offset.
  for (let i = 0; i < 30; i += 1) await manual.create(owner, { title: `分页验收 ${String(i).padStart(2, '0')}` });
  const page1 = await request('/manual?scope=mine&page=1');
  assert.equal(page1.body.items.length, 24);
  assert.equal(page1.body.total, 32);
  assert.equal(page1.body.nextOffset, 24);
  const page2 = await request('/manual?scope=mine&page=2');
  assert.equal(page2.body.items.length, 8);
  assert.equal(page2.body.nextOffset, null);
  assert.equal(page1.body.items.some(item => page2.body.items.some(other => other.id === item.id)), false);

  // Publication is current discoverability; copies keep legal access after retraction.
  const publishedWork = (await request('/manual', 'POST', { title: '公开撤回验收' })).body;
  const series = [...new Map(animeCatalog().map(item => [item.seriesId, item])).values()].slice(0, 24).map(item => item.id);
  const pool = await pools.create(owner, { name: '公开撤回池', description: '', author: '测试', workIds: [...series, publishedWork.id], isPublic: true });
  assert.ok(manual.worksForSync(undefined).some(item => item.id === publishedWork.id), 'public pool makes the manual work discoverable');
  const copy = await pools.copy(pool.id, other);
  await pools.update(pool.id, owner, { ...pool, name: '转私人池', description: '', author: '测试', workIds: pool.workIds, isPublic: false, expectedRevision: pool.revision });
  assert.equal(manual.worksForSync(undefined).some(item => item.id === publishedWork.id), false, 'private pool retracts public discovery');
  assert.equal(animeCatalogFor(undefined).some(item => item.id === publishedWork.id), false, 'anonymous catalog no longer advertises a retracted work');
  assert.ok(animeCatalogFor(other, await pools.workIdsForPrincipal(other)).some(item => item.id === publishedWork.id), 'the copier catalog still resolves its legitimate copy');
  assert.equal((await manual.listPublished('')).items.some(item => item.id === publishedWork.id), false);
  assert.equal(copy.isPublic, false);
  // The copy can still keep the retracted work in its list, but cannot be used for new discovery until published.
  const copyDetail = await pools.get(copy.id, other);
  const keptCopy = await pools.update(copy.id, other, { ...copyDetail, author: '测试', expectedRevision: copyDetail.revision, workIds: copy.workIds, isPublic: false });
  assert.ok(keptCopy.workIds.includes(publishedWork.id));
  assert.equal((await manual.worksForSync(other)).some(item => item.id === publishedWork.id), false, 'retracted work is not in the new-visitor catalog');
  assert.ok((await manual.resolveIds([publishedWork.id])).length === 1, 'existing snapshots can still resolve it');

  // Shared reference semantics: metadata updates propagate to copied lists.
  const renamed = await request(`/manual/${publishedWork.id}`, 'PUT', { title: '公开撤回验收 · 改名', expectedUpdatedAt: publishedWork.updatedAt });
  assert.equal(renamed.status, 200);
  assert.equal((await manual.resolveIds([publishedWork.id]))[0].title, '公开撤回验收 · 改名');
  console.log('round5 manual: cover history, real decode rejection, atomic edit, pagination, publication retraction and shared references passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
