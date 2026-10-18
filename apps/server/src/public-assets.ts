import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { fetchReplayCover } from './replay-cover.js';

/** Regenerable cache only: never stores room state, credentials or original uploads. */
export class PublicAssets {
  private avatars = new Map<string, string>();
  private avatarBytes = 0;
  private pending = new Map<string, Promise<Buffer>>();
  private active = 0;
  private queue: (() => void)[] = [];
  private lastPrune = 0;
  constructor(private directory: string, private fetcher: typeof fetch = fetch) {}

  private file(kind: string, key: string) { return path.join(this.directory, `${kind}-${key}.webp`); }
  private async save(filename: string, data: Buffer) {
    await mkdir(this.directory, { recursive: true });
    const temp = `${filename}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, filename);
    // Bound regenerable disk use. Reads and in-flight coalescing do not accumulate buffers.
    if (Date.now() - this.lastPrune > 60_000) {
      this.lastPrune = Date.now();
      void this.prune().catch(() => {});
    }
  }
  private async prune() {
    const entries = await Promise.all((await readdir(this.directory)).filter(n => /^(cover|avatar)-[a-f0-9]{64}\.webp$/.test(n)).map(async n => {
      const filename = path.join(this.directory, n), info = await stat(filename);
      return { filename, bytes: info.size, at: info.mtimeMs };
    }));
    let total = entries.reduce((n, f) => n + f.bytes, 0);
    for (const entry of entries.sort((a, b) => a.at - b.at)) {
      if (total <= 128 * 1024 * 1024) break;
      await unlink(entry.filename).catch(() => {}); total -= entry.bytes;
    }
  }
  private async cached(kind: string, key: string, load: () => Promise<Buffer>): Promise<Buffer> {
    const filename = this.file(kind, key);
    const existing = this.pending.get(filename); if (existing) return existing;
    if (this.pending.size >= 128) throw new Error('图片队列繁忙，请重试');
    const request = (async () => {
      try { return await readFile(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // CDN misses must not queue small local avatars behind remote timeouts.
      if (kind === 'cover' && this.active >= 4) await new Promise<void>(resolve => this.queue.push(resolve));
      if (kind === 'cover') this.active++;
      try { const data = await load(); await this.save(filename, data); return data; }
      finally { if (kind === 'cover') { this.active--; this.queue.shift()?.(); } }
    })();
    this.pending.set(filename, request);
    try { return await request; } finally { this.pending.delete(filename); }
  }
  avatar(source: string): string {
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(source) || source.length > 300_000) return source;
    let key = this.avatars.get(source);
    if (!key) {
      key = crypto.createHash('sha256').update(source).digest('hex');
      while (this.avatars.size && (this.avatars.size >= 512 || this.avatarBytes + source.length > 24 * 1024 * 1024)) {
        const oldest = this.avatars.keys().next().value!;
        this.avatarBytes -= oldest.length; this.avatars.delete(oldest);
      }
      this.avatars.set(source, key);
      this.avatarBytes += source.length;
    }
    return `/api/profile-avatars/${key}`;
  }
  async readAvatar(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('头像不存在');
    return this.cached('avatar', key, async () => {
      const source = [...this.avatars].find(([, hash]) => hash === key)?.[0];
      if (!source) throw new Error('头像不存在');
      return sharp(Buffer.from(source.split(',')[1], 'base64'), { limitInputPixels: 16_000_000 }).resize(96, 96, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    });
  }
  async cover(source: string) {
    // fetchReplayCover revalidates the server-selected CDN, redirects, MIME, size and timeout.
    const key = crypto.createHash('sha256').update(source).digest('hex');
    return this.cached('cover', key, async () => {
      const image = await fetchReplayCover(source, this.fetcher);
      return sharp(image.data, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    });
  }
  /** Leaves private source objects untouched, including legacy data-URI account avatars. */
  wire<T>(value: T): T {
    const visit = (item: unknown, key?: string): unknown => {
      if (key === 'avatarUrl' && typeof item === 'string') return this.avatar(item);
      if (Array.isArray(item)) return item.map(v => visit(v));
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, visit(v, k)]));
      return item;
    };
    return visit(value) as T;
  }
}
