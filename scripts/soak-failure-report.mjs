import fs from 'node:fs/promises';
import path from 'node:path';

// A killed/OOM driver cannot write its final report. Recover durable completed
// games, while always keeping the run failed. A partial last write isn't a game.
export async function interruptedSoakReport(out,result){
 let progress={};try{progress=JSON.parse(await fs.readFile(path.join(out,'progress.json'),'utf8'));}catch{}
 const rounds=[];let journalError;
 try{
  const lines=(await fs.readFile(path.join(out,'rounds.jsonl'),'utf8')).split('\n');
  for(let index=0;index<lines.length;index++){
   if(!lines[index].trim())continue;
   try{rounds.push(JSON.parse(lines[index]));}
   catch(error){journalError=`Invalid round journal record ${index+1}: ${error.message}`;break;}
  }
 }catch(error){if(error.code!=='ENOENT')journalError=error.message;}
 return {passed:false,threeHourComplete:false,message:'Driver exited without completion report: '+JSON.stringify(result),
  elapsedSeconds:progress.elapsedSeconds??0,counters:progress.counters??{},errors:[],rounds,
  lastSampleCompletedGames:progress.completedGames??0,roundCountSource:'rounds.jsonl',...(journalError?{journalError}:{})};
}
