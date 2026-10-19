import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {RoomTransport,applyRoomDelta,type PublicRoomState} from '@acg-codenames/shared';
import {PublicAssets} from '../src/public-assets.js';
import {fetchReplayCover} from '../src/replay-cover.js';
import {ScopedResource} from '../../web/src/lib/resource-cache.js';

const state={id:'room',players:[{id:'a',profile:{avatarUrl:null}}],spectators:[],board:[],messages:[],serverNow:100,
  nextPlan:{id:'plan',version:1,stage:'draft',candidates:Array.from({length:180},(_,id)=>({id,title:'作品'+id,cover:'https://lain.bgm.tv/'+id})),captainView:{claims:{},ready:{red:true,blue:true},done:{red:false,blue:false}}}} as unknown as PublicRoomState;
const tx=new RoomTransport();let current=tx.next(state).snapshot!;
state.nextPlan!.version++;
(state.nextPlan!.captainView!.claims as any)[1]={team:'red',kind:'manual',protectedUntil:5000};
const delta=tx.next(state).delta!;
assert.ok(!('candidates' in delta.plan!.changes),'stable candidate metadata omitted');
assert.ok(!('players' in delta.changes),'stable roster omitted');
assert.ok(JSON.stringify(delta).length<JSON.stringify(state).length/10);
current=applyRoomDelta(current,JSON.parse(JSON.stringify(delta)))!;
assert.equal(current.nextPlan!.captainView!.claims[1].team,'red');
assert.equal(applyRoomDelta(current,delta),null,'duplicate delta rejected');
assert.equal(applyRoomDelta(current,{...delta,roomId:'other'}),null);
assert.equal(applyRoomDelta(current,{...delta,baseRevision:100}),null,'missing base requires full sync');
delete state.nextPlan!.captainView; // captain loses access immediately
const revoke=tx.next(state).delta!;current=applyRoomDelta(current,JSON.parse(JSON.stringify(revoke)))!;
assert.equal(current.nextPlan!.captainView,undefined);
state.nextPlan=undefined;const remove=tx.next(state).delta!;
assert.equal(applyRoomDelta(current,remove)!.nextPlan,undefined);
const resync=tx.next(state,true).snapshot!;assert.equal(resync.id,'room');

const cache=new ScopedResource<number>();let calls=0,resolve!:(value:number)=>void;
const load=()=>{calls++;return new Promise<number>(r=>resolve=r);};
const a=cache.get('alice',load),b=cache.get('alice',load);assert.equal(a,b);assert.equal(calls,1);
const other=cache.get('bob',async()=>7);assert.equal(await other,7);resolve(3);assert.equal(await a,3);
assert.equal(await cache.get('bob',async()=>8),7,'late old identity must not replace cache');
cache.clear();await assert.rejects(cache.get('bob',async()=>{throw new Error('offline');}));
assert.equal(await cache.get('bob',async()=>9),9,'failure retry');

const dir=await mkdtemp(path.join(os.tmpdir(),'cipai-assets-'));
try{
  const png=await sharp({create:{width:32,height:48,channels:3,background:'#49a'}}).png().toBuffer();
  let downloads=0;const fetcher=(async()=>{downloads++;await new Promise(r=>setTimeout(r,20));return new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}});}) as typeof fetch;
  const assets=new PublicAssets(dir,fetcher),source='https://lain.bgm.tv/r/400/pic/cover/l/test.jpg';
  const images=await Promise.all(Array.from({length:12},()=>assets.cover(source)));
  assert.equal(downloads,1,'simultaneous cold misses share one download');
  assert.ok(images.every(b=>b.equals(images[0])));assert.equal((await sharp(images[0]).metadata()).format,'webp');
  const restarted=new PublicAssets(dir,fetcher);await restarted.cover(source);assert.equal(downloads,1,'persistent cache reused after restart');
  const slowFetcher=(async (_url:unknown,init?:RequestInit)=>{
    await new Promise(r=>setTimeout(r,5200));
    init?.signal?.throwIfAborted();
    return new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}});
  }) as typeof fetch;
  const slowSource='https://lain.bgm.tv/r/400/pic/cover/l/slow.jpg';
  const slowResults=await Promise.allSettled([new PublicAssets(dir,slowFetcher).cover(slowSource),fetchReplayCover(slowSource,slowFetcher)]);
  assert.equal(slowResults[0].status,'fulfilled','5.2-second CDN response populates bounded cover cache');
  assert.equal(slowResults[1].status,'rejected','PNG export retains its original 4.5-second deadline');
  await assert.rejects(assets.cover('http://127.0.0.1/secrets'));assert.equal(downloads,1,'arbitrary origin rejected before fetch');
  const data='data:image/png;base64,'+png.toString('base64');
  const input={players:[{profile:{avatarUrl:data}}],messages:[{profile:{avatarUrl:data}}]};
  const wire=assets.wire(input);assert.ok(wire.players[0].profile.avatarUrl.startsWith('/api/profile-avatars/'));
  assert.equal(input.players[0].profile.avatarUrl,data,'original account/room stays unchanged');
  const key=wire.players[0].profile.avatarUrl.split('/').at(-1)!;
  assert.equal((await sharp(await assets.readAvatar(key)).metadata()).format,'webp');
  await assert.rejects(assets.readAvatar('../../etc/passwd'));
}finally{await rm(dir,{recursive:true,force:true});}
console.log('performance: private-view delta/recovery/revocation, identity single-flight, persistent/coalesced cover cache and hashed avatar assets PASS');
