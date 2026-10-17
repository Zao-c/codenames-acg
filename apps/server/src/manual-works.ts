import crypto from 'node:crypto';
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
  published: boolean;
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

function readDimensions(buffer: Buffer, format: 'jpg' | 'png' | 'webp'): { width: number; height: number } {
  if (format === 'png') {
    if (buffer.length < 24) throw new CommunityError('PNG 封面数据不完整');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (format === 'jpg') {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    throw new CommunityError('无法读取 JPEG 封面尺寸，请重新导出图片');
  }
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') throw new CommunityError('WebP 封面格式无效');
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (kind === 'VP8X' && data + 10 <= buffer.length) {
      return { width: 1 + buffer.readUIntLE(data + 4, 3), height: 1 + buffer.readUIntLE(data + 7, 3) };
    }
    if (kind === 'VP8L' && data + 5 <= buffer.length && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (kind === 'VP8 ' && data + 10 <= buffer.length && buffer[data + 3] === 0x9d && buffer[data + 4] === 0x01 && buffer[data + 5] === 0x2a) {
      return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff };
    }
    offset = data + size + (size % 2);
  }
  throw new CommunityError('无法读取 WebP 封面尺寸，请重新导出图片');
}

/** Drop EXIF/XMP/text metadata without re-encoding pixel data. */
function stripMetadata(buffer: Buffer, format: 'jpg' | 'png' | 'webp'): Buffer {
  if (format === 'jpg') {
    const parts: Buffer[] = [buffer.subarray(0, 2)];
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) { parts.push(buffer.subarray(offset)); break; }
      const marker = buffer[offset + 1];
      if (marker === 0xda) { parts.push(buffer.subarray(offset)); break; }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) { parts.push(buffer.subarray(offset)); break; }
      const drop = marker === 0xe1 || marker === 0xfe || marker === 0xed; // EXIF/XMP, comment, Photoshop
      if (!drop) parts.push(buffer.subarray(offset, offset + 2 + length));
      offset += 2 + length;
    }
    return Buffer.concat(parts);
  }
  if (format === 'png') {
    const signature = buffer.subarray(0, 8);
    const kept: Buffer[] = [signature];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const total = 12 + length;
      if (offset + total > buffer.length) break;
      const kind = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(kind)) kept.push(buffer.subarray(offset, offset + total));
      offset += total;
    }
    return Buffer.concat(kept);
  }
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') throw new CommunityError('WebP 封面格式无效');
  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const kind = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const total = 8 + size + (size % 2);
    if (offset + total > buffer.length) break;
    if (kind !== 'EXIF' && kind !== 'XMP ') chunks.push(buffer.subarray(offset, offset + total));
    offset += total;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.from('WEBP', 'ascii');
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([riff, header, body]);
}

function parseCover(dataUrl: string | undefined): { buffer: Buffer; format: 'jpg' | 'png' | 'webp' } | null {
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
  const { width, height } = readDimensions(buffer, format);
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) throw new CommunityError(`封面尺寸至少 ${MIN_DIMENSION}×${MIN_DIMENSION}`);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new CommunityError(`封面最长边不能超过 ${MAX_DIMENSION}px`);
  return { buffer: stripMetadata(buffer, format), format };
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
    return this.data.works.filter(work => (!work.deletedAt && (work.owner === principal || work.published)) || extra.has(work.id)).map(record => this.toWork(record));
  }

  canUseSync(principal: string, id: number): boolean {
    if (id >= 0) return true;
    const record = this.data?.works.find(work => work.id === id);
    return !!record && !record.deletedAt && (record.owner === principal || record.published);
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
    return { items: records.slice((safePage - 1) * 24, safePage * 24).map(record => this.toWork(record)), total: records.length, page: safePage };
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
    return this.page(data.works.filter(work => work.published && !work.deletedAt && (!q || `${work.title} ${work.fullTitle} ${work.aliases.join(' ')}`.toLocaleLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt), page);
  }

  /** Catalog view: only the owner's works plus works already shared through a public pool. */
  async worksFor(principal: string | undefined, extraIds: number[] = []): Promise<AnimeWork[]> {
    const data = await this.read();
    const extra = new Set(extraIds);
    return data.works.filter(work => (!work.deletedAt && (work.owner === principal || work.published)) || extra.has(work.id)).map(record => this.toWork(record));
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
    const cover = parseCover(body.coverDataUrl);
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
        const record: ManualWorkRecord = { ...parsed, id, manualId: crypto.randomUUID(), owner, coverFile, published: false, createdAt: timestamp, updatedAt: timestamp };
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
    const cover = body.coverDataUrl ? parseCover(body.coverDataUrl) : null;
    let coverFile: string | null = null;
    try {
      const current = await this.read();
      const existing = current.works.find(work => work.id === id);
      if (!existing) throw new CommunityError('自建作品不存在', 404);
      if (existing.owner !== owner) throw new CommunityError('无权修改此自建作品', 403);
      if (existing.deletedAt) throw new CommunityError('此自建作品已删除', 404);
      if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== existing.updatedAt) throw new CommunityError('作品已被更新，请刷新后重试', 409);
      if (cover) coverFile = await this.writeCover(cover);
      const previousCover = existing.coverFile;
      return await this.mutate(data => {
        const record = data.works.find(work => work.id === id);
        if (!record || record.owner !== owner || record.deletedAt) throw new CommunityError('自建作品不存在', 404);
        if (body.title !== undefined) record.title = text(body.title, 100, true);
        if (body.fullTitle !== undefined) record.fullTitle = text(body.fullTitle, 140) || record.title;
        if (body.aliases !== undefined) record.aliases = stringList(body.aliases, 20, 100, '别名');
        if (body.tags !== undefined) record.tags = stringList(body.tags, 10, 30, '标签');
        if (body.airDate !== undefined) record.airDate = normalizeAirDate(body.airDate);
        if (body.type !== undefined && TYPES.includes(body.type as AnimeWork['type'])) record.type = body.type as AnimeWork['type'];
        if (coverFile) record.coverFile = coverFile;
        else if (body.removeCover === true) record.coverFile = null;
        record.updatedAt = Date.now();
        return this.toWork(record);
      }).then(async result => {
        if (previousCover && previousCover !== result.cover && (coverFile || body.removeCover === true)) await rm(path.join(this.coverDir, previousCover), { force: true });
        return result;
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
      record.updatedAt = Date.now();
      // Keep the file and metadata: copied public pools and frozen replays may still reference it.
    });
  }

  /** Called by the pool store when a pool containing manual works becomes public. */
  async markPublished(ids: number[]): Promise<void> {
    const wanted = new Set(ids);
    return this.mutate(data => {
      for (const work of data.works) if (wanted.has(work.id)) work.published = true;
    });
  }

  async coverPath(file: string): Promise<string | null> {
    if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(file)) return null;
    const target = path.resolve(this.coverDir, file);
    if (path.dirname(target) !== path.resolve(this.coverDir)) return null;
    const data = await this.read();
    return data.works.some(work => work.coverFile === file) ? target : null;
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
