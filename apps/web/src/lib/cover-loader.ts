import {ImageRequestQueue} from './image-request-queue';
import type {AnimeWork} from '@acg-codenames/shared';
import {resolveAnimeAssetUrl} from './api';
type Work=Pick<AnimeWork,'id'|'cover'>;
type Location={id:number;source:string;version:string;cdn?:string};
const abortError=()=>new DOMException('Aborted','AbortError');
export function coverVersion(source:string){let hash=2166136261;for(const c of source)hash=Math.imul(hash^c.charCodeAt(0),16777619);return String(hash>>>0);}
const isBgm=(source:string)=>/^https:\/\/lain\.(bgm|bangumi)\.tv\//.test(source);
const metadata=new Map<number,{value:Location;expires:number}>(),waiting=new Map<number,((value?:Location)=>void)[]>();
let metadataTimer:ReturnType<typeof setTimeout>|undefined,metadataUnavailableUntil=0,metadataReading=false;
function coverLocation(work:Work):Promise<Location|undefined>{
 if(!isBgm(work.cover)||Date.now()<metadataUnavailableUntil)return Promise.resolve(undefined);
 const cached=metadata.get(work.id);if(cached&&cached.expires>Date.now()&&cached.value.source===work.cover)return Promise.resolve(cached.value);
 if(waiting.size>=256&&!waiting.has(work.id))return Promise.resolve(undefined);
 return new Promise(resolve=>{const callbacks=waiting.get(work.id)??[];callbacks.push(value=>resolve(value?.source===work.cover?value:undefined));waiting.set(work.id,callbacks);if(!metadataTimer&&!metadataReading)metadataTimer=setTimeout(()=>{metadataTimer=undefined;void readLocations();},15);});
}
async function readLocations(){
 if(metadataReading||!waiting.size)return;metadataReading=true;
 const ids=[...waiting.keys()].slice(0,60),callbacks=ids.map(id=>({id,callbacks:waiting.get(id)!}));ids.forEach(id=>waiting.delete(id));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),350);let entries:Location[]=[];
 try{
  const response=await fetch(resolveAnimeAssetUrl('/api/anime/cover-locations?ids='+ids.sort((a,b)=>a-b).join(',')),{signal:controller.signal,credentials:'omit',cache:'default'});
  if(!response.ok){if(response.status===404)metadataUnavailableUntil=Date.now()+60000;throw new Error('No cover service');}
  const body=await response.json();entries=Array.isArray(body.works)?body.works:[];
  for(const value of entries)if(Number.isSafeInteger(value.id)&&typeof value.source==='string'&&isBgm(value.source)&&value.version===coverVersion(value.source)&&(!value.cdn||/^https:\/\//.test(value.cdn))){while(metadata.size>=512)metadata.delete(metadata.keys().next().value!);metadata.set(value.id,{value,expires:Date.now()+(value.cdn?3600000:2000)});}
 }catch{}finally{clearTimeout(timer);metadataReading=false;for(const item of callbacks)item.callbacks.forEach(done=>done(entries.find(value=>value.id===item.id)));if(waiting.size&&!metadataTimer)metadataTimer=setTimeout(()=>{metadataTimer=undefined;void readLocations();},15);}
}

const requests=new ImageRequestQueue();
const resolved=new Map<string,string>(),bad=new Map<string,number>();
const flights=new Map<string,{promise:Promise<string>;controller:AbortController;users:number}>();
function remember(key:string,source:string){while(resolved.size>=256)resolved.delete(resolved.keys().next().value!);resolved.set(key,source);}
async function delay(ms:number,signal:AbortSignal){if(!ms)return;await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(abortError());};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});}
async function runCover(work:Work,signal:AbortSignal,priority:number){
 const value=await coverLocation(work);signal.throwIfAborted();
 const direct=resolveAnimeAssetUrl(work.cover),local=isBgm(work.cover)?resolveAnimeAssetUrl(`/api/anime/cover/${work.id}?v=${coverVersion(work.cover)}`):undefined;
 const candidates=value?.cdn?[{source:value.cdn,delay:0,timeout:3000},{source:direct,delay:700,timeout:4500},...(local?[{source:local,delay:1100,timeout:2000}]:[])]:[{source:direct,delay:0,timeout:4500},...(local?[{source:local,delay:700,timeout:2000}]:[])];
 const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),6500),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
 const attempt=async(candidate:typeof candidates[number])=>{
  await delay(candidate.delay,controller.signal);controller.signal.throwIfAborted();
  if((bad.get(candidate.source)??0)>Date.now())throw new Error('Source cooling down');
  try{return await requests.load(candidate.source,controller.signal,priority,candidate.timeout);}
  catch(error){if(!controller.signal.aborted){while(bad.size>=512)bad.delete(bad.keys().next().value!);bad.set(candidate.source,Date.now()+10000);}throw error;}
 };
 try{return await Promise.any(candidates.map(attempt));}
 finally{clearTimeout(deadline);controller.abort();signal.removeEventListener('abort',abort);}
}
export function loadedCoverSource(work:Work){return resolved.get(work.id+'|'+work.cover);}
export async function loadCover(work:Work,signal:AbortSignal,priority=0):Promise<string>{
 if(signal.aborted)throw abortError();const key=work.id+'|'+work.cover,cached=resolved.get(key);if(cached)return cached;
 let flight=flights.get(key);
 if(!flight){if(flights.size>=192)throw new Error('Cover queue full');const controller=new AbortController(),promise=runCover(work,controller.signal,priority);flight={controller,promise,users:0};flights.set(key,flight);promise.then(source=>{remember(key,source);flights.delete(key);},()=>flights.delete(key));}
 const current=flight;current.users++;
 try{return await new Promise<string>((resolve,reject)=>{const abort=()=>reject(abortError());signal.addEventListener('abort',abort,{once:true});current.promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}
 finally{if(--current.users===0)current.controller.abort();}
}
export function forgetCover(work:Work){resolved.delete(work.id+'|'+work.cover);bad.delete(resolveAnimeAssetUrl(work.cover));}
export function coverLoaderStats(){return {...requests.stats(),resolved:resolved.size,inFlight:flights.size};}
