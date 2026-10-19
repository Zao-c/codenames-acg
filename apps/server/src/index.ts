import { animeCatalog, animeCatalogFor, animePools, initializeAnimeCatalog, registerManualCatalog } from "./anime-catalog.js";
import { BangumiAdapter } from './bangumi.js';
import cors from "cors";
import compression from "compression";
import path from "node:path";
import { PublicAssets } from "./public-assets.js";
import { RoomTransport } from "@acg-codenames/shared";
import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  BOARD_MODE_CONFIG,
  MatchEventLedger,
  MAX_AVATAR_DATA_URL_LENGTH,
  type BoardMode,
  type RevealGuessSettings,
  type ScoringMode,
  type TimerMode,
  type FlipMode,
  type ChatReaction,
  type ClientToServerEvents,
  type CustomWordPackInput,
  type ParticipantType,
  type PlayerRole,
  sanitizeRoundHighlightsForPhase,
  roomTurnKey,
  type ServerToClientEvents,
  type Team,
  type UpdateNamedUserPayload,
  type UserProfile
} from "@acg-codenames/shared";
import { env } from "./env.js";
import { GameService, buildAchievementUnlocksFromHighlight } from "./game.js";
import * as RevealGuess from "./reveal-guess.js";
import { RevealImageAssetStore } from "./reveal-image-assets.js";
import { REPLAY_TTL_SECONDS, createRoomStore } from "./store.js";
import type { ReplayStore } from "./types.js";
import { JsonUserStore } from "./user-store.js";
import { principalFromKey } from './private-identity.js';
import { AnimePoolStore, CommunityError } from './anime-pool-store.js';
import { animePoolRouter } from './anime-pools.js';
import { ManualWorkStore } from './manual-works.js';
import { manualCoverRouter, manualWorkRouter } from './manual-works-api.js';
import { fetchReplayCover } from './replay-cover.js';
import {RoomBroadcastQueue} from './room-broadcast.js';

type PayloadRecord = Record<string, unknown>;

function asObject(value: unknown): PayloadRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求参数格式无效");
  }
  return value as PayloadRecord;
}

function requireString(record: PayloadRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${key} 参数无效`);
  }
  return value;
}

function requireNumber(record: PayloadRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} 参数无效`);
  }
  return value;
}

function requireRoomId(payload: unknown): string {
  return requireString(asObject(payload), "roomId");
}

function optionalTeam(value: unknown): Team | null {
  if (value === null) {
    return null;
  }
  if (value === "red" || value === "blue") {
    return value;
  }
  throw new Error("team 参数无效");
}

function requirePlayerRole(value: unknown): PlayerRole {
  if (value === "spymaster" || value === "operative") {
    return value;
  }
  throw new Error("role 参数无效");
}

function requireBoardMode(value: unknown): BoardMode {
  if (typeof value === "string" && value in BOARD_MODE_CONFIG) {
    return value as BoardMode;
  }
  throw new Error("boardMode 参数无效");
}

function requireScoringMode(value: unknown): ScoringMode {
  if (value === "classic" || value === "scoring" || value === "gamble") {
    return value;
  }
  throw new Error("scoringMode 参数无效");
}

function requireTimerMode(value: unknown): TimerMode {
  if (value === "unlimited" || value === "timed") {
    return value;
  }
  throw new Error("timerMode 参数无效");
}

function requireFlipMode(value: unknown): FlipMode {
  if (value === "word-color" || value === "color-only") {
    return value;
  }
  throw new Error("flipMode 参数无效");
}

function requirePositiveInt(value: unknown, fieldName: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 600 || !Number.isInteger(n)) {
    throw new Error(`${fieldName} 参数无效`);
  }
  return n;
}

function requireReaction(value: unknown): ChatReaction {
  if (value === "flower" || value === "egg") {
    return value;
  }
  throw new Error("reaction 参数无效");
}

function requireParticipantType(value: unknown): ParticipantType {
  if (value === "player" || value === "spectator") {
    return value;
  }
  throw new Error("targetParticipantType 参数无效");
}

function optionalProfile(value: unknown): Partial<UserProfile> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const profile = asObject(value);
  const accountType = profile.accountType;
  if (accountType !== undefined && accountType !== "guest" && accountType !== "named") {
    throw new Error("accountType 参数无效");
  }
  const username = profile.username;
  if (username !== undefined && username !== null && typeof username !== "string") {
    throw new Error("username 参数无效");
  }
  const avatarUrl = profile.avatarUrl;
  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
    throw new Error("avatarUrl 参数无效");
  }
  return {
    accountType: accountType as UserProfile["accountType"] | undefined,
    username: username as string | null | undefined,
    avatarUrl: avatarUrl as string | null | undefined
  };
}

function optionalUserSessionToken(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}

function parseUpdateRoomSettingsPayload(value: unknown): {
  roomId: string;
  boardMode?: BoardMode;
  builtinWordPackId?: string;
  customWordPack?: CustomWordPackInput | null;
  scoringMode?: ScoringMode;
  timerMode?: TimerMode;
  timerClueSeconds?: number;
  timerGuessSeconds?: number;
  timerFirstRoundBonus?: boolean;
  neutralCount?: number | null;
  flipMode?: FlipMode;
} {
  const body = asObject(value);
  const parsed: {
    roomId: string;
    boardMode?: BoardMode;
    builtinWordPackId?: string;
    customWordPack?: CustomWordPackInput | null;
    scoringMode?: ScoringMode;
    timerMode?: TimerMode;
    timerClueSeconds?: number;
    timerGuessSeconds?: number;
    timerFirstRoundBonus?: boolean;
    neutralCount?: number | null;
    flipMode?: FlipMode;
  } = { roomId: requireString(body, "roomId") };
  if (body.boardMode !== undefined) {
    parsed.boardMode = requireBoardMode(body.boardMode);
  }
  if (body.builtinWordPackId !== undefined) {
    parsed.builtinWordPackId = requireString(body, "builtinWordPackId");
  }
  if (body.customWordPack !== undefined) {
    if (body.customWordPack === null) {
      parsed.customWordPack = null;
    } else {
      const pack = asObject(body.customWordPack);
      const entries = pack.entries;
      if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) {
        throw new Error("customWordPack.entries 参数无效");
      }
      parsed.customWordPack = {
        name: requireString(pack, "name"),
        entries
      };
    }
  }
  if (body.scoringMode !== undefined) {
    parsed.scoringMode = requireScoringMode(body.scoringMode);
  }
  if (body.timerMode !== undefined) {
    parsed.timerMode = requireTimerMode(body.timerMode);
  }
  if (body.timerClueSeconds !== undefined) {
    parsed.timerClueSeconds = requirePositiveInt(body.timerClueSeconds, "timerClueSeconds");
  }
  if (body.timerGuessSeconds !== undefined) {
    parsed.timerGuessSeconds = requirePositiveInt(body.timerGuessSeconds, "timerGuessSeconds");
  }
  if (body.timerFirstRoundBonus !== undefined) {
    parsed.timerFirstRoundBonus = Boolean(body.timerFirstRoundBonus);
  }
  if (body.neutralCount !== undefined) {
    if (body.neutralCount === null) {
      parsed.neutralCount = null;
    } else {
      parsed.neutralCount = requirePositiveInt(body.neutralCount, "neutralCount");
    }
  }
  if (body.flipMode !== undefined) {
    parsed.flipMode = requireFlipMode(body.flipMode);
  }
  return parsed;
}

