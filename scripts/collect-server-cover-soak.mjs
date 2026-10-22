// Safe to rerun after a desktop restart. The server browser test runs independently.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const activeFile=process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'output/active-server-cover-soak.json';
const active=JSON.parse(await fs.readFile(activeFile,'utf8'));
const remote=active.remoteRun;
if(!/^\/opt\/codenames-test-runs\/cover-f609fa4-server-\d{8}T\d{6}$/.test(remote))throw new Error('Unexpected isolated test directory');
const local=path.resolve(active.run);
if(!local.startsWith(path.join(root,'output')+path.sep))throw new Error('Local artifacts must stay inside output');
const wait=process.argv.includes('--wait'),deadline=Date.now()+4*3600000;
const probe=String.raw`
import json,pathlib,subprocess
run=pathlib.Path(${JSON.stringify(remote)})
results=run/'results'
read=lambda name: json.loads((results/name).read_text()) if (results/name).exists() else None
status=subprocess.check_output(['systemctl','show',${JSON.stringify(active.unit)},'-p','ActiveState','-p','SubState','-p','Result','-p','MemoryCurrent','-p','MemoryPeak'],text=True).strip()
print(json.dumps({'report':bool(read('report.json')),'failure':bool(read('failure.json')),
 'supervisorFailure':read('supervisor-failure.json'),'manifest':read('manifest.json'),
 'progress':read('progress.json'),'service':status}))
`;
let state;
while(true){
  try{
    state=JSON.parse(execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','my-server','python3','-'],
      {cwd:root,input:probe,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}));
    await fs.mkdir(local,{recursive:true});
    await fs.writeFile(path.join(local,'remote-status.json'),JSON.stringify(state,null,2)+'\n');
    console.log(JSON.stringify({at:new Date().toISOString(),report:state.report,failure:state.failure,
      elapsedSeconds:state.progress?.elapsedSeconds,completedGames:state.progress?.completedGames,service:state.service}));
    if(state.report||state.failure)break;
    if(state.supervisorFailure||!state.service.includes('ActiveState=active'))throw new Error('Remote browser service stopped without a driver report; inspect remote-status.json');
    if(!wait){console.log('Still running; no three-hour completion is claimed.');process.exit(0);}
  }catch(error){
    if(!wait||Date.now()>deadline||state?.supervisorFailure||state&&!state.service.includes('ActiveState=active'))throw error;
    console.error('Status connection failed; server test continues independently: '+error.message);
  }
  if(Date.now()>deadline)throw new Error('Collection deadline exceeded; server artifacts remain available');
  await new Promise(resolve=>setTimeout(resolve,45000));
}
await fs.mkdir(local,{recursive:true});
execFileSync('scp',['-r','-o','BatchMode=yes','-o','ConnectTimeout=15',`my-server:${remote}/results/.`,local],
  {cwd:root,stdio:'inherit',timeout:180000});
execFileSync('scp',['-o','BatchMode=yes','-o','ConnectTimeout=15',`my-server:${remote}/supervisor.log`,path.join(local,'driver.log')],
  {cwd:root,stdio:'inherit',timeout:60000});
if(!state.manifest)throw new Error('No startup manifest; retain diagnostics without claiming acceptance');
execFileSync(process.execPath,['scripts/finalize-cover-soak.mjs',local],{cwd:root,stdio:'inherit',timeout:180000});
