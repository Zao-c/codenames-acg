import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
const dir=path.resolve('output/playwright/round6/tests');
await mkdir(dir,{recursive:true});
const requested=process.argv.slice(2);
const scripts=requested.length?requested:['typecheck','test:rules','test:e2e:local','build','test:round5:local','test:stability:local','test:mixed:local','test:lobby:local','test:browser:local','test:phase2:local','test:bangumi:local','test:concentrated:local','test:round6:local','test:round6:roles:local'];
let report=[];try{report=JSON.parse(await readFile(path.join(dir,'results.json'),'utf8'));}catch{}
const runId=new Date().toISOString().replaceAll(':','-');
for(const script of scripts){
 const log=path.join(dir,script.replaceAll(':','-')+'.log');
 await copyFile(log,log+'.previous-'+runId).catch(()=>{});
 const output=createWriteStream(log);
 const started=Date.now();
 console.log(`START ${script}`);
 const child=spawn(process.execPath,[process.env.npm_execpath,'run',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 await new Promise(resolve=>output.end(resolve));
 report=report.filter(row=>row.command!==`npm run ${script}`);
 report.push({command:`npm run ${script}`,passed:code===0,code,seconds:+((Date.now()-started)/1000).toFixed(2),log});
 await writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));
 console.log(`${code===0?'PASS':'FAIL'} ${script} (${report.at(-1).seconds}s)`);
}
if(report.some(row=>!row.passed))process.exitCode=1;
