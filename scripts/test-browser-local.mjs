import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'cipai-browser-'));
const children=[];
function run(args,env={}) { const child=spawn(process.execPath,args,{env:{...process.env,...env},stdio:'inherit',windowsHide:true});children.push(child);return child; }
async function ready(url) { for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{} await new Promise(r=>setTimeout(r,250));}throw new Error(`Not ready: ${url}`); }
try {
  run(['node_modules/tsx/dist/cli.mjs','apps/server/src/index.ts'],{PORT:'3022',CLIENT_ORIGIN:'http://127.0.0.1:5177',USE_MEMORY_STORE:'1',ENABLE_DEBUG_TOOLS:'0',ENABLE_ANIME_DRAFT:'1',USER_STORE_FILE:path.join(dir,'users.json'),REVEAL_IMAGE_DIR:path.join(dir,'images')});
  run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5177','--strictPort','apps/web'],{VITE_SERVER_URL:'http://127.0.0.1:3022'});
  await Promise.all([ready('http://127.0.0.1:3022/health'),ready('http://127.0.0.1:5177')]);
  const test=run(['scripts/browser-smoke.mjs'],{PLAYTEST_BASE_URL:'http://127.0.0.1:5177'});
  const code=await new Promise(r=>test.on('exit',r));
  if(code!==0)throw new Error(`Browser checks failed: ${code}`);
} finally {
  for(const child of children)if(child.exitCode===null){
    if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}
    else child.kill();
  }
  await rm(dir,{recursive:true,force:true});
}
