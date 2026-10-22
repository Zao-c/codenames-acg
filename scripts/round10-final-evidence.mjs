import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const out=path.resolve('output/playwright/round10'),docs=path.resolve('docs/round10');
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const before=await read(path.join(out,'before/report.json')),after=await read(path.join(out,'after/report.json'));
const tests=await read(path.join(out,'tests/results.json')),performance=await read(path.join(out,'performance-comparison.json'));
assert.ok(before.passed&&after.passed&&tests.length===25&&tests.every(t=>t.passed)&&performance.passed);
await fs.mkdir(path.join(docs,'screens'),{recursive:true});
for(const [source,target]of [['before/report.json','browser-before.json'],['after/report.json','browser-after.json'],['tests/results.json','test-results.json'],['performance-comparison.json','performance-comparison.json'],['runtime-before.json','runtime-before.json']])await fs.writeFile(path.join(docs,target),JSON.stringify(await read(path.join(out,source)),null,2)+'\n');
await fs.copyFile('output/playwright/performance/browser/report.json',path.join(docs,'weak-network-browser-results.json'));
const selected=['lobby-1440-light.png','lobby-four-390-dark.png','lobby-unequal-1440-dark.png','settings-1440-light.png','settings-390-dark.png','flips-5x5-1440-light.png','flips-6x6-390-dark.png','text-6x6-1440-dark.png','replay-6x6-390-light.png','export-6x6-16x9-dark.png'];
const manifest=[];
for(const name of selected)for(const [dir,report]of [['before',before],['after',after]]){
  const bytes=await fs.readFile(path.join(out,dir,name)),file=dir+'-'+name;
  await fs.writeFile(path.join(docs,'screens',file),bytes);
  const metadata=report.screens.find(s=>s.file===name)??{file:name,role:'public PNG export',width:1600,height:900};
  manifest.push({...metadata,file,sourceSha:report.sha,pixelWidth:bytes.readUInt32BE(16),pixelHeight:bytes.readUInt32BE(20),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(path.join(docs,'screens/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Evidence: ${tests.length} passed commands, ${after.checks.length} checks, ${after.screens.length} screenshots, ${manifest.length} committed images`);
const table=['最终 **25／25 条命令通过**。Round 10 专项 **'+after.checks.length+' 项检查、'+after.screens.length+' 张截图**；没有页面脚本错误。测试源码提交 `'+after.sha+'`，基线 `'+before.sha+'`。','','| 命令 | 结果 | 秒 |','| --- | --- | --- |',...tests.map(t=>`| \`${t.command}\` | 通过 | ${t.seconds} |`)].join('\n');
const b=performance.before,a=performance.after;
const perf=['[原始性能对比](performance-comparison.json) 的两道回归门禁均通过：房间传输不超过基线 105%，ACK P95 不超过基线 ×1.25＋20ms。','','| 指标 | 59f2bd1 生产基线 | 本轮 |','| --- | --- | --- |',`| 房间 bytes | ${b.actualRoomBytes} | ${a.actualRoomBytes} |`,`| delta／完整快照 | ${b.deltas}／${b.snapshots} | ${a.deltas}／${a.snapshots} |`,`| ACK P50／P95／max ms | ${b.latencyMs.p50}／${b.latencyMs.p95}／${b.latencyMs.max} | ${a.latencyMs.p50}／${a.latencyMs.p95}／${a.latencyMs.max} |`,`| 服务端最高 RSS MiB | ${b.server.maxRssMiB.toFixed(1)} | ${a.server.maxRssMiB.toFixed(1)} |`,`| 最大 event-loop P99 ms | ${b.server.eventLoopP99Ms.toFixed(2)} | ${a.server.eventLoopP99Ms.toFixed(2)} |`].join('\n');
const acceptance=path.join(docs,'ACCEPTANCE.md');
let markdown=await fs.readFile(acceptance,'utf8');
markdown=markdown.replace(/<!-- RESULTS -->[\s\S]*?<!-- END RESULTS -->/,'<!-- RESULTS -->\n\n'+table+'\n\n<!-- END RESULTS -->').replace(/<!-- PERFORMANCE -->[\s\S]*?<!-- END PERFORMANCE -->/,'<!-- PERFORMANCE -->\n\n'+perf+'\n\n<!-- END PERFORMANCE -->');
await fs.writeFile(acceptance,markdown);
