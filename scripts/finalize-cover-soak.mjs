// Collect an already-running isolated soak. Never deploys or restarts a service.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const root=process.cwd(),run=path.resolve(process.argv[2]??'output/playwright/cover-delivery/soak-633ddfd');
assert.ok(run.startsWith(path.join(root,'output')+path.sep));
const docs=path.join(root,'docs/cover-delivery'),manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=async name=>{try{return JSON.parse(await fs.readFile(path.join(run,name),'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}};
const command=(file,args,options={})=>execFileSync(file,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,...options}).trim();
async function retryCommand(file,args,options={}){
 for(let attempt=0;attempt<3;attempt++){
  try{return command(file,args,options);}catch(error){if(attempt===2)throw error;await sleep(5000);}
 }
}
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
const jsonl=async name=>(await fs.readFile(path.join(run,name),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
let report,failure;
const deadline=Date.now()+4*3600000;
while(!(report=await read('report.json'))&&!(failure=await read('failure.json'))){
 if(Date.now()>deadline)throw new Error('Collector deadline exceeded; no completion is claimed');
 await sleep(30000);
}
await fs.mkdir(docs,{recursive:true});
await fs.copyFile(path.join(run,report?'report.json':'failure.json'),path.join(docs,report?'three-hour-report.json':'three-hour-failure.json'));
const start=Date.parse(manifest.started.startedAt),elapsed=(report??failure).elapsedSeconds;
const attemptDocs=path.join(docs,'attempts',new Date(start).toISOString().replace(/[-:]/g,'').slice(0,15));
await fs.mkdir(attemptDocs,{recursive:true});
await fs.copyFile(path.join(run,report?'report.json':'failure.json'),path.join(attemptDocs,report?'report.json':'failure.json'));
await fs.writeFile(path.join(attemptDocs,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const auditCode=String.raw`
import json,pathlib,subprocess,hashlib,time
m=json.loads(${JSON.stringify(JSON.stringify(manifest))})
start=${start}; end=${start}+${elapsed}*1000
def output(args): return subprocess.check_output(args,text=True).strip()
def verify(base,filename,prefix=None):
    checked=0
    for line in pathlib.Path(filename).read_text().splitlines():
        digest,relative=line.split(None,1);relative=relative.lstrip('*')
        if prefix and not relative.startswith(prefix): continue
        target=pathlib.Path(base,relative)
        assert target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==digest,relative
        checked+=1
    assert checked>0
    return checked
def metrics(filename):
    records=[]
    for line in pathlib.Path(filename).read_text().splitlines():
        r=json.loads(line)
        if start<=r['at']<=end: records.append(r)
    assert len(records)>0
    def q(key,p):
        values=sorted(r[key] for r in records);return values[min(len(values)-1,int(len(values)*p))]
    return {'samples':len(records),'first':records[0],'last':records[-1],
        'maxRssBytes':max(r['memory']['rss'] for r in records),'maxHeapBytes':max(r['memory']['heapUsed'] for r in records),
        'loopP99Ms':{'median':q('loopP99Ms',.5),'p95':q('loopP99Ms',.95),'max':q('loopP99Ms',1)},
        'maxLoopPauseMs':max(r['loopMaxMs'] for r in records)}
repo='/opt/codenames-acg'; web=m['webStage']; worker=m['workerStage']
audit={'atUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'verification':{},'services':{}}
audit['verification']['webStageFiles']=verify(web,pathlib.Path(web,'ARTIFACT_SHA256'))
audit['verification']['workerStageFiles']=verify(worker,pathlib.Path(worker,'ARTIFACT_SHA256'))
audit['verification']['productionWebFiles']=verify(repo,pathlib.Path(web,'ARTIFACT_SHA256'),'apps/web/dist/')
audit['verification']['productionGameFiles']=verify(repo,pathlib.Path(web,'RUNTIME_SHA256'))
release=json.loads(pathlib.Path(repo,'release.json').read_text())
assert release['frontendSha']==m['frontendSha']
assert release['coverWorkerSha']==m['coverWorkerSha']
assert release['serverRuntimeSha']==m['gameRuntimeSha']
audit['release']=release
for name,expected_cwd,expected_pid in [('codenames.service',repo+'/apps/server',m.get('productionGamePid',2886573)),('codenames-covers.service',worker+'/apps/server',m.get('productionWorkerPid',3246246)),(m.get('testCoverService','cipai-cover-soak-c2d0153.service'),worker+'/apps/server',m.get('testWorkerPid',3250571))]:
    props=dict(line.split('=',1) for line in output(['systemctl','show',name,'-p','MainPID','-p','NRestarts','-p','MemoryCurrent','-p','MemoryPeak','-p','MemoryMax','-p','CPUQuotaPerSecUSec']).splitlines())
    pid=int(props['MainPID']);assert pid==expected_pid,(name,pid)
    assert str(pathlib.Path('/proc',str(pid),'cwd').resolve())==expected_cwd,name
    audit['services'][name]=props
audit['testGame']=metrics(m['testRun']+'/server-metrics.jsonl')
audit['testCover']=metrics(m['testRun']+'/cover-metrics.jsonl')
audit['coverHealth']=json.loads(output(['curl','--fail','--silent','http://127.0.0.1:3196/health']))
audit['productionCoverHealth']=json.loads(output(['curl','--fail','--silent','http://127.0.0.1:3003/health']))
if m.get('remoteRun'):
    name=pathlib.Path(m['remoteRun']).name
    assert name.startswith('cover-f609fa4-server-')
    unit='cipai-cover-browser-f609fa4-'+name.removeprefix('cover-f609fa4-server-')+'.service'
    props=dict(line.split('=',1) for line in output(['systemctl','show',unit,'-p','Result','-p','ActiveState','-p','MainPID','-p','MemoryCurrent','-p','MemoryPeak','-p','MemoryMax','-p','MemoryHigh','-p','MemorySwapMax','-p','CPUQuotaPerSecUSec','-p','CPUWeight','-p','Nice']).splitlines())
    assert int(props['MemoryMax'])==m['browserLimits']['memoryMax']
    assert int(props['MemoryHigh'])==m['browserLimits']['memoryHigh']
    assert int(props['MemorySwapMax'])==m['browserLimits']['memorySwapMax']
    quota=props['CPUQuotaPerSecUSec']
    seconds=float(quota[:-2])/1000 if quota.endswith('ms') else float(quota[:-1])
    assert abs(seconds-float(m['browserLimits']['cpuQuota'].rstrip('%'))/100)<0.001
    assert props['CPUWeight']=='1' and props['Nice']=='19'
    audit['browserService']={'unit':unit,**props}
print(json.dumps(audit))
`;
// No shell interpolation: the Python program goes to the remote interpreter's stdin.
const audit=JSON.parse(await retryCommand('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=15','my-server','python3','-'],{input:auditCode}));
await fs.writeFile(path.join(docs,'three-hour-artifact-audit.json'),JSON.stringify(audit,null,2)+'\n');
await fs.writeFile(path.join(attemptDocs,'artifact-audit.json'),JSON.stringify(audit,null,2)+'\n');
const samples=await jsonl('samples.jsonl');
const maxSampleGapSeconds=Math.max(0,...samples.slice(1).map((s,i)=>(Date.parse(s.at)-Date.parse(samples[i].at))/1000));
const summary={startedAt:manifest.started.startedAt,elapsedSeconds:elapsed,reportPresent:!!report,artifactVerification:true,
 browser:{samples:samples.length,maxSampleGapSeconds,clients:Array.from({length:8},(_,index)=>{
  const values=samples.map(s=>s.clients[index]);return {index,firstHeapBytes:values[0].heapBytes,lastHeapBytes:values.at(-1).heapBytes,
   maxHeapBytes:Math.max(...values.map(v=>v.heapBytes)),firstNodes:values[0].nodes,lastNodes:values.at(-1).nodes,maxNodes:Math.max(...values.map(v=>v.nodes)),
   longTasks:values.reduce((sum,v)=>sum+v.longTasks,0),maxLongTaskMs:Math.max(...values.map(v=>v.longTaskMaxMs))};}),
  ackSampleP95Ms:percentile(samples.map(s=>s.ackP95Ms),.95)},
 server:audit.testGame,coverWorker:audit.testCover,
 caveats:['Image HTTP/network error counts include deliberately aborted fault probes and cancelled off-screen work.',
  'Browser heap samples include garbage collection cycles; first/last differences alone are not proof of a memory leak.',
  'Eight isolated browser contexts are not eight physical phones or a guarantee for every network.',
  'The legacy PNG export matrix remains outside this soak acceptance.']};
const environmentNote=manifest.remoteRun
 ? `\n\n测试浏览器位于服务器上的隔离服务，八个上下文共用 CPU ${manifest.browserLimits.cpuQuota} 和内存 ${(manifest.browserLimits.memoryMax/1048576).toFixed(0)} MiB 上限。延迟包含测试客户端的资源限额影响，不代表八台独立设备或互联网端到端延迟，不能直接与先前桌面测量比较。`
 : '';
if(manifest.remoteRun){
 summary.browser.host='eight browser contexts share the test server; not eight independent client devices';
 summary.browser.limits=manifest.browserLimits;
 summary.caveats.push('Server-side browser CPU/memory quotas affect measured latency; these values are not directly comparable with desktop clients over the Internet.');
}
let accepted=false;
if(report){
 try{
 assert.ok(report.passed&&report.threeHourComplete&&report.elapsedSeconds>=10800);
 if(manifest.remoteRun)assert.equal((await read('driver-exit.json'))?.code,0,'server browser driver must finish successfully');
 assert.ok(Date.now()-start>=10800000);assert.equal(report.players,8);assert.equal(report.browserContexts,8);assert.equal(report.compiled,true);
 assert.ok(maxSampleGapSeconds<=180,'a suspended desktop cannot count as continuous browser activity');
 assert.deepEqual(report.errors,[]);assert.ok(report.rounds.some(r=>r.size==='5x5')&&report.rounds.some(r=>r.size==='6x6'));
 assert.equal(report.coverChecks.length,report.rounds.length);assert.ok(report.coverChecks.every(c=>c.passed&&c.unresolved.length===0));
 assert.ok(report.coverFaults.some(f=>f.allSourcesBlocked&&f.actualOperativeGuesses>0&&f.recovered));
 summary.passed=true;summary.completedGames=report.rounds.length;summary.ackMs=report.ackMs;summary.uiGuessMs=report.uiGuessMs;
 summary.counters=report.counters;summary.maxCoverWaitSeconds=Math.max(...report.coverChecks.map(c=>c.waitSeconds));accepted=true;
 }catch(error){summary.passed=false;summary.completedGames=report.rounds?.length??0;summary.validationFailure=String(error.message).slice(0,1000);}
}else{summary.passed=false;summary.failure=failure.message;summary.completedGames=failure.rounds.length;}
await fs.writeFile(path.join(docs,'three-hour-summary.json'),JSON.stringify(summary,null,2)+'\n');
await fs.writeFile(path.join(attemptDocs,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const message=accepted
 ? `八个独立浏览器持续 ${elapsed.toFixed(1)} 秒，完成 ${report.rounds.length} 局 5×5／6×6 正常对局，三小时通过。ACK P95 ${report.ackMs.p95.toFixed(1)} ms，猜牌界面 P95 ${report.uiGuessMs.p95.toFixed(1)} ms。逐局可见封面检查通过；故障注入中封面全部不可用仍能真实猜牌，解除后恢复。网页、图片服务、正式游戏产物及进程复核通过。详见 [三小时报告](three-hour-report.json)、[指标摘要](three-hour-summary.json)、[产物与资源核验](three-hour-artifact-audit.json)。`
 : failure?`本次八浏览器长测运行 ${elapsed.toFixed(1)} 秒、完成 ${failure.rounds.length} 局后失败，未记作三小时通过。详见 [失败记录](three-hour-failure.json)、[指标摘要](three-hour-summary.json)、[产物核验](three-hour-artifact-audit.json)。`
 : `本次测量运行 ${elapsed.toFixed(1)} 秒，但验收条件未满足，未记作三小时通过。原因：${summary.validationFailure}。详见 [原始测量](three-hour-report.json)、[验收摘要](three-hour-summary.json)、[产物核验](three-hour-artifact-audit.json)。`;
const documentedMessage=message+environmentNote;
const readmePath=path.join(docs,'README.md');let readme=await fs.readFile(readmePath,'utf8');
readme=readme.replace(/<!-- SOAK_STATUS -->[\s\S]*?<!-- \/SOAK_STATUS -->/,`<!-- SOAK_STATUS -->\n${documentedMessage}\n<!-- /SOAK_STATUS -->`);
readme=readme.replace('最终产物正在继续长测。','最终产物的长测结果见下文。').replace('结束后核验网页、图片服务及游戏产物，再补充内存、事件循环、延迟、逐局封面恢复和错误统计。','结束后已核验网页、图片服务及游戏产物，并记录内存、事件循环、延迟、逐局封面恢复和错误统计。');
await fs.writeFile(readmePath,readme);
await fs.writeFile(path.join(docs,'ACCEPTANCE.md'),`# 封面交付验收\n\n${documentedMessage}\n\n正式前端：${manifest.frontendSha}；独立图片服务：${manifest.coverWorkerSha}；游戏运行版本：${manifest.gameRuntimeSha}。本收集脚本没有部署或重启任何服务。\n\n图片错误统计包含故障注入和取消请求，不等于永久缺图数。内存记录包含 GC 波动，需结合峰值、队列与最终状态审阅。实体手机及所有网络条件不在本次保证范围；历史 PNG 导出矩阵未被算作本次通过。\n`);
// Refuse to publish acceptance for a branch whose runtime sources have changed.
assert.equal(command('git',['branch','--show-current']),'codex/cipai-cover-delivery');
assert.equal(command('git',['diff',manifest.coverWorkerSha,'--','apps/server/src','packages/shared/src','package-lock.json']),'');
assert.equal(command('git',['diff',manifest.frontendSha,'--','apps/web/src']),'');
const prMessage=documentedMessage.replace(/\]\(([^)]+)\)/g,(_,file)=>`](https://github.com/Zao-c/codenames-acg/blob/codex/cipai-cover-delivery/docs/cover-delivery/${file})`);
const body=`图片故障不应阻塞游戏。公共封面采用独立图片服务、浏览器有界队列、COS/BGM/独立公共图片缓存/同源缓存降级及后台补齐；现有游戏同步、权限与规则保持原状。公共图片备选不携带用户、房间、凭据或签名查询。\n\n已部署：前端 ${manifest.frontendSha.slice(0,7)}，图片服务 ${manifest.coverWorkerSha.slice(0,7)}。游戏运行版本 ${manifest.gameRuntimeSha.slice(0,7)} 和进程保持不变。类型检查、构建、缓存与取消单测、八人两局故障短测均通过。\n\n${prMessage}\n\n基于 PR #19。审计和截图：[评审报告](https://github.com/Zao-c/codenames-acg/blob/codex/cipai-cover-delivery/docs/cover-delivery/README.md)。历史 PNG 导出矩阵不在本次通过范围。\n`;
const bodyFile=path.join(root,'output','cover-pr-final.md');await fs.writeFile(bodyFile,body);
command('git',['add','--','docs/cover-delivery']);
command('git',['commit','-m',accepted?'docs: record verified eight-player three-hour cover soak':'docs: record cover soak failure without claiming acceptance']);
await retryCommand('git',['-c','http.version=HTTP/1.1','-c','http.postBuffer=524288000','push','origin','codex/cipai-cover-delivery']);
await retryCommand('gh',['pr','edit','20','--body-file',bodyFile]);
console.log(JSON.stringify({accepted,completedGames:summary.completedGames,elapsedSeconds:elapsed,commit:command('git',['rev-parse','HEAD']),pr:20}));
