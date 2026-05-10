import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  BOARD_MODE_CONFIG,
  DEFAULT_ROOM_SETTINGS,
  MAX_CHAT_LENGTH,
  MAX_CHAT_MESSAGES,
  MAX_CLUE_COUNT,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  MIN_CLUE_COUNT,
  MIN_PLAYERS_TO_START,
  PLAYER_ROLE_LABELS,
  ROOM_ID_LENGTH,
  ROOM_TTL_LOBBY_IDLE_SECONDS,
  ROOM_TTL_FINISHED_SECONDS,
  TEAM_LABELS,
  buildRoomSummary,
  createCustomWordPack,
  defaultWordPack,
  getBuiltinWordPackById,
  sanitizeRoom,
  type BoardMode,
  type Card,
  type ChatMessage,
  type ChatReaction,
  type Clue,
  type CustomWordPackInput,
  type JoinRequest,
  type ParticipantType,
  type Player,
  type PlayerRole,
  type PublicRoomState,
  type RevealEvent,
  type RevealOutcome,
  type Room,
  type RoomSummary,
  type Spectator,
  type Team,
  type UserProfile,
  type WordPack
} from "@acg-codenames/shared";
import type { RoomSession, RoomStore, UserStore } from "./types.js";

function sampleId(length: number): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

function now(): number {
  return Date.now();
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function nextTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

function getHumanPlayers(room: Room): Player[] {
  return room.players.filter((player) => !player.isBot);
}

function normalizeNickname(nickname: string): string {
  const clean = nickname.trim();
  if (!clean) {
    throw new Error("昵称不能为空");
  }
  if (clean.length > MAX_NICKNAME_LENGTH) {
    throw new Error(`昵称不能超过 ${MAX_NICKNAME_LENGTH} 个字`);
  }
  return clean;
}

function normalizeChatText(text: string): string {
  const clean = text.trim();
  if (!clean) {
    throw new Error("聊天内容不能为空");
  }
  if (clean.length > MAX_CHAT_LENGTH) {
    throw new Error(`聊天内容不能超过 ${MAX_CHAT_LENGTH} 个字`);
  }
  return clean;
}

function createBot(nickname: string, team: Team, role: PlayerRole): Player {
  return {
    id: crypto.randomUUID(),
    nickname,
    profile: { accountType: "guest", username: null, avatarUrl: null },
    team,
    role,
    connected: true,
    isHost: false,
    isBot: true
  };
}

function createPlayerFromSpectator(spectator: Spectator): Player {
  return {
    id: spectator.id,
    nickname: spectator.nickname,
    profile: spectator.profile,
    team: null,
    role: "operative",
    connected: spectator.connected,
    isHost: false,
    sessionToken: spectator.sessionToken
  };
}

function isSoloDebugController(room: Room, playerId: string, enableDebugTools: boolean): boolean {
  if (!enableDebugTools || room.hostPlayerId !== playerId) {
    return false;
  }
  const humanPlayers = getHumanPlayers(room);
  if (humanPlayers.length !== 1 || humanPlayers[0]?.id !== playerId) {
    return false;
  }
  return room.players.length === 1 || room.players.some((player) => player.isBot);
}

function validateWordPackForMode(wordPack: WordPack, boardMode: BoardMode): void {
  const config = BOARD_MODE_CONFIG[boardMode];
  if (wordPack.entries.length < config.size) {
    throw new Error(`${wordPack.name} 词条不足，${boardMode} 至少需要 ${config.size} 个词`);
  }
}

function generateBoard(
  wordPack: WordPack,
  boardMode: BoardMode,
  startingTeam: Team
): { board: Card[]; remainingCounts: Record<Team, number> } {
  const config = BOARD_MODE_CONFIG[boardMode];
  const words = shuffle(wordPack.entries).slice(0, config.size);
  const roles = shuffle([
    ...Array(startingTeam === "red" ? config.starter : config.follower).fill("red"),
    ...Array(startingTeam === "blue" ? config.starter : config.follower).fill("blue"),
    ...Array(config.neutral).fill("neutral"),
    ...Array(config.assassin).fill("assassin")
  ] as Card["role"][]);

  return {
    board: words.map((entry, index) => ({
      id: crypto.randomUUID(),
      wordId: entry.id,
      word: entry.text,
      role: roles[index],
      revealed: false
    })),
    remainingCounts: {
      red: startingTeam === "red" ? config.starter : config.follower,
      blue: startingTeam === "blue" ? config.starter : config.follower
    }
  };
}

function createMessage(type: ChatMessage["type"], text: string, options: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    type,
    text,
    createdAt: now(),
    ...options
  };
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_CHAT_MESSAGES);
}

