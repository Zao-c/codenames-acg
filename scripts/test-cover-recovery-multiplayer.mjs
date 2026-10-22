// Test the new compiled frontend against the existing isolated game/cover services.
// Never sends test accounts or room actions to production ports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';

const root=process.cwd(),stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
const out=path.resolve('output/playwright/cover-recovery',stamp),children=[];
await fs.mkdir(out,{recursive:true});
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['diff','--','apps/web/src'],{encoding:'utf8'}).trim(),'','commit the tested frontend first');
async function hashes(){
 const result={};async function visit(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);
  else result[path.relative(root,file).replaceAll('\\','/')]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
 }}await visit(path.resolve('apps/web/dist'));return result;
}
const manifest={frontendSha:sha,gameRuntimeSha:'37537ea1d351956c226456ad4c5685509f8e04df',
 coverWorkerSha:'f609fa4b3faa1a459659583f9bb6832b9cf674a9',requestedSeconds:400,
 isolation:'local compiled web; SSH forwards only isolated game port 3195 and image port 3196; separate test room',artifacts:await hashes()};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
function start(file,args,env={}){const child=spawn(file,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,...env}});children.push(child);return child;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(url){for(let n=0;n<80;n++){
 if(children.some(child=>child.exitCode!==null))throw new Error('Test helper exited before startup');
 try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
 await pause(250);
}throw new Error('Test endpoint did not become ready: '+url);}
try{
 start('ssh',['-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30',
  '-L','127.0.0.1:3199:127.0.0.1:3195','-L','127.0.0.1:3200:127.0.0.1:3196','my-server']);
 await Promise.all([ready('http://127.0.0.1:3199/health'),ready('http://127.0.0.1:3200/health')]);
 start(process.execPath,['scripts/soak-static-proxy.mjs'],{SOAK_WEB_PORT:'5397',SOAK_BACKEND_PORT:'3199',SOAK_COVER_PORT:'3200'});
 await ready('http://127.0.0.1:5397/');
 const driver=start(process.execPath,['scripts/browser-staged-soak.mjs'],{SOAK_BASE_URL:'http://127.0.0.1:5397',SOAK_SECONDS:'400',SOAK_OUT:out,COVER_FAULT_PROBE:'1'});
 const code=await new Promise((resolve,reject)=>{driver.once('exit',resolve);driver.once('error',reject);});
 assert.equal(code,0,'eight-browser regression must finish without errors');
 const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
 assert.ok(report.passed);assert.equal(report.browserContexts,8);
 assert.ok(report.rounds.some(round=>round.size==='5x5')&&report.rounds.some(round=>round.size==='6x6'));
 assert.ok(report.coverFaults.some(fault=>fault.allSourcesBlocked&&fault.actualOperativeGuesses>0&&fault.recovered));
 assert.deepEqual(await hashes(),manifest.artifacts,'frontend build must not change during the test');
 await fs.writeFile(path.join(out,'artifact-verification.json'),JSON.stringify({passed:true,frontendSha:sha,unchanged:true},null,2));
 console.log('COVER_RECOVERY_MULTIPLAYER_PASS='+out);
}finally{
 for(const child of children)if(child.exitCode===null){
  if(process.platform==='win32'){
   const stop=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
   await new Promise(resolve=>stop.once('exit',resolve));
  }else child.kill();
 }
}
