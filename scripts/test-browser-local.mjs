import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const bangumi=process.argv.includes('--bangumi');
const bangumiLive=process.argv.includes('--bangumi-live');
const concentrated=process.argv.includes('--concentrated');
const stability = process.argv.includes('--stability');
const phase2 = process.argv.includes('--phase2');
const lobbyV2 = process.argv.includes('--lobby-v2');
const serverPort = concentrated ? '3073' : bangumiLive ? '3063' : bangumi ? '3062' : stability ? '3052' : lobbyV2 ? '3042' : phase2 ? '3032' : '3022';
const webPort = concentrated ? '5237' : bangumiLive ? '5218' : bangumi ? '5217' : stability ? '5207' : lobbyV2 ? '5197' : phase2 ? '5187' : '5177';
const dir=await mkdtemp(path.join(tmpdir(),'cipai-browser-'));
const children=[];
function run(args,env={}) { const child=spawn(process.execPath,args,{env:{...process.env,...env},stdio:'inherit',windowsHide:true});children.push(child);return child; }
async function ready(url) { for(let i=0;i<100;i++){if(children.some(c=>c.exitCode!==null))throw new Error(`Test service exited before ready: ${url}`);try{if((await fetch(url,{signal:AbortSignal.timeout(2000)})).ok)return;}catch{} await new Promise(r=>setTimeout(r,250));}throw new Error(`Not ready: ${url}`); }
try {
  const adminKey = crypto.randomBytes(32).toString('hex');
  run([...(bangumi?['--import',pathToFileURL(path.resolve('scripts/bangumi-fixture.mjs')).href]:[]),'node_modules/tsx/dist/cli.mjs','apps/server/src/index.ts'],{...(bangumi?{NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --import=${pathToFileURL(path.resolve('scripts/bangumi-fixture.mjs')).href}`} : {}),PORT:serverPort,CLIENT_ORIGIN:`http://127.0.0.1:${webPort}`,USE_MEMORY_STORE:'1',ENABLE_DEBUG_TOOLS:'0',ENABLE_ANIME_DRAFT:'1',ENABLE_MATCH_ANALYSIS:(phase2||stability||bangumi||bangumiLive||concentrated)?'1':'0',ENABLE_PREDICTIONS:(phase2||stability||bangumi||bangumiLive||concentrated)?'1':'0',ENABLE_ANIME_COMMUNITY:(phase2||stability||bangumi||bangumiLive||concentrated)?'1':'0',ANIME_IMPORT_FILE:path.join(dir,'anime-imports.json'),ANIME_POOL_STORE_FILE:path.join(dir,'anime-pools.json'),ANIME_POOL_ADMIN_KEY:adminKey,USER_STORE_FILE:path.join(dir,'users.json'),REVEAL_IMAGE_DIR:path.join(dir,'images')});
  run(['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',webPort,'--strictPort','apps/web'],{VITE_SERVER_URL:`http://127.0.0.1:${serverPort}`});
  await Promise.all([ready(`http://127.0.0.1:${serverPort}/health`),ready(`http://127.0.0.1:${webPort}`)]);
  const test=run([concentrated?'scripts/browser-concentrated.mjs':bangumi?'scripts/browser-bangumi.mjs':bangumiLive?'scripts/browser-bangumi-live.mjs':stability?'scripts/browser-stability.mjs':lobbyV2?'scripts/browser-lobby-v2.mjs':phase2?'scripts/browser-phase2.mjs':'scripts/browser-smoke.mjs'],{PLAYTEST_BASE_URL:`http://127.0.0.1:${webPort}`,PLAYTEST_API_URL:`http://127.0.0.1:${serverPort}`,PLAYTEST_ADMIN_KEY:adminKey});
  const code=await new Promise(r=>test.on('exit',r));
  if(code!==0)throw new Error(`Browser checks failed: ${code}`);
} finally {
  for(const child of children)if(child.exitCode===null){
    if(process.platform==='win32'){const kill=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise(r=>kill.on('exit',r));}
    else child.kill();
  }
  await rm(dir,{recursive:true,force:true});
}
