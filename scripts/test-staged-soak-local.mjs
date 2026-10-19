import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),seconds=Number(process.env.SOAK_SECONDS??(process.argv.includes('--smoke')?1:10800)),mode=seconds>=10800?'soak':'smoke';
if(!Number.isSafeInteger(seconds)||seconds<1)throw new Error('SOAK_SECONDS must be a positive integer');
const out=path.resolve(process.env.SOAK_OUT??`output/playwright/staged-draft/${mode}-${new Date().toISOString().replaceAll(':','-')}`);await fs.mkdir(out,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cipai-staged-soak-')),children=[];
async function hashes(){const parts={};for(const base of ['apps/server/dist','apps/web/dist','packages/shared/dist']){async function visit(directory){for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await visit(file);else parts[path.relative(root,file)]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}}await visit(path.resolve(base));}return parts;}
function run(args,env={},cwd=root){const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:'inherit',env:{...process.env,...env}});children.push(child);return child;}
async function ready(url){for(let i=0;i<160;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Not ready '+url);}
const dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
if(seconds>=10800&&dirty)throw new Error('A three-hour acceptance requires committed source, not a dirty working tree');
const manifest={sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty,requestedSeconds:seconds,mode,compiled:true,startedAt:new Date().toISOString(),artifacts:await hashes()};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
try{
 run([...(Number(process.versions.node.split('.')[0])>=24?['--use-env-proxy']:[]),'--import',pathToFileURL(path.join(root,'scripts/soak-metrics.mjs')).href,'dist/apps/server/src/index.js'],{PORT:'3194',CLIENT_ORIGIN:'http://127.0.0.1:5394',USE_MEMORY_STORE:'1',REDIS_URL:'',ENABLE_ANIME_DRAFT:'1',ENABLE_MATCH_ANALYSIS:'1',ENABLE_PREDICTIONS:'1',ENABLE_ANIME_COMMUNITY:'1',SOAK_SERVER_METRICS:path.join(out,'server-metrics.jsonl'),USER_STORE_FILE:path.join(temp,'users.json'),ANIME_POOL_STORE_FILE:path.join(temp,'pools.json'),ANIME_IMPORT_FILE:path.join(temp,'imports.json'),MANUAL_WORK_STORE_FILE:path.join(temp,'manual.json'),ANIME_COVER_DIR:path.join(temp,'covers'),REVEAL_IMAGE_DIR:path.join(temp,'images')},path.join(root,'apps/server'));
 run(['scripts/soak-static-proxy.mjs']);await Promise.all([ready('http://127.0.0.1:3194/health'),ready('http://127.0.0.1:5394/')]);
 const test=run(['scripts/browser-staged-soak.mjs'],{SOAK_BASE_URL:'http://127.0.0.1:5394',SOAK_OUT:out,SOAK_SECONDS:String(seconds)});
 const code=await new Promise(r=>test.on('exit',r));if(code!==0)throw new Error('Browser staged soak failed');
 const after=await hashes();if(JSON.stringify(after)!==JSON.stringify(manifest.artifacts))throw new Error('Compiled artifacts changed during soak; run is not a final-version acceptance');
 await fs.writeFile(path.join(out,'artifact-verification.json'),JSON.stringify({passed:true,completedAt:new Date().toISOString(),unchanged:true},null,2));
 console.log(`STAGED_${mode.toUpperCase()}_OUTPUT=${out}`);
}finally{
 for(const p of children)if(p.exitCode===null){if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}else p.kill();}
 await fs.rm(temp,{recursive:true,force:true});
}