function withEvent(room: Room, lastEvent: string, message?: ChatMessage): Room {
  return {
    ...room,
    updatedAt: now(),
    lastEvent,
    messages: trimMessages([...room.messages, message ?? createMessage("system", lastEvent)])
  };
}

function requirePlayer(room: Room, playerId: string): Player {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error("玩家不存在");
  }
  return player;
}

function requireSpectator(room: Room, spectatorId: string): Spectator {
  const spectator = room.spectators.find((entry) => entry.id === spectatorId);
  if (!spectator) {
    throw new Error("旁观者不存在");
  }
  return spectator;
}

function requireParticipant(room: Room, participantId: string, participantType: ParticipantType): Player | Spectator {
  return participantType === "player" ? requirePlayer(room, participantId) : requireSpectator(room, participantId);
}

function requireLobby(room: Room): void {
  if (room.phase !== "lobby") {
    throw new Error("当前不在准备阶段");
  }
}

function requirePlaying(room: Room): void {
  if (room.phase !== "playing") {
    throw new Error("当前不在对局中");
  }
}

function validateStart(room: Room): void {
  if (room.players.length < MIN_PLAYERS_TO_START) {
    throw new Error(`至少需要 ${MIN_PLAYERS_TO_START} 名玩家`);
  }

  for (const team of ["red", "blue"] as const) {
    const teamPlayers = room.players.filter((player) => player.team === team);
    if (teamPlayers.length < 2) {
      throw new Error("每队至少需要 2 名玩家");
    }
    if (teamPlayers.filter((player) => player.role === "spymaster").length !== 1) {
      throw new Error("每队需要且仅需要 1 名队长");
    }
  }

  validateWordPackForMode(room.wordPack, room.settings.boardMode);
}

function updateScores(scores: Room["scores"], winner: Team | null): Room["scores"] {
  if (!winner) {
    return scores;
  }
  return {
    ...scores,
    [winner]: scores[winner] + 1
  };
}

function hasNicknameConflict(room: Room, nickname: string, ignoreId?: string): boolean {
  return [...room.players, ...room.spectators].some((entry) => entry.id !== ignoreId && entry.nickname === nickname);
}

function promoteQueuedSpectators(room: Room): {
  players: Player[];
  spectators: Spectator[];
  joinQueue: JoinRequest[];
  promoted: Spectator[];
} {
  const openSlots = Math.max(0, MAX_PLAYERS - room.players.length);
  if (openSlots === 0 || room.joinQueue.length === 0) {
    return {
      players: room.players,
      spectators: room.spectators,
      joinQueue: room.joinQueue,
      promoted: []
    };
  }

  const queueToPromote = room.joinQueue.slice(0, openSlots);
  const promotedIds = new Set(queueToPromote.map((entry) => entry.spectatorId));
  const promoted = room.spectators.filter((spectator) => promotedIds.has(spectator.id));
  const spectators = room.spectators.filter((spectator) => !promotedIds.has(spectator.id));
  const players = [...room.players, ...promoted.map(createPlayerFromSpectator)];
  const joinQueue = room.joinQueue.filter((entry) => !promotedIds.has(entry.spectatorId));

  return { players, spectators, joinQueue, promoted };
}

function createSession(roomId: string, participantId: string, participantType: ParticipantType): RoomSession {
  return { roomId, participantId, participantType };
}

function createRevealEvent(
  card: Card,
  player: Player,
  currentTeam: Team,
  outcome: RevealOutcome,
  nextTurn: Team,
  winner: Team | null
): RevealEvent {
  return {
    id: crypto.randomUUID(),
    cardId: card.id,
    word: card.word,
    role: card.role,
    guessedByPlayerId: player.id,
    guessedByNickname: player.nickname,
    guessedByTeam: currentTeam,
    outcome,
    nextTeam: nextTurn,
    winner,
    createdAt: now()
  };
}

