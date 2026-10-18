import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { CommunityError } from './anime-pool-store.js';
import { ManualWorkStore } from './manual-works.js';
import { principalFromKey } from './private-identity.js';

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function principal(req: Request): string {
  return principalFromKey(req.header('x-private-key'));
}

export function manualWorkRouter(store: ManualWorkStore, options: { enabled: boolean }) {
  const router = Router();
  const writable = () => { if (!options.enabled) throw new CommunityError('自建作品暂未开放', 503); };
  const route = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) {
      if (error instanceof CommunityError) res.status(error.status).json({ message: error.message });
      else if (error instanceof Error && error.message.startsWith('私人身份凭证')) res.status(401).json({ message: '需要有效的作品池身份凭证' });
      else { console.error('Manual anime storage request failed'); res.status(500).json({ message: '自建作品操作未完成，请稍后重试' }); }
    }
  };
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: '操作太频繁，请稍后重试' } });
  const id = (req: Request): number => {
    const value = Number(req.params.workId);
    if (!Number.isSafeInteger(value) || value >= 0) throw new CommunityError('自建作品 ID 无效', 400);
    return value;
  };

  router.get('/', route(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    const page = Number(req.query.page ?? 1);
    if (req.query.scope === 'public') res.json(await store.listPublished(query, page));
    else res.json(await store.listMine(principal(req), query, page));
  }));
  router.post('/', writeLimiter, route(async (req, res) => { writable(); res.status(201).json(await store.create(principal(req), req.body)); }));
  router.put('/:workId', writeLimiter, route(async (req, res) => { writable(); res.json(await store.update(principal(req), id(req), req.body)); }));
  router.delete('/:workId', writeLimiter, route(async (req, res) => { writable(); await store.remove(principal(req), id(req)); res.json({ ok: true }); }));
  return router;
}

/** Opaque, content-addressed cover files; only files registered to a manual work are served. */
export function manualCoverRouter(store: ManualWorkStore) {
  const router = Router();
  router.get('/:file', async (req, res) => {
    try {
      const file = String(req.params.file);
      if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(file)) { res.status(404).end(); return; }
      const target = await store.coverPath(file);
      if (!target) { res.status(404).end(); return; }
      const info = await stat(target).catch(() => null);
      if (!info || !info.isFile()) { res.status(404).end(); return; }
      const etag = `"${crypto.createHash('sha1').update(`${file}:${info.size}:${info.mtimeMs}`).digest('hex')}"`;
      res.setHeader('Content-Type', MIME[file.split('.').pop()!] ?? 'application/octet-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', etag);
      if (req.header('if-none-match') === etag) { res.status(304).end(); return; }
      createReadStream(target).on('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
    } catch {
      res.status(404).end();
    }
  });
  return router;
}
