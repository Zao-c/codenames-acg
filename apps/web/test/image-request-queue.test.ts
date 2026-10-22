import assert from 'node:assert/strict';
import {ImageRequestQueue} from '../src/lib/image-request-queue';
const started:string[]=[],live=new Map<string,FakeImage>();
class FakeImage {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;naturalWidth=10;referrerPolicy='';decoding='';fetchPriority='';private value='';set src(value:string){this.value=value;if(value){started.push(value);live.set(value,this);}}get src(){return this.value;}}
const requests=new ImageRequestQueue(()=>new FakeImage() as unknown as HTMLImageElement,{bgm:2,remote:2,local:1});
const signals=Array.from({length:8},()=>new AbortController());
const a=requests.load('/api/a',signals[0].signal,1,5000),b=requests.load('/api/b',signals[1].signal,1,5000);
const c=requests.load('/api/c',signals[2].signal,0,5000);
assert.deepEqual(started,['/api/a']);live.get('/api/a')!.onload!();await a;assert.deepEqual(started,['/api/a','/api/c'],'visible request bypasses queued prefetch');
live.get('/api/c')!.onload!();await c;live.get('/api/b')!.onload!();await b;
const cancelled=requests.load('/api/cancel',signals[3].signal,0,5000);signals[3].abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(requests.stats().active.local,0);
const hold=requests.load('/api/hold',signals[4].signal,0,5000),queued=requests.load('/api/queued',signals[5].signal,0,5000);signals[5].abort();await assert.rejects(queued,{name:'AbortError'});assert.equal(started.includes('/api/queued'),false,'cancelled offscreen work never starts a request');live.get('/api/hold')!.onload!();await hold;
const r1=requests.load('https://lain.bgm.tv/one',signals[6].signal,0,5000),r2=requests.load('https://lain.bgm.tv/two',signals[7].signal,0,5000);
assert.equal(requests.stats().active.bgm,2);assert.equal(requests.stats().maxLocal,1);signals[6].abort();signals[7].abort();await Promise.allSettled([r1,r2]);
assert.deepEqual(requests.stats().active,{bgm:0,remote:0,local:0});assert.equal(requests.stats().queued,0);
console.log('Image request queue PASS: connection budget, visible priority, queued and active cancellation, no slot leaks');
