import crypto from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import {ProxyAgent,type Dispatcher} from 'undici';
import {bgmCover,type CoverRemote,type CoverWork} from './cover-service.js';

interface CosConfig {secretId:string;secretKey:string;bucket:string;region:string;publicBase:string;prefix:string;allowedPrefixes:string[]}
export function cosConfiguration(env:NodeJS.ProcessEnv):CosConfig|undefined{
 const secretId=env.COS_SECRET_ID?.trim(),secretKey=env.COS_SECRET_KEY?.trim(),bucket=env.COS_BUCKET?.trim(),region=env.COS_REGION?.trim();
 if(!secretId||!secretKey||!bucket||!region)return;
 if(!/^[a-z0-9-]+-\d+$/.test(bucket)||!/^ap-[a-z0-9-]+$/.test(region))throw new Error('Invalid COS bucket or region');
 const publicBase=(env.COS_PUBLIC_BASE_URL||`https://${bucket}.cos.${region}.myqcloud.com`).replace(/\/+$/,'');
 const url=new URL(publicBase);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw new Error('Invalid public cover origin');
 const prefix=(env.CIPAI_COS_PREFIX||'codenames-acg/covers-v1').replace(/^\/+|\/+$/g,'');
 const allowedPrefixes=[prefix,env.COS_COVER_PREFIX||'animatch/covers'];
 if(allowedPrefixes.some(p=>!p||p.includes('..')||!/^[a-zA-Z0-9/_-]+$/.test(p)))throw new Error('Invalid cover prefix');
 return {secretId,secretKey,bucket,region,publicBase,prefix,allowedPrefixes};
}
async function imageBytes(response:Response,signal:AbortSignal){
 const type=response.headers.get('content-type')?.split(';')[0];
 if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type??'')||!response.body)throw new Error('Image unavailable');
 if(Number(response.headers.get('content-length'))>2*1024*1024){await response.body.cancel();throw new Error('Image too large');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new Error('Image too large');parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts);
}
export class CoverUpstreams implements CoverRemote {
 private cos?:COS;private proxy?:Dispatcher;private badCdn=new Set<string>();
 constructor(private config?:CosConfig,proxyUrl?:string,private fetcher:typeof fetch=fetch){
  if(config)this.cos=new COS({SecretId:config.secretId,SecretKey:config.secretKey,Timeout:3500,ChunkRetryTimes:0,FileParallelLimit:1,ChunkParallelLimit:1,FollowRedirect:false});
  // Two cold jobs can each hedge an original and a resized image; a stalled
  // resizer must not occupy both proxy connections ahead of its own fallback.
  if(proxyUrl)this.proxy=new ProxyAgent({uri:proxyUrl,connections:4,pipelining:1,connect:{timeout:2000}});
 }
 validCdn(source:string){
  if(!this.config)return false;
  try{const u=new URL(source),base=new URL(this.config.publicBase);return u.origin===base.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&this.config.allowedPrefixes.some(p=>u.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'+p+'/'));}catch{return false;}
 }
 needsPublish(url:string){return this.badCdn.has(url);}
 private async download(source:string,signal:AbortSignal,proxy=false){
  const options:RequestInit&{dispatcher?:Dispatcher}={redirect:'error',signal,headers:{'User-Agent':'Cipai-Cover/2.0'}};
  if(proxy)options.dispatcher=this.proxy;
  const response=await this.fetcher(source,options);return imageBytes(response,signal);
 }
 async load(work:CoverWork,cachedUrl?:string){
  if(!bgmCover(work.cover))throw new Error('Invalid original cover');
  if(cachedUrl&&this.validCdn(cachedUrl)&&!this.badCdn.has(cachedUrl)){
   try{return await this.download(cachedUrl,AbortSignal.timeout(1500));}catch{if(this.badCdn.size>=512)this.badCdn.delete(this.badCdn.values().next().value!);this.badCdn.add(cachedUrl);}
  }
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6500);
  const attempt=async(source:string,delay:number,proxy=false)=>{
   if(delay)await new Promise<void>((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve();},delay);if(controller.signal.aborted)stop();else controller.signal.addEventListener('abort',stop,{once:true});});
   controller.signal.throwIfAborted();return this.download(source,AbortSignal.any([controller.signal,AbortSignal.timeout(proxy?3500:4000)]),proxy);
  };
  // Bangumi's /r/<size>/ service can fail while the original is healthy. Keep
  // the exact filename/fingerprint, bypass only resizing, and resize locally.
  const original=new URL(work.cover);original.pathname=original.pathname.replace(/^\/r\/\d+\/pic\/cover\//,'/pic/cover/');
  const different=original.href!==work.cover;
  const alternate=new URL(original);alternate.hostname=alternate.hostname==='lain.bgm.tv'?'lain.bangumi.tv':'lain.bgm.tv';
  try{return await Promise.any([attempt(work.cover,0),...(different?[attempt(original.href,350)]:[]),attempt(alternate.href,750),...(this.proxy?[attempt(original.href,0,true),...(different?[attempt(work.cover,1000,true)]:[])]:[])]);}
  finally{clearTimeout(timeout);controller.abort();}
 }
 async publish(work:CoverWork,data:Buffer){
  if(!this.cos||!this.config)throw new Error('COS not configured');
  const sourceHash=crypto.createHash('sha1').update(work.cover).digest('hex').slice(0,12),contentHash=crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
  const key=`${this.config.prefix}/bangumi-${work.id}/${sourceHash}-${contentHash}.webp`;
  await this.cos.putObject({Bucket:this.config.bucket,Region:this.config.region,Key:key,Body:data,ContentType:'image/webp',CacheControl:'public, max-age=31536000, immutable',ACL:'public-read'});
  return this.config.publicBase+'/'+key;
 }
}
