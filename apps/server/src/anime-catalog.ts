import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import type { AnimePool, AnimeWork } from '@acg-codenames/shared';

const resourceDir = [path.resolve('apps/server/resources'), path.resolve('resources')].find(p => fs.existsSync(path.join(p, 'anime-catalog.json')));
let cached: AnimeWork[] | undefined;
let imported: AnimeWork[]=[];
let importedFile: string | undefined;
let tail: Promise<unknown>=Promise.resolve();
const overrides=resourceDir?JSON.parse(fs.readFileSync(path.join(resourceDir,'anime-series-overrides.json'),'utf8')):{titles:{}};
let base: AnimeWork[] | undefined;
export function animeCatalog(): AnimeWork[] {
  if (cached) return cached;
  if (!resourceDir) return [];
  const raw = JSON.parse(fs.readFileSync(path.join(resourceDir, 'anime-catalog.json'), 'utf8'));
  base ??= (raw.works as AnimeWork[]).map(w => ({ ...w, source:'legacy' as const,seriesSource:'legacy' as const,seriesId: overrides.subjectIds?.[w.id]??overrides.titles[w.fullTitle] ?? w.seriesId }));
  cached = [...new Map([...base,...imported].map(w=>[w.id,w])).values()];
  return cached;
}

/** The additive overlay survives static catalog upgrades. Never silently overwrite a corrupt overlay. */
export async function initializeAnimeCatalog(filename: string): Promise<void> {
  importedFile=filename;
  const parse=(raw:string)=>{const data=JSON.parse(raw);if(data.schemaVersion!==1||!Array.isArray(data.works)||!data.works.every((w:AnimeWork)=>Number.isSafeInteger(w.id)&&w.id>0&&typeof w.fullTitle==='string'&&typeof w.seriesId==='string'&&Array.isArray(w.aliases)))throw new Error('导入目录格式无效，拒绝覆盖');return data.works as AnimeWork[];};
  try{imported=parse(await readFile(filename,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){try{imported=parse(await readFile(`${filename}.bak`,'utf8'));}catch(backup){if((backup as NodeJS.ErrnoException).code!=='ENOENT')throw backup;imported=[];}}else{try{imported=parse(await readFile(`${filename}.bak`,'utf8'));}catch{throw error;}}}
  cached=undefined;animeCatalog();
}

export function catalogSeries(work: AnimeWork): AnimeWork {
  const known=animeCatalog().find(w=>w.id===work.id);
  const manual=overrides.subjectIds?.[work.id]??overrides.titles[work.fullTitle];
  const related=animeCatalog().find(w=>work.seriesLinks?.includes(w.id)||w.seriesLinks?.includes(work.id));
  return {...work,seriesId:manual??known?.seriesId??related?.seriesId??`bgm:${Math.min(work.id,...(work.seriesLinks??[]))}`,seriesSource:manual?'manual-override':known?.seriesSource??(related?'official-relation':work.seriesLinks?.length?'official-relation':'subject-id')};
}

export function persistAnimeWorks(works: AnimeWork[]): Promise<void> {
  const operation=tail.then(async()=>{
    if(!importedFile)throw new Error('动画增量目录未初始化');
    const map=new Map(imported.map(w=>[w.id,w]));
    for(const work of works){const previous=map.get(work.id)??animeCatalog().find(w=>w.id===work.id);map.set(work.id,catalogSeries({...previous,...work,aliases:[...new Set([...(previous?.aliases??[]),...work.aliases])],type:work.type==='未知'?(previous?.type??'未知'):work.type,seriesLinks:work.seriesLinks??previous?.seriesLinks,detailFetchedAt:work.detailFetchedAt??previous?.detailFetchedAt}));}
    if(map.size>25000)throw new Error('动画缓存容量已满，请联系管理员');
    const next=structuredClone([...map.values()]);
    // Explicit official sequel/prequel links join imported entries; legacy overrides remain authoritative.
    const parents=new Map<number,number>();const root=(n:number):number=>{const p=parents.get(n);return p===undefined||p===n?n:root(p);};
    for(const w of next)for(const related of w.seriesLinks??[])parents.set(root(Math.max(w.id,related)),root(Math.min(w.id,related)));
    const known=new Map<number,AnimeWork>();for(const w of base??[])if(!known.has(root(w.id)))known.set(root(w.id),w);
    for(const w of next){const manual=overrides.subjectIds?.[w.id]??overrides.titles[w.fullTitle];const original=base?.find(b=>b.id===w.id);const reference=known.get(root(w.id));w.seriesId=manual??original?.seriesId??reference?.seriesId??`bgm:${root(w.id)}`;if(!manual&&!original&&reference)w.seriesSource='official-relation';}
    await mkdir(path.dirname(importedFile),{recursive:true});const temporary=`${importedFile}.tmp`;
    await writeFile(temporary,JSON.stringify({schemaVersion:1,works:next}),{encoding:'utf8',mode:0o600});
    await writeFile(`${importedFile}.bak.tmp`,JSON.stringify({schemaVersion:1,works:next}),{encoding:'utf8',mode:0o600});
    await rename(`${importedFile}.bak.tmp`,`${importedFile}.bak`);
    await rename(temporary,importedFile);imported=next;cached=undefined;animeCatalog();
  });tail=operation.catch(()=>{});return operation;
}
export function animePools(): AnimePool[] {
  const works = animeCatalog();
  const pools = new Map<string, AnimePool>();
  for (const work of works) {
    const [year, month] = work.airDate.split('-').map(Number);
    if (!year || !month) continue;
    const quarter = Math.ceil(month / 3);
    const id = `${year}-Q${quarter}`;
    if (!pools.has(id)) pools.set(id, { id, name: `${year} 年第 ${quarter} 季`, workIds: [] });
    pools.get(id)!.workIds.push(work.id);
  }
  return [{ id: 'all', name: '全部动画', workIds: works.map(w => w.id) }, ...[...pools.values()].sort((a,b) => b.id.localeCompare(a.id))];
}
