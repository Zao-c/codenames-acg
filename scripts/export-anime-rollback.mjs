// Build a backward-compatible static catalog before rolling back to a release without overlay support.
// Never deletes pools or the additive overlay. Caller supplies paths; no network or private credentials.
import { readFile, writeFile, rename } from 'node:fs/promises';
const [baseFile,overlayFile,outputFile]=process.argv.slice(2);
if(!baseFile||!overlayFile||!outputFile)throw new Error('Usage: node export-anime-rollback.mjs base-catalog.json anime-imports.json output.json');
const base=JSON.parse(await readFile(baseFile,'utf8'));
let overlay;try{overlay=JSON.parse(await readFile(overlayFile,'utf8'));}catch{overlay=JSON.parse(await readFile(overlayFile+'.bak','utf8'));}
if(!Array.isArray(base.works)||overlay.schemaVersion!==1||!Array.isArray(overlay.works))throw new Error('Invalid catalog schema');
const works=[...new Map([...base.works,...overlay.works].map(w=>{if(!Number.isSafeInteger(w.id)||w.id<1||typeof w.seriesId!=='string'||typeof w.fullTitle!=='string'||!Array.isArray(w.aliases))throw new Error('Invalid work');return [w.id,w];})).values()];
const temporary=outputFile+'.tmp';await writeFile(temporary,JSON.stringify({...base,works}),{mode:0o600});await rename(temporary,outputFile);
console.log(JSON.stringify({works:works.length,overlayWorks:overlay.works.length,output:outputFile}));
