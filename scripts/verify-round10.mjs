import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve(`output/playwright/${process.env.ROUND10_REVIEW_DIR??'round10'}/tests`);fs.mkdirSync(out,{recursive:true});
let results=[];try{results=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'));}catch{};
async function run(command){
 const name=command.replaceAll(':','-').replaceAll(' ','-');const log=path.join(out,name+'.log');const handle=fs.openSync(log,'w');const started=Date.now();
 const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run',command],{shell:process.platform==='win32',windowsHide:true,stdio:['ignore',handle,handle]});
 const code=await new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('exit',resolve);});fs.closeSync(handle);
 const result={command:'npm run '+command,passed:code===0,code,seconds:Math.round((Date.now()-started)/10)/100,log:path.basename(log)};results=results.filter(r=>r.command!==result.command);results.push(result);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));return code===0;
}
const requested=process.argv.slice(2);
for(const command of requested.length?[]:['typecheck','test:rules','test:round10:unit','build'])if(!await run(command))process.exit(1);
const suites=requested.length?requested:['test:e2e:local','test:round5:local','test:stability:local','test:mixed:local','test:lobby:local','test:browser:local','test:phase2:local','test:bangumi:local','test:concentrated:local','test:round6:local','test:round6:roles:local','test:round7:ui:local','test:round7:faults:local','test:round7:load','test:round8:local','test:round8:large:local','test:performance:unit','test:performance:browser','test:round9:local','test:performance:load','test:round10:local'];
let next=0;async function worker(){while(next<suites.length){const command=suites[next++];await run(command);}}
await worker();
if(results.some(result=>!result.passed))process.exitCode=1;