async function buildPlayer(nickname: string, isHost: boolean, profile: UserProfile): Promise<Player> {
  return {
    id: crypto.randomUUID(),
    nickname: normalizeNickname(nickname),
    profile,
    team: null,
    role: "operative",
    connected: true,
    isHost,
    sessionToken: crypto.randomUUID()
  };
}

async function buildSpectator(nickname: string, profile: UserProfile): Promise<Spectator> {
  return {
    id: crypto.randomUUID(),
    nickname: normalizeNickname(nickname),
    profile,
    connected: true,
    sessionToken: crypto.randomUUID(),
    joinedAt: now()
  };
}

export class GameService {
  private readonly roomLocks = new Map<string, Promise<void>>();
  private readonly heldRoomLocks = new AsyncLocalStorage<Set<string>>();

  constructor(
    private readonly store: RoomStore,
    private readonly users: UserStore,
    private readonly options: { enableDebugTools: boolean } = { enableDebugTools: false }
  ) {}

  private async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    if (this.heldRoomLocks.getStore()?.has(roomId)) {
      return fn();
    }
    const prev = this.roomLocks.get(roomId) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.roomLocks.set(roomId, prev.then(() => next));
    try {
      await prev;
      const held = new Set(this.heldRoomLocks.getStore() ?? []);
      held.add(roomId);
      return await this.heldRoomLocks.run(held, fn);
    } finally {
      release();
      if (this.roomLocks.get(roomId) === next) {
        this.roomLocks.delete(roomId);
      }
    }
  }

  async createRoom(nickname: string, profile?: Partial<UserProfile>): Promise<{ room: Room; player: Player }> {
    const resolvedProfile = await this.users.resolveProfile(profile);
    const player = await buildPlayer(nickname, true, resolvedProfile);
    const room: Room = {
      id: sampleId(ROOM_ID_LENGTH),
      phase: "lobby",
      players: [player],
      spectators: [],
      joinQueue: [],
      board: [],
      currentTeam: "red",
      startingTeam: "red",
      clue: null,
      remainingCounts: { red: 0, blue: 0 },
      winner: null,
      settings: { ...DEFAULT_ROOM_SETTINGS },
      wordPack: defaultWordPack,
      scores: { red: 0, blue: 0 },
      roundNumber: 1,
      messages: [],
      hostPlayerId: player.id,
      createdAt: now(),
      updatedAt: now(),
      lastEvent: `${player.nickname} 创建了房间`,
      lastReveal: null
    };
    const nextRoom = withEvent(room, room.lastEvent);
    await this.store.setRoom(nextRoom);
    await this.store.setPlayerSession(player.sessionToken!, createSession(nextRoom.id, player.id, "player"));
    if (resolvedProfile.accountType === "named") {
      await this.users.noteRoomHosted(resolvedProfile.username);
    }
    return { room: nextRoom, player };
  }

  async listRoomSummaries(): Promise<RoomSummary[]> {
    const rooms = await this.store.listRooms();
    return rooms.map(buildRoomSummary);
  }

  getRoom(roomId: string): Promise<Room | null> {
    return this.store.getRoom(roomId);
  }

  async joinRoom(roomId: string, nickname: string, profile?: Partial<UserProfile>): Promise<{ room: Room; player: Player }> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    if (room.players.length >= MAX_PLAYERS) {
      throw new Error("房间已满");
    }

    const cleanNickname = normalizeNickname(nickname);
    if (hasNicknameConflict(room, cleanNickname)) {
      throw new Error("昵称已被占用");
    }

    const player = await buildPlayer(cleanNickname, false, await this.users.resolveProfile(profile));
    const nextRoom = withEvent({ ...room, players: [...room.players, player] }, `${player.nickname} 加入了房间`);
    await this.store.setRoom(nextRoom);
    await this.store.setPlayerSession(player.sessionToken!, createSession(nextRoom.id, player.id, "player"));
    return { room: nextRoom, player };
    });
  }

  async joinSpectator(
    roomId: string,
    nickname: string,
    profile?: Partial<UserProfile>
  ): Promise<{ room: Room; spectator: Spectator }> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const cleanNickname = normalizeNickname(nickname);
    if (hasNicknameConflict(room, cleanNickname)) {
      throw new Error("昵称已被占用");
    }

    const spectator = await buildSpectator(cleanNickname, await this.users.resolveProfile(profile));
    const nextRoom = withEvent(
      {
        ...room,
        spectators: [...room.spectators, spectator]
      },
      `${spectator.nickname} 进入旁观`
    );
    await this.store.setRoom(nextRoom);
    await this.store.setPlayerSession(spectator.sessionToken!, createSession(nextRoom.id, spectator.id, "spectator"));
    return { room: nextRoom, spectator };
    });
  }

  async reconnectRoom(
    roomId: string,
    sessionToken: string
  ): Promise<{ room: Room; participantId: string; participantType: ParticipantType }> {
    return this.withRoomLock(roomId, async () => {
    const session = await this.store.getPlayerSession(sessionToken);
    if (!session || session.roomId !== roomId) {
      throw new Error("重连凭证无效");
    }

    const room = await this.requireRoom(roomId);
    const participant = requireParticipant(room, session.participantId, session.participantType);
    participant.connected = true;

    const nextRoom = withEvent(room, `${participant.nickname} 已重连`);
    await this.store.setRoom(nextRoom);
    return { room: nextRoom, participantId: session.participantId, participantType: session.participantType };
    });
  }

  async setTeam(roomId: string, playerId: string, team: Team | null): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    const player = requirePlayer(room, playerId);

    player.team = team;
    if (!team) {
      player.role = "operative";
    }

    const nextRoom = withEvent(room, `${player.nickname} 调整了队伍`);
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async setRole(roomId: string, playerId: string, role: PlayerRole): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    const player = requirePlayer(room, playerId);

    if (!player.team) {
      throw new Error("请先选择队伍");
    }
    if (
      role === "spymaster" &&
      room.players.some((entry) => entry.id !== player.id && entry.team === player.team && entry.role === "spymaster")
    ) {
      throw new Error("这个队伍已经有队长了");
    }

    player.role = role;
    const nextRoom = withEvent(room, `${player.nickname} 切换为${PLAYER_ROLE_LABELS[role]}`);
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async updateRoomSettings(
    roomId: string,
    playerId: string,
    payload: { boardMode?: BoardMode; builtinWordPackId?: string; customWordPack?: CustomWordPackInput | null }
  ): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以修改房间设置");
    }

    let nextWordPack = room.wordPack;
    if (payload.customWordPack) {
      nextWordPack = createCustomWordPack(payload.customWordPack);
    } else if (payload.builtinWordPackId) {
      const builtin = getBuiltinWordPackById(payload.builtinWordPackId);
      if (!builtin) {
        throw new Error("题库不存在");
      }
      nextWordPack = builtin;
    }

    const nextBoardMode = payload.boardMode ?? room.settings.boardMode;
    validateWordPackForMode(nextWordPack, nextBoardMode);

    const nextRoom = withEvent(
      {
        ...room,
        settings: {
          ...room.settings,
          boardMode: nextBoardMode,
          wordPackId: nextWordPack.id
        },
        wordPack: nextWordPack
      },
      `房主更新了房间设置：${nextBoardMode} / ${nextWordPack.name}`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async debugFillRoom(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    if (!this.options.enableDebugTools) {
      throw new Error("当前环境未启用调试工具");
    }

    const room = await this.requireRoom(roomId);
    requireLobby(room);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以使用调试补位");
    }

    const humanPlayers = getHumanPlayers(room);
    if (humanPlayers.length !== 1 || humanPlayers[0]?.id !== playerId) {
      throw new Error("调试补位仅支持单人房间");
    }

    const host = requirePlayer(room, playerId);
    const hostTeam = host.team ?? "red";
    const otherTeam = nextTeam(hostTeam);
    const sameTeamBot = createBot("测试位 A", hostTeam, host.role === "spymaster" ? "operative" : "spymaster");
    const otherTeamSpymaster = createBot("测试位 B", otherTeam, "spymaster");
    const otherTeamOperative = createBot("测试位 C", otherTeam, "operative");

    host.team = hostTeam;

    const nextRoom = withEvent(
      {
        ...room,
        players: [host, sameTeamBot, otherTeamSpymaster, otherTeamOperative]
      },
      `${host.nickname} 启用了单人调试补位`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async startGame(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以开局");
    }

    validateStart(room);
    const startingTeam: Team = Math.random() >= 0.5 ? "red" : "blue";
    const { board, remainingCounts } = generateBoard(room.wordPack, room.settings.boardMode, startingTeam);

    const nextRoom = withEvent(
      {
        ...room,
        phase: "playing",
        board,
        currentTeam: startingTeam,
        startingTeam,
        clue: null,
        remainingCounts,
        winner: null,
        lastReveal: null
      },
      `第 ${room.roundNumber} 局开始，${TEAM_LABELS[startingTeam]}先手`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async restartGame(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    if (room.phase !== "finished") {
      throw new Error("只有对局结束后才能再来一把");
    }
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以再来一把");
    }

    const { players, spectators, joinQueue, promoted } = promoteQueuedSpectators(room);
    const roundNumber = room.roundNumber + 1;

    if (promoted.length > 0) {
      const nextRoom = withEvent(
        {
          ...room,
          phase: "lobby",
          players: players.map((player) => ({
            ...player,
            isHost: player.id === room.hostPlayerId,
            team: player.team,
            role: player.role
          })),
          spectators,
          joinQueue,
          board: [],
          currentTeam: "red",
          startingTeam: "red",
          clue: null,
          remainingCounts: { red: 0, blue: 0 },
          winner: null,
          roundNumber,
          lastReveal: null
        },
        `第 ${roundNumber} 局准备阶段，${promoted.length} 名旁观者补位成功`
      );
      await this.store.setRoom(nextRoom);
      await Promise.all(
        promoted
          .filter((spectator) => spectator.sessionToken)
          .map((spectator) =>
            this.store.setPlayerSession(spectator.sessionToken!, createSession(room.id, spectator.id, "player"))
          )
      );
      return nextRoom;
    }

    try {
      validateStart(room);
    } catch {
      const nextRoom = withEvent(
        {
          ...room,
          phase: "lobby",
          players: room.players.map((player) => ({
            ...player,
            isHost: player.id === room.hostPlayerId,
            team: player.team,
            role: player.role
          })),
          board: [],
          currentTeam: "red",
          startingTeam: "red",
          clue: null,
          remainingCounts: { red: 0, blue: 0 },
          winner: null,
          roundNumber,
          lastReveal: null
        },
        "人数不足，回到准备阶段等待玩家加入"
      );
      await this.store.setRoom(nextRoom);
      return nextRoom;
    }

    const startingTeam: Team = Math.random() >= 0.5 ? "red" : "blue";
    const { board, remainingCounts } = generateBoard(room.wordPack, room.settings.boardMode, startingTeam);
    const nextRoom = withEvent(
      {
        ...room,
        phase: "playing",
        board,
        currentTeam: startingTeam,
        startingTeam,
        clue: null,
        remainingCounts,
        winner: null,
        roundNumber,
        lastReveal: null
      },
      `第 ${roundNumber} 局开始，${TEAM_LABELS[startingTeam]}先手`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async returnToLobby(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const host = requirePlayer(room, playerId);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以回到准备阶段");
    }
    if (room.phase === "lobby") {
      return room;
    }

    const { players, spectators, joinQueue, promoted } = promoteQueuedSpectators(room);
    const nextRoom = withEvent(
      {
        ...room,
        phase: "lobby",
        players: players.map((player) => ({
          ...player,
          isHost: player.id === room.hostPlayerId
        })),
        spectators,
        joinQueue,
        board: [],
        currentTeam: "red",
        startingTeam: "red",
        clue: null,
        remainingCounts: { red: 0, blue: 0 },
        winner: null,
        roundNumber: room.roundNumber + 1,
        lastReveal: null
      },
      `${host.nickname} 将房间带回准备阶段`
    );
    await this.store.setRoom(nextRoom);
    await Promise.all(
      promoted
        .filter((spectator) => spectator.sessionToken)
        .map((spectator) =>
          this.store.setPlayerSession(spectator.sessionToken!, createSession(room.id, spectator.id, "player"))
        )
    );
    return nextRoom;
    });
  }

  async transferHost(roomId: string, currentHostId: string, targetPlayerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const currentHost = requirePlayer(room, currentHostId);
    const targetPlayer = requirePlayer(room, targetPlayerId);
    if (room.hostPlayerId !== currentHostId) {
      throw new Error("只有房主可以转让房主");
    }
    if (targetPlayer.isBot) {
      throw new Error("不能把房主转让给测试位");
    }
    if (targetPlayer.id === currentHost.id) {
      return room;
    }

    const nextRoom = withEvent(
      {
        ...room,
        hostPlayerId: targetPlayer.id,
        players: room.players.map((player) => ({
          ...player,
          isHost: player.id === targetPlayer.id
        }))
      },
      `${currentHost.nickname} 将房主转让给 ${targetPlayer.nickname}`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async disbandRoom(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以解散房间");
    }
    await this.store.deleteRoom(room.id);
    return room;
    });
  }

  async submitClue(roomId: string, playerId: string, word: string, count: number): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requirePlaying(room);
    const player = requirePlayer(room, playerId);
    if (!player.connected) {
      throw new Error("你已离线，请重新连接");
    }
    const isDebugHost = isSoloDebugController(room, playerId, this.options.enableDebugTools);

    if (room.clue) {
      throw new Error("当前回合已经有提示");
    }
    if (!isDebugHost && (player.team !== room.currentTeam || player.role !== "spymaster")) {
      throw new Error("只有当前队伍的队长可以发提示");
    }

    const cleanWord = word.trim();
    if (!cleanWord) {
      throw new Error("提示词不能为空");
    }
    if (!Number.isInteger(count) || count < MIN_CLUE_COUNT || count > MAX_CLUE_COUNT) {
      throw new Error("提示数字不合法");
    }

    const nextRoom = withEvent(
      {
        ...room,
        clue: {
          word: cleanWord,
          count,
          team: room.currentTeam,
          giverPlayerId: player.id,
          usedGuesses: 0
        },
        lastReveal: null
      },
      `${player.nickname} 给出提示：${cleanWord} ${count}`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async guessCard(roomId: string, playerId: string, cardId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requirePlaying(room);
    const player = requirePlayer(room, playerId);
    if (!player.connected) {
      throw new Error("你已离线，请重新连接");
    }
    const isDebugHost = isSoloDebugController(room, playerId, this.options.enableDebugTools);

    if (!isDebugHost && (player.team !== room.currentTeam || player.role !== "operative")) {
      throw new Error("只有当前队伍的队员可以猜词");
    }
    if (!room.clue) {
      throw new Error("当前没有提示");
    }

    const card = room.board.find((entry) => entry.id === cardId);
    if (!card) {
      throw new Error("词牌不存在");
    }
    if (card.revealed) {
      return room;
    }

    const actingTeam = room.currentTeam;
    card.revealed = true;
    card.revealedBy = actingTeam;
    room.clue.usedGuesses += 1;

    let winner: Team | null = null;
    let currentTeam = actingTeam;
    let clue: Clue | null = room.clue;
    const remainingCounts = { ...room.remainingCounts };
    let event = `${player.nickname} 翻开了 ${card.word}`;
    let outcome: RevealOutcome;

    if (card.role === "assassin") {
      winner = nextTeam(actingTeam);
      clue = null;
      outcome = "assassin-hit";
      event = `${player.nickname} 猜中了刺客词`;
    } else if (card.role === actingTeam) {
      remainingCounts[actingTeam] -= 1;
      outcome = "own-hit";
      event = `${player.nickname} 猜中了${TEAM_LABELS[actingTeam]}的目标词`;
      if (remainingCounts[actingTeam] === 0) {
        winner = actingTeam;
        clue = null;
        event = `${TEAM_LABELS[actingTeam]}找到了全部目标词`;
      } else if (room.clue.usedGuesses > room.clue.count) {
        currentTeam = nextTeam(actingTeam);
        clue = null;
        event = `${player.nickname} 用完了额外猜测机会`;
      }
    } else {
      currentTeam = nextTeam(actingTeam);
      clue = null;
      outcome = card.role === "neutral" ? "neutral-hit" : "opponent-hit";
      if (card.role === "red" || card.role === "blue") {
        remainingCounts[card.role] -= 1;
        if (remainingCounts[card.role] === 0) {
          winner = card.role;
        }
      }
      event =
        card.role === "neutral"
          ? `${player.nickname} 猜到了中立词`
          : `${player.nickname} 猜到了${TEAM_LABELS[card.role as Team]}的词`;
    }

    const lastReveal = createRevealEvent(card, player, actingTeam, outcome!, currentTeam, winner);
    const nextRoom = withEvent(
      {
        ...room,
        phase: winner ? "finished" : room.phase,
        currentTeam,
        clue,
        winner,
        remainingCounts,
        scores: winner ? updateScores(room.scores, winner) : room.scores,
        lastReveal
      },
      event
    );
    await this.store.setRoom(nextRoom);
    if (winner) {
      await this.users.recordRoundResult(nextRoom.players, winner);
    }
    return nextRoom;
    });
  }

  async endTurn(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requirePlaying(room);
    const player = requirePlayer(room, playerId);
    const isDebugHost = isSoloDebugController(room, playerId, this.options.enableDebugTools);

    if (!isDebugHost && player.team !== room.currentTeam) {
      throw new Error("只有当前队伍可以结束回合");
    }
    if (!room.clue) {
      throw new Error("当前没有可结束的回合");
    }

    const currentTeam = nextTeam(room.currentTeam);
    const nextRoom = withEvent(
      {
        ...room,
        currentTeam,
        clue: null,
        lastReveal: null
      },
      `${player.nickname} 结束了回合`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async sendChatMessage(roomId: string, participantId: string, participantType: ParticipantType, text: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const participant = requireParticipant(room, participantId, participantType);
    const cleanText = normalizeChatText(text);
    const message = createMessage("chat", cleanText, {
      playerId: participant.id,
      nickname: participant.nickname
    });

    const nextRoom = {
      ...room,
      updatedAt: now(),
      messages: trimMessages([...room.messages, message])
    };
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async sendReaction(
    roomId: string,
    participantId: string,
    participantType: ParticipantType,
    reaction: ChatReaction,
    targetParticipantId: string,
    targetParticipantType: ParticipantType
  ): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const participant = requireParticipant(room, participantId, participantType);
    const target = requireParticipant(room, targetParticipantId, targetParticipantType);

    const recentMessages = [...room.messages].reverse();
    const recentReaction = recentMessages.find(
      (m: ChatMessage) =>
        m.type === "reaction" &&
        m.playerId === participant.id &&
        m.targetParticipantId === target.id &&
        now() - m.createdAt < 5000
    );
    if (recentReaction) {
      throw new Error("请稍等片刻再发送互动");
    }

    const text =
      reaction === "flower"
        ? participant.nickname + " \u7ED9 " + target.nickname + " \u9001\u4E86\u4E00\u6735\u82B1 \u{1F490}~\u2661"
        : participant.nickname + " \u5411 " + target.nickname + " \u4E22\u4E86\u4E00\u9897\u81ED\u9E21\u86CB \u{1F95A}!!\u{1F4A5}";
    const message = createMessage("reaction", text, {
      playerId: participant.id,
      nickname: participant.nickname,
      reaction,
      targetParticipantId: target.id,
      targetParticipantType,
      targetNickname: target.nickname,
      targetProfile: target.profile
    });

    const nextRoom = {
      ...room,
      updatedAt: now(),
      messages: trimMessages([...room.messages, message])
    };
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async queueForNextRound(roomId: string, spectatorId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const spectator = requireSpectator(room, spectatorId);

    if (room.phase === "lobby") {
      throw new Error("准备阶段请直接加入玩家席");
    }
    if (room.players.length >= MAX_PLAYERS) {
      throw new Error("玩家席已满");
    }
    if (room.joinQueue.some((entry) => entry.spectatorId === spectator.id)) {
      throw new Error("你已经在下一局候补队列中");
    }

    const nextRoom = withEvent(
      {
        ...room,
        joinQueue: [
          ...room.joinQueue,
          {
            spectatorId: spectator.id,
            nickname: spectator.nickname,
            profile: spectator.profile,
            requestedAt: now()
          }
        ]
      },
      `${spectator.nickname} 已进入下一局候补`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async cancelQueueJoin(roomId: string, spectatorId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const spectator = requireSpectator(room, spectatorId);
    if (!room.joinQueue.some((entry) => entry.spectatorId === spectator.id)) {
      throw new Error("你当前不在候补队列中");
    }

    const nextRoom = withEvent(
      {
        ...room,
        joinQueue: room.joinQueue.filter((entry) => entry.spectatorId !== spectator.id)
      },
      `${spectator.nickname} 取消了下一局候补`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async leaveRoom(roomId: string, participantId: string, participantType: ParticipantType): Promise<Room | null> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const participant = requireParticipant(room, participantId, participantType);

    const players = participantType === "player" ? room.players.filter((entry) => entry.id !== participantId) : room.players;
    const spectators =
      participantType === "spectator" ? room.spectators.filter((entry) => entry.id !== participantId) : room.spectators;
    const joinQueue = room.joinQueue.filter((entry) => entry.spectatorId !== participantId);

    if (players.length === 0 || players.every((entry) => entry.isBot)) {
      await this.store.deleteRoom(room.id);
      return null;
    }

    const nextHostId = players.find((entry) => !entry.isBot)?.id ?? players[0].id;
    const nextRoom = withEvent(
      {
        ...room,
        players: players.map((entry) => ({
          ...entry,
          isHost: entry.id === nextHostId
        })),
        spectators,
        joinQueue,
        hostPlayerId: nextHostId
      },
      `${participant.nickname} 离开了房间`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async markDisconnected(roomId: string, participantId: string, participantType: ParticipantType): Promise<Room | null> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      return null;
    }

    const participant =
      participantType === "player"
        ? room.players.find((entry) => entry.id === participantId)
        : room.spectators.find((entry) => entry.id === participantId);
    if (!participant) {
      return room;
    }

    participant.connected = false;
    const nextRoom = withEvent(room, `${participant.nickname} 暂时离线`);

    if (room.phase === "lobby" && participantType === "player" && !(participant as Player).isBot) {
      const DISCONNECT_KICK_DELAY = 2 * 60 * 1000;
      setTimeout(async () => {
        try {
          const current = await this.store.getRoom(roomId);
          if (!current || current.phase !== "lobby") return;
          const entry =
            current.players.find((p) => p.id === participantId) ??
            current.spectators.find((s) => s.id === participantId);
          if (!entry?.connected) {
            await this.leaveRoom(roomId, participantId, participantType);
          }
        } catch {
          // 静默处理
        }
      }, DISCONNECT_KICK_DELAY);
    }

    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  getPublicRoomState(room: Room, participantId?: string, participantType?: ParticipantType): PublicRoomState {
    const player = participantType === "player" ? room.players.find((entry) => entry.id === participantId) : undefined;
    const isDebugController =
      participantType === "player" && participantId
        ? isSoloDebugController(room, participantId, this.options.enableDebugTools)
        : false;
    const isQueuedForNextRound =
      participantType === "spectator" && participantId
        ? room.joinQueue.some((entry) => entry.spectatorId === participantId)
        : false;

    return sanitizeRoom(room, {
      participantType: participantType ?? null,
      participantId: participantId ?? null,
      team: player?.team,
      role: player?.role,
      isHost: participantId === room.hostPlayerId,
      isDebugController,
      isQueuedForNextRound,
      revealAll: isDebugController
    });
  }

  async cleanupIdleRooms(): Promise<number> {
    const rooms = await this.store.listRooms();
    let cleaned = 0;
    for (const room of rooms) {
      const idleMs = Date.now() - room.updatedAt;
      const humanPlayers = room.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0) {
        await this.store.deleteRoom(room.id);
        cleaned++;
      } else if (room.phase === "lobby" && idleMs > ROOM_TTL_LOBBY_IDLE_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        cleaned++;
      } else if (room.phase === "finished" && idleMs > ROOM_TTL_FINISHED_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        cleaned++;
      }
    }
    return cleaned;
  }

  private async requireRoom(roomId: string): Promise<Room> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error("房间不存在");
    }
    return room;
  }
}
