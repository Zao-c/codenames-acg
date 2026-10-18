import crypto from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnimeWork, ManualAnimeInput, ManualAnimePage } from '@acg-codenames/shared';
import { CommunityError } from './anime-pool-store.js';

interface ManualWorkRecord {
  id: number;
  manualId: string;
  owner: string;
  title: string;
  fullTitle: string;
  aliases: string[];
  type: AnimeWork['type'];
  airDate: string;
  tags: string[];
  coverFile: string | null;
  coverHistory: string[];
  /** Ever shared through a public pool (keeps copied pools usable). */
  published: boolean;
  /** Currently discoverable in the public directory. */
  discoverable: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
interface ManualData {
  schemaVersion: 1;
  nextId: number;
  works: ManualWorkRecord[];
}

const IMAGE_MIME_EXT: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 6000;
const TYPES: AnimeWork['type'][] = ['TV', 'OVA', 'ONA', '电影', '未知'];
const COVER_PATH = '/api/anime/covers/';

function text(value: unknown, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new CommunityError('请填写作品名称');
    return '';
  }
  if (typeof value !== 'string') throw new CommunityError('文字参数无效');
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean.length > max) throw new CommunityError(`文字长度不能超过 ${max} 字`);
  if (required && !clean) throw new CommunityError('请填写作品名称');
  return clean;
}

function stringList(value: unknown, maxItems: number, maxLength: number, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new CommunityError(`${label}最多 ${maxItems} 项`);
  return [...new Set(value.map(item => text(item, maxLength)).filter(Boolean))];
}

function normalizeAirDate(value: unknown): string {
  const raw = text(value, 10);
  if (!raw) return '';
  if (/^\d{4}$/.test(raw)) {
    const year = Number(raw);
    if (year < 1900 || year > 2100) throw new CommunityError('年份需在 1900～2100 之间');
    return raw;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw)) || new Date(raw).toISOString().slice(0, 10) !== raw) throw new CommunityError('日期格式需为 YYYY 或 YYYY-MM-DD');
  return raw;
}

function parseCover(dataUrl: string | undefined): Promise<{ buffer: Buffer; format: 'jpg' | 'png' | 'webp' } | null> {
  return parseCoverAsync(dataUrl);
}

async function parseCoverAsync(dataUrl: string | undefined): Promise<{ buffer: Buffer; format: 'jpg' | 'png' | 'webp' } | null> {
  if (dataUrl === undefined) return null;
  if (typeof dataUrl !== 'string' || !dataUrl) throw new CommunityError('封面数据无效');
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new CommunityError('封面仅支持 JPG / PNG / WebP 的 base64 图片');
  const mime = match[1].toLowerCase();
  const format = IMAGE_MIME_EXT[mime];
  if (!format) throw new CommunityError('封面仅支持 JPG / PNG / WebP');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new CommunityError('封面内容为空');
  if (buffer.length > MAX_COVER_BYTES) throw new CommunityError('封面不能超过 4MB，请压缩后重试');
  const magic = format === 'jpg'
    ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    : format === 'png'
      ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!magic) throw new CommunityError('封面内容与图片格式不符，已拒绝保存');
  let metadata: Metadata;
  try {
    // Real decode: a valid header with a corrupted body must fail here.
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000, sequentialRead: true }).metadata();
  } catch {
    throw new CommunityError('图片已损坏或无法完整解码，请重新导出后上传');
  }
  const actualFormat = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  if (actualFormat !== format) throw new CommunityError('图片实际格式与声明不一致，已拒绝保存');
  if ((metadata.pages ?? 1) > 1) throw new CommunityError('暂不支持动图封面，请上传静态图片');
  const width = metadata.width ?? 0, height = metadata.height ?? 0;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) throw new CommunityError(`封面尺寸至少 ${MIN_DIMENSION}×${MIN_DIMENSION}`);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new CommunityError(`封面最长边不能超过 ${MAX_DIMENSION}px`);
  let encoded: Buffer;
  try {
    const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
    encoded = format === 'jpg' ? await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
      : format === 'png' ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
        : await pipeline.webp({ quality: 88 }).toBuffer();
  } catch {
    throw new CommunityError('图片无法安全重编码，请更换图片');
  }
  if (!encoded.length || encoded.length > MAX_COVER_BYTES) throw new CommunityError('重编码后的封面过大，请压缩后重试');
  return { buffer: encoded, format };
}

