import { createClient } from "redis";
import { PLAYER_RECONNECT_TTL_SECONDS, ROOM_TTL_SECONDS, type Room } from "@acg-codenames/shared";
import type { RoomSession, RoomStore } from "./types.js";

class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, RoomSession>();

  async getRoom(roomId: string): Promise<Room | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async listRooms(): Promise<Room[]> {
    return [...this.rooms.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async setRoom(room: Room): Promise<void> {
    this.rooms.set(room.id, room);
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
  }

  async getPlayerSession(sessionToken: string): Promise<RoomSession | null> {
    return this.sessions.get(sessionToken) ?? null;
  }

  async setPlayerSession(sessionToken: string, session: RoomSession): Promise<void> {
    this.sessions.set(sessionToken, session);
  }
}

class RedisRoomStore implements RoomStore {
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
    const rooms = await Promise.all(roomIds.map((roomId) => this.getRoom(roomId)));
    return rooms.filter((room): room is Room => room !== null).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async setRoom(room: Room): Promise<void> {
    await this.set(`room:${room.id}`, JSON.stringify(room), ROOM_TTL_SECONDS);
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
}

export async function createRoomStore(redisUrl: string, forceMemory: boolean): Promise<RoomStore> {
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
