import dotenv from "dotenv";

dotenv.config();

export const env = {
  enableAnimeCommunity: process.env.ENABLE_ANIME_COMMUNITY === '1',
  animePoolStoreFile: process.env.ANIME_POOL_STORE_FILE ?? 'apps/server/data/anime-pools.json',
  animePoolAdminKey: process.env.ANIME_POOL_ADMIN_KEY ?? '',
  enableMatchAnalysis: process.env.ENABLE_MATCH_ANALYSIS === "1",
  enablePredictions: process.env.ENABLE_PREDICTIONS === "1",
  enableAnimeDraft: process.env.ENABLE_ANIME_DRAFT === "1",
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://localhost:4173",
  redisUrl: process.env.REDIS_URL ?? "",
  useMemoryStore: process.env.USE_MEMORY_STORE === "1",
  enableDebugTools: process.env.ENABLE_DEBUG_TOOLS === "1",
  userStoreFile: process.env.USER_STORE_FILE ?? "apps/server/data/users.json",
  revealImageDir: process.env.REVEAL_IMAGE_DIR ?? "apps/server/data/reveal-images"
};
