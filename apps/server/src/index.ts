import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ParticipantType, ServerToClientEvents } from "@acg-codenames/shared";
import { env } from "./env.js";
import { GameService } from "./game.js";
import { createRoomStore } from "./store.js";
import { JsonUserStore } from "./user-store.js";

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
  app.use(express.json());

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
      const username = String(req.body?.username ?? "");
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
      res.json(user);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Fetch failed" });
    }
  });

  app.put("/api/users/:username", async (req, res) => {
    try {
      const user = await users.update(req.params.username, req.body ?? {});
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

    socket.on("create_room", async ({ nickname, profile }) => {
      try {
        const { room, player } = await game.createRoom(nickname, profile);
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

    socket.on("join_room", async ({ roomId, nickname, profile }) => {
      try {
        const { room, player } = await game.joinRoom(roomId, nickname, profile);
        bind(socket.id, room.id, player.id, "player");
        socket.join(room.id);
        socket.join(`member:${player.id}`);
        emitSession(socket, room.id, player.id, "player", player.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("join_spectator", async ({ roomId, nickname, profile }) => {
      try {
        const { room, spectator } = await game.joinSpectator(roomId, nickname, profile);
        bind(socket.id, room.id, spectator.id, "spectator");
        socket.join(room.id);
        socket.join(`member:${spectator.id}`);
        emitSession(socket, room.id, spectator.id, "spectator", spectator.sessionToken!);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("reconnect_room", async ({ roomId, sessionToken }) => {
      try {
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

    socket.on("set_team", async ({ roomId, team }) => {
      try {
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

    socket.on("set_role", async ({ roomId, role }) => {
      try {
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
        const session = requireSession(socket.id, payload.roomId);
        if (session.participantType !== "player") {
          throw new Error("旁观者不能修改房间设置");
        }
        const room = await game.updateRoomSettings(payload.roomId, session.participantId, payload);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("start_game", async ({ roomId }) => {
      try {
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

    socket.on("restart_game", async ({ roomId }) => {
      try {
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

    socket.on("return_to_lobby", async ({ roomId }) => {
      try {
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

    socket.on("transfer_host", async ({ roomId, targetPlayerId }) => {
      try {
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

    socket.on("disband_room", async ({ roomId }) => {
      try {
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

    socket.on("submit_clue", async ({ roomId, word, count }) => {
      try {
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

    socket.on("guess_card", async ({ roomId, cardId }) => {
      try {
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

    socket.on("end_turn", async ({ roomId }) => {
      try {
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

    socket.on("send_chat_message", async ({ roomId, text }) => {
      try {
        const session = requireSession(socket.id, roomId);
        const room = await game.sendChatMessage(roomId, session.participantId, session.participantType, text);
        await sendRoomState(room.id);
      } catch (error) {
        fail(socket, error);
      }
    });

    socket.on("send_reaction", async ({ roomId, reaction, targetParticipantId, targetParticipantType }) => {
      try {
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

    socket.on("queue_for_next_round", async ({ roomId }) => {
      try {
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

    socket.on("cancel_queue_join", async ({ roomId }) => {
      try {
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

    socket.on("leave_room", async ({ roomId }) => {
      try {
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

    socket.on("sync_room_state", async ({ roomId }) => {
      try {
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

    socket.on("debug_fill_room", async ({ roomId }) => {
      try {
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

  httpServer.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
