// Started as a hidden, independent OS process so closing a tool session does not end the soak.
// All test accounts and game traffic use isolated backend ports, never production rooms.
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd(),stamp=new Date().toISOString().replace(/[-:]/g,'').slice(0,15);
const run=path.join(root,'output/playwright/cover-delivery',`soak-633ddfd-${stamp}`);
await fs.mkdir(run,{recursive:true});
await fs.writeFile('output/active-cover-soak.json',JSON.stringify({supervisorPid:process.pid,run,launchedAt:new Date().toISOString()},null,2));
const env={...process.env,SOAK_BASE_URL:'http://127.0.0.1:5396',SOAK_SECONDS:'10800',SOAK_OUT:run,COVER_FAULT_PROBE:'1'};
const tunnelLog=createWriteStream(path.join(run,'tunnel.log'));
const tunnel=spawn('ssh',['-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-L','127.0.0.1:5396:127.0.0.1:5396','my-server'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
tunnel.stdout.pipe(tunnelLog);tunnel.stderr.pipe(tunnelLog);
let tunnelExit; tunnel.on('exit',(code,signal)=>{tunnelExit={code,signal};});
let driver;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let ready=false;
 for(let i=0;i<30;i++){
  if(tunnelExit)throw new Error('Test SSH tunnel exited; see tunnel.log');
  try{const r=await fetch(env.SOAK_BASE_URL,{signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}
  await sleep(1000);
 }
 if(!ready)throw new Error('Isolated test proxy is unreachable');
 const log=createWriteStream(path.join(run,'driver.log'));
 driver=spawn(process.execPath,['scripts/browser-staged-soak.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 driver.stdout.pipe(log,{end:false});driver.stderr.pipe(log,{end:false});
 const exited=new Promise(resolve=>driver.once('exit',(code,signal)=>resolve({code,signal})));
 let started;
 for(let i=0;i<120;i++){
  try{started=JSON.parse(await fs.readFile(path.join(run,'started.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(driver.exitCode!==null)throw new Error('Browser driver exited before starting eight contexts');
  await sleep(1000);
 }
 if(!started)throw new Error('Browser driver did not start within two minutes');
 const manifest={frontendSha:'633ddfd1fa2110bc44315f80cf7240d8d22bae99',coverWorkerSha:'c2d0153002f862dc591c26114f8bbc420acc7d87',gameRuntimeSha:'37537ea1d351956c226456ad4c5685509f8e04df',
  webStage:'/opt/codenames-releases/staged-draft-633ddfd1fa21-web',workerStage:'/opt/codenames-releases/cover-c2d0153002f8-review',testRun:'/opt/codenames-test-runs/cover-c2d0153002f8-review',
  requestedSeconds:10800,workerLimits:{cpuQuota:'50%',memoryMax:402653184,nodeHeapMiB:192},isolation:'separate data/accounts/ports; no production test rooms',started};
 await fs.writeFile(path.join(run,'manifest.json'),JSON.stringify(manifest,null,2));
 await fs.copyFile(path.join(run,'manifest.json'),'docs/cover-delivery/soak-manifest.json');
 console.log(JSON.stringify({status:'running',pid:process.pid,driverPid:driver.pid,run,startedAt:started.startedAt}));
 const exit=await exited;log.end();
 await fs.writeFile(path.join(run,'driver-exit.json'),JSON.stringify({...exit,at:new Date().toISOString()},null,2));
 const exists=async filename=>{try{await fs.access(path.join(run,filename));return true;}catch{return false;}};
 if(!await exists('report.json')&&!await exists('failure.json')){
  let last;try{last=JSON.parse(await fs.readFile(path.join(run,'progress.json'),'utf8'));}catch{}
  await fs.writeFile(path.join(run,'failure.json'),JSON.stringify({passed:false,threeHourComplete:false,message:'Driver exited without report: '+JSON.stringify(exit),elapsedSeconds:last?.elapsedSeconds??0,counters:last?.counters??{},errors:[],rounds:[]},null,2));
 }
 const collectorLog=createWriteStream(path.join(run,'collector.log'));
 const collector=spawn(process.execPath,['scripts/finalize-cover-soak.mjs',run],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 collector.stdout.pipe(collectorLog,{end:false});collector.stderr.pipe(collectorLog,{end:false});
 const result=await new Promise(resolve=>collector.once('exit',(code,signal)=>resolve({code,signal})));collectorLog.end();
 await fs.writeFile(path.join(run,'collector-exit.json'),JSON.stringify({...result,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({status:'finished',driver:exit,collector:result,run}));
 if(result.code!==0)process.exitCode=1;
}catch(error){
 await fs.writeFile(path.join(run,'supervisor-failure.json'),JSON.stringify({at:new Date().toISOString(),message:error.stack},null,2));
 console.error(error.message);process.exitCode=1;if(driver&&driver.exitCode===null)driver.kill();
}finally{tunnel.kill();tunnelLog.end();}
