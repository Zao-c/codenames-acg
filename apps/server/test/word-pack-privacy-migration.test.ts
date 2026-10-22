import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {JsonUserStore} from '../src/user-store.js';

// Regression: revoking historical public word packs must affect both the in-memory
// public API and the persisted database, without losing any private entries.
const folder=await mkdtemp(path.join(tmpdir(),'cipai-private-words-'));
try {
  const filename=path.join(folder,'users.json');
  const entries=Array.from({length:60},(_,i)=>'private-example-'+i);
  const old={
    username:'alice',avatarUrl:null,
    customWordPacks:[{
      id:'old-shared',name:'历史公开题库',entries,description:'owner notes',
      isPublic:true,publishedAt:1234,createdAt:1000,updatedAt:2000
    }],
    customImagePacks:[],
    stats:{gamesPlayed:0,wins:0,losses:0,roomsHosted:0},
    createdAt:1000,updatedAt:2000
  };
  await writeFile(filename,JSON.stringify({users:{alice:old}}));
  const users=new JsonUserStore(filename);
  const [list,pack]=await Promise.all([
    users.listPublicWordPacks(),
    users.getPublicWordPackByPublicId('alice:old-shared')
  ]);
  assert.deepEqual(list,[]);
  assert.equal(pack,null,'old public detail links stop serving words immediately');
  const account=await users.get('alice');
  assert.ok(account);
  assert.equal(account.customWordPacks.length,1);
  assert.equal(account.customWordPacks[0].isPublic,false);
  assert.equal(account.customWordPacks[0].publishedAt,undefined);
  assert.deepEqual(account.customWordPacks[0].entries,entries);
  const saved=JSON.parse(await readFile(filename,'utf8'));
  assert.equal(saved.users.alice.customWordPacks[0].isPublic,false);
  assert.equal(saved.users.alice.customWordPacks[0].publishedAt,undefined);
  const backups=(await readdir(folder)).filter(name=>name.startsWith('users.json.before-wordpack-privacy-'));
  assert.equal(backups.length,1,'existing public data is backed up before migration');
  const original=JSON.parse(await readFile(path.join(folder,backups[0]),'utf8'));
  assert.equal(original.users.alice.customWordPacks[0].isPublic,true);
  const restarted=new JsonUserStore(filename);
  assert.deepEqual(await restarted.listPublicWordPacks(),[]);
  assert.equal((await restarted.get('alice'))?.customWordPacks[0].isPublic,false);
  console.log('Word-pack privacy migration PASS: public URLs revoked, entries preserved, durable migration and backup');
} finally {
  await rm(folder,{recursive:true,force:true});
}
