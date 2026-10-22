import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {interruptedSoakReport} from './soak-failure-report.mjs';
const out=await fs.mkdtemp(path.join(os.tmpdir(),'cipai-failure-report-'));
try{
 let r=await interruptedSoakReport(out,{code:null,signal:'SIGABRT'});
 assert.deepEqual(r.rounds,[]);assert.equal(r.passed,false);
 await fs.writeFile(path.join(out,'progress.json'),JSON.stringify({elapsedSeconds:3566,completedGames:12,counters:{guesses:256}}));
 const rounds=Array.from({length:13},(_,i)=>({number:i+1,winner:'red'}));
 await fs.writeFile(path.join(out,'rounds.jsonl'),rounds.map(r=>JSON.stringify(r)).join('\n')+'\n');
 r=await interruptedSoakReport(out,{code:null,signal:'SIGABRT'});
 assert.deepEqual(r.rounds,rounds);assert.equal(r.lastSampleCompletedGames,12);assert.equal(r.elapsedSeconds,3566);assert.equal(r.threeHourComplete,false);
 await fs.appendFile(path.join(out,'rounds.jsonl'),'{"number":14');
 r=await interruptedSoakReport(out,{code:null,signal:'SIGABRT'});
 assert.deepEqual(r.rounds,rounds);assert.ok(r.journalError);assert.equal(r.passed,false);
 console.log('SOAK_FAILURE_REPORT_PASS: preserves 13 completed games and flags truncated last write without passing the run');
}finally{
 assert.equal(path.dirname(path.resolve(out)),path.resolve(os.tmpdir()));
 assert.ok(path.basename(out).startsWith('cipai-failure-report-'));
 await fs.rm(out,{recursive:true,force:true});
}
