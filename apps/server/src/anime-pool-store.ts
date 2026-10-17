import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { AnimeWork, CommunityPool, CommunityPoolInput, CommunityPoolPage, CommunityPoolSummary, PoolModerationItem } from '@acg-codenames/shared';

interface StoredPool { id: string; owner: string; revision: number; name: string; description: string; author: string; workIds: number[]; isPublic: boolean; hidden: boolean; updatedAt: number }
interface PoolData {
  schemaVersion: 1;
  pools: StoredPool[];
  favorites: Record<string, string[]>;
  deletedPools?: StoredPool[];
  reports: Array<{ poolId: string; reporter: string; reason: string; createdAt: number }>;
  moderation: Array<{ poolId: string; hidden: boolean; reason: string; at: number }>;
}
export class CommunityError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const initial = (): PoolData => ({ schemaVersion: 1, pools: [], favorites: {}, reports: [], moderation: [] });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommunityError('作品池参数无效');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new CommunityError(`文字长度须为 ${required ? '1' : '0'}～${max} 字`);
  return value.trim();
};

/** Single-process serialized writes, clone before mutation, atomic rename before publishing in memory. */
export class AnimePoolStore {
  private data: PoolData | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private lastWorks?: AnimeWork[];
  private lastCatalog=new Map<number,AnimeWork>();
  constructor(
    private readonly filename: string,
    private readonly works: AnimeWork[]|((principal?: string, extraIds?: number[])=>AnimeWork[]),
    private readonly options: {
      canUseWork?: (principal: string, workId: number, allowExisting: boolean) => boolean;
      onPublicationChange?: (publicManualWorkIds: number[]) => Promise<void> | void;
    } = {}
  ) {}
  private catalogFor(principal?: string, extraIds: number[] = []):Map<number,AnimeWork>{const values=typeof this.works==='function'?this.works(principal, extraIds):this.works;if(values!==this.lastWorks){this.lastWorks=values;this.lastCatalog=new Map(values.map(w=>[w.id,w]));}return this.lastCatalog;}
  private async load(): Promise<PoolData> {
    if (this.data) return this.data;
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8')) as PoolData;
      if (value.schemaVersion !== 1 || !Array.isArray(value.pools) || !value.favorites || !Array.isArray(value.reports) || !Array.isArray(value.moderation)) throw new Error('动画社区数据格式无效，拒绝覆盖');
      this.data = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = initial();
    }
    return this.data;
  }
  private mutate<T>(fn: (draft: PoolData) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(await this.load());
      const result = fn(draft);
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      await writeFile(temporary, JSON.stringify(draft), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.filename);
      this.data = draft;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private async read(): Promise<PoolData> { await this.tail; return this.load(); }
  private summary(pool: StoredPool, principal: string | undefined, data: PoolData): CommunityPoolSummary {
    const catalog=this.catalogFor(principal, pool.workIds);
    return { id: pool.id, revision: pool.revision, name: pool.name, description: pool.description, author: pool.author,
      workCount: pool.workIds.length, seriesCount: new Set(pool.workIds.map(id => catalog.get(id)?.seriesId).filter(Boolean)).size,
      previewWorkIds: pool.workIds.slice(0, 4),
      isPublic: pool.isPublic, hidden: pool.hidden, canEdit: principal === pool.owner,
      favorited: !!principal && !!data.favorites[principal]?.includes(pool.id), updatedAt: pool.updatedAt };
  }
  private detail(pool: StoredPool, principal: string | undefined, data: PoolData): CommunityPool { return { ...this.summary(pool, principal, data), workIds: [...pool.workIds] }; }
  private find(data: PoolData, id: string): StoredPool {
    const pool = data.pools.find(p => p.id === id);
    if (!pool) throw new CommunityError('作品池不存在或不可访问', 404);
    return pool;
  }
  private visible(pool: StoredPool, principal?: string): boolean { return !pool.hidden && (pool.isPublic || pool.owner === principal); }
  private validate(input: unknown, principal: string, existingIds: Set<number> = new Set()): Omit<CommunityPoolInput, 'expectedRevision'> {
    const body = object(input);
    if (!Array.isArray(body.workIds) || body.workIds.length > 2500 || !body.workIds.every(id => Number.isSafeInteger(id) && (existingIds.has(id as number) || this.catalogFor(principal, [...existingIds]).has(id)))) throw new CommunityError('请选择当前动画目录中的作品，最多 2500 部');
    if (this.options.canUseWork && !body.workIds.every(id => this.options.canUseWork!(principal, id as number, existingIds.has(id as number)))) throw new CommunityError('作品池包含无权使用的私人自建作品');
    if (typeof body.isPublic !== 'boolean') throw new CommunityError('发布状态无效');
    return { name: text(body.name, 64, true), description: text(body.description, 500), author: text(body.author, 24, true), workIds: [...new Set(body.workIds as number[])], isPublic: body.isPublic };
  }
  async list(principal: string | undefined, query: { q?: string; page?: number; scope?: string } = {}): Promise<CommunityPoolPage> {
    const data = await this.read();
    if (query.scope && !['public', 'mine', 'favorites'].includes(query.scope)) throw new CommunityError('列表范围无效');
    if (query.scope !== undefined && query.scope !== 'public' && !principal) throw new CommunityError('需要作品池身份凭证', 401);
    const q = (query.q ?? '').slice(0, 100).toLocaleLowerCase();
    const page = Number.isSafeInteger(query.page) && query.page! > 0 ? query.page! : 1;
    const pools = data.pools.filter(p => query.scope === 'mine' ? p.owner === principal : this.visible(p, principal) && (query.scope === 'favorites' ? data.favorites[principal!]?.includes(p.id) : p.isPublic))
      .filter(p => `${p.name} ${p.description} ${p.author}`.toLocaleLowerCase().includes(q)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { enabled: true, page, total: pools.length, items: pools.slice((page - 1) * 20, page * 20).map(p => this.summary(p, principal, data)) };
  }
  async get(id: string, principal?: string): Promise<CommunityPool> {
    const data = await this.read(), pool = this.find(data, id);
    if (!this.visible(pool, principal) && pool.owner !== principal) throw new CommunityError('作品池不存在或不可访问', 404);
    return this.detail(pool, principal, data);
  }
  async create(principal: string, input: unknown): Promise<CommunityPool> {
    const parsed = this.validate(input, principal);
    const created = await this.mutate(data => {
      if (data.pools.filter(p => p.owner === principal).length >= 50) throw new CommunityError('每个身份最多保存 50 个作品池');
      const pool: StoredPool = { ...parsed, owner: principal, id: crypto.randomUUID(), revision: 1, hidden: false, updatedAt: Date.now() };
      data.pools.push(pool);
      return this.detail(pool, principal, data);
    });
    await this.syncPublication();
    return created;
  }
  async update(id: string, principal: string, input: unknown): Promise<CommunityPool> {
    const body = object(input);
    const current = await this.read();
    const existingPool = this.find(current, id);
    if (existingPool.owner !== principal) throw new CommunityError('无权修改此作品池', 403);
    const parsed = this.validate(body, principal, new Set(existingPool.workIds));
    const updated = await this.mutate(data => {
      const pool = this.find(data, id);
      if (pool.owner !== principal) throw new CommunityError('无权修改此作品池', 403);
      if (body.expectedRevision !== pool.revision) throw new CommunityError('作品池已更新，请重新打开后再保存', 409);
      Object.assign(pool, parsed, { revision: pool.revision + 1, updatedAt: Date.now() });
      return this.detail(pool, principal, data);
    });
    await this.syncPublication();
    return updated;
  }
  async copy(id: string, principal: string): Promise<CommunityPool> {
    return this.mutate(data => {
      const source = this.find(data, id);
      if (!this.visible(source, principal)) throw new CommunityError('作品池不存在或不可访问', 404);
      if (data.pools.filter(p => p.owner === principal).length >= 50) throw new CommunityError('每个身份最多保存 50 个作品池');
      const pool: StoredPool = { ...source, id: crypto.randomUUID(), owner: principal, name: `${source.name.slice(0, 58)} · 副本`, workIds: [...source.workIds], revision: 1, isPublic: false, hidden: false, updatedAt: Date.now() };
      data.pools.push(pool);
      return this.detail(pool, principal, data);
    });
  }
  private publicWorkIdsFrom(data: PoolData): number[] {
    return [...new Set(data.pools.filter(pool => pool.isPublic && !pool.hidden).flatMap(pool => pool.workIds).filter(id => id < 0))].sort((a, b) => a - b);
  }

  async publicWorkIds(): Promise<number[]> {
    return this.publicWorkIdsFrom(await this.read());
  }

  /** Manual works referenced by the principal's own or favorited pools (keeps legitimate copies editable). */
  async workIdsForPrincipal(principal?: string): Promise<number[]> {
    if (!principal) return [];
    const data = await this.read();
    return [...new Set(data.pools.filter(pool => pool.owner === principal || data.favorites[principal]?.includes(pool.id)).flatMap(pool => pool.workIds).filter(id => id < 0))];
  }

  private async syncPublication(): Promise<void> {
    if (!this.options.onPublicationChange) return;
    try {
      await this.options.onPublicationChange(await this.publicWorkIds());
    } catch (error) {
      // The pool write already succeeded; keep it and let the next mutation retry the projection.
      console.error('Failed to sync manual work publication state', error);
    }
  }

  async delete(id: string, principal: string): Promise<void> {
    await this.mutate(data => {
      const pool = this.find(data, id);
      if (pool.owner !== principal) throw new CommunityError('无权删除此作品池', 403);
      data.pools = data.pools.filter(p => p.id !== id);
      for (const ids of Object.values(data.favorites)) {
        const index = ids.indexOf(id);
        if (index !== -1) ids.splice(index, 1);
      }
      // Retain only audit metadata for reported/moderated pools, never remove catalog or frozen room snapshots.
      if (data.reports.some(r => r.poolId === id) || data.moderation.some(m => m.poolId === id)) {
        (data.deletedPools ??= []).push({ ...pool, owner: '', workIds: [], hidden: true, isPublic: false });
        data.moderation.push({ poolId: id, hidden: true, reason: '所有者已删除作品池', at: Date.now() });
      }
    });
    await this.syncPublication();
  }
  async favorite(id: string, principal: string, value: unknown): Promise<void> {
    if (typeof value !== 'boolean') throw new CommunityError('收藏状态无效');
    return this.mutate(data => {
      const pool = this.find(data, id);
      if (value && !this.visible(pool, principal)) throw new CommunityError('作品池不存在或不可访问', 404);
      const ids = (data.favorites[principal] ?? []).filter(key => key !== id);
      if (value) ids.push(id);
      if (ids.length > 200) throw new CommunityError('最多收藏 200 个作品池');
      data.favorites[principal] = ids;
    });
  }
  async report(id: string, principal: string, reason: unknown): Promise<void> {
    const clean = text(reason, 500, true);
    return this.mutate(data => {
      const pool = this.find(data, id);
      if (!pool.isPublic || pool.hidden) throw new CommunityError('作品池不存在或不可访问', 404);
      if (data.reports.some(r => r.poolId === id && r.reporter === principal)) throw new CommunityError('已举报该作品池，请等待处理', 409);
      if (data.reports.filter(r => r.reporter === principal && r.createdAt > Date.now() - 86_400_000).length >= 5) throw new CommunityError('每天最多提交 5 次举报', 429);
      data.reports.push({ poolId: id, reporter: principal, reason: clean, createdAt: Date.now() });
    });
  }
  async moderation(): Promise<PoolModerationItem[]> {
    const data = await this.read();
    return [...data.pools, ...(data.deletedPools ?? [])].filter(p => p.hidden || data.reports.some(r => r.poolId === p.id)).map(p => ({ pool: { ...this.detail(p, undefined, data), deleted: !!data.deletedPools?.some(d => d.id === p.id) },
      reports: data.reports.filter(r => r.poolId === p.id).map(r => ({ reason: r.reason, createdAt: r.createdAt })),
      history: data.moderation.filter(m => m.poolId === p.id).map(m => ({ hidden: m.hidden, reason: m.reason, at: m.at })),
    }));
  }
  async moderate(id: string, hidden: unknown, reason: unknown): Promise<void> {
    if (typeof hidden !== 'boolean') throw new CommunityError('隐藏状态无效');
    const clean = text(reason, 500, true);
    await this.mutate(data => {
      const pool = this.find(data, id);
      pool.hidden = hidden; pool.revision += 1; pool.updatedAt = Date.now();
      data.moderation.push({ poolId: id, hidden, reason: clean, at: Date.now() });
    });
    await this.syncPublication();
  }
}
