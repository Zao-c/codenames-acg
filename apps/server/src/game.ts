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
  ROOM_TTL_EMPTY_SECONDS,
  ROOM_TTL_PLAYING_IDLE_SECONDS,
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
  type PlayerRoundStats,
  type PublicRoomState,
  type RevealEvent,
  type RevealOutcome,
  type Room,
  type RoomScore,
  type RoundScoreDetail,
  type RoomSummary,
  type ScoringMode,
  type Spectator,
  type Team,
  type UserProfile,
  type WordPack,
  type Achievement,
  type AchievementUnlockPayload,
  type ClueRoundRecord,
  type GameReplay,
  type ReplayBoardCard,
  type ReplayKeyEvent,
  type ReplayRound,
  type RoundHighlight,
  type RoundHighlightCard,
} from "@acg-codenames/shared";
import type { ReplayStore, RoomSession, RoomStore, UserStore } from "./types.js";

function sampleId(length: number): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

async function generateUniqueRoomId(store: RoomStore): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const id = sampleId(ROOM_ID_LENGTH);
    if (!(await store.getRoom(id))) return id;
  }
  throw new Error("房间号生成失败，请重试");
}

const NEUTRAL_COUNT_OPTIONS = {
  "5x5": [3, 5, 7, 9, 11],
  "7x7": [7, 9, 11, 13, 15, 17, 19],
  "9x9": [15, 19, 21, 25]
} as const;

function validateNeutralCount(neutralCount: number | undefined, boardMode: BoardMode): void {
  if (neutralCount === undefined) return;
  if (!isNeutralCountAllowed(neutralCount, boardMode)) {
    const allowed = NEUTRAL_COUNT_OPTIONS[boardMode] as readonly number[];
    throw new Error(`${boardMode} 棋盘的中立词数只能为 ${allowed.join("、")}`);
  }
}