function parseUpdateNamedUserPayload(value: unknown): UpdateNamedUserPayload {
  const body = asObject(value);
  const parsed: UpdateNamedUserPayload = {};
  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl !== null && typeof body.avatarUrl !== "string") {
      throw new Error("avatarUrl 参数无效");
    }
    if (typeof body.avatarUrl === "string" && body.avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
      throw new Error("头像图片过大");
    }
    parsed.avatarUrl = body.avatarUrl;
  }
  if (body.title !== undefined) {
    if (body.title !== null && (typeof body.title !== 'string' || body.title.length > 24)) throw new Error("title 参数无效");
    parsed.title = body.title as string | null;
  }
  if (body.customWordPacks !== undefined) {
    if (!Array.isArray(body.customWordPacks)) {
      throw new Error("customWordPacks 参数无效");
    }
    parsed.customWordPacks = body.customWordPacks as UpdateNamedUserPayload["customWordPacks"];
  }
  if (body.customImagePacks !== undefined) {
    if (!Array.isArray(body.customImagePacks)) {
      throw new Error("customImagePacks 参数无效");
    }
    parsed.customImagePacks = body.customImagePacks as UpdateNamedUserPayload["customImagePacks"];
  }
  return parsed;
}

function requireAnswerType(value: unknown): "priority" | "buzz" | "formal" {
  if (value === "priority" || value === "buzz" || value === "formal") {
    return value;
  }
  throw new Error("answer type 参数无效");
}

function requireVerdict(value: unknown): "correct" | "wrong" | "partial" {
  if (value === "correct" || value === "wrong" || value === "partial") {
    return value;
  }
  throw new Error("verdict 参数无效");
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("参数无效，期望数组");
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") throw new Error(`数组第 ${i} 项参数无效`);
  }
  return value as string[];
}

function requireNonEmptyInt(value: unknown, fieldName: string, min?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || (min !== undefined && n < min)) {
    throw new Error(`${fieldName} 参数无效`);
  }
  return n;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return Boolean(value);
}

function acknowledge(reply: unknown, result: import('@acg-codenames/shared').ActionReply): void { if (typeof reply === 'function') reply(result); }

