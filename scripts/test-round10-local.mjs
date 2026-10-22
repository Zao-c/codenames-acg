import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const codeRoot=process.env.PLAYTEST_CODE_ROOT??process.cwd(),children=[];
const temp=await mkdtemp(path.join(tmpdir(),'cipai-round10-'));
function run(args,env={},cwd=codeRoot){const p=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:'inherit',env:{...process.env,...env}});children.push(p);return p;}
async function ready(url){for(let i=0;i<160;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('not ready '+url);}
try{
const {works}=JSON.parse(await readFile(path.join(codeRoot,'apps/server/resources/anime-catalog.json'),'utf8'));
await writeFile(path.join(temp,'imports.json'),JSON.stringify({schemaVersion:1,works:Array.from({length:5000},(_,i)=>({...works[i%works.length],id:900000+i,title:'大目录'+i,fullTitle:'大目录'+i,seriesId:'fixture:'+i,source:'bangumi'}))}));
run(['--use-env-proxy','node_modules/tsx/dist/cli.mjs','apps/server/src/index.ts'],{PORT:'3193',CLIENT_ORIGIN:'http://127.0.0.1:5348',USE_MEMORY_STORE:'1',ENABLE_ANIME_DRAFT:'1',ENABLE_MATCH_ANALYSIS:'1',ENABLE_PREDICTIONS:'1',ENABLE_ANIME_COMMUNITY:'1',USER_STORE_FILE:path.join(temp,'users.json'),ANIME_POOL_STORE_FILE:path.join(temp,'pools.json'),ANIME_IMPORT_FILE:path.join(temp,'imports.json'),MANUAL_WORK_STORE_FILE:path.join(temp,'manual.json'),ANIME_COVER_DIR:path.join(temp,'covers'),REVEAL_IMAGE_DIR:path.join(temp,'images')});
run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5348','--strictPort','apps/web'],{VITE_DEFAULT_STAGED_DRAFT:'0',VITE_SERVER_URL:'http://127.0.0.1:3193'});
await Promise.all([ready('http://127.0.0.1:3193/health'),ready('http://127.0.0.1:5348')]);
const test=run([path.resolve('scripts/browser-round10.mjs')],{PLAYTEST_BASE_URL:'http://127.0.0.1:5348',PLAYTEST_API_URL:'http://127.0.0.1:3193'},process.cwd());
if(await new Promise(r=>test.on('exit',r))!==0)throw new Error('Round10 browser failed');
}finally{for(const p of children)if(p.exitCode===null){if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}else p.kill();}await rm(temp,{recursive:true,force:true});}
