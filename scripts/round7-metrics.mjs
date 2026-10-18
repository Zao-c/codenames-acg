// Test-server preload only. Never imported by the production application.
import fs from 'node:fs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
if(process.env.ROUND7_METRICS_FILE){
 const delay=monitorEventLoopDelay({resolution:10});delay.enable();
 setInterval(()=>{
  fs.appendFileSync(process.env.ROUND7_METRICS_FILE,JSON.stringify({at:Date.now(),cpu:process.cpuUsage(),memory:process.memoryUsage(),loopP99Ms:delay.percentile(99)/1e6})+'\n');delay.reset();
 },500).unref();
}
