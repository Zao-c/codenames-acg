// Run on the user's server. Values stay in a root-readable environment file.
import fs from 'node:fs/promises';
import dotenv from 'dotenv';
const argument=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const source=argument('--from'),target=argument('--to'),cache=argument('--cache');
if(!source||!target||!cache)throw new Error('--from, --to and --cache are required');
const old=dotenv.parse(await fs.readFile(source));
const fields=['COS_SECRET_ID','COS_SECRET_KEY','COS_BUCKET','COS_REGION','COS_PUBLIC_BASE_URL','COS_COVER_PREFIX'];
if(fields.slice(0,4).some(key=>!old[key]))throw new Error('Existing COS configuration is incomplete');
const env=Object.fromEntries(fields.map(key=>[key,old[key]||'']));
Object.assign(env,{CIPAI_COS_PREFIX:'codenames-acg/covers-v1',COVER_PORT:argument('--port')||'3003',COVER_CACHE_DIR:cache,COVER_RESOURCE_FILE:argument('--resource')||'/opt/codenames-acg/apps/server/resources/anime-catalog.json',COVER_IMPORT_FILE:argument('--imports')||'/opt/codenames-acg/apps/server/data/anime-imports.json',COVER_OUTBOUND_PROXY_URL:old.ANIMATCH_OUTBOUND_PROXY_URL||old.HTTPS_PROXY||old.HTTP_PROXY||''});
await fs.writeFile(target,Object.entries(env).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600});await fs.chmod(target,0o600);
console.log(JSON.stringify({configured:true,privateFile:target,cos:true,outboundProxy:!!env.COVER_OUTBOUND_PROXY_URL,namespace:env.CIPAI_COS_PREFIX}));
