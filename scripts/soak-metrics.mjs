// Isolated test-process preload. Never imported by the production service.
import fs from 'node:fs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
if(process.env.SOAK_SERVER_METRICS){
 const loop=monitorEventLoopDelay({resolution:20});loop.enable();const stream=fs.createWriteStream(process.env.SOAK_SERVER_METRICS,{flags:'a'});
 setInterval(()=>{stream.write(JSON.stringify({at:Date.now(),uptime:process.uptime(),memory:process.memoryUsage(),cpu:process.cpuUsage(),loopP95Ms:loop.percentile(95)/1e6,loopP99Ms:loop.percentile(99)/1e6,loopMaxMs:loop.max/1e6})+'\n');loop.reset();},5000).unref();
}
