import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://localhost:4173",
  redisUrl: process.env.REDIS_URL ?? "",
  useMemoryStore: process.env.USE_MEMORY_STORE === "1",
  enableDebugTools: process.env.ENABLE_DEBUG_TOOLS !== "0",
  userStoreFile: process.env.USER_STORE_FILE ?? "apps/server/data/users.json"
};