export class ManualWorkStore {
  private data: ManualData | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filename: string, private readonly coverDir: string) {}

  private async load(): Promise<ManualData> {
    if (this.data) return this.data;
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8')) as ManualData;
      if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.nextId) || value.nextId >= 0 || !Array.isArray(value.works)) throw new Error('自建作品数据格式无效，拒绝覆盖');
      value.works = value.works.map(work => ({
        ...work,
        coverHistory: Array.isArray(work.coverHistory) ? work.coverHistory.filter((file): file is string => typeof file === 'string') : work.coverFile ? [work.coverFile] : [],
        published: work.published === true,
        discoverable: work.discoverable === true,
      }));
      this.data = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.data = { schemaVersion: 1, nextId: -1, works: [] };
    }
    return this.data;
  }

  private mutate<T>(fn: (draft: ManualData) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(await this.load());
      const result = await fn(draft);
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

  private async read(): Promise<ManualData> { await this.tail; return this.load(); }

  /** Load once at bootstrap so the synchronous catalog provider never sees an empty list. */
  async initialize(): Promise<void> {
    await this.load();
    await mkdir(this.coverDir, { recursive: true });
  }

  worksForSync(principal?: string, extraIds: number[] = []): AnimeWork[] {
    if (!this.data) return [];
    const extra = new Set(extraIds);
    return this.data.works.filter(work => (!work.deletedAt && (work.owner === principal || work.discoverable)) || extra.has(work.id)).map(record => this.toWork(record));
  }

  canUseSync(principal: string, id: number, allowExisting = false): boolean {
    if (id >= 0) return true;
    const record = this.data?.works.find(work => work.id === id);
    if (!record) return false;
    if (allowExisting) return true;
    return !record.deletedAt && (record.owner === principal || record.discoverable);
  }

  resolveIdsSync(ids: number[]): AnimeWork[] {
    if (!this.data) return [];
    const wanted = new Set(ids);
    return this.data.works.filter(work => wanted.has(work.id)).map(record => this.toWork(record));
  }

  private toWork(record: ManualWorkRecord): AnimeWork {
    return {
      id: record.id,
      title: record.title,
      fullTitle: record.fullTitle,
      aliases: [...record.aliases],
      cover: record.coverFile ? `${COVER_PATH}${record.coverFile}` : '',
      type: record.type,
      seriesId: `manual:${record.manualId}`,
      airDate: record.airDate,
      tags: [...record.tags],
      rating: null,
      ratingCount: null,
      popularity: null,
      source: 'manual',
      manualId: record.manualId,
      seriesSource: 'manual',
      updatedAt: record.updatedAt,
    };
  }

  private page(records: ManualWorkRecord[], page: number): ManualAnimePage {
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const start = (safePage - 1) * 24;
    return { items: records.slice(start, start + 24).map(record => this.toWork(record)), total: records.length, page: safePage, nextOffset: start + 24 < records.length ? start + 24 : null };
  }

  async listMine(owner: string, query = '', page = 1): Promise<ManualAnimePage> {
    const data = await this.read();
    const q = query.trim().toLocaleLowerCase();
    return this.page(data.works.filter(work => work.owner === owner && !work.deletedAt && (!q || `${work.title} ${work.fullTitle} ${work.aliases.join(' ')} ${work.tags.join(' ')}`.toLocaleLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt), page);
  }

  async listPublished(query = '', page = 1): Promise<ManualAnimePage> {
    const data = await this.read();
    const q = query.trim().toLocaleLowerCase();
    return this.page(data.works.filter(work => work.discoverable && !work.deletedAt && (!q || `${work.title} ${work.fullTitle} ${work.aliases.join(' ')}`.toLocaleLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt), page);
  }

  /** Catalog view: only the owner's works plus works already shared through a public pool. */
  async worksFor(principal: string | undefined, extraIds: number[] = []): Promise<AnimeWork[]> {
    const data = await this.read();
    const extra = new Set(extraIds);
    return data.works.filter(work => (!work.deletedAt && (work.owner === principal || work.discoverable)) || extra.has(work.id)).map(record => this.toWork(record));
  }

  async resolveIds(ids: number[]): Promise<AnimeWork[]> {
    const data = await this.read();
    const wanted = new Set(ids);
    return data.works.filter(work => wanted.has(work.id)).map(record => this.toWork(record));
  }

  async getById(id: number): Promise<AnimeWork | null> {
    const data = await this.read();
    const record = data.works.find(work => work.id === id);
    return record ? this.toWork(record) : null;
  }

  async create(owner: string, input: unknown): Promise<AnimeWork> {
    const body = (input ?? {}) as ManualAnimeInput;
    const cover = await parseCover(body.coverDataUrl);
    const title = text(body.title, 100, true);
    const parsed = {
      title,
      fullTitle: text(body.fullTitle, 140) || title,
      aliases: stringList(body.aliases, 20, 100, '别名'),
      type: TYPES.includes(body.type as AnimeWork['type']) ? body.type as AnimeWork['type'] : '未知',
      airDate: normalizeAirDate(body.airDate),
      tags: stringList(body.tags, 10, 30, '标签'),
    };
    let coverFile: string | null = null;
    if (cover) {
      coverFile = await this.writeCover(cover);
    }
    try {
      return await this.mutate(data => {
        if (data.works.filter(work => work.owner === owner && !work.deletedAt).length >= 300) throw new CommunityError('每个身份最多创建 300 个自建作品');
        const id = data.nextId;
        data.nextId -= 1;
        const timestamp = Date.now();
        const record: ManualWorkRecord = { ...parsed, id, manualId: crypto.randomUUID(), owner, coverFile, coverHistory: coverFile ? [coverFile] : [], published: false, discoverable: false, createdAt: timestamp, updatedAt: timestamp };
        data.works.push(record);
        return this.toWork(record);
      });
    } catch (error) {
      if (coverFile) await rm(path.join(this.coverDir, coverFile), { force: true });
      throw error;
    }
  }

  async update(owner: string, id: number, input: unknown): Promise<AnimeWork> {
    const body = (input ?? {}) as ManualAnimeInput;
    const cover = body.coverDataUrl ? await parseCover(body.coverDataUrl) : null;
    let coverFile: string | null = null;
    try {
      const current = await this.read();
      const existing = current.works.find(work => work.id === id);
      if (!existing) throw new CommunityError('自建作品不存在', 404);
      if (existing.owner !== owner) throw new CommunityError('无权修改此自建作品', 403);
      if (existing.deletedAt) throw new CommunityError('此自建作品已删除', 404);
      if (cover) coverFile = await this.writeCover(cover);
      return await this.mutate(data => {
        const record = data.works.find(work => work.id === id);
        if (!record || record.owner !== owner || record.deletedAt) throw new CommunityError('自建作品不存在', 404);
        // Re-check inside the serialized write so two tabs cannot both pass a stale version.
        if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== record.updatedAt) throw new CommunityError('作品已被更新，请刷新后重试', 409);
        if (body.title !== undefined) record.title = text(body.title, 100, true);
        if (body.fullTitle !== undefined) record.fullTitle = text(body.fullTitle, 140) || record.title;
        if (body.aliases !== undefined) record.aliases = stringList(body.aliases, 20, 100, '别名');
        if (body.tags !== undefined) record.tags = stringList(body.tags, 10, 30, '标签');
        if (body.airDate !== undefined) record.airDate = normalizeAirDate(body.airDate);
        if (body.type !== undefined && TYPES.includes(body.type as AnimeWork['type'])) record.type = body.type as AnimeWork['type'];
        if (coverFile || body.removeCover === true) {
          const previous = record.coverFile;
          if (previous && !record.coverHistory.includes(previous)) record.coverHistory.push(previous);
          record.coverFile = body.removeCover === true ? null : coverFile;
        }
        record.updatedAt = Date.now();
        return this.toWork(record);
      });
    } catch (error) {
      if (coverFile) await rm(path.join(this.coverDir, coverFile), { force: true });
      throw error;
    }
  }

  async remove(owner: string, id: number): Promise<void> {
    return this.mutate(data => {
      const record = data.works.find(work => work.id === id);
      if (!record) throw new CommunityError('自建作品不存在', 404);
      if (record.owner !== owner) throw new CommunityError('无权删除此自建作品', 403);
      if (record.deletedAt) return;
      record.deletedAt = Date.now();
      record.discoverable = false;
      record.updatedAt = Date.now();
      // Keep the file and metadata: copied public pools and frozen replays may still reference it.
    });
  }

  /**
   * Recompute public discoverability from currently public, non-hidden pools.
   * `published` stays true as an "ever shared" marker so already-copied pools keep working.
   */
  async syncPublication(discoverableIds: number[]): Promise<void> {
    const wanted = new Set(discoverableIds);
    return this.mutate(data => {
      for (const work of data.works) {
        const discoverable = !work.deletedAt && wanted.has(work.id);
        work.discoverable = discoverable;
        if (discoverable) work.published = true;
      }
    });
  }

  async coverPath(file: string): Promise<string | null> {
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(file)) return null;
    const target = path.resolve(this.coverDir, file);
    if (path.dirname(target) !== path.resolve(this.coverDir)) return null;
    const data = await this.read();
    // Historical covers stay addressable for old replays and revoked covers.
    return data.works.some(work => work.coverFile === file || work.coverHistory.includes(file)) ? target : null;
  }

  private async writeCover(cover: { buffer: Buffer; format: 'jpg' | 'png' | 'webp' }): Promise<string> {
    await mkdir(this.coverDir, { recursive: true });
    const file = `${crypto.randomUUID()}.${cover.format}`;
    const target = path.join(this.coverDir, file);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, cover.buffer, { mode: 0o600 });
    await rename(temporary, target);
    return file;
  }
}
