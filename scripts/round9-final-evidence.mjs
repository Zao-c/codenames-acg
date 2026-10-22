import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),baseline=process.env.ROUND9_BASELINE_ROOT??path.resolve('../performance');
const out=path.resolve('output/playwright/round9');await fs.mkdir(out,{recursive:true});
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),'59f2bd1aad922bad41d42b63ca0857b0102ad0b1','baseline worktree must remain unchanged');
async function run(args,cwd,env,log){const handle=await fs.open(path.join(out,log),'w');const p=spawn(process.execPath,args,{cwd,windowsHide:true,env:{...process.env,...env},stdio:['ignore',handle.fd,handle.fd]});const code=await new Promise(r=>{p.on('error',()=>r(-1));p.on('exit',r);});await handle.close();assert.equal(code,0,log);console.log('PASS '+log);}
await run(['scripts/verify-round9.mjs','test:round9:local'],root,{},'final-round9.log');
await run(['scripts/verify-round9.mjs','build'],root,{},'final-build.log');
await run(['scripts/test-round9-local.mjs'],root,{ROUND9_BASELINE:'1',PLAYTEST_CODE_ROOT:baseline},'baseline-browser.log');
// Matched loopback pair: no simultaneous browser suite or build in this runner.
for(const [name,cwd] of [['before',baseline],['after',root]]){
  await run(['scripts/performance-load.mjs'],cwd,{PERFORMANCE_SECONDS:'60'},'paired-performance-'+name+'.log');
  await fs.copyFile(path.join(cwd,'output/playwright/performance/load-report.json'),path.join(out,'paired-performance-'+name+'.json'));
}
const before=JSON.parse(await fs.readFile(path.join(out,'paired-performance-before.json'),'utf8')),after=JSON.parse(await fs.readFile(path.join(out,'paired-performance-after.json'),'utf8'));
const comparison={passed:before.passed&&after.passed,before,after,roomBytesChangePercent:100*(after.actualRoomBytes/before.actualRoomBytes-1),ackP95ChangeMs:after.latencyMs.p95-before.latencyMs.p95,latencyGuardPassed:after.latencyMs.p95<=before.latencyMs.p95*1.25+20,scope:'Adjacent loopback runs, identical 8-player 240-action workloads; not production capacity or internet latency.'};
assert.ok(comparison.passed);assert.ok(after.actualRoomBytes<=before.actualRoomBytes*1.05,'no room byte regression');
await fs.writeFile(path.join(out,'performance-comparison.json'),JSON.stringify(comparison,null,2));
console.log(JSON.stringify({bytesBefore:before.actualRoomBytes,bytesAfter:after.actualRoomBytes,p95Before:before.latencyMs.p95,p95After:after.latencyMs.p95,latencyGuardPassed:comparison.latencyGuardPassed}));
assert.ok(comparison.latencyGuardPassed,'paired ACK P95 exceeds 25% + 20ms tolerance; inspect the recorded pair');
await run(['scripts/preview-round9-prototype.mjs'],root,{},'prototype-preview.log');
await run(['scripts/build-round9-review.mjs'],root,{},'review-build.log');