async function bootstrap(): Promise<void> {
  // dotenv can load an operator-provided proxy after Node initialized its default agent.
  if(process.env.NODE_USE_ENV_PROXY==='1'){
    const http=await import('node:http') as typeof import('node:http') & {setGlobalProxyFromEnv?:()=>void};
    http.setGlobalProxyFromEnv?.();
  }
  await initializeAnimeCatalog(env.animeImportFile);
  const store = await createRoomStore(env.redisUrl, env.useMemoryStore);
  const users = new JsonUserStore(env.userStoreFile);
  const manualWorks = new ManualWorkStore(env.manualWorkStoreFile, env.animeCoverDir);
  await manualWorks.initialize();
  registerManualCatalog((principal, extraIds) => manualWorks.worksForSync(principal, extraIds));
  const communityPools = new AnimePoolStore(env.animePoolStoreFile, (principal?: string, extraIds: number[] = []) => animeCatalogFor(principal, extraIds), {
    canUseWork: (principal, workId, allowExisting) => manualWorks.canUseSync(principal, workId, allowExisting),
    onPublicationChange: ids => manualWorks.syncPublication(ids),
  });
  try { await manualWorks.syncPublication(await communityPools.publicWorkIds()); }
  catch (error) { console.error('Failed to restore manual work publication state', error); }
  const bangumi=new BangumiAdapter();
  const revealImages = new RevealImageAssetStore(env.revealImageDir);
  await revealImages.ensureReady();
  const optionalMs = (value: string | undefined) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  const game = new GameService(store, users, { enableDebugTools: env.enableDebugTools, disconnectKickDelayMs: optionalMs(process.env.DISCONNECT_KICK_DELAY_MS), hostTakeoverGraceMs: optionalMs(process.env.HOST_TAKEOVER_GRACE_MS), enableAnimeDraft: env.enableAnimeDraft, enableMatchAnalysis: env.enableMatchAnalysis, enablePredictions: env.enablePredictions, resolveCommunityPool: (id, principal) => communityPools.get(id, principal), resolveManualWorks: ids => manualWorks.resolveIds(ids) }, store);
  const privatePrincipal = (body: PayloadRecord) => body.identityKey !== undefined || env.enableMatchAnalysis ? principalFromKey(body.identityKey) : undefined;
  const app = express();
  const httpServer = createServer(app);
  const allowedOrigins = env.clientOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    }
  });

  const socketSessions = new Map<string, { roomId: string; participantId: string; participantType: ParticipantType }>();
  // Test-only fault injection for create-room atomicity; never enabled in production.
  let createdRoomCount = 0;
  const failCreateAfter = Number(process.env.SIMULATE_CREATE_FAILURE_AFTER);
  function maybeFailCreate(): void {
    if (!Number.isFinite(failCreateAfter) || failCreateAfter < 0) return;
    if (createdRoomCount >= failCreateAfter) throw new Error('模拟创建房间失败，请稍后重试');
    createdRoomCount += 1;
  }

  const assets = new PublicAssets(path.join(path.dirname(env.userStoreFile), "public-cache"));
  const transports = new WeakMap<object, RoomTransport>();
  const deltaSockets = new WeakSet<object>();
  function emitRoom(socket: import("socket.io").Socket<ClientToServerEvents, ServerToClientEvents>, state: import("@acg-codenames/shared").PublicRoomState, full = false) {
    const wire = assets.wire(state);
    if (!deltaSockets.has(socket)) { socket.emit("room_state", wire); return; }
    let transport = transports.get(socket);
    if (!transport) { transport = new RoomTransport(); transports.set(socket, transport); }
    const next = transport.next(wire, full);
    if (next.snapshot) socket.emit("room_state", next.snapshot);
    else if (next.delta) socket.emit("room_state_delta", next.delta);
  }
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(compression({ threshold: 1024 }));
  app.use(helmet());
  app.use(express.json({ limit: "50mb" }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false
  });

  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
  });

  const socketRateCounters = new Map<string, Map<string, { count: number; resetAt: number }>>();

  function checkSocketRate(socketId: string, action: string, limit: number, windowMs: number): void {
    let actionMap = socketRateCounters.get(socketId);
    if (!actionMap) {
      actionMap = new Map();
      socketRateCounters.set(socketId, actionMap);
    }
    const now = Date.now();
    let entry = actionMap.get(action);
    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      actionMap.set(action, entry);
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      throw new Error("操作太频繁，请稍后再试");
    }
  }

  app.use('/api/anime-pools', animePoolRouter(communityPools, { enabled: env.enableAnimeCommunity, adminKey: env.animePoolAdminKey }));
  app.use('/api/anime/manual', manualWorkRouter(manualWorks, { enabled: env.enableAnimeManual }));
  app.use('/api/anime/covers', manualCoverRouter(manualWorks));
  const discoveryLimiter=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false,message:{message:'搜索或导入过于频繁，请稍后重试'}});
  for(const action of ['search','import'] as const)app.post(`/api/anime/discovery/${action}`,discoveryLimiter,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      if(!env.enableAnimeCommunity)throw new CommunityError('动画发现暂未开放',503);
      principalFromKey(req.header('x-private-key'));
      if(action==='search'&&req.body?.source==='manual'){
        const owner=principalFromKey(req.header('x-private-key'));
        const q=typeof req.body?.q==='string'?req.body.q.slice(0,100):'';
        const offset=Number.isSafeInteger(req.body?.offset)&&req.body.offset>0?req.body.offset:0;
        const page=Math.floor(offset/24)+1;
        const mine=await manualWorks.listMine(owner,q,page);
        res.json({works:mine.items,total:mine.total,nextOffset:mine.nextOffset,source:'manual',notice:'自建作品：可继续加载更多；Bangumi 未收录的作品也能与 Bangumi 作品混合保存到同一作品池。',updatedAt:Date.now(),missingMetadata:mine.items.filter(w=>!w.cover).length});
        return;
      }
      res.json(action==='search'?await bangumi.discover(req.body):await bangumi.import(req.body?.input));
    }
    catch(error){res.status(error instanceof CommunityError?error.status:400).json({message:error instanceof Error?error.message:'动画发现未完成，请重试'});}
  });
  app.get('/api/profile-avatars/:key', async (req, res) => {
    try { const data = await assets.readAvatar(req.params.key); res.set({'Content-Type':'image/webp','Cache-Control':'public, max-age=604800, immutable','Cross-Origin-Resource-Policy':'cross-origin'}).send(data); }
    catch { res.set('Cache-Control','no-store').status(404).end(); }
  });
  const coverLimiter = rateLimit({windowMs:60_000,limit:3000,standardHeaders:true,legacyHeaders:false});
  app.get('/api/anime/cover/:id', coverLimiter, async (req, res) => {
    const id = Number(req.params.id);
    const work = Number.isSafeInteger(id) && id > 0 ? animeCatalog().find(work => work.id === id) : undefined;
    if (!work?.cover) { res.status(404).end(); return; }
    try { const data = await assets.cover(work.cover); res.set({'Content-Type':'image/webp','Cache-Control':'public, max-age=86400','Cross-Origin-Resource-Policy':'cross-origin'}).send(data); }
    catch { res.set('Cache-Control','no-store').status(503).end(); }
  });
  const metadataLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { message: '目录读取太频繁，请稍后重试' } });
  app.get('/api/features', metadataLimiter, (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ animeCommunity: env.enableAnimeCommunity }); });
  app.get('/api/anime/home-covers', metadataLimiter, (_req, res) => {
    const works = animeCatalog().filter(work => work.cover).slice(0, 24).map(({id,title,fullTitle,cover}) => ({id,title,fullTitle,cover}));
    res.set('Cache-Control','public, max-age=300').json({works});
  });
  app.get('/api/anime/catalog', metadataLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=60, must-revalidate');
    res.vary('x-private-key');
    const available = env.enableAnimeDraft || env.enableAnimeCommunity;
    let principalId: string | undefined;
    if (req.header('x-private-key')) { try { principalId = principalFromKey(req.header('x-private-key')); } catch { principalId = undefined; } }
    let extraIds: number[] = [];
    if (principalId) { try { extraIds = await communityPools.workIdsForPrincipal(principalId); } catch { extraIds = []; } }
    res.json({ enabled: env.enableAnimeDraft, works: available ? animeCatalogFor(principalId, extraIds) : [], pools: available ? animePools() : [] });
  });
  app.use("/api/", apiLimiter);
  app.use("/rooms", apiLimiter);
  app.use(
    "/api/reveal-images",
    express.static(revealImages.getStaticDir(), {
      immutable: true,
      maxAge: "7d",
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/rooms", async (_req, res) => {
    const rooms = await game.listRoomSummaries();
    res.json(assets.wire(rooms));
  });

  app.get("/api/public-word-packs", async (_req, res) => {
    try {
      res.json(await users.listPublicWordPacks());
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.get("/api/public-word-packs/:publicId", async (req, res) => {
    try {
      const pack = await users.getPublicWordPackByPublicId(req.params.publicId);
      if (!pack) {
        res.status(404).json({ message: "题库不存在" });
        return;
      }
      res.json(pack);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.get("/api/public-image-packs", async (_req, res) => {
    try {
      res.json(await users.listPublicImagePacks());
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.get("/api/public-image-packs/:publicId", async (req, res) => {
    try {
      const pack = await users.getPublicImagePackByPublicId(req.params.publicId);
      if (!pack) {
        res.status(404).json({ message: "图库不存在" });
        return;
      }
      res.json(pack);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.get('/api/rooms/:roomId/interference-pool',metadataLimiter,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {res.json(await game.getInterferencePool(String(req.params.roomId),principalFromKey(req.header('x-private-key')),String(req.query.planId??''),Number(req.query.stageVersion),String(req.query.q??''),Number(req.query.page??1)));}
    catch(error){res.status(403).json({message:error instanceof Error?error.message:'干扰作品池读取失败'});}
  });
  app.get('/api/rooms/:roomId/plan-pool',metadataLimiter,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {
      const principal=principalFromKey(req.header('x-private-key'));
      const pool=await game.getPlanPool(String(req.params.roomId),principal,String(req.query.planId??''),Number(req.query.version));
      res.json(req.query.preview==='1'?{...pool,works:pool.works.slice(0,4)}:pool);
    } catch(error) { res.status(403).json({message:error instanceof Error?error.message:'作品池读取失败'}); }
  });
  app.get('/api/private-replays/:matchId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(game.getPrivateReplay(req.params.matchId, principalFromKey(req.header('x-private-key')))); }
    catch { res.status(404).json({ message: '私密复盘不存在、已过期或无权访问。服务重启后内存复盘会失效；请在原设备重试或恢复身份凭证。' }); }
  });
  app.post('/api/private-replays/:matchId/share', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const body = asObject(req.body);
      if (typeof body.shared !== 'boolean') throw new Error('分享状态无效');
      const principal = principalFromKey(req.header('x-private-key'));
      await game.sharePrivatePrediction(req.params.matchId, principal, body.shared);
      res.json(game.getPrivateReplay(req.params.matchId, principal));
    } catch { res.status(404).json({ message: '预测不存在、未开放或无权修改' }); }
  });

  const replayCoverLimiter=rateLimit({windowMs:60_000,limit:240,standardHeaders:true,legacyHeaders:false});
  app.get('/api/replays/:replayId/covers/:cardId',replayCoverLimiter,async(req,res)=>{
    try{
      const replay=await game.getReplay(String(req.params.replayId));
      const card=replay?.finalBoard.find(c=>c.id===req.params.cardId);
      if(!card?.anime?.cover){res.sendStatus(404);return;}
      const cover=await fetchReplayCover(card.anime.cover);
      res.setHeader('Cache-Control','public, max-age=300');res.type(cover.type).send(cover.data);
    }catch{res.sendStatus(404);}
  });
  app.get("/api/replays/:replayId", async (req, res) => {
    try {
      const replay = await game.getReplay(req.params.replayId);
      if (!replay) {
        res.status(404).json({ message: "公开复盘不存在、已过期或服务重启后已失效" });
        return;
      }
      res.json(replay);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.post("/api/users/login", authLimiter, async (req, res) => {
    try {
      const body = asObject(req.body);
      const username = requireString(body, "username");
      const user = await users.login(username);
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Login failed" });
    }
  });

  app.get("/api/users/:username", async (req, res) => {
    try {
      const user = await users.get(req.params.username);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json(users.getPublicProfile(user));
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.get("/api/users/me", async (req, res) => {
    try {
      const username = req.header("x-username");
      const sessionToken = req.header("x-user-session-token");
      if (!username || !sessionToken) {
        res.status(401).json({ message: "缺少认证信息" });
        return;
      }
      if (!(await users.verifySession(username, sessionToken))) {
        res.status(401).json({ message: "用户登录已失效，请重新登录" });
        return;
      }
      const user = await users.get(username);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.put("/api/users/:username", async (req, res) => {
    try {
      const sessionToken = req.header("x-user-session-token");
      if (!sessionToken) {
        res.status(401).json({ message: "缺少用户登录凭证" });
        return;
      }
      if (!(await users.verifySession(req.params.username, sessionToken))) {
        res.status(401).json({ message: "用户登录已失效，请重新登录" });
        return;
      }
      const user = await users.update(req.params.username, parseUpdateNamedUserPayload(req.body));
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Update failed" });
    }
  });

  app.post("/api/users/logout", async (req, res) => {
    try {
      const sessionToken = req.header("x-user-session-token");
      const username = req.header("x-username");
      if (!sessionToken || !username) {
        res.status(400).json({ message: "缺少认证信息" });
        return;
      }
      await users.revokeSession(username, sessionToken);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "注销失败" });
    }
  });

  let summariesTimer: ReturnType<typeof setTimeout> | undefined;
  async function broadcastRoomSummaries(): Promise<void> {
    if (summariesTimer) return;
    summariesTimer=setTimeout(()=>{summariesTimer=undefined;game.listRoomSummaries().then(rooms=>io.emit("room_summaries",assets.wire(rooms))).catch(error=>console.warn('room summaries:',error));},150);
  }

  const roomBroadcasts=new RoomBroadcastQueue(publishRoomState);
  function sendRoomState(roomId:string):Promise<void>{return roomBroadcasts.send(roomId);}
  async function publishRoomState(roomId: string): Promise<void> {
    const room = await game.getRoom(roomId);
    if (!room) {
      await broadcastRoomSummaries();
      return;
    }

    const sockets = await io.in(roomId).fetchSockets();
    for (const currentSocket of sockets) {
      const session = socketSessions.get(currentSocket.id);
      if (!session || session.roomId !== roomId) {
        continue;
      }
      if (session.participantType === 'spectator' && room.players.some(p => p.id === session.participantId)) {
        session.participantType = 'player';
        const promoted = room.players.find(p => p.id === session.participantId)!;
        currentSocket.emit('session',{roomId,playerId:promoted.id,participantId:promoted.id,participantType:'player',sessionToken:promoted.sessionToken!});
      }
      const payload = game.getPublicRoomState(room, session.participantId, session.participantType);
      if (room.revealGuessState) {
        payload.revealGuessPublic = RevealGuess.sanitizeRevealGuessState(room, session.participantId, session.participantType) ?? undefined;
      }
      const localSocket = io.sockets.sockets.get(currentSocket.id);
      if (localSocket) emitRoom(localSocket, payload);
      else currentSocket.emit("room_state", assets.wire(payload));
    }

    await broadcastRoomSummaries();
  }

  const publishedMatchEvents = new MatchEventLedger();
  async function emitRoundHighlights(roomId: string): Promise<void> {
    const room = await game.getRoom(roomId);
    if (!room) return;
    const highlights = room.roundHighlights ?? [];
    if (highlights.length === 0) return;
    const sanitizedHighlights = sanitizeRoundHighlightsForPhase(highlights, room.phase) ?? [];
    const scope = { roomId, matchId: room.matchId!, roundNumber: room.roundNumber };
    // Claim synchronously after the fetch, before emitting. Concurrent guess/end-turn
    // handlers may observe the same snapshot, or more than one new closed turn.
    for (const highlight of sanitizedHighlights) {
      if (!publishedMatchEvents.claim(roomId, scope.matchId, `highlight:${highlight.id}`)) continue;
      io.to(roomId).emit("round_highlight", { ...highlight, ...scope });
      const original = highlights.find(h => h.id === highlight.id)!;
      for (const ach of buildAchievementUnlocksFromHighlight(original, room)) {
        if (publishedMatchEvents.claim(roomId, scope.matchId, `achievement:${ach.id}`)) {
          io.to(roomId).emit("achievement_unlock", { ...ach, ...scope, team: highlight.team, roundIndex: highlight.roundIndex });
        }
      }
    }
  }

  async function bind(socketId: string, roomId: string, participantId: string, participantType: ParticipantType): Promise<void> {
    const previous = socketSessions.get(socketId);
    if (previous && (previous.roomId !== roomId || previous.participantId !== participantId)) {
      const client = io.sockets.sockets.get(socketId);
      client?.leave(previous.roomId); client?.leave(`member:${previous.participantId}`);
      socketSessions.delete(socketId);
      await game.markDisconnected(previous.roomId,previous.participantId,previous.participantType,()=>![...socketSessions.values()].some(s=>s.roomId===previous.roomId&&s.participantId===previous.participantId));
      await sendRoomState(previous.roomId);
    }
    socketSessions.set(socketId, { roomId, participantId, participantType });
  }

  function requireSession(
    socketId: string,
    roomId: string
  ): { roomId: string; participantId: string; participantType: ParticipantType } {
    const session = socketSessions.get(socketId);
    if (!session) {
      throw new Error("会话不存在");
    }
    if (session.roomId !== roomId) {
      throw new Error("会话与房间不匹配");
    }
    return session;
  }

  function emitSession(
    socket: Parameters<typeof io.on>[1] extends (socket: infer T) => void ? T : never,
    roomId: string,
    participantId: string,
    participantType: ParticipantType,
    sessionToken: string
  ): void {
    socket.emit("session", {
      roomId,
      playerId: participantId,
      participantId,
      participantType,
      sessionToken
    });
  }

  function fail(socket: Parameters<typeof io.on>[1] extends (socket: infer T) => void ? T : never, error: unknown, context: { roomId?: string; code?: string; action?: string } = {}): void {
    socket.emit("error_message", {
      message: error instanceof Error ? error.message : "请求失败",
      ...(context.roomId ? { roomId: context.roomId } : {}),
      ...(context.code ? { code: context.code } : {}),
      ...(context.action ? { action: context.action } : {})
    });
  }

  function turnVersion(room: Parameters<typeof roomTurnKey>[0]): string {
    return roomTurnKey(room);
  }

  async function resync(socket: Parameters<typeof io.on>[1] extends (socket: infer T) => void ? T : never): Promise<void> {
    const bound = socketSessions.get(socket.id);
    if (bound) await sendRoomState(bound.roomId);
  }


  io.on("connection", (socket) => {
    socket.on("enable_room_deltas", () => { deltaSockets.add(socket); transports.delete(socket); });
    socket.on('prediction_action', async payload => {
      try {
        checkSocketRate(socket.id, 'prediction_action', 10, 1000);
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        const room = await game.predictionAction(roomId, session.participantId, session.participantType, payload);
        const analysis = game.getPublicRoomState(room, session.participantId, session.participantType).analysis;
        if (analysis) socket.emit('analysis_state', { roomId, analysis });
      } catch (error) { fail(socket, error); }
    });

    socket.on('analysis_action', async (payload, reply) => {
      try {
        checkSocketRate(socket.id, 'analysis_action', 10, 1000);
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        const room = await game.analysisAction(roomId, session.participantId, session.participantType, payload);
        const team = room.players.find(p => p.id === session.participantId)?.team;
        for (const client of await io.in(roomId).fetchSockets()) {
          const bound = socketSessions.get(client.id);
          if (!bound || bound.roomId !== roomId) continue;
          const sameParticipant = bound.participantId === session.participantId;
          const sameTeam = room.players.some(p => p.id === bound.participantId && p.team === team);
          if (!sameParticipant && !(payload.target === 'team' && sameTeam)) continue;
          const analysis = game.getPublicRoomState(room, bound.participantId, bound.participantType).analysis;
          if (analysis && (sameParticipant || analysis.canReadTeamGraph)) client.emit('analysis_state', { roomId, analysis });
        }
        acknowledge(reply, {ok:true});
      } catch (error) { const bound=socketSessions.get(socket.id);if(bound)await sendRoomState(bound.roomId);acknowledge(reply, {ok:false,message:error instanceof Error?error.message:'图谱未保存'});fail(socket,error); }
    });

    socket.on('plan_action', async (payload, reply) => {
      try {
        checkSocketRate(socket.id, 'plan_action', 30, 5_000);
        const body = asObject(payload);
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id,roomId);
        if (session.participantType !== 'player') throw new Error('旁观者不能操作下局准备');
        if (typeof body.kind !== 'string') throw new Error('操作无效');
        await game.planAction(roomId,session.participantId,payload);
        await sendRoomState(roomId);
        acknowledge(reply, {ok:true});
      } catch(error) { const bound=socketSessions.get(socket.id);if(bound)try{await sendRoomState(bound.roomId);}catch{} acknowledge(reply, {ok:false,message:error instanceof Error?error.message:'配置未保存'});fail(socket,error); }
    });
    socket.emit("room_summaries", []);
    broadcastRoomSummaries().catch((error) => {
      console.error("Failed to broadcast room summaries on connect", error);
    });

    socket.on("create_room", async (payload) => {
      try {
        maybeFailCreate();
        const body = asObject(payload);
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const sessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const { room, player } = await game.createRoom(nickname, profile, sessionToken, privatePrincipal(body));
        await bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        emitRoom(socket, game.getPublicRoomState(room, player.id, "player"), true);
        await broadcastRoomSummaries();
      } catch (error) {
        fail(socket, error, { code: 'CREATE_ROOM_FAILED', action: 'create_room' });
      }
    });

    socket.on("join_room", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const userSessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const roomSessionToken = typeof body.sessionToken === "string" ? body.sessionToken : undefined;

        if (roomSessionToken) {
          try {
            const restored = await game.reconnectRoom(roomId, roomSessionToken, privatePrincipal(body));
            await bind(socket.id, restored.room.id, restored.participantId, restored.participantType);
            socket.join(restored.room.id);
            socket.join(`member:${restored.participantId}`);
            emitSession(socket, restored.room.id, restored.participantId, restored.participantType, roomSessionToken);
            await sendRoomState(restored.room.id);
            return;
          } catch { /* fallback to normal join */ }
        }

        const { room, player } = await game.joinRoom(roomId, nickname, profile, userSessionToken, privatePrincipal(body));
        await bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        fail(socket, error, { roomId, code: 'JOIN_FAILED', action: 'join_room' });
      }
    });

    socket.on("join_spectator", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const userSessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const roomSessionToken = typeof body.sessionToken === "string" ? body.sessionToken : undefined;

        const { room, spectator } = await game.joinSpectator(roomId, nickname, profile, userSessionToken, privatePrincipal(body));
        await bind(socket.id, room.id, spectator.id, "spectator");
        socket.join(room.id);
        socket.join(`member:${spectator.id}`);
        emitSession(socket, room.id, spectator.id, "spectator", spectator.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        fail(socket, error, { roomId, code: 'JOIN_FAILED', action: 'join_spectator' });
      }
    });

    socket.on("reconnect_room", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const sessionToken = requireString(body, "sessionToken");
        const { room, participantId, participantType } = await game.reconnectRoom(roomId, sessionToken, privatePrincipal(body));
        await bind(socket.id, room.id, participantId, participantType);
        socket.join(room.id);
        socket.join(`member:${participantId}`);
        emitSession(socket, room.id, participantId, participantType, sessionToken);
        await sendRoomState(room.id);
      } catch (error) {
        socket.emit('error_message',{message:error instanceof Error?error.message:'Recovery failed',code:'ROOM_RECOVERY_FAILED',roomId:payload?.roomId});
      }
    });

    socket.on("set_team", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const team = optionalTeam(body.team);

        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能修改队伍");
        }
        const room = await game.setTeam(roomId, session.participantId, team);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on('manage_member',async(payload,reply)=>{
      try{
        checkSocketRate(socket.id,'manage_member',12,10_000);
        const body=asObject(payload),roomId=requireString(body,'roomId'),targetId=requireString(body,'targetId');
        const session=requireSession(socket.id,roomId);
        if(session.participantType!=='player')throw new Error('只有房主可以管理成员');
        if(!['team','role','remove'].includes(String(body.kind)))throw new Error('管理操作无效');
        const kind=body.kind as 'team'|'role'|'remove';
        if(kind==='team'&&body.team!==null&&body.team!=='red'&&body.team!=='blue')throw new Error('队伍无效');
        const room=await game.manageMember(roomId,session.participantId,targetId,{kind,...(kind==='team'?{team:optionalTeam(body.team)}:{}),...(kind==='role'?{role:requirePlayerRole(body.role)}:{})});
        if(kind==='remove')for(const [id,bound] of socketSessions){
          if(bound.roomId!==roomId||bound.participantId!==targetId)continue;
          socketSessions.delete(id);const client=io.sockets.sockets.get(id);
          client?.leave(roomId);client?.leave(`member:${targetId}`);client?.emit('room_closed',{roomId,reason:'你已被房主移出房间；原席位恢复凭证失效'});
        }
        await sendRoomState(roomId);acknowledge(reply,{ok:true,roomId,roomVersion:room.updatedAt});
      }catch(error){acknowledge(reply,{ok:false,message:error instanceof Error?error.message:'成员管理失败'});fail(socket,error);}
    });

    socket.on("set_role", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const role = requirePlayerRole(body.role);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能修改身份");
        }
        const room = await game.setRole(roomId, session.participantId, role);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("randomize_teams", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能随机分队");
        }
        const room = await game.randomizeTeams(roomId, session.participantId, payload.mode);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("update_room_settings", async (payload, reply) => {
      try {
        const body = parseUpdateRoomSettingsPayload(payload);
        const session = requireSession(socket.id, body.roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能修改房间设置");
        }
        const room = await game.updateRoomSettings(body.roomId, session.participantId, body);
        await sendRoomState(room.id);
      acknowledge(reply, {ok:true});
      } catch (error) { acknowledge(reply, {ok:false,message:error instanceof Error?error.message:'配置未保存'});
        fail(socket, error);
      }
    });

    socket.on("start_game", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能开局");
        }
        const room = await game.startGame(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("restart_game", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能再开一把");
        }
        const room = await game.restartGame(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("return_to_lobby", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能让房间回到准备阶段");
        }
        const room = await game.returnToLobby(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("transfer_host", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const targetPlayerId = requireString(body, "targetPlayerId");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能转让房主");
        }
        const room = await game.transferHost(roomId, session.participantId, targetPlayerId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("host_takeover", async (payload, reply) => {
      try {
        checkSocketRate(socket.id, "host_takeover", 6, 10_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const kind = requireString(body, "kind");
        if (!['request', 'approve', 'reject', 'cancel'].includes(kind)) throw new Error('接任操作无效');
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能参与社长接任");
        const room = await game.hostTakeover(roomId, session.participantId, kind as 'request' | 'approve' | 'reject' | 'cancel');
        await sendRoomState(room.id);
        acknowledge(reply, { ok: true, roomId: room.id, roomVersion: room.updatedAt, turnVersion: turnVersion(room) });
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        await resync(socket);
        acknowledge(reply, { ok: false, message: error instanceof Error ? error.message : '接任未完成' });
        fail(socket, error, { roomId, code: 'HOST_TAKEOVER_FAILED', action: 'host_takeover' });
      }
    });

    socket.on("disband_room", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能解散房间");
        }
        await game.disbandRoom(roomId, session.participantId);
        io.to(roomId).emit("room_closed", { roomId, reason: "社长已解散密令房" });
        for (const [socketId, boundSession] of socketSessions.entries()) {
          if (boundSession.roomId === roomId) {
            socketSessions.delete(socketId);
          }
        }
        await broadcastRoomSummaries();
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("force_end_game", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能结束对局");
        }
        const room = await game.forceEndGame(roomId, session.participantId,payload.mode??'abort');
        if (room.phase === "finished") {
          await game.ensureReplay(room.id);
        }
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("submit_clue", async (payload, reply) => {
      try {
        checkSocketRate(socket.id, "submit_clue", 3, 10_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const word = requireString(body, "word");
        const count = requireNumber(body, "count");
        const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能发提示");
        }
        const room = await game.submitClue(roomId, session.participantId, word, count, requestId);
        const duplicate = game.takeDuplicateRequest(room.id, requestId);
        await sendRoomState(room.id);
        acknowledge(reply, { ok: true, duplicate, roomId: room.id, roomVersion: room.updatedAt, turnVersion: turnVersion(room) });
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        await resync(socket);
        acknowledge(reply, { ok: false, message: error instanceof Error ? error.message : '提示未提交' });
        fail(socket, error, { roomId, code: 'SUBMIT_CLUE_FAILED', action: 'submit_clue' });
      }
    });

    socket.on("guess_card", async (payload, reply) => {
      try {
        checkSocketRate(socket.id, "guess_card", 8, 5_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const cardId = requireString(body, "cardId");
        const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能猜词");
        }
        const room = await game.guessCard(roomId, session.participantId, cardId, requestId);
        const duplicate = game.takeDuplicateRequest(room.id, requestId);
        if (room.phase === "finished") {
          await game.ensureReplay(room.id);
        }
        await sendRoomState(room.id);
        await emitRoundHighlights(room.id);
        acknowledge(reply, { ok: true, duplicate, roomId: room.id, roomVersion: room.updatedAt, turnVersion: turnVersion(room) });
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        await resync(socket);
        acknowledge(reply, { ok: false, message: error instanceof Error ? error.message : '猜牌未完成' });
        fail(socket, error, { roomId, code: 'GUESS_CARD_FAILED', action: 'guess_card' });
      }
    });

    socket.on("end_turn", async (payload, reply) => {
      try {
        checkSocketRate(socket.id, "end_turn", 3, 10_000);
        const roomId = requireRoomId(payload);
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : undefined;
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能结束回合");
        }
        const room = await game.endTurn(roomId, session.participantId, requestId);
        const duplicate = game.takeDuplicateRequest(room.id, requestId);
        await sendRoomState(room.id);
        await emitRoundHighlights(room.id);
        acknowledge(reply, { ok: true, duplicate, roomId: room.id, roomVersion: room.updatedAt, turnVersion: turnVersion(room) });
      } catch (error) {
        const roomId = typeof payload?.roomId === 'string' ? payload.roomId : undefined;
        await resync(socket);
        acknowledge(reply, { ok: false, message: error instanceof Error ? error.message : '结束回合未完成' });
        fail(socket, error, { roomId, code: 'END_TURN_FAILED', action: 'end_turn' });
      }
    });

    socket.on("resume_timer", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        const room = await game.resumeTimer(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("send_chat_message", async (payload, reply) => {
      try {
        checkSocketRate(socket.id, "send_chat_message", 5, 5_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const text = requireString(body, "text");
        const session = requireSession(socket.id, roomId);
        const room = await game.sendChatMessage(roomId, session.participantId, session.participantType, text, body.requestId === undefined ? undefined : requireString(body, "requestId"));
        await sendRoomState(room.id);
        if (session.participantType === "spectator") {
          const sender =
            room.spectators.find((s) => s.id === session.participantId) ??
            room.players.find((p) => p.id === session.participantId);
          const chatMessage = [...room.messages].reverse().find((message) => message.type === "chat" && message.playerId === session.participantId);
          io.to(roomId).emit("danmaku_message", {
            id: crypto.randomUUID(),
            roomId,
            senderNickname: sender?.nickname ?? "?",
            text: chatMessage?.text ?? text.trim(),
            createdAt: Date.now()
          });
        }
        acknowledge(reply, {ok:true});
      } catch (error) {
        acknowledge(reply, {ok:false,message:error instanceof Error?error.message:"消息发送失败"});
        fail(socket, error);
      }
    });

    socket.on("send_reaction", async (payload) => {
      try {
        checkSocketRate(socket.id, "send_reaction", 5, 10_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const reaction = requireReaction(body.reaction);
        const targetParticipantId = requireString(body, "targetParticipantId");
        const targetParticipantType = requireParticipantType(body.targetParticipantType);
        const session = requireSession(socket.id, roomId);
        const room = await game.sendReaction(
          roomId,
          session.participantId,
          session.participantType,
          reaction,
          targetParticipantId,
          targetParticipantType
        );
        await sendRoomState(room.id);
        io.to(roomId).emit("reaction_effect", {
          id: crypto.randomUUID(),
          roomId,
          reaction,
          senderNickname: (room.players.find(p => p.id === session.participantId) ?? room.spectators.find(s => s.id === session.participantId))?.nickname ?? "?",
          targetNickname: (room.players.find(p => p.id === targetParticipantId) ?? room.spectators.find(s => s.id === targetParticipantId))?.nickname ?? "?",
          targetParticipantId,
          targetParticipantType,
          createdAt: Date.now()
        });
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("queue_for_next_round", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "spectator") {
          throw new Error("只有旁观者可以加入下一局候补");
        }
        const room = await game.queueForNextRound(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("cancel_queue_join", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "spectator") {
          throw new Error("只有旁观者可以取消候补");
        }
        const room = await game.cancelQueueJoin(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("leave_room", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const sessionToken = typeof body === "object" && body.sessionToken ? requireString(body, "sessionToken") : undefined;

        let participantId: string;
        let participantType: ParticipantType;

        const boundSession = socketSessions.get(socket.id);
        if (boundSession && boundSession.roomId === roomId) {
          participantId = boundSession.participantId;
          participantType = boundSession.participantType;
        } else if (sessionToken) {
          const storedSession = await store.getPlayerSession(sessionToken);
          if (!storedSession || storedSession.roomId !== roomId) {
            throw new Error("会话不存在");
          }
          await game.reconnectRoom(roomId,sessionToken,privatePrincipal(body));
          participantId = storedSession.participantId;
          participantType = storedSession.participantType;
        } else {
          throw new Error("会话不存在");
        }

        const currentRoom = await store.getRoom(roomId);
        const isLobby = currentRoom?.phase === "lobby";

        const room = isLobby
          ? await game.leaveRoom(roomId, participantId, participantType)
          : await game.markDisconnected(roomId, participantId, participantType,()=>![...socketSessions.entries()].some(([id,s])=>id!==socket.id&&s.roomId===roomId&&s.participantId===participantId));

        if (boundSession?.roomId === roomId && socketSessions.get(socket.id) === boundSession) socketSessions.delete(socket.id);
        socket.leave(roomId);
        socket.leave(`member:${participantId}`);
        if(isLobby)for(const [id,bound] of socketSessions){if(bound.roomId===roomId&&bound.participantId===participantId){socketSessions.delete(id);const client=io.sockets.sockets.get(id);client?.leave(roomId);client?.leave(`member:${participantId}`);client?.emit('room_closed',{roomId,reason:'已退出房间'});}}
        if (room) {
          await sendRoomState(room.id);
        } else {
          await broadcastRoomSummaries();
        }
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("sync_room_state", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        const room = await game.getRoom(roomId);
        if (!room) {
          throw new Error("房间不存在");
        }
        const state = game.getPublicRoomState(room, session.participantId, session.participantType);
        if (room.revealGuessState) {
          state.revealGuessPublic = RevealGuess.sanitizeRevealGuessState(room, session.participantId, session.participantType) ?? undefined;
        }
        emitRoom(socket, state, true);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("debug_fill_room", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能使用调试补位");
        }
        const room = await game.debugFillRoom(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    // ═══ Reveal Guess events ═══════════════════════════════════

    socket.on("create_reveal_guess_room", async (payload) => {
      try {
        maybeFailCreate();
        const body = asObject(payload);
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const sessionToken = body.profile && typeof body.profile === "object"
          ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken)
          : undefined;
        const settings = body.settings && typeof body.settings === "object"
          ? body.settings as Partial<RevealGuessSettings>
          : undefined;
        const initialPuzzle = body.initialPuzzle && typeof body.initialPuzzle === "object"
          ? asObject(body.initialPuzzle)
          : null;

        const { room, player } = await game.createRoom(nickname, profile, sessionToken,body.identityKey===undefined?undefined:privatePrincipal(body));
        RevealGuess.initRevealGuessState(room, settings);
        if (initialPuzzle) {
          const imageUrl = await revealImages.normalizeImageUrl(requireString(initialPuzzle, "imageUrl"));
          const answer = requireString(initialPuzzle, "answer");
          const aliases = optionalStringArray(initialPuzzle.aliases);
          const hints = optionalStringArray(initialPuzzle.hints);
          RevealGuess.addPuzzle(room, { imageUrl, answer, aliases, hints });
        }
        await store.setRoom(room);

        await bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        const roomStatePayload = game.getPublicRoomState(room, player.id, "player");
        roomStatePayload.revealGuessPublic = RevealGuess.sanitizeRevealGuessState(room, player.id, "player") ?? undefined;
        emitRoom(socket, roomStatePayload, true);
        await broadcastRoomSummaries();
      } catch (error) {
        fail(socket, error, { code: 'CREATE_ROOM_FAILED', action: 'create_reveal_guess_room' });
      }
    });

    socket.on("reveal_guess_add_puzzle", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const imageUrl = await revealImages.normalizeImageUrl(requireString(body, "imageUrl"));
        const answer = requireString(body, "answer");
        const aliases = optionalStringArray(body.aliases);
        const hints = optionalStringArray(body.hints);

        if (imageUrl.startsWith("/api/reveal-images/")) {
          // Stored reveal-image asset; already validated before writing.
        } else
        // Validate image URL
        if (imageUrl.startsWith("data:image/")) {
          if (imageUrl.length > 3_200_000) {
            throw new Error("图片过大，请压缩后重试（建议最长边不超过 1280px）");
          }
          const mimeMatch = imageUrl.match(/^data:(image\/\w+);/);
          if (!mimeMatch || !["image/png", "image/jpeg", "image/webp"].includes(mimeMatch[1])) {
            throw new Error("不支持的图片格式，仅支持 PNG / JPEG / WebP");
          }
        } else if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
          throw new Error("图片 URL 必须以 http(s):// 开头或为 data:image/...;base64");
        }

        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能添加题目");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        const judgeId = room.judgePlayerId || room.hostPlayerId;
        if (session.participantId !== judgeId) {
          throw new Error("只有裁判或房主可以添加题目");
        }
        RevealGuess.addPuzzle(room, { imageUrl, answer, aliases, hints });
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_add_puzzles", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const puzzles = Array.isArray(body.puzzles) ? body.puzzles : [];
        if (!puzzles.length) throw new Error("puzzles 不能为空");

        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能添加题目");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        const judgeId = room.judgePlayerId || room.hostPlayerId;
        if (session.participantId !== judgeId) throw new Error("只有裁判或房主可以添加题目");

        for (const p of puzzles) {
          const imageUrl = requireString(p, "imageUrl");
          const answer = requireString(p, "answer");
          const aliases = optionalStringArray(p.aliases);
          const hints = optionalStringArray(p.hints);
          if (imageUrl.startsWith("data:image/")) {
            if (imageUrl.length > 3_200_000) throw new Error("图片过大");
          } else if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
            throw new Error("图片 URL 无效");
          }
          RevealGuess.addPuzzle(room, { imageUrl, answer, aliases, hints });
        }
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_update_puzzle", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const index = requireNumber(body, "index");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能编辑题目");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        const judgeId = room.judgePlayerId || room.hostPlayerId;
        if (session.participantId !== judgeId) throw new Error("只有裁判或房主可以编辑题目");
        const data: { imageUrl?: string; answer?: string; aliases?: string[]; hints?: string[] } = {};
        if (body.imageUrl !== undefined) {
          const u = requireString(body, "imageUrl");
          if (u.startsWith("data:image/") && u.length > 3_200_000) throw new Error("图片过大");
          data.imageUrl = u;
        }
        if (body.answer !== undefined) data.answer = requireString(body, "answer");
        if (body.aliases !== undefined) data.aliases = optionalStringArray(body.aliases);
        if (body.hints !== undefined) data.hints = optionalStringArray(body.hints);
        RevealGuess.updatePuzzle(room, index, data);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) { fail(socket, error); }
    });

    socket.on("reveal_guess_remove_puzzle", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const index = requireNumber(body, "index");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能删除题目");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        const judgeId = room.judgePlayerId || room.hostPlayerId;
        if (session.participantId !== judgeId) throw new Error("只有裁判或房主可以删除题目");
        RevealGuess.removePuzzle(room, index);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) { fail(socket, error); }
    });

    socket.on("reveal_guess_reorder_puzzle", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const fromIndex = requireNumber(body, "fromIndex");
        const toIndex = requireNumber(body, "toIndex");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能调整顺序");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        const judgeId = room.judgePlayerId || room.hostPlayerId;
        if (session.participantId !== judgeId) throw new Error("只有裁判或房主可以调整顺序");
        RevealGuess.reorderPuzzles(room, fromIndex, toIndex);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) { fail(socket, error); }
    });

    socket.on("reveal_guess_start", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能开始游戏");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        if ((room.judgePlayerId || room.hostPlayerId) !== session.participantId) {
          throw new Error("只有裁判可以开始游戏");
        }
        RevealGuess.startRevealGuessGame(room);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_reveal_cell", async (payload) => {
      try {
        checkSocketRate(socket.id, "reveal_cell", 8, 5_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const cellId = requireString(body, "cellId");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能翻牌");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.revealCell(room, session.participantId, cellId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_submit_answer", async (payload) => {
      try {
        checkSocketRate(socket.id, "submit_answer", 3, 10_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const answer = requireString(body, "answer");
        const type = requireAnswerType(body.type);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能提交答案");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.submitAnswer(room, session.participantId, answer, type);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_open_buzz", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能开放抢答");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.openBuzzing(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_close_buzz", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能关闭抢答");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.closeBuzzing(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_skip_puzzle", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能跳过题目");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.skipPuzzle(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_buzz_in", async (payload) => {
      try {
        checkSocketRate(socket.id, "buzz_in", 5, 5_000);
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能抢答");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.buzzIn(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_judge_answer", async (payload) => {
      try {
        checkSocketRate(socket.id, "judge_answer", 5, 5_000);
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const answerId = requireString(body, "answerId");
        const verdict = requireVerdict(body.verdict);
        const note = typeof body.note === "string" ? body.note : undefined;
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能判定答案");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.judgeAnswer(room, session.participantId, answerId, verdict);
        if (note && verdict !== "correct") {
          const puzzle = room.revealGuessState?.puzzles[room.revealGuessState.currentPuzzleIndex];
          if (puzzle) {
            const pa = puzzle.pendingAnswers.find((a) => a.id === answerId);
            if (pa) pa.judgeNote = note;
          }
        }
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_show_hint", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const hint = requireString(body, "hint");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能发提示");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.showHint(room, session.participantId, hint);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_next_puzzle", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能切换题目");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.nextPuzzle(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_adjust_score", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const targetPlayerId = requireString(body, "targetPlayerId");
        const amount = requireNonEmptyInt(body.amount, "amount");
        const reason = requireString(body, "reason");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能调整分数");
        }
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.adjustScore(room, session.participantId, targetPlayerId, amount, reason);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_transfer_judge", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const newJudgeId = requireString(body, "newJudgeId");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能转让裁判");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.transferJudge(room, session.participantId, newJudgeId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_return_to_setup", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能操作");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.returnToSetup(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reveal_guess_open_free_reveal", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") throw new Error("旁观者不能操作");
        const room = await game.getRoom(roomId);
        if (!room) throw new Error("房间不存在");
        RevealGuess.openFreeReveal(room, session.participantId);
        await store.setRoom(room);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("disconnect", async () => {
      socketRateCounters.delete(socket.id);
      const session = socketSessions.get(socket.id);
      socketSessions.delete(socket.id);
      if (!session) {
        return;
      }
      const room = await game.markDisconnected(session.roomId, session.participantId, session.participantType, () => ![...socketSessions.values()].some(s => s.roomId === session.roomId && s.participantId === session.participantId));
      if (room) {
        await sendRoomState(room.id);
      } else {
        await broadcastRoomSummaries();
      }
    });
  });

  setInterval(() => {
    game.cleanupIdleRooms().then((deleted) => {
      if (deleted.length > 0) {
        for (const roomId of deleted) {
          io.to(roomId).emit("room_closed", { roomId, reason: "房间长期无活动已自动关闭" });
          for (const [socketId, boundSession] of socketSessions.entries()) {
            if (boundSession.roomId === roomId) {
              socketSessions.delete(socketId);
            }
          }
        }
        broadcastRoomSummaries().catch(() => {});
      }
    }).catch((err) => console.warn("room cleanup error:", err));
  }, 60_000);

  setInterval(() => {
    game.tickTimers().then((expired) => {
      if (expired.length > 0) {
        for (const room of expired) {
          sendRoomState(room.id).catch(() => {});
        }
      }
    }).catch((err) => console.warn("timer tick error:", err));
  }, 1000);

  httpServer.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
