import fs from 'node:fs';
import path from 'node:path';
import type { AnimePool, AnimeWork } from '@acg-codenames/shared';

const resourceDir = [path.resolve('apps/server/resources'), path.resolve('resources')].find(p => fs.existsSync(path.join(p, 'anime-catalog.json')));
let cached: AnimeWork[] | undefined;
export function animeCatalog(): AnimeWork[] {
  if (cached) return cached;
  if (!resourceDir) return [];
  const raw = JSON.parse(fs.readFileSync(path.join(resourceDir, 'anime-catalog.json'), 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(resourceDir, 'anime-series-overrides.json'), 'utf8')).titles as Record<string,string>;
  cached = (raw.works as AnimeWork[]).map(w => ({ ...w, seriesId: overrides[w.fullTitle] ?? w.seriesId }));
  return cached;
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
