import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { defaultTitle, isTitleUnlocked, unlockedTitles } from '@acg-codenames/shared';
import { JsonUserStore } from '../src/user-store.js';

const root = path.resolve('artifacts');
await mkdirSafe(root);
const directory = await mkdtemp(path.join(root, 'cipai-title-'));
async function mkdirSafe(target: string) { const { mkdir } = await import('node:fs/promises'); await mkdir(target, { recursive: true }); }

try {
  const users = new JsonUserStore(path.join(directory, 'users.json'));
  const login = await users.login('称号验收');
  assert.equal(defaultTitle(login.stats), '新人社员');
  assert.equal(isTitleUnlocked(login.stats, '主场之王'), false);
  await assert.rejects(users.update('称号验收', { title: '百战勇士' }), /尚未解锁/);
  for (let i = 0; i < 5; i += 1) await users.noteRoomHosted('称号验收');
  let account = (await users.get('称号验收'))!;
  assert.ok(isTitleUnlocked(account.stats, '主场之王'));
  account = await users.update('称号验收', { title: '主场之王' });
  assert.equal(account.title, '主场之王');
  assert.equal(defaultTitle(account.stats), '主场之王', 'host title outranks generic attendance when unlocked');
  await assert.rejects(users.update('称号验收', { title: '稳健队长' }), /尚未解锁/);
  const named = { accountType: 'named' as const, username: '称号验收', avatarUrl: null };
  for (let i = 0; i < 20; i += 1) await users.recordRoundResult([{ team: i % 2 ? 'red' : 'blue', profile: named }], 'red');
  account = (await users.get('称号验收'))!;
  assert.equal(account.stats.gamesPlayed, 20);
  account = await users.update('称号验收', { title: '百战勇士' });
  assert.equal(account.title, '百战勇士');
  const titles = unlockedTitles(account.stats).map(entry => entry.title);
  assert.ok(titles.includes('结社常客') && titles.includes('胜场猎手'));
  const reloaded = new JsonUserStore(path.join(directory, 'users.json'));
  assert.equal((await reloaded.get('称号验收'))?.title, '百战勇士');
  console.log('profile titles: server rejects locked titles, persists equipped titles, and host priority is not overwritten by attendance');
} finally {
  await rm(path.resolve(directory), { recursive: true, force: true });
}
