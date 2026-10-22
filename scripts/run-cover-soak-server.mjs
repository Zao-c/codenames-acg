// Run under a resource-limited systemd unit; SSH or desktop exits cannot end the test.
// Uses the isolated test proxy only. This supervisor never deploys or restarts services.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root=process.cwd(),out=path.join(root,'results');
const template=JSON.parse(await fs.readFile('manifest-template.json','utf8'));
if(process.platform!=='linux'||!root.startsWith('/opt/codenames-test-runs/'))throw new Error('An isolated Linux test directory is required');
if(!/^[a-f0-9]{40}$/.test(template.coverWorkerSha))throw new Error('Verified production artifact manifest required');
await fs.mkdir(out,{recursive:true});
const launchedAt=new Date().toISOString();
const driver=spawn(process.execPath,['scripts/browser-staged-soak.mjs'],{
  cwd:root,stdio:'inherit',env:{...process.env,
    SOAK_BASE_URL:'http://127.0.0.1:5396',SOAK_SECONDS:'10800',SOAK_OUT:out,COVER_FAULT_PROBE:'1'},
});
let exit;
const exited=new Promise((resolve,reject)=>{
  driver.once('error',reject);
  driver.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);});
});
// Attach rejection handling before waiting for browser startup.
exited.catch(()=>{});
try{
  let started;
  for(let n=0;n<180&&!exit;n++){
    try{started=JSON.parse(await fs.readFile(path.join(out,'started.json'),'utf8'));break;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!started)throw new Error('Eight browser contexts did not start within three minutes');
  const manifest={...template,requestedSeconds:10800,started,
    workerLimits:{cpuQuota:'50%',memoryMax:402653184,nodeHeapMiB:192},
    browserLimits:{cpuQuota:'60%',memoryMax:1073741824,memoryHigh:838860800,memorySwapMax:134217728,nice:19},
    isolation:'server-side browser supervisor; separate data/accounts/ports; no production test rooms'};
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({status:'running',pid:process.pid,driverPid:driver.pid,startedAt:started.startedAt}));
  const result=await exited;
  await fs.writeFile(path.join(out,'driver-exit.json'),JSON.stringify({...result,at:new Date().toISOString()},null,2));
  const exists=async filename=>{try{await fs.access(path.join(out,filename));return true;}catch{return false;}};
  if(!await exists('report.json')&&!await exists('failure.json')){
    let last;try{last=JSON.parse(await fs.readFile(path.join(out,'progress.json'),'utf8'));}catch{}
    await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({passed:false,threeHourComplete:false,
      message:'Driver exited without completion report: '+JSON.stringify(result),
      elapsedSeconds:last?.elapsedSeconds??0,counters:last?.counters??{},errors:[],rounds:[]},null,2));
  }
  console.log(JSON.stringify({status:'finished',driver:result}));
  if(result.code!==0)process.exitCode=1;
}catch(error){
  await fs.writeFile(path.join(out,'supervisor-failure.json'),JSON.stringify({launchedAt,at:new Date().toISOString(),message:error.stack},null,2));
  if(driver.exitCode===null)driver.kill();
  console.error(error.stack);process.exitCode=1;
}
