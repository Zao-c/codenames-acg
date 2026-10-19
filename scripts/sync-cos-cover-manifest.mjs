// Read existing public COS objects; no game or AniMatch data is written.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import COS from 'cos-nodejs-sdk-v5';
const argument=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const envFile=argument('--env');if(!envFile)throw new Error('--env is required');
const env=dotenv.parse(await fs.readFile(envFile));
const base=(env.COS_PUBLIC_BASE_URL||`https://${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com`).replace(/\/$/,'');
const resource=argument('--resource')||env.COVER_RESOURCE_FILE,overlay=argument('--imports')||env.COVER_IMPORT_FILE;
const output=argument('--output')||path.join(env.COVER_CACHE_DIR,'manifest.json');
if(!resource||!overlay)throw new Error('Public catalog paths are required');
const read=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8')).works;}catch(e){if(e.code==='ENOENT')return [];throw e;}};
const works=[...new Map([...(await read(resource)),...(await read(overlay))].map(w=>[w.id,w])).values()];
const keys=new Map();
for(const w of works){
 if(!/^https:\/\/lain\.(bgm|bangumi)\.tv\//.test(w.cover))continue;
 const url=new URL(w.cover),paths=new Set([url.pathname]),plain=url.pathname.replace(/^\/r\/\d+\//,'/');
 keys.set(w.id+'/'+crypto.createHash('sha1').update(w.cover).digest('hex').slice(0,12),w);
 for(const size of ['l','c','m','s','g']){const p=plain.replace(/\/cover\/[a-z]\//,'/cover/'+size+'/');for(const pre of ['','/r/400','/r/600'])paths.add(pre+p);}
 for(const host of ['lain.bgm.tv','lain.bangumi.tv'])for(const p of paths){const hash=crypto.createHash('sha1').update('https://'+host+p+url.search).digest('hex').slice(0,12);keys.set(w.id+'/'+hash,w);}
}
const cos=new COS({SecretId:env.COS_SECRET_ID,SecretKey:env.COS_SECRET_KEY,Timeout:5000,ChunkRetryTimes:0});
const prefixes=[...new Set([env.COS_COVER_PREFIX||'animatch/covers',env.CIPAI_COS_PREFIX||'codenames-acg/covers-v1'])];
const matches=new Map();let pages=0,listed=0;
for(const prefix of prefixes){
 if(!/^[a-zA-Z0-9/_-]+$/.test(prefix)||prefix.includes('..'))throw new Error('Invalid cover prefix');let marker='';
 do{
  const result=await cos.getBucket({Bucket:env.COS_BUCKET,Region:env.COS_REGION,Prefix:prefix.replace(/\/$/,'')+'/',MaxKeys:'1000',Marker:marker}).catch(error=>{throw new Error('COS inventory failed: '+String(error.code??error.statusCode??'unknown'));});pages++;
  for(const item of result.Contents||[]){listed++;const m=item.Key.match(/\/bangumi-(\d+)\/([a-f0-9]{12})-[a-f0-9]{12}\.webp$/);if(!m)continue;const w=keys.get(m[1]+'/'+m[2]);if(!w)continue;const old=matches.get(w.id);if(!old||Date.parse(item.LastModified)>Date.parse(old.modified))matches.set(w.id,{id:w.id,source:w.cover,url:base+'/'+item.Key.split('/').map(encodeURIComponent).join('/'),bytes:Number(item.Size),modified:item.LastModified});}
  marker=result.IsTruncated==='true'||result.IsTruncated===true?result.NextMarker||result.Contents.at(-1)?.Key:'';
  if(pages>100)throw new Error('Inventory page limit exceeded');
 }while(marker);
}
await fs.mkdir(path.dirname(output),{recursive:true});const temp=output+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({version:1,generatedAt:new Date().toISOString(),entries:[...matches.values()]}),{mode:0o600});await fs.rename(temp,output);
console.log(JSON.stringify({catalog:works.length,objects:listed,pages,matched:matches.size,manifestBytes:(await fs.stat(output)).size}));
