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
  assert.equal(saved.wordPackPrivacyVersion,1,'privacy cutover marker is persisted');
  const beforeEdit=(await restarted.get('alice'))!.customWordPacks[0];
  const stale=await restarted.update('alice',{customWordPacks:[{...beforeEdit,isPublic:true,publishedAt:5678}]});
  assert.equal(stale.customWordPacks[0].isPublic,false,'stale editor cannot silently republish');
  const explicit=await restarted.update('alice',{
    customWordPacks:[{...stale.customWordPacks[0],isPublic:true,publishedAt:9999}],
    publishWordPackIds:['old-shared']
  });
  assert.equal(explicit.customWordPacks[0].isPublic,true,'owner explicitly opted in');
  const afterRepublish=new JsonUserStore(filename);
  assert.equal((await afterRepublish.listPublicWordPacks()).length,1,'explicit publication survives restart');
  assert.equal((await readdir(folder)).filter(name=>name.startsWith('users.json.before-wordpack-privacy-')).length,1,'migration only runs once');
  // Valid JSON with an invalid database shape must not be migrated as empty data,
  // especially when a healthy recovery backup still contains the owner's packs.
  const badShapes=[{}, {users:null}, {users:[]}, []];
  for (const [index,shape] of badShapes.entries()) {
    const recoveryFile=path.join(folder,`invalid-shape-${index}.json`);
    await writeFile(recoveryFile,JSON.stringify(shape));
    await writeFile(recoveryFile+'.bak',JSON.stringify({users:{alice:old}}));
    const recovery=new JsonUserStore(recoveryFile);
    assert.deepEqual(await recovery.listPublicWordPacks(),[]);
    assert.deepEqual((await recovery.get('alice'))?.customWordPacks[0].entries,entries,'healthy backup must recover all entries');
    assert.ok(JSON.parse(await readFile(recoveryFile,'utf8')).users.alice);
    assert.ok(JSON.parse(await readFile(recoveryFile+'.bak','utf8')).users.alice,'backup must not be overwritten with empty data');
  }
  const unusableFile=path.join(folder,'both-invalid.json');
  const badPrimary=JSON.stringify({users:null}),badBackup=JSON.stringify({});
  await writeFile(unusableFile,badPrimary);await writeFile(unusableFile+'.bak',badBackup);
  await assert.rejects(new JsonUserStore(unusableFile).listPublicWordPacks(),/账户数据暂不可用/);
  assert.equal(await readFile(unusableFile,'utf8'),badPrimary,'unrecoverable primary stays untouched');
  assert.equal(await readFile(unusableFile+'.bak','utf8'),badBackup,'unrecoverable backup stays untouched');
  const emptyFile=path.join(folder,'valid-empty.json');
  await writeFile(emptyFile,JSON.stringify({users:{}}));
  assert.deepEqual(await new JsonUserStore(emptyFile).listPublicWordPacks(),[],'valid empty database remains supported');
  console.log('Word-pack privacy migration PASS: old URLs revoked, backups, stale-tab guard and explicit opt-in');
} finally {
  await rm(folder,{recursive:true,force:true});
}
