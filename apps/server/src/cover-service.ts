import crypto from 'node:crypto';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename,stat,readdir,unlink} from 'node:fs/promises';
import sharp from 'sharp';

export interface CoverWork {id:number;cover:string}
export interface CachedCover {id:number;source:string;url:string;bytes?:number}
export interface CoverRemote {
 load(work:CoverWork,cachedUrl?:string):Promise<Buffer>;
 publish?(work:CoverWork,data:Buffer):Promise<string>;
 validCdn(url:string):boolean;
 needsPublish?(url:string):boolean;
}
export function coverVersion(source:string){let hash=2166136261;for(const c of source)hash=Math.imul(hash^c.charCodeAt(0),16777619);return String(hash>>>0);}
export function bgmCover(source:string){try{const u=new URL(source);return u.protocol==='https:'&&['lain.bgm.tv','lain.bangumi.tv'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&/^\/(?:r\/\d+\/)?pic\/cover\//.test(u.pathname);}catch{return false;}}
export class CoverUnavailable extends Error {constructor(public reason:'busy'|'cooldown'|'missing'|'upstream'){super(reason);}}
type Job={work:CoverWork;priority:number;resolve:(data:Buffer)=>void;reject:(error:Error)=>void;promise:Promise<Buffer>;running:boolean};

/** Runs in the dedicated cover process, never in the game process. */
export class CoverService {
 private works=new Map<number,CoverWork>();
 private cdn=new Map<string,CachedCover>();
 private memory=new Map<string,Buffer>();private memoryBytes=0;
 private pending=new Map<string,Job>();private queue:Job[]=[];private active=0;
 private failed=new Map<string,number>();private uploads: {work:CoverWork;data:Buffer}[]=[];private uploading=false;
 private saveTimer?:ReturnType<typeof setTimeout>;private lastPrune=0;
 readonly metrics={diskHits:0,memoryHits:0,loads:0,failed:0,busy:0,coalesced:0,published:0,publishFailed:0};
 constructor(private directory:string,private manifestFile:string,private remote:CoverRemote,private options={concurrency:2,maxQueue:32,memoryBytes:8*1024*1024,cooldownMs:15000}){}
 async initialize(works:CoverWork[]){
  this.setCatalog(works);await mkdir(this.directory,{recursive:true});
  try{const data=JSON.parse(await readFile(this.manifestFile,'utf8'));if(data.version===1&&Array.isArray(data.entries))for(const entry of data.entries.slice(0,30000)){if(Number.isSafeInteger(entry.id)&&bgmCover(entry.source)&&this.remote.validCdn(entry.url))this.cdn.set(entry.source,entry);}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Invalid cover manifest');}
 }
 setCatalog(works:CoverWork[]){this.works=new Map(works.filter(w=>Number.isSafeInteger(w.id)&&w.id>0&&bgmCover(w.cover)).map(w=>[w.id,w]));}
 private key(source:string){return crypto.createHash('sha256').update(source).digest('hex');}
 private filename(source:string){return path.join(this.directory,'cover-'+this.key(source)+'.webp');}
 location(id:number){const work=this.works.get(id);if(!work)return undefined;return {id,source:work.cover,version:coverVersion(work.cover),cdn:this.cdn.get(work.cover)?.url};}
 locations(ids:number[]){return ids.map(id=>this.location(id)).filter((v):v is NonNullable<typeof v>=>!!v);}
 stats(){return {...this.metrics,catalog:this.works.size,cdn:this.cdn.size,active:this.active,queued:this.queue.length,pending:this.pending.size,memoryBytes:this.memoryBytes,uploadQueue:this.uploads.length};}
 private remember(source:string,data:Buffer){
  const previous=this.memory.get(source);if(previous){this.memoryBytes-=previous.length;this.memory.delete(source);}
  if(data.length>this.options.memoryBytes)return;
  while(this.memory.size&&(this.memoryBytes+data.length>this.options.memoryBytes||this.memory.size>=256)){const oldest=this.memory.keys().next().value!;this.memoryBytes-=this.memory.get(oldest)!.length;this.memory.delete(oldest);}
  this.memory.set(source,data);this.memoryBytes+=data.length;
 }
 async cover(id:number,version?:string,background=false):Promise<Buffer>{
  const work=this.works.get(id);if(!work||(version!==undefined&&coverVersion(work.cover)!==version))throw new CoverUnavailable('missing');
  const memory=this.memory.get(work.cover);if(memory){this.metrics.memoryHits++;this.memory.delete(work.cover);this.memory.set(work.cover,memory);return memory;}
  // Disk hits bypass both cold-miss admission and the upstream queue.
  try{const data=await readFile(this.filename(work.cover));this.metrics.diskHits++;this.remember(work.cover,data);return data;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const existing=this.pending.get(work.cover);if(existing){this.metrics.coalesced++;if(!background&&!existing.running)existing.priority=0;return existing.promise;}
  if((this.failed.get(work.cover)??0)>Date.now())throw new CoverUnavailable('cooldown');
  if(this.queue.length>=this.options.maxQueue){
   const replace=!background?this.queue.map(j=>j.priority>0).lastIndexOf(true):-1;
   if(replace>=0){const removed=this.queue.splice(replace,1)[0];this.pending.delete(removed.work.cover);removed.reject(new CoverUnavailable('busy'));}
   else{this.metrics.busy++;throw new CoverUnavailable('busy');}
  }
  let resolve!:(data:Buffer)=>void,reject!:(error:Error)=>void;
  const promise=new Promise<Buffer>((yes,no)=>{resolve=yes;reject=no;});
  const job:Job={work,priority:background?1:0,resolve,reject,promise,running:false};
  this.pending.set(work.cover,job);this.queue.push(job);this.pump();return promise;
 }
 warm(ids:number[]){for(const id of ids.slice(0,60))void this.cover(id,undefined,true).catch(()=>{});}
 private pump(){
  while(this.active<this.options.concurrency&&this.queue.length){
   this.queue.sort((a,b)=>a.priority-b.priority);const job=this.queue.shift()!;job.running=true;this.active++;
   void this.load(job).then(job.resolve,job.reject).finally(()=>{this.active--;this.pending.delete(job.work.cover);this.pump();});
  }
 }
 private async load(job:Job){
  this.metrics.loads++;
  try{
   const bytes=await this.remote.load(job.work,this.cdn.get(job.work.cover)?.url);
   const data=await sharp(bytes,{limitInputPixels:20_000_000}).rotate().resize({width:400,withoutEnlargement:true}).webp({quality:80}).toBuffer();
   const filename=this.filename(job.work.cover),temp=filename+'.'+crypto.randomUUID()+'.tmp';
   try{await writeFile(temp,data,{mode:0o600});await rename(temp,filename);}catch(error){await unlink(temp).catch(()=>{});throw error;}
   this.remember(job.work.cover,data);this.failed.delete(job.work.cover);
   if((!this.cdn.has(job.work.cover)||this.remote.needsPublish?.(this.cdn.get(job.work.cover)!.url))&&this.remote.publish&&this.uploads.length<16){this.uploads.push({work:job.work,data});void this.publish();}
   if(Date.now()-this.lastPrune>60000){this.lastPrune=Date.now();void this.prune().catch(()=>{});}
   return data;
  }catch{
   this.metrics.failed++;while(this.failed.size>=1024)this.failed.delete(this.failed.keys().next().value!);
   this.failed.set(job.work.cover,Date.now()+this.options.cooldownMs);throw new CoverUnavailable('upstream');
  }
 }
 private async publish(){
  if(this.uploading||!this.remote.publish)return;this.uploading=true;
  try{while(this.uploads.length){const item=this.uploads.shift()!;try{const url=await this.remote.publish(item.work,item.data);if(!this.remote.validCdn(url))throw new Error('Invalid CDN result');this.cdn.set(item.work.cover,{id:item.work.id,source:item.work.cover,url,bytes:item.data.length});this.metrics.published++;this.saveManifest();}catch{this.metrics.publishFailed++;}}}
  finally{this.uploading=false;}
 }
 private saveManifest(){
  clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{void this.flush().catch(()=>{});},500);this.saveTimer.unref();
 }
 async flush(){const temp=this.manifestFile+'.'+crypto.randomUUID()+'.tmp';await mkdir(path.dirname(this.manifestFile),{recursive:true});try{await writeFile(temp,JSON.stringify({version:1,generatedAt:new Date().toISOString(),entries:[...this.cdn.values()]}),{mode:0o600});await rename(temp,this.manifestFile);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
 private async prune(){
  const names=(await readdir(this.directory)).filter(n=>/^cover-[a-f0-9]{64}\.webp$/.test(n));
  const entries=[];for(const name of names){try{const filename=path.join(this.directory,name),s=await stat(filename);entries.push({filename,bytes:s.size,at:s.mtimeMs});}catch{}}
  let bytes=entries.reduce((n,e)=>n+e.bytes,0);for(const entry of entries.sort((a,b)=>a.at-b.at)){if(bytes<=256*1024*1024)break;await unlink(entry.filename).catch(()=>{});bytes-=entry.bytes;}
 }
}
