import { createClient } from "redis";
import { PLAYER_RECONNECT_TTL_SECONDS, ROOM_TTL_SECONDS, ROOM_TTL_LOBBY_IDLE_SECONDS, ROOM_TTL_FINISHED_SECONDS, ROOM_TTL_EMPTY_SECONDS, type GameReplay, type Room } from "@acg-codenames/shared";
import type { ReplayStore, RoomSession, RoomStore } from "./types.js";

export const REPLAY_TTL_SECONDS = 7 * 24 * 60 * 60;

function computeRoomTTL(room: Room): number {
  const humanPlayers = room.players.filter((p) => !p.isBot);
  if (humanPlayers.length === 0) return ROOM_TTL_EMPTY_SECONDS;
  if (room.phase === "lobby") return ROOM_TTL_LOBBY_IDLE_SECONDS;
  if (room.phase === "finished") return ROOM_TTL_FINISHED_SECONDS;
  return ROOM_TTL_SECONDS;
}

function isStaleRoom(room: Room): boolean {
  const idleMs = Date.now() - room.updatedAt;
  const humanPlayers = room.players.filter((p) => !p.isBot);
  if (humanPlayers.length === 0) return idleMs > ROOM_TTL_EMPTY_SECONDS * 1000;
  if (room.phase === "lobby") return idleMs > ROOM_TTL_LOBBY_IDLE_SECONDS * 1000;
  if (room.phase === "finished") return idleMs > ROOM_TTL_FINISHED_SECONDS * 1000;
  return idleMs > ROOM_TTL_SECONDS * 1000;
}

class MemoryRoomStore implements RoomStore, ReplayStore {
  private readonly rooms = new Map<string, { value: Room; expiresAt: number }>();
  private readonly sessions = new Map<string, { value: RoomSession; expiresAt: number }>();
  private readonly replays = new Map<string, { value: GameReplay; expiresAt: number }>();

  async getRoom(roomId: string): Promise<Room | null> {
    this.pruneExpired();
    return this.rooms.get(roomId)?.value ?? null;
  }

  async listRooms(): Promise<Room[]> {
    this.pruneExpired();
    return [...this.rooms.values()].map((entry) => entry.value).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async setRoom(room: Room): Promise<void> {
    this.rooms.set(room.id, { value: room, expiresAt: Date.now() + computeRoomTTL(room) * 1000 });
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  async getPlayerSession(sessionToken: string): Promise<RoomSession | null> {
    this.pruneExpired();
    return this.sessions.get(sessionToken)?.value ?? null;
  }

  async setPlayerSession(sessionToken: string, session: RoomSession): Promise<void> {
    this.sessions.set(sessionToken, { value: session, expiresAt: Date.now() + PLAYER_RECONNECT_TTL_SECONDS * 1000 });
  }

  private pruneExpired(): void {
    const current = Date.now();
    for (const [roomId, entry] of this.rooms.entries()) {
      if (entry.expiresAt <= current) {
        this.rooms.delete(roomId);
      }
    }
    for (const [sessionToken, entry] of this.sessions.entries()) {
      if (entry.expiresAt <= current) {
        this.sessions.delete(sessionToken);
      }
    }
    for (const [replayId, entry] of this.replays.entries()) {
      if (entry.expiresAt <= current) {
        this.replays.delete(replayId);
      }
    }
  }

  async saveReplay(replay: GameReplay): Promise<void> {
    this.replays.set(replay.id, { value: replay, expiresAt: replay.expiresAt });
  }

  async getReplay(replayId: string): Promise<GameReplay | null> {
    this.pruneExpired();
    const entry = this.replays.get(replayId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { this.replays.delete(replayId); return null; }
    return entry.value;
  }
}

class RedisRoomStore implements RoomStore, ReplayStore {
  constructor(
    private readonly get: (key: string) => Promise<string | null>,
    private readonly set: (key: string, value: string, ttlSeconds: number) => Promise<void>,
    private readonly del: (key: string) => Promise<void>,
    private readonly addRoomId: (roomId: string) => Promise<void>,
    private readonly removeRoomId: (roomId: string) => Promise<void>,
    private readonly listRoomIds: () => Promise<string[]>
  ) {}

  async getRoom(roomId: string): Promise<Room | null> {
    const raw = await this.get(`room:${roomId}`);
    return raw ? (JSON.parse(raw) as Room) : null;
  }

  async listRooms(): Promise<Room[]> {
    const roomIds = await this.listRoomIds();
    const pairs = await Promise.all(roomIds.map(async (roomId) => ({ roomId, room: await this.getRoom(roomId) })));
    await Promise.all(pairs.filter((entry) => entry.room === null).map((entry) => this.removeRoomId(entry.roomId)));
    return pairs
      .map((entry) => entry.room)
      .filter((room): room is Room => room !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async setRoom(room: Room): Promise<void> {
    await this.set(`room:${room.id}`, JSON.stringify(room), computeRoomTTL(room));
    await this.addRoomId(room.id);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.del(`room:${roomId}`);
    await this.removeRoomId(roomId);
  }

  async getPlayerSession(sessionToken: string): Promise<RoomSession | null> {
    const raw = await this.get(`session:${sessionToken}`);
    return raw ? (JSON.parse(raw) as RoomSession) : null;
  }

  async setPlayerSession(sessionToken: string, session: RoomSession): Promise<void> {
    await this.set(`session:${sessionToken}`, JSON.stringify(session), PLAYER_RECONNECT_TTL_SECONDS);
  }

  async saveReplay(replay: GameReplay): Promise<void> {
    await this.set(`replay:${replay.id}`, JSON.stringify(replay), REPLAY_TTL_SECONDS);
  }

  async getReplay(replayId: string): Promise<GameReplay | null> {
    const raw = await this.get(`replay:${replayId}`);
    return raw ? (JSON.parse(raw) as GameReplay) : null;
  }
}

export async function createRoomStore(redisUrl: string, forceMemory: boolean): Promise<RoomStore & ReplayStore> {
  if (!redisUrl || forceMemory) {
    return new MemoryRoomStore();
  }

  try {
    const client = createClient({ url: redisUrl });
    await client.connect();
    client.on("error", (error) => {
      console.error("Redis client error", error);
    });
    return new RedisRoomStore(
      (key) => client.get(key),
      (key, value, ttlSeconds) => client.set(key, value, { EX: ttlSeconds }).then(() => undefined),
      (key) => client.del(key).then(() => undefined),
      (roomId) => client.sAdd("rooms:index", roomId).then(() => undefined),
      (roomId) => client.sRem("rooms:index", roomId).then(() => undefined),
      () => client.sMembers("rooms:index")
    );
  } catch (error) {
    console.warn("Redis unavailable, falling back to memory store.", error);
    return new MemoryRoomStore();
  }
}
