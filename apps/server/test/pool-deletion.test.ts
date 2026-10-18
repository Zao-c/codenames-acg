import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AnimePoolStore } from '../src/anime-pool-store.js';
import { animePoolRouter } from '../src/anime-pools.js';
import { animeCatalog } from '../src/anime-catalog.js';
import { principalFromKey } from '../src/private-identity.js';
import { GameService } from '../src/game.js';
import { createRoomStore } from '../src/store.js';
import type { UserStore } from '../src/types.js';
const root=path.resolve('artifacts');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'delete-pools-'));
const works=animeCatalog(),filename=path.join(dir,'pools.json'),pools=new AnimePoolStore(filename,works);
const keys=['a','b'].map(c=>c.repeat(64)),owner=principalFromKey(keys[0]),other=principalFromKey(keys[1]);
const input={name:'可删除公开作品池',author:'同名作者',description:'删除快照测试',workIds:[...new Map(works.map(w=>[w.seriesId,w])).values()].slice(0,65).map(w=>w.id),isPublic:true};
const app=express();app.use(express.json());app.use('/pools',animePoolRouter(pools,{enabled:true,adminKey:''}));
const server=createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
async function del(id:string,key?:string){return fetch(`${base}/pools/${id}`,{method:'DELETE',headers:key?{'x-private-key':key}:{}});}
try{
 const source=await pools.create(owner,input),copy=await pools.copy(source.id,other),privatePool=await pools.create(owner,{...input,isPublic:false});
 assert.equal((await del(privatePool.id)).status,401);assert.equal((await del(privatePool.id,keys[1])).status,403);
 assert.equal((await del(privatePool.id,keys[0])).status,200);assert.equal((await del(privatePool.id,keys[0])).status,404);
 await pools.favorite(source.id,other,true);await pools.report(source.id,other,'需要保留举报审计');
 const store=await createRoomStore('',true),users={resolveProfile:async()=>({accountType:'guest',username:null,avatarUrl:null}),recordRoundResult:async()=>{}} as unknown as UserStore;
 const game=new GameService(store,users,{enableDebugTools:false,enableAnimeDraft:true,resolveCommunityPool:(id,principal)=>pools.get(id,principal)},store);
 const {room,player}=await game.createRoom('作品池房主',undefined,undefined,owner),players=[player];
 for(const name of ['红队员','蓝队长','蓝队员'])players.push((await game.joinRoom(room.id,name)).player);
 for(let i=0;i<4;i++){await game.setTeam(room.id,players[i].id,i<2?'red':'blue');if(i%2===0)await game.setRole(room.id,players[i].id,'spymaster');}
 const current=async()=>(await game.getRoom(room.id))!;
 const plan=async(i:number,kind:string,extra={})=>game.planAction(room.id,players[i].id,{roomId:room.id,version:(await current()).nextPlan?.version,kind,...extra} as any);
 await plan(0,'configure',{variant:'anime',boardMode:'6x6',communityPoolId:source.id,communityPoolRevision:source.revision});await plan(0,'prepare');for(const i of [0,2])await plan(i,'ready');for(const i of [0,2])await plan(i,'done');
 await game.startGame(room.id,player.id);const r=await current();r.countdown!.startsAt=Date.now()-1;await store.setRoom(r);await game.tickTimers();
 const frozen=JSON.stringify({board:(await current()).board,pool:(await current()).nextPlan!.pool,candidates:(await current()).nextPlan!.candidates});
 assert.equal((await del(source.id,keys[1])).status,403);assert.equal((await del(source.id,keys[0])).status,200);
 assert.equal(JSON.stringify({board:(await current()).board,pool:(await current()).nextPlan!.pool,candidates:(await current()).nextPlan!.candidates}),frozen);
 assert.equal((await pools.list(undefined)).total,0);assert.equal((await pools.list(other,{scope:'favorites'})).total,0);
 assert.equal((await pools.get(copy.id,other)).workCount,65);
 const audit=(await pools.moderation()).find(m=>m.pool.id===source.id)!;assert.equal(audit.pool.deleted,true);assert.equal(audit.reports.length,1);assert.ok(audit.history.some(h=>h.reason.includes('已删除')));assert.ok(!JSON.stringify(audit).includes(owner));
 assert.equal(JSON.parse(await readFile(filename,'utf8')).favorites[other].length,0);
 const board=(await current()).board.map(c=>({id:c.id,word:c.word,role:c.role}));await game.forceEndGame(room.id,player.id);const replayId=await game.ensureReplay(room.id);assert.deepEqual((await game.getReplay(replayId!))!.finalBoard.map(c=>({id:c.id,word:c.word,role:c.role})),board);
 await assert.rejects(plan(0,'configure',{variant:'anime',boardMode:'6x6',communityPoolId:source.id,communityPoolRevision:source.revision}),/不存在/);
 assert.equal((await del(copy.id,keys[0])).status,403);assert.equal((await del(copy.id,keys[1])).status,200);
 // Quota is released durably, including copies. Disabled publication still permits owners to delete.
 for(let n=0;n<50;n++)await pools.create(owner,{...input,isPublic:false,name:`私人${n}`});
 await assert.rejects(pools.create(owner,input),/50/);const first=(await pools.list(owner,{scope:'mine'})).items[0];await pools.delete(first.id,owner);await pools.create(owner,input);assert.equal((await pools.list(owner,{scope:'mine'})).total,50);
 assert.equal((await new AnimePoolStore(filename,works).list(owner,{scope:'mine'})).total,50);assert.equal(animeCatalog().length,works.length);
 await game.disbandRoom(room.id,player.id);
 console.log('pool deletion: 401/403/404, new/private/public/copied ownership, favorites cleanup, audit tombstone, frozen match/replay, durable quota release PASS');
}finally{await new Promise<void>(r=>server.close(()=>r()));assert.equal(path.dirname(path.resolve(dir)),root);await rm(dir,{recursive:true,force:true});}
