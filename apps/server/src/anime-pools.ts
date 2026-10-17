import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AnimePoolStore, CommunityError } from './anime-pool-store.js';
import { principalFromKey } from './private-identity.js';

export function animePoolRouter(store: AnimePoolStore, options: { enabled: boolean; adminKey: string }) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: '读取太频繁，请稍后重试' } }));
  const principal = (req: Request) => principalFromKey(req.header('x-private-key'));
  const optionalPrincipal = (req: Request) => req.header('x-private-key') ? principal(req) : undefined;
  const admin = (req: Request) => {
    const provided = req.header('x-anime-admin-key');
    if (!provided || options.adminKey.length < 32 || !crypto.timingSafeEqual(crypto.createHash('sha256').update(provided).digest(), crypto.createHash('sha256').update(options.adminKey).digest())) throw new CommunityError('管理员凭证无效', 403);
  };
  const writable = () => { if (!options.enabled) throw new CommunityError('作品池发布暂未开放', 503); };
  const route = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) {
      if (error instanceof CommunityError) res.status(error.status).json({ message: error.message });
      else if (error instanceof Error && error.message.startsWith('私人身份凭证')) res.status(401).json({ message: '需要有效的作品池身份凭证' });
      else { console.error('Anime community storage request failed'); res.status(500).json({ message: '作品池操作未完成，请稍后重试' }); }
    }
  };
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: '操作太频繁，请稍后重试' } });
  router.get('/', route(async (req, res) => {
    const result = await store.list(optionalPrincipal(req), { q: typeof req.query.q === 'string' ? req.query.q : '', page: Number(req.query.page ?? 1), scope: typeof req.query.scope === 'string' ? req.query.scope : 'public' });
    res.json({ ...result, enabled: options.enabled });
  }));
  router.get('/moderation', route(async (req, res) => { admin(req); res.json({ items: await store.moderation() }); }));
  router.post('/', writeLimiter, route(async (req, res) => { writable(); res.status(201).json(await store.create(principal(req), req.body)); }));
  router.get('/:poolId', route(async (req, res) => { res.json(await store.get(String(req.params.poolId), optionalPrincipal(req))); }));
  router.put('/:poolId', writeLimiter, route(async (req, res) => { writable(); res.json(await store.update(String(req.params.poolId), principal(req), req.body)); }));
  router.delete('/:poolId', writeLimiter, route(async (req, res) => { await store.delete(String(req.params.poolId), principal(req)); res.json({ ok: true }); }));
  router.post('/:poolId/copy', writeLimiter, route(async (req, res) => { writable(); res.status(201).json(await store.copy(String(req.params.poolId), principal(req))); }));
  router.put('/:poolId/favorite', writeLimiter, route(async (req, res) => { writable(); await store.favorite(String(req.params.poolId), principal(req), req.body?.value); res.json({ ok: true }); }));
  router.post('/:poolId/report', writeLimiter, route(async (req, res) => { await store.report(String(req.params.poolId), principal(req), req.body?.reason); res.json({ ok: true }); }));
  router.put('/:poolId/moderation', writeLimiter, route(async (req, res) => { admin(req); await store.moderate(String(req.params.poolId), req.body?.hidden, req.body?.reason); res.json({ ok: true }); }));
  return router;
}