function isNeutralCountAllowed(neutralCount: number, boardMode: BoardMode): boolean {
  return (NEUTRAL_COUNT_OPTIONS[boardMode] as readonly number[]).includes(neutralCount);
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
  startingTeam: Team,
  neutralCount?: number,
  usedWordIds?: string[]
): { board: Card[]; remainingCounts: Record<Team, number> } {
  const config = BOARD_MODE_CONFIG[boardMode];
  const neutral = neutralCount ?? config.neutral;
  const extraSlots = (config.starter + config.follower + config.neutral + config.assassin) - (config.starter + config.follower + neutral + config.assassin);
  const starterAdj = Math.floor(extraSlots / 2);
  const followerAdj = extraSlots - starterAdj;
  const starter = config.starter + starterAdj;
  const follower = config.follower + followerAdj;

  const used = new Set(usedWordIds ?? []);
  const fresh = wordPack.entries.filter((e) => !used.has(e.id));
  const pool = fresh.length >= config.size ? fresh : wordPack.entries;
  const words = shuffle(pool).slice(0, config.size);
  const roles = shuffle([
    ...Array(startingTeam === "red" ? starter : follower).fill("red"),
    ...Array(startingTeam === "blue" ? starter : follower).fill("blue"),
    ...Array(neutral).fill("neutral"),
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
      red: startingTeam === "red" ? starter : follower,
      blue: startingTeam === "blue" ? starter : follower
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

function emptyRoundScore(team: Team): RoundScoreDetail {
  return {
    team,
    ownHits: 0, ownPoints: 0, comboBonus: 0, maxCombo: 0,
    neutralHits: 0, neutralPenalty: 0,
    opponentHits: 0, opponentPointsLost: 0,
    assassinHit: false, assassinPenalty: 0,
    precisionBonus: 0, victoryBonus: 0, totalRound: 0
  };
}

function computeScoreDelta(round: RoundScoreDetail): number {
  return round.ownPoints + round.comboBonus - round.neutralPenalty + round.opponentPointsLost - round.assassinPenalty + round.precisionBonus + round.victoryBonus;
}

function applyScore(room: Room, team: Team, delta: number): { scores: RoomScore } {
  const scores = { ...room.scores };
  scores[team] = Math.max(0, scores[team] + delta);
  return { scores };
}

function isScoringMode(mode: ScoringMode): boolean {
  return mode === "scoring" || mode === "gamble";
}

function getTimerDuration(room: Room, phase: "clue" | "guess"): number {
  const base = phase === "clue"
    ? (room.settings.timerClueSeconds ?? 90)
    : (room.settings.timerGuessSeconds ?? 90);
  if (phase === "clue" && room.settings.timerFirstRoundBonus && !room.firstTurnBonusUsed) {
    return base + 30;
  }
  return base;
}

function ensurePlayerStats(room: Room, player: Player): PlayerRoundStats {
  if (!room.playerStats) room.playerStats = {};
  if (!room.playerStats[player.id]) {
    room.playerStats[player.id] = {
      playerId: player.id, nickname: player.nickname,
      team: player.team, role: player.role,
      ownHits: 0, opponentHits: 0, neutralHits: 0, assassinHits: 0,
      guesses: 0, correctGuessStreakMax: 0, extraGuesses: 0,
      cluesGiven: 0, clueOwnHits: 0, clueWrongHits: 0, preciseClues: 0,
      chatMessages: 0, reactionsSent: 0, endedTurnEarly: 0
    };
  }
  return room.playerStats[player.id];
}

function computeAchievements(room: Room): Achievement[] {
  const results: Achievement[] = [];
  const stats = Object.values(room.playerStats ?? {});
  if (stats.length === 0) return results;

  const bestGuesser = stats.reduce((a, b) => b.ownHits > a.ownHits ? b : a, stats[0]);
  if (bestGuesser.ownHits > 0) {
    results.push({ id: "top-guesser", title: "词牌王者", playerId: bestGuesser.playerId, nickname: bestGuesser.nickname, description: `猜中 ${bestGuesser.ownHits} 张己方词牌`, tier: "positive" });
  }

  const spymasters = stats.filter(s => s.role === "spymaster");
  if (spymasters.length > 0) {
    let bestSpy = spymasters[0];
    let bestScore = -Infinity;
    for (const s of spymasters) {
      const score = s.clueOwnHits * 10 + s.preciseClues * 8 - s.clueWrongHits * 6 - (s.assassinHits > 0 ? 20 : 0);
      if (score > bestScore) { bestScore = score; bestSpy = s; }
    }
    if (bestSpy.cluesGiven > 0) {
      results.push({ id: "best-spy", title: "神谕队长", playerId: bestSpy.playerId, nickname: bestSpy.nickname, description: `${bestSpy.cluesGiven} 次密令带出 ${bestSpy.clueOwnHits} 张`, tier: "positive" });
    }
  }

  const clueRecords = room.clueRecords ?? [];
  let bestClue: ClueRoundRecord | null = null;
  let bestClueHits = 0;
  for (const cr of clueRecords) {
    const ownHits = cr.guesses.filter(g => g.isOwnHit).length;
    if (ownHits > bestClueHits) { bestClueHits = ownHits; bestClue = cr; }
  }
  if (bestClue && bestClueHits > 0) {
    results.push({ id: "god-word", title: "名场面密令", playerId: bestClue.giverPlayerId, nickname: bestClue.giverNickname, description: `「${bestClue.word} ${bestClue.count}」一回合猜中 ${bestClueHits} 张`, tier: "positive" });
  }

  const operatives = stats.filter(s => s.role === "operative");
  for (const cr of clueRecords) {
    for (const g of cr.guesses) {
      if (!g.isOwnHit) continue;
      const op = operatives.find(o => o.playerId === g.playerId);
      if (op && !results.some(r => r.id === "partner-" + op.playerId + "-" + cr.giverPlayerId)) {
        results.push({ id: "partner-" + op.playerId + "-" + cr.giverPlayerId, title: "羁绊连携", playerId: op.playerId, nickname: `${cr.giverNickname} × ${op.nickname}`, description: `"只要一个密令，我们就懂。"`, tier: "positive" });
      }
    }
  }

  const streakMonster = stats.reduce((a, b) => b.correctGuessStreakMax > a.correctGuessStreakMax ? b : a, stats[0]);
  if (streakMonster.correctGuessStreakMax >= 3) {
    results.push({ id: "streak", title: "主角光环持有者", playerId: streakMonster.playerId, nickname: streakMonster.nickname, description: `连续猜中 ${streakMonster.correctGuessStreakMax} 张`, tier: "positive" });
  }

  const backstabber = stats.reduce((a, b) => b.opponentHits > a.opponentHits ? b : a, stats[0]);
  if (backstabber.opponentHits > 0) {
    results.push({ id: "backstab", title: "友军认证失败", playerId: backstabber.playerId, nickname: backstabber.nickname, description: `送给对面 ${backstabber.opponentHits} 张词牌`, tier: "funny" });
  }

  const assassinCaller = stats.find(s => s.assassinHits > 0);
  if (assassinCaller) {
    results.push({ id: "assassin", title: "死亡 Flag 回收者", playerId: assassinCaller.playerId, nickname: assassinCaller.nickname, description: "\"别猜这个？那我偏要猜。\"", tier: "funny" });
  }

  const reckless = stats.reduce((a, b) => b.extraGuesses > a.extraGuesses ? b : a, stats[0]);
  if (reckless.extraGuesses > 0) {
    results.push({ id: "reckless", title: "莽就完事了", playerId: reckless.playerId, nickname: reckless.nickname, description: `提示之外还多猜了 ${reckless.extraGuesses} 张`, tier: "funny" });
  }

  const cautious = stats.reduce((a, b) => b.endedTurnEarly > a.endedTurnEarly ? b : a, stats[0]);
  if (cautious.endedTurnEarly > 0) {
    results.push({ id: "cautious", title: "保守派军师", playerId: cautious.playerId, nickname: cautious.nickname, description: `见好就收 ${cautious.endedTurnEarly} 次`, tier: "vibe" });
  }

  const social = stats.reduce((a, b) => (b.chatMessages + b.reactionsSent) > (a.chatMessages + a.reactionsSent) ? b : a, stats[0]);
  if (social.chatMessages + social.reactionsSent > 0) {
    results.push({ id: "social", title: "队魂担当", playerId: social.playerId, nickname: social.nickname, description: `聊天/互动最活跃`, tier: "vibe" });
  }

  return results.slice(0, 7);
}

function resetPerGameReviewState(room: Room): Room {
  return {
    ...room,
    clueRecords: [],
    roundScoreHistory: [],
    playerStats: {},
    achievements: undefined,
    currentRoundScore: undefined,
    comboStreaks: undefined,
    lastReveal: null
  };
}

function finalizeAchievements(room: Room): Room {
  if (room.phase !== "finished" || room.achievements) return room;
  return { ...room, achievements: computeAchievements(room) };
}

export class GameService {
  private readonly roomLocks = new Map<string, Promise<void>>();
  private readonly heldRoomLocks = new AsyncLocalStorage<Set<string>>();

  constructor(
    private readonly store: RoomStore,
    private readonly users: UserStore,
    private readonly options: { enableDebugTools: boolean } = { enableDebugTools: false },
    private readonly replayStore?: ReplayStore
  ) {}

  private async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    if (this.heldRoomLocks.getStore()?.has(roomId)) {
      return fn();
    }
    const prev = this.roomLocks.get(roomId) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => { release = resolve; });
    const chained = prev.then(() => next);
    this.roomLocks.set(roomId, chained);
    try {
      await prev;
      const held = new Set(this.heldRoomLocks.getStore() ?? []);
      held.add(roomId);
      return await this.heldRoomLocks.run(held, fn);
    } finally {
      release();
      if (this.roomLocks.get(roomId) === chained) {
        this.roomLocks.delete(roomId);
      }
    }
  }

  async createRoom(nickname: string, profile?: Partial<UserProfile>, sessionToken?: string): Promise<{ room: Room; player: Player }> {
    const resolvedProfile = await this.users.resolveProfile(profile, sessionToken);
    const player = await buildPlayer(nickname, true, resolvedProfile);
    const roomId = await generateUniqueRoomId(this.store);
    const room: Room = {
      id: roomId,
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
      lastEvent: `${player.nickname} 创建了密令房 ✨`,
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

  async joinRoom(roomId: string, nickname: string, profile?: Partial<UserProfile>, sessionToken?: string): Promise<{ room: Room; player: Player }> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);

    const cleanNickname = normalizeNickname(nickname);

    const existing = [...room.players, ...room.spectators].find(
      (entry) => entry.nickname === cleanNickname
    );
    if (existing) {
      if ("connected" in existing && !existing.connected) {
        if ("team" in existing) {
          existing.connected = true;
          existing.sessionToken = crypto.randomUUID();
          const nextRoom = withEvent(room, `${existing.nickname} 已重连`);
          await this.store.setRoom(nextRoom);
          await this.store.setPlayerSession(existing.sessionToken!, createSession(nextRoom.id, existing.id, "player"));
          return { room: nextRoom, player: existing };
        }

        room.spectators = room.spectators.filter((s) => s.id !== existing.id);
        if (room.players.length >= MAX_PLAYERS) {
          room.spectators.push(existing);
          throw new Error("房间已满");
        }
        const convertedPlayer = createPlayerFromSpectator(existing);
        if (room.hostPlayerId === existing.id) {
          convertedPlayer.isHost = true;
        }
        const nextRoom = withEvent({ ...room, players: [...room.players, convertedPlayer] }, `${convertedPlayer.nickname} 加入了结社 (｡･∀･)ﾉﾞ`);
        await this.store.setRoom(nextRoom);
        await this.store.setPlayerSession(convertedPlayer.sessionToken!, createSession(nextRoom.id, convertedPlayer.id, "player"));
        return { room: nextRoom, player: convertedPlayer };
      }
      throw new Error("昵称已被占用");
    }

    if (room.players.length >= MAX_PLAYERS) {
      throw new Error("房间已满");
    }

    const player = await buildPlayer(cleanNickname, false, await this.users.resolveProfile(profile, sessionToken));
    const nextRoom = withEvent({ ...room, players: [...room.players, player] }, `${player.nickname} 加入了结社 (｡･∀･)ﾉﾞ`);
    await this.store.setRoom(nextRoom);
    await this.store.setPlayerSession(player.sessionToken!, createSession(nextRoom.id, player.id, "player"));
    return { room: nextRoom, player };
    });
  }

  async joinSpectator(
    roomId: string,
    nickname: string,
    profile?: Partial<UserProfile>,
    sessionToken?: string
  ): Promise<{ room: Room; spectator: Spectator }> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    const cleanNickname = normalizeNickname(nickname);

    const existing = [...room.players, ...room.spectators].find(
      (entry) => entry.nickname === cleanNickname
    );
    if (existing) {
      if ("connected" in existing && !existing.connected) {
        if ("team" in existing) {
          throw new Error("你是本局玩家，请以玩家身份重连");
        }
        existing.connected = true;
        existing.sessionToken = crypto.randomUUID();
        const nextRoom = withEvent(room, `${existing.nickname} 已重连`);
        await this.store.setRoom(nextRoom);
        await this.store.setPlayerSession(existing.sessionToken!, createSession(nextRoom.id, existing.id, "spectator"));
        return { room: nextRoom, spectator: existing };
      }
      throw new Error("昵称已被占用");
    }

    const spectator = await buildSpectator(cleanNickname, await this.users.resolveProfile(profile, sessionToken));
    const nextRoom = withEvent(
      {
        ...room,
        spectators: [...room.spectators, spectator]
      },
      `${spectator.nickname} 进入旁观 👀`
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
    } else if (
      player.role === "spymaster" &&
      room.players.some(
        (entry) =>
          entry.id !== player.id &&
          entry.team === team &&
          entry.role === "spymaster"
      )
    ) {
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

  async randomizeTeams(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    requireLobby(room);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以随机分队");
    }
    if (room.players.length < MIN_PLAYERS_TO_START) {
      throw new Error("至少需要 4 名玩家才能随机分队");
    }

    const shuffledPlayers = shuffle(room.players);
    const firstTeam: Team = Math.random() >= 0.5 ? "red" : "blue";
    const secondTeam = nextTeam(firstTeam);
    const firstTeamSize = Math.ceil(shuffledPlayers.length / 2);
    const firstTeamPlayers = shuffledPlayers.slice(0, firstTeamSize);
    const secondTeamPlayers = shuffledPlayers.slice(firstTeamSize);

    if (firstTeamPlayers.length < 2 || secondTeamPlayers.length < 2) {
      throw new Error("至少需要 4 名玩家才能随机分队");
    }

    const assignment = new Map<string, { team: Team; role: PlayerRole }>();
    firstTeamPlayers.forEach((player, index) => {
      assignment.set(player.id, { team: firstTeam, role: index === 0 ? "spymaster" : "operative" });
    });
    secondTeamPlayers.forEach((player, index) => {
      assignment.set(player.id, { team: secondTeam, role: index === 0 ? "spymaster" : "operative" });
    });

    const nextPlayers = room.players.map((player) => {
      const next = assignment.get(player.id);
      return next ? { ...player, team: next.team, role: next.role } : player;
    });
    const nextRoom = withEvent(
      {
        ...room,
        players: nextPlayers
      },
      "房主随机分配了红蓝队"
    );
    validateStart(nextRoom);
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async updateRoomSettings(
    roomId: string,
    playerId: string,
    payload: { boardMode?: BoardMode; builtinWordPackId?: string; customWordPack?: CustomWordPackInput | null; scoringMode?: ScoringMode; timerMode?: import("@acg-codenames/shared").TimerMode; timerClueSeconds?: number; timerGuessSeconds?: number; timerFirstRoundBonus?: boolean; neutralCount?: number | null; flipMode?: import("@acg-codenames/shared").FlipMode; }
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
    const boardModeChanged = payload.boardMode !== undefined && payload.boardMode !== room.settings.boardMode;

    let nextNeutralCount: number | undefined;
    if (payload.neutralCount === null) {
      nextNeutralCount = undefined;
    } else if (payload.neutralCount !== undefined) {
      nextNeutralCount = payload.neutralCount;
    } else if (boardModeChanged) {
      const currentNeutral = room.settings.neutralCount;
      nextNeutralCount =
        currentNeutral !== undefined && isNeutralCountAllowed(currentNeutral, nextBoardMode)
          ? currentNeutral
          : undefined;
    } else {
      nextNeutralCount = room.settings.neutralCount;
    }

    validateWordPackForMode(nextWordPack, nextBoardMode);
    validateNeutralCount(nextNeutralCount, nextBoardMode);

    const wordPackChanged = nextWordPack !== room.wordPack;

    const nextRoom = withEvent(
      {
        ...room,
        usedWordIds: wordPackChanged ? undefined : room.usedWordIds,
        settings: {
          ...room.settings,
          boardMode: nextBoardMode,
          wordPackId: nextWordPack.id,
          scoringMode: payload.scoringMode ?? room.settings.scoringMode,
          timerMode: payload.timerMode ?? room.settings.timerMode,
          timerClueSeconds: payload.timerClueSeconds ?? room.settings.timerClueSeconds,
          timerGuessSeconds: payload.timerGuessSeconds ?? room.settings.timerGuessSeconds,
          timerFirstRoundBonus: payload.timerFirstRoundBonus ?? room.settings.timerFirstRoundBonus,
          neutralCount: nextNeutralCount,
          flipMode: payload.flipMode ?? room.settings.flipMode
        },
        wordPack: nextWordPack
      },
      `房主更新了密令房设置：${nextBoardMode} / ${nextWordPack.name}`
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
    const { board, remainingCounts } = generateBoard(room.wordPack, room.settings.boardMode, startingTeam, room.settings.neutralCount, room.usedWordIds);
    const nextUsedWordIds = [...(room.usedWordIds ?? []), ...board.map((c) => c.wordId)];
    const timerMode: import("@acg-codenames/shared").TimerMode = room.settings.timerMode ?? "unlimited";
    const timerEndsAt = timerMode === "timed"
      ? now() + getTimerDuration(room, "clue") * 1000
      : undefined;

    const resetRoom = resetPerGameReviewState(room);
    const nextRoom = withEvent(
      {
        ...resetRoom,
        phase: "playing",
        board,
        currentTeam: startingTeam,
        startingTeam,
        clue: null,
        remainingCounts,
        winner: null,
        lastReveal: null,
        comboStreaks: {},
        currentRoundScore: undefined,
        usedWordIds: nextUsedWordIds,
        timerEndsAt,
        timerPhase: timerMode === "timed" ? "clue" as const : undefined,
        timerPaused: false,
        consecutiveTimeouts: 0,
        firstTurnBonusUsed: false
      },
      `第 ${room.roundNumber} 局开始，${TEAM_LABELS[startingTeam]}先手 ٩(ˊᗜˋ*)و`
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
    const { board, remainingCounts } = generateBoard(room.wordPack, room.settings.boardMode, startingTeam, room.settings.neutralCount, room.usedWordIds);
    const nextUsedWordIds = [...(room.usedWordIds ?? []), ...board.map((c) => c.wordId)];
    const timerMode: import("@acg-codenames/shared").TimerMode = room.settings.timerMode ?? "unlimited";
    const timerEndsAt = timerMode === "timed" ? now() + getTimerDuration(room, "clue") * 1000 : undefined;
    const resetRoom = resetPerGameReviewState(room);
    const nextRoom = withEvent(
      {
        ...resetRoom,
        phase: "playing",
        board,
        currentTeam: startingTeam,
        startingTeam,
        clue: null,
        remainingCounts,
        winner: null,
        roundNumber,
        lastReveal: null,
        usedWordIds: nextUsedWordIds,
        timerEndsAt,
        timerPhase: timerMode === "timed" ? "clue" as const : undefined,
        timerPaused: false,
        consecutiveTimeouts: 0,
        firstTurnBonusUsed: false
      },
      `第 ${roundNumber} 局开始，${TEAM_LABELS[startingTeam]}先手 ٩(ˊᗜˋ*)و`
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
        lastReveal: null,
        timerEndsAt: undefined,
        timerPhase: undefined,
        timerPaused: false,
        consecutiveTimeouts: 0,
        timeoutPauseReason: undefined,
      },
      `${host.nickname} 将密令房带回准备阶段`
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
      `${currentHost.nickname} 将社长转让给 ${targetPlayer.nickname}`
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

    const timerMode: import("@acg-codenames/shared").TimerMode = room.settings.timerMode ?? "unlimited";
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
        lastReveal: null,
        timerEndsAt: timerMode === "timed" ? now() + getTimerDuration(room, "guess") * 1000 : undefined,
        timerPhase: timerMode === "timed" ? "guess" as const : undefined,
        timerPaused: false,
        consecutiveTimeouts: 0,
        firstTurnBonusUsed: true
      } as any,
      `${player.nickname} 给出提示：${cleanWord} ${count}`
    );
    ensurePlayerStats(nextRoom, player).cluesGiven += 1;
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

    const guesserStats = ensurePlayerStats(room, player);
    guesserStats.guesses += 1;
    if (room.clue.usedGuesses > room.clue.count) guesserStats.extraGuesses += 1;

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
      guesserStats.assassinHits += 1;
      event = `${player.nickname} 选择了「${card.word}」——刺客词……这波寄了 (╥﹏╥)`;
    } else if (card.role === actingTeam) {
      remainingCounts[actingTeam] -= 1;
      outcome = "own-hit";
      guesserStats.ownHits += 1;
      event = `${player.nickname} 选择了「${card.word}」——${TEAM_LABELS[actingTeam]}词，正确 ✅`;
      if (remainingCounts[actingTeam] === 0) {
        winner = actingTeam;
        clue = null;
        event = `${TEAM_LABELS[actingTeam]}找到全部目标词，太强啦 (★ ω ★)`;
      } else if (room.clue.usedGuesses > room.clue.count) {
        currentTeam = nextTeam(actingTeam);
        clue = null;
        event = `${player.nickname} 用完了额外猜测次数，回合结束`;
      }
    } else {
      currentTeam = nextTeam(actingTeam);
      clue = null;
      outcome = card.role === "neutral" ? "neutral-hit" : "opponent-hit";
      if (card.role === "neutral") {
        guesserStats.neutralHits += 1;
      } else {
        guesserStats.opponentHits += 1;
      }
      if (card.role === "red" || card.role === "blue") {
        remainingCounts[card.role] -= 1;
        if (remainingCounts[card.role] === 0) {
          winner = card.role;
        }
      }
      event =
        card.role === "neutral"
          ? `${player.nickname} 选择了「${card.word}」——中立词，回合结束`
          : `${player.nickname} 选择了「${card.word}」——${TEAM_LABELS[card.role as Team]}词，错误 (⊙ˍ⊙)`;
    }

    const lastReveal = createRevealEvent(card, player, actingTeam, outcome!, currentTeam, winner);

    if (!room.clueRecords) room.clueRecords = [];
    const clueRecord = room.clueRecords[room.clueRecords.length - 1];
    if (clueRecord && clueRecord.giverPlayerId === room.clue?.giverPlayerId && clueRecord.word === room.clue?.word) {
      clueRecord.guesses.push({ playerId: player.id, nickname: player.nickname, cardWord: card.word, cardRole: card.role, isOwnHit: outcome === "own-hit" });
    } else {
      const newRecord: ClueRoundRecord = {
        clueId: "clue-" + Date.now(),
        team: actingTeam,
        giverPlayerId: room.clue?.giverPlayerId ?? "?",
        giverNickname: room.players.find(p => p.id === room.clue?.giverPlayerId)?.nickname ?? "?",
        word: room.clue?.word ?? "?",
        count: room.clue?.count ?? 0,
        guesses: [{ playerId: player.id, nickname: player.nickname, cardWord: card.word, cardRole: card.role, isOwnHit: outcome === "own-hit" }]
      };
      room.clueRecords.push(newRecord);
    }

    const giverStats = ensurePlayerStats(room, room.players.find(p => p.id === room.clue?.giverPlayerId) ?? player);
    if (outcome === "own-hit") giverStats.clueOwnHits += 1;
    else giverStats.clueWrongHits += 1;

    const scoringActive = isScoringMode(room.settings.scoringMode);
    let nextScores: RoomScore = room.scores;
    if (scoringActive) {
      const prev = room.currentRoundScore ?? emptyRoundScore(actingTeam);
      const streaks = { ...(room.comboStreaks ?? {}) };

      if (outcome === "own-hit") {
        const combo = (streaks[actingTeam] ?? 0) + 1;
        streaks[actingTeam] = combo;
        prev.ownHits += 1;
        prev.ownPoints += 10;
        prev.comboBonus += 2 * combo;
        if (combo > prev.maxCombo) prev.maxCombo = combo;
        guesserStats.correctGuessStreakMax = Math.max(guesserStats.correctGuessStreakMax, combo);
      } else {
        streaks[actingTeam] = 0;
        if (outcome === "opponent-hit") {
          prev.opponentHits += 1;
          prev.opponentPointsLost += 5;
          const opponentTeam = card.role as Team;
          const opponentRound = room.currentRoundScore?.team === opponentTeam
            ? room.currentRoundScore
            : emptyRoundScore(opponentTeam);
          opponentRound.opponentPointsLost += 5;
        } else if (outcome === "neutral-hit") {
          prev.neutralHits += 1;
          prev.neutralPenalty += 3;
        } else if (outcome === "assassin-hit") {
          prev.assassinHit = true;
          prev.assassinPenalty += 25;
          const opponentTeam = nextTeam(actingTeam);
          const opponentRound = room.currentRoundScore?.team === opponentTeam
            ? room.currentRoundScore
            : emptyRoundScore(opponentTeam);
          opponentRound.assassinPenalty += 25;
        }
      }

      if (winner === actingTeam) {
        prev.victoryBonus = 20;
      }

      const delta = computeScoreDelta(prev);
      const applied = applyScore(room, actingTeam, delta);
      nextScores = applied.scores;
      prev.totalRound = (room.scores[actingTeam] ?? 0) + delta;

      room.comboStreaks = streaks;
      room.currentRoundScore = prev;

      if (winner) {
        const clueCount = room.clue?.count ?? 0;
        if (
          prev.ownHits === clueCount &&
          prev.neutralHits === 0 &&
          !prev.assassinHit &&
          prev.opponentHits === 0
        ) {
          prev.precisionBonus = 10;
          prev.totalRound += 10;
          nextScores[actingTeam] = Math.max(0, nextScores[actingTeam] + 10);
        }
        room.roundScoreHistory = [...(room.roundScoreHistory ?? []), prev];
        room.currentRoundScore = undefined;
        room.comboStreaks = {};
      }
    }

    const nextRoom = withEvent(
      {
        ...room,
        phase: winner ? "finished" : room.phase,
        currentTeam,
        clue,
        winner,
        remainingCounts,
        scores: winner && !scoringActive ? updateScores(room.scores, winner) : nextScores,
        lastReveal,
        achievements: winner ? computeAchievements(room) : undefined
      },
      event
    );
    if (!clue) {
      const lastRecord = nextRoom.clueRecords?.[nextRoom.clueRecords.length - 1];
      if (lastRecord) {
        const highlights = [...(nextRoom.roundHighlights ?? [])];
        const hl = buildRoundHighlightFromRecord(lastRecord, nextRoom, highlights.length);
        highlights.push(hl);
        nextRoom.roundHighlights = highlights;
      }
    }
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

    let nextScores = room.scores;
    let roundHistory = room.roundScoreHistory ?? [];
    const scoringActive = isScoringMode(room.settings.scoringMode);

    if (scoringActive) {
      const prev = room.currentRoundScore ?? emptyRoundScore(room.currentTeam);
      const clue = room.clue!;
      if (
        prev.ownHits === clue.count &&
        prev.neutralHits === 0 &&
        !prev.assassinHit &&
        prev.opponentHits === 0
      ) {
        prev.precisionBonus = 10;
        prev.totalRound += 10;
        const team = room.currentTeam;
        nextScores = { ...room.scores, [team]: Math.max(0, room.scores[team] + 10) };
      }
      roundHistory = [...roundHistory, prev];
    }

    if (room.clue!.usedGuesses < room.clue!.count) {
      ensurePlayerStats(room, player).endedTurnEarly += 1;
    }

    const timerMode: import("@acg-codenames/shared").TimerMode = room.settings.timerMode ?? "unlimited";
    const nextRoom = withEvent(
      {
        ...room,
        currentTeam,
        clue: null,
        lastReveal: null,
        scores: nextScores,
        roundScoreHistory: roundHistory,
        currentRoundScore: undefined,
        comboStreaks: {},
        timerEndsAt: timerMode === "timed" ? now() + getTimerDuration(room, "clue") * 1000 : undefined,
        timerPhase: timerMode === "timed" ? "clue" as const : undefined,
        timerPaused: false,
        consecutiveTimeouts: 0
      },
      `${player.nickname} 结束了回合 (ง •_•)ง`
    );
    const giverId = room.clue!.giverPlayerId;
    if (giverId && room.clue!.usedGuesses >= room.clue!.count) {
      const spy = room.players.find(p => p.id === giverId);
      if (spy) ensurePlayerStats(nextRoom, spy).preciseClues += 1;
    }
    const lastRecord = nextRoom.clueRecords?.[nextRoom.clueRecords.length - 1];
    if (lastRecord) {
      const highlights = [...(nextRoom.roundHighlights ?? [])];
      const hl = buildRoundHighlightFromRecord(lastRecord, nextRoom, highlights.length);
      highlights.push(hl);
      nextRoom.roundHighlights = highlights;
    }
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async resumeTimer(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有房主可以继续游戏");
    }
    if (room.phase !== "playing") {
      throw new Error("当前不在对局中");
    }
    const timerMode: import("@acg-codenames/shared").TimerMode = room.settings.timerMode ?? "unlimited";
    if (timerMode !== "timed") {
      throw new Error("只有限时模式需要继续计时");
    }
    const nextRoom = withEvent(
      {
        ...room,
        timerEndsAt: now() + getTimerDuration(room, "clue") * 1000,
        timerPhase: "clue" as const,
        timerPaused: false,
        consecutiveTimeouts: 0,
        timeoutPauseReason: undefined
      },
      `${room.players.find((p) => p.id === playerId)?.nickname ?? "房主"} 继续计时`
    );
    await this.store.setRoom(nextRoom);
    return nextRoom;
    });
  }

  async forceEndGame(roomId: string, playerId: string): Promise<Room> {
    return this.withRoomLock(roomId, async () => {
    const room = await this.requireRoom(roomId);
    if (room.hostPlayerId !== playerId) {
      throw new Error("只有社长可以强制结束对局");
    }
    if (room.phase !== "playing") {
      throw new Error("当前不在对局中");
    }
    const winner = nextTeam(room.currentTeam);
    const nextRoom = withEvent(
      { ...room, phase: "finished" as const, winner, clue: null, lastReveal: null },
      `社长强制结束了对局`
    );
    const scoringActive = isScoringMode(room.settings.scoringMode);
    if (!scoringActive) {
      nextRoom.scores = updateScores(room.scores, winner);
    }
    nextRoom.achievements = computeAchievements(room);
    await this.store.setRoom(nextRoom);
    await this.users.recordRoundResult(nextRoom.players, winner);
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
    if (participantType === "player") {
      ensurePlayerStats(nextRoom, participant as Player).chatMessages += 1;
    }
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
    if (participantType === "player") {
      ensurePlayerStats(nextRoom, participant as Player).reactionsSent += 1;
    }
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

  async generateReplay(roomId: string): Promise<string | null> {
    if (!this.replayStore) return null;
    const room = await this.requireRoom(roomId);
    if (room.phase !== "finished") return null;
    const replayId = sampleReplayId();
    const replay = buildReplay(room, replayId);
    await this.replayStore.saveReplay(replay);
    return replayId;
  }

  async getReplay(replayId: string): Promise<GameReplay | null> {
    if (!this.replayStore) return null;
    return this.replayStore.getReplay(replayId);
  }

  async tickTimers(): Promise<Room[]> {
    const rooms = await this.store.listRooms();
    const expired: Room[] = [];
    const now2 = now();
    for (const room of rooms) {
      if (room.phase !== "playing" || room.timerPaused || !room.timerEndsAt || room.timerEndsAt > now2) continue;
      expired.push(room);
    }
    for (const room of expired) {
      await this.tickTimerForRoom(room);
    }
    return expired;
  }

  private async tickTimerForRoom(room: Room): Promise<void> {
    return this.withRoomLock(room.id, async () => {
    const latest = await this.requireRoom(room.id);
    if (latest.phase !== "playing" || latest.timerPaused || !latest.timerEndsAt || latest.timerEndsAt > now()) return;

    if (latest.timerPhase === "clue" && !latest.clue) {
      const skipCount = latest.consecutiveTimeouts ?? 0;
      const currentTeam = nextTeam(latest.currentTeam);
      const scoringActive = isScoringMode(latest.settings.scoringMode);
      let nextScores = latest.scores;
      if (scoringActive && latest.currentRoundScore) {
        const prev = latest.currentRoundScore;
        const penalty = 10;
        prev.totalRound = -penalty;
        nextScores = { ...latest.scores, [latest.currentTeam]: Math.max(0, latest.scores[latest.currentTeam] - penalty) };
        latest.roundScoreHistory = [...(latest.roundScoreHistory ?? []), prev];
      }
      const nextConsecutive = skipCount + 1;
      const timerPaused = nextConsecutive >= 2;
      const nextRoom = withEvent(
        {
          ...latest,
          currentTeam,
          clue: latest.clue,
          scores: nextScores,
          roundScoreHistory: latest.roundScoreHistory,
          currentRoundScore: undefined,
          comboStreaks: {},
          timerEndsAt: timerPaused ? undefined : now() + getTimerDuration(latest, "clue") * 1000,
          timerPhase: timerPaused ? undefined : "clue" as const,
          timerPaused,
          timeoutPauseReason: timerPaused ? `${TEAM_LABELS[latest.currentTeam]} 连续超时` : undefined,
          consecutiveTimeouts: timerPaused ? 0 : nextConsecutive
        },
        timerPaused
          ? `${TEAM_LABELS[latest.currentTeam]} 连续超时，计时暂停，等待房主继续`
          : `${TEAM_LABELS[latest.currentTeam]} 提示超时，回合跳过`
      );
      await this.store.setRoom(nextRoom);
    } else if (latest.timerPhase === "guess" && latest.clue) {
      const currentTeam = nextTeam(latest.currentTeam);
      const scoringActive = isScoringMode(latest.settings.scoringMode);
      let nextScores = latest.scores;
      if (scoringActive && latest.currentRoundScore) {
        const prev = latest.currentRoundScore;
        const clueCount = latest.clue?.count ?? 0;
        if (prev.ownHits !== clueCount || prev.neutralHits > 0 || prev.opponentHits > 0) {
          prev.totalRound = 0;
          latest.roundScoreHistory = [...(latest.roundScoreHistory ?? []), prev];
        }
      }
      const nextRoom = withEvent(
        {
          ...latest,
          currentTeam,
          clue: null,
          scores: nextScores,
          roundScoreHistory: latest.roundScoreHistory,
          currentRoundScore: undefined,
          comboStreaks: {},
          lastReveal: null,
          timerEndsAt: now() + getTimerDuration(latest, "clue") * 1000,
          timerPhase: "clue" as const,
          timerPaused: false,
          consecutiveTimeouts: 0
        },
        `${TEAM_LABELS[latest.currentTeam]} 猜词超时，回合跳过`
      );
      const lastRecord = nextRoom.clueRecords?.[nextRoom.clueRecords.length - 1];
      if (lastRecord) {
        const highlights = [...(nextRoom.roundHighlights ?? [])];
        const hl = buildRoundHighlightFromRecord(lastRecord, nextRoom, highlights.length);
        highlights.push(hl);
        nextRoom.roundHighlights = highlights;
      }
      await this.store.setRoom(nextRoom);
    }
    });
  }

  async cleanupIdleRooms(): Promise<string[]> {
    const rooms = await this.store.listRooms();
    const deleted: string[] = [];
    for (const room of rooms) {
      const idleMs = Date.now() - room.updatedAt;
      const humanPlayers = room.players.filter((p) => !p.isBot);
      if (humanPlayers.length === 0 && idleMs > ROOM_TTL_EMPTY_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        deleted.push(room.id);
      } else if (room.phase === "playing" && idleMs > ROOM_TTL_PLAYING_IDLE_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        deleted.push(room.id);
      } else if (room.phase === "lobby" && idleMs > ROOM_TTL_LOBBY_IDLE_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        deleted.push(room.id);
      } else if (room.phase === "finished" && idleMs > ROOM_TTL_FINISHED_SECONDS * 1000) {
        await this.store.deleteRoom(room.id);
        deleted.push(room.id);
      }
    }
    return deleted;
  }

  private async requireRoom(roomId: string): Promise<Room> {
    const room = await this.store.getRoom(roomId);
    if (!room) {
      throw new Error("房间不存在");
    }
    return room;
  }
}

export function buildRoundHighlightFromRecord(
  record: ClueRoundRecord,
  room: Room,
  roundIndex: number
): RoundHighlight {
  const hitCards: RoundHighlightCard[] = [];
  const wrongCards: RoundHighlightCard[] = [];
  for (const g of record.guesses) {
    const card: RoundHighlightCard = {
      id: g.playerId + "-" + g.cardWord,
      word: g.cardWord,
      role: g.cardRole,
      guessedByNickname: g.nickname
    };
    if (g.isOwnHit) {
      hitCards.push(card);
    } else {
      wrongCards.push(card);
    }
  }

  const assassinHit = record.guesses.some((g) => g.cardRole === "assassin");
  const opponentHitCount = record.guesses.filter((g) => !g.isOwnHit && (g.cardRole === "red" || g.cardRole === "blue")).length;
  const wrongHitCount = record.guesses.filter((g) => !g.isOwnHit).length;

  let captainTitle = "";
  if (assassinHit) {
    captainTitle = "刺客引路人";
  } else if (opponentHitCount > 0) {
    captainTitle = "诈骗队长";
  } else if (hitCards.length === record.count && wrongCards.length === 0) {
    captainTitle = "神谕队长";
  } else if (hitCards.length >= Math.ceil(record.count / 2)) {
    captainTitle = "稳健队长";
  } else if (hitCards.length === 0) {
    captainTitle = "谜语人";
  } else {
    captainTitle = "普通队长";
  }

  let teamTitle = "";
  if (hitCards.length === record.count && wrongCards.length === 0) {
    teamTitle = "脑回路同步";
  } else if (wrongHitCount >= 2) {
    teamTitle = "脑补过度";
  } else if (assassinHit) {
    teamTitle = "命运选择者";
  } else if (hitCards.length > 0 && wrongCards.length === 0) {
    teamTitle = "执行到位";
  } else {
    teamTitle = "仍在解码";
  }

  const missedCards: RoundHighlightCard[] = [];
  if (hitCards.length < record.count) {
    const revealedWordIds = new Set(record.guesses.map((g) => g.cardWord));
    const remainingOwnCards = room.board.filter(
      (c) => c.role === record.team && !c.revealed
    );
    const missedCount = record.count - hitCards.length;
    remainingOwnCards.slice(0, missedCount).forEach((c) => {
      missedCards.push({
        id: c.id,
        word: c.word,
        role: c.role,
        guessedByNickname: ""
      });
    });
  }

  return {
    id: "hl-" + Date.now() + "-" + roundIndex,
    roundIndex,
    team: record.team,
    clueWord: record.word,
    clueCount: record.count,
    giverPlayerId: record.giverPlayerId,
    giverNickname: record.giverNickname,
    hitCards,
    wrongCards,
    missedCards,
    assassinHit,
    captainTitle,
    teamTitle
  };
}

export function buildAchievementUnlocksFromHighlight(
  highlight: RoundHighlight,
  room: Room
): AchievementUnlockPayload[] {
  const results: AchievementUnlockPayload[] = [];

  if (highlight.captainTitle === "神谕队长") {
    results.push({
      id: "ach-oracle",
      title: "神谕队长",
      playerId: highlight.giverPlayerId,
      nickname: highlight.giverNickname,
      description: "单回合提示全中且无误伤"
    });
  }

  if (highlight.captainTitle === "诈骗队长") {
    results.push({
      id: "ach-fraud",
      title: "诈骗队长",
      playerId: highlight.giverPlayerId,
      nickname: highlight.giverNickname,
      description: "单回合造成对手误伤"
    });
  }

  if (highlight.captainTitle === "刺客引路人") {
    results.push({
      id: "ach-assassin-lead",
      title: "刺客引路人",
      playerId: highlight.giverPlayerId,
      nickname: highlight.giverNickname,
      description: "提示后队友翻到刺客"
    });
  }

  if (highlight.teamTitle === "脑回路同步") {
    for (const hc of highlight.hitCards) {
      const guessPlayer = room.players.find((p) => p.nickname === hc.guessedByNickname);
      if (guessPlayer && !results.some((r) => r.playerId === guessPlayer.id && r.id === "ach-sync")) {
        results.push({
          id: "ach-sync",
          title: "脑回路同步",
          playerId: guessPlayer.id,
          nickname: guessPlayer.nickname,
          description: "单回合猜中全部目标"
        });
      }
    }
  }

  if (highlight.assassinHit) {
    const assassinGuess = highlight.wrongCards.find((c) => c.role === "assassin");
    if (assassinGuess) {
      const guessPlayer = room.players.find((p) => p.nickname === assassinGuess.guessedByNickname);
      if (guessPlayer) {
        results.push({
          id: "ach-assassin-friend",
          title: "刺客亲友",
          playerId: guessPlayer.id,
          nickname: guessPlayer.nickname,
          description: "本局翻到刺客"
        });
      }
    }
  }

  if (highlight.captainTitle === "谜语人") {
    results.push({
      id: "ach-riddler",
      title: "谜语人",
      playerId: highlight.giverPlayerId,
      nickname: highlight.giverNickname,
      description: "提示后队友全部猜错"
    });
  }

  return results;
}

export function buildReplay(room: Room, replayId: string): GameReplay {
  const REPLAY_TTL_SECONDS = 7 * 24 * 60 * 60;

  const boardMode = room.settings.boardMode;
  const scoringMode = room.settings.scoringMode;
  const timerMode = room.settings.timerMode ?? "unlimited";

  const players = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    team: p.team,
    role: p.role,
    isHost: p.isHost
  }));

  const finalBoard: ReplayBoardCard[] = room.board.map((c) => ({
    id: c.id,
    word: c.word,
    role: c.role,
    revealed: c.revealed,
    guessedByNickname: undefined,
    guessedByTeam: c.revealedBy
  }));

  for (const cr of room.clueRecords ?? []) {
    for (const g of cr.guesses) {
      const card = finalBoard.find((c) => c.word === g.cardWord && c.role === g.cardRole);
      if (card) {
        card.guessedByNickname = g.nickname;
      }
    }
  }

  const rounds: ReplayRound[] = [];
  const keyEvents: ReplayKeyEvent[] = [];

  for (let i = 0; i < (room.clueRecords?.length ?? 0); i += 1) {
    const cr = room.clueRecords![i];
    const hl = room.roundHighlights?.[i];
    const round: ReplayRound = {
      index: i + 1,
      team: cr.team,
      clueWord: cr.word,
      clueCount: cr.count,
      giverNickname: cr.giverNickname,
      guesses: cr.guesses.map((g) => ({
        word: g.cardWord,
        role: g.cardRole,
        guessedByNickname: g.nickname,
        result: g.isOwnHit ? "hit" as const : g.cardRole === "assassin" ? "assassin" as const : g.cardRole === "neutral" ? "neutral" as const : "opponent" as const
      })),
      captainLabel: hl?.captainTitle,
      teamLabel: hl?.teamTitle
    };

    if (hl && hl.missedCards.length > 0) {
      round.missed = hl.missedCards.map((c) => ({ word: c.word, role: c.role as Team }));
    }

    rounds.push(round);

    const ownHits = cr.guesses.filter((g) => g.isOwnHit).length;
    const wrongHits = cr.guesses.filter((g) => !g.isOwnHit);
    const assassinHit = cr.guesses.some((g) => g.cardRole === "assassin");

    if (ownHits >= 3 && wrongHits.length === 0) {
      keyEvents.push({
        id: `ke-great-${i}`,
        type: "great_clue",
        title: "神提示",
        description: `${TEAM_LABELS[cr.team]}「${cr.word} ${cr.count}」命中 ${ownHits} 张`,
        roundIndex: i + 1,
        team: cr.team
      });
    }

    if (ownHits === 0 && cr.guesses.length > 0) {
      keyEvents.push({
        id: `ke-low-${i}`,
        type: "low_accuracy_clue",
        title: "谜语提示",
        description: `${TEAM_LABELS[cr.team]}「${cr.word} ${cr.count}」无人理解`,
        roundIndex: i + 1,
        team: cr.team
      });
    }

    for (const g of wrongHits) {
      if (g.cardRole === "assassin") {
        keyEvents.push({
          id: `ke-assassin-${i}`,
          type: "assassin",
          title: "刺客名场面",
          description: `${g.nickname} 翻到了「${g.cardWord}」`,
          roundIndex: i + 1,
          playerNickname: g.nickname
        });
      } else if (g.cardRole === "red" || g.cardRole === "blue") {
        keyEvents.push({
          id: `ke-wrong-${i}-${g.cardWord}`,
          type: "wrong_hit",
          title: "误伤",
          description: `${g.nickname} 翻到了${TEAM_LABELS[g.cardRole as Team]}牌「${g.cardWord}」`,
          roundIndex: i + 1,
          playerNickname: g.nickname,
          team: g.cardRole
        });
      }
    }
  }

  const createdAt = Date.now();
  return {
    id: replayId,
    roomId: room.id,
    createdAt,
    expiresAt: createdAt + REPLAY_TTL_SECONDS * 1000,
    mode: { boardMode, scoringMode, timerMode },
    players,
    winner: room.winner,
    durationMs: createdAt - room.createdAt,
    finalBoard,
    rounds,
    keyEvents: keyEvents.slice(0, 20)
  };
}

function sampleReplayId(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}
