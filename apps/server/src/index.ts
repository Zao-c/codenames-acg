import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  BOARD_MODE_CONFIG,
  MAX_AVATAR_DATA_URL_LENGTH,
  type BoardMode,
  type ChatReaction,
  type ClientToServerEvents,
  type CustomWordPackInput,
  type ParticipantType,
  type PlayerRole,
  type ServerToClientEvents,
  type Team,
  type UpdateNamedUserPayload,
  type UserProfile
} from "@acg-codenames/shared";
import { env } from "./env.js";
import { GameService } from "./game.js";
import { createRoomStore } from "./store.js";
import { JsonUserStore } from "./user-store.js";

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
} {
  const body = asObject(value);
  const parsed: {
    roomId: string;
    boardMode?: BoardMode;
    builtinWordPackId?: string;
    customWordPack?: CustomWordPackInput | null;
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
  if (body.customWordPacks !== undefined) {
    if (!Array.isArray(body.customWordPacks)) {
      throw new Error("customWordPacks 参数无效");
    }
    parsed.customWordPacks = body.customWordPacks as UpdateNamedUserPayload["customWordPacks"];
  }
  return parsed;
}

async function bootstrap(): Promise<void> {
  const store = await createRoomStore(env.redisUrl, env.useMemoryStore);
  const users = new JsonUserStore(env.userStoreFile);
  const game = new GameService(store, users, { enableDebugTools: env.enableDebugTools });
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

  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/rooms", async (_req, res) => {
    const rooms = await game.listRoomSummaries();
    res.json(rooms);
  });

  app.get("/api/public-word-packs", async (_req, res) => {
    try {
      res.json(await users.listPublicWordPacks());
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.post("/api/users/login", async (req, res) => {
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

  async function broadcastRoomSummaries(): Promise<void> {
    io.emit("room_summaries", await game.listRoomSummaries());
  }

  async function sendRoomState(roomId: string): Promise<void> {
    const room = await game.getRoom(roomId);
    if (!room) {
      await broadcastRoomSummaries();
      return;
    }

    const members = [
      ...room.players.map((player) => ({ id: player.id, type: "player" as const })),
      ...room.spectators.map((spectator) => ({ id: spectator.id, type: "spectator" as const }))
    ];

    for (const member of members) {
      const sockets = await io.in(`member:${member.id}`).fetchSockets();
      const payload = game.getPublicRoomState(room, member.id, member.type);
      sockets.forEach((currentSocket) => currentSocket.emit("room_state", payload));
    }

    await broadcastRoomSummaries();
  }

  function bind(socketId: string, roomId: string, participantId: string, participantType: ParticipantType): void {
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

  function fail(socket: Parameters<typeof io.on>[1] extends (socket: infer T) => void ? T : never, error: unknown): void {
    socket.emit("error_message", {
      message: error instanceof Error ? error.message : "请求失败"
    });
  }

  io.on("connection", (socket) => {
    socket.emit("room_summaries", []);
    broadcastRoomSummaries().catch((error) => {
      console.error("Failed to broadcast room summaries on connect", error);
    });

    socket.on("create_room", async (payload) => {
      try {
        const body = asObject(payload);
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const sessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const { room, player } = await game.createRoom(nickname, profile, sessionToken);
        bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        socket.emit("room_state", game.getPublicRoomState(room, player.id, "player"));
        await broadcastRoomSummaries();
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("join_room", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const sessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const { room, player } = await game.joinRoom(roomId, nickname, profile, sessionToken);
        bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("join_spectator", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const nickname = requireString(body, "nickname");
        const profile = optionalProfile(body.profile);
        const sessionToken = body.profile && typeof body.profile === "object" ? optionalUserSessionToken((body.profile as PayloadRecord).userSessionToken) : undefined;
        const { room, spectator } = await game.joinSpectator(roomId, nickname, profile, sessionToken);
        bind(socket.id, room.id, spectator.id, "spectator");
        socket.join(room.id);
        socket.join(`member:${spectator.id}`);
        emitSession(socket, room.id, spectator.id, "spectator", spectator.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reconnect_room", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const sessionToken = requireString(body, "sessionToken");
        const { room, participantId, participantType } = await game.reconnectRoom(roomId, sessionToken);
        bind(socket.id, room.id, participantId, participantType);
        socket.join(room.id);
        socket.join(`member:${participantId}`);
        emitSession(socket, room.id, participantId, participantType, sessionToken);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
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

    socket.on("update_room_settings", async (payload) => {
      try {
        const body = parseUpdateRoomSettingsPayload(payload);
        const session = requireSession(socket.id, body.roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能修改房间设置");
        }
        const room = await game.updateRoomSettings(body.roomId, session.participantId, body);
        await sendRoomState(room.id);
      } catch (error) {
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

    socket.on("disband_room", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能解散房间");
        }
        await game.disbandRoom(roomId, session.participantId);
        io.to(roomId).emit("room_closed", { roomId, reason: "房主已解散房间" });
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

    socket.on("submit_clue", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const word = requireString(body, "word");
        const count = requireNumber(body, "count");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能发提示");
        }
        const room = await game.submitClue(roomId, session.participantId, word, count);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("guess_card", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const cardId = requireString(body, "cardId");
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能猜词");
        }
        const room = await game.guessCard(roomId, session.participantId, cardId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("end_turn", async (payload) => {
      try {
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能结束回合");
        }
        const room = await game.endTurn(roomId, session.participantId);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("send_chat_message", async (payload) => {
      try {
        const body = asObject(payload);
        const roomId = requireString(body, "roomId");
        const text = requireString(body, "text");
        const session = requireSession(socket.id, roomId);
        const room = await game.sendChatMessage(roomId, session.participantId, session.participantType, text);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("send_reaction", async (payload) => {
      try {
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
        const roomId = requireRoomId(payload);
        const session = requireSession(socket.id, roomId);
        const room = await game.leaveRoom(roomId, session.participantId, session.participantType);
        socketSessions.delete(socket.id);
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
        socket.emit("room_state", game.getPublicRoomState(room, session.participantId, session.participantType));
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

    socket.on("disconnect", async () => {
      const session = socketSessions.get(socket.id);
      socketSessions.delete(socket.id);
      if (!session) {
        return;
      }
      const room = await game.markDisconnected(session.roomId, session.participantId, session.participantType);
      if (room) {
        await sendRoomState(room.id);
      } else {
        await broadcastRoomSummaries();
      }
    });
  });

  setInterval(() => {
    game.cleanupIdleRooms().catch((err) => console.warn("room cleanup error:", err));
  }, 60_000);

  httpServer.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
