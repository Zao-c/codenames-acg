import { MAX_PLAYERS, MIN_PLAYERS_TO_START, TEAM_LABELS } from "./constants.js";
import { toWordPackSummary } from "./words.js";
import type {
  PublicCard,
  PublicPlayer,
  PublicRoomState,
  PublicSpectator,
  RoundHighlight,
  Room,
  RoomSummary,
  ViewerIdentity,
  ViewerState
} from "./types.js";

export function isSpymaster(viewer: ViewerIdentity): boolean {
  return viewer.role === "spymaster" || viewer.revealAll === true;
}

function buildViewerState(room: Room, viewer: ViewerIdentity): ViewerState | null {
  if (!viewer.participantId || !viewer.participantType) {
    return null;
  }

  const isPlayer = viewer.participantType === "player";
  const isSpectator = viewer.participantType === "spectator";
  const canEditRoom = viewer.isHost === true && room.phase === "lobby" && isPlayer;
  const canStartGame = canEditRoom;
  const canRestartGame = viewer.isHost === true && room.phase === "finished" && isPlayer;
  const canReturnToLobby = viewer.isHost === true && room.phase !== "lobby" && isPlayer;
  const canTransferHost = viewer.isHost === true && isPlayer && room.players.some((player) => !player.isBot && player.id !== viewer.participantId);
  const canDisbandRoom = viewer.isHost === true && isPlayer;
  const canUseDebugFill =
    viewer.isDebugController === true &&
    room.phase === "lobby" &&
    room.players.filter((player) => !player.isBot).length === 1;
  const canSubmitClue =
    isPlayer &&
    room.phase === "playing" &&
    !room.clue &&
    (viewer.isDebugController === true || (viewer.team === room.currentTeam && viewer.role === "spymaster"));
  const canGuess =
    isPlayer &&
    room.phase === "playing" &&
    !!room.clue &&
    (viewer.isDebugController === true || (viewer.team === room.currentTeam && viewer.role === "operative"));
  const canEndTurn =
    isPlayer &&
    room.phase === "playing" &&
    !!room.clue &&
    (viewer.isDebugController === true || viewer.team === room.currentTeam);
  const canQueueForNextRound = isSpectator && room.phase !== "lobby" && room.players.length < MAX_PLAYERS;
  const canCancelQueue = isSpectator && viewer.isQueuedForNextRound === true;
  const canResumeTimer = viewer.isHost === true && room.timerPaused === true && isPlayer;
  const targetTeam = room.phase === "playing" ? room.currentTeam : null;

  let statusText = "等待房间同步";
  if (room.phase === "lobby") {
    const assignedPlayers = room.players.filter((player) => player.team !== null).length;
    const spymasters = room.players.filter((player) => player.role === "spymaster" && player.team !== null).length;

    if (isSpectator) {
      statusText = "正在旁观准备阶段";
    } else if (canUseDebugFill) {
      statusText = "可使用单人调试补位";
    } else if (!viewer.team) {
      statusText = "先选择队伍";
    } else if (room.players.length < MIN_PLAYERS_TO_START) {
      statusText = "等待更多玩家加入";
    } else if (assignedPlayers < MIN_PLAYERS_TO_START) {
      statusText = "还有玩家尚未分队";
    } else if (spymasters < 2) {
      statusText = "等待双方队长就位";
    } else if (canStartGame) {
      statusText = "可以开始对局";
    } else {
      statusText = "等待房主开局";
    }
  } else if (room.phase === "playing") {
    if (isSpectator) {
      statusText = viewer.isQueuedForNextRound ? "旁观中，已排队加入下一局" : "旁观中，可排队加入下一局";
    } else if (!room.clue) {
      statusText = canSubmitClue
        ? `轮到你为${TEAM_LABELS[room.currentTeam]}发提示`
        : `等待${TEAM_LABELS[room.currentTeam]}队长发提示`;
    } else if (canGuess) {
      statusText = `轮到你为${TEAM_LABELS[room.currentTeam]}猜词：${room.clue.word} ${room.clue.count}`;
    } else if (canEndTurn) {
      statusText = `你可以结束${TEAM_LABELS[room.currentTeam]}的当前回合`;
    } else {
      statusText = `等待${TEAM_LABELS[room.currentTeam]}行动`;
    }
  } else if (room.winner) {
    statusText = `${TEAM_LABELS[room.winner]}获胜`;
    if (isSpectator && viewer.isQueuedForNextRound) {
      statusText += "，等待房主开始下一局";
    }
  } else {
    statusText = "本局结束";
  }

  return {
    participantType: viewer.participantType,
    participantId: viewer.participantId,
    team: viewer.team ?? null,
    role: viewer.role ?? null,
    isHost: viewer.isHost === true,
    isDebugController: viewer.isDebugController === true,
    canStartGame,
    canUseDebugFill,
    canSubmitClue,
    canGuess,
    canEndTurn,
    canRestartGame,
    canReturnToLobby,
    canTransferHost,
    canDisbandRoom,
    canEditRoom,
    canResumeTimer,
    canQueueForNextRound,
    canCancelQueue,
    isQueuedForNextRound: viewer.isQueuedForNextRound === true,
    targetTeam,
    statusText
  };
}

export function buildRoomSummary(room: Room): RoomSummary {
  const host =
    room.players.find((player) => player.id === room.hostPlayerId) ??
    room.spectators.find((spectator) => spectator.id === room.hostPlayerId) ??
    room.players[0] ??
    room.spectators[0];

  return {
    id: room.id,
    phase: room.phase,
    boardMode: room.settings.boardMode,
    roundNumber: room.roundNumber,
    wordPackSummary: toWordPackSummary(room.wordPack),
    playerCount: room.players.length,
    spectatorCount: room.spectators.length,
    queuedCount: room.joinQueue.length,
    hostNickname: host?.nickname ?? "房主",
    hostProfile: host?.profile ?? { accountType: "guest", username: null, avatarUrl: null },
    hasOpenSlots: room.players.length < MAX_PLAYERS,
    canJoinDirectly: room.phase === "lobby" && room.players.length < MAX_PLAYERS,
    canSpectate: true,
    canQueueForNextRound: room.phase !== "lobby" && room.players.length < MAX_PLAYERS,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastEvent: room.lastEvent,
    replayId: room.replayId
  };
}

export function sanitizeRoom(room: Room, viewer: ViewerIdentity = {}): PublicRoomState {
  const sanitizePlayer = ({ sessionToken: _sessionToken, ...player }: Room["players"][number]): PublicPlayer => player;
  const sanitizeSpectator = ({ sessionToken: _sessionToken, ...spectator }: Room["spectators"][number]): PublicSpectator =>
    spectator;
  const players: PublicPlayer[] = room.players.map(sanitizePlayer);
  const spectators: PublicSpectator[] = room.spectators.map(sanitizeSpectator);
  const revealAll = isSpymaster(viewer) || room.phase === "finished";
  const flipMode: import("./types.js").FlipMode = room.settings.flipMode ?? "word-color";
  const board: PublicCard[] = room.board.map((card) => {
    const canSeeWord = !card.revealed || revealAll || flipMode === "word-color";
    return {
      id: card.id,
      wordId: card.wordId,
      word: canSeeWord ? card.word : "",
      role: revealAll || card.revealed ? card.role : undefined,
      revealed: card.revealed,
      revealedBy: card.revealedBy
    };
  });
  const roundHighlights = sanitizeRoundHighlightsForPhase(room.roundHighlights, room.phase);

  return {
    id: room.id,
    phase: room.phase,
    players,
    spectators,
    joinQueue: room.joinQueue,
    board,
    currentTeam: room.currentTeam,
    startingTeam: room.startingTeam,
    clue: room.clue,
    remainingCounts: room.remainingCounts,
    winner: room.winner,
    settings: room.settings,
    scores: room.scores,
    roundNumber: room.roundNumber,
    messages: room.messages,
    hostPlayerId: room.hostPlayerId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastEvent: room.lastEvent,
    lastReveal: room.lastReveal,
    achievements: room.achievements,
    clueRecords: room.clueRecords,
    roundHighlights,
    roundScoreHistory: room.roundScoreHistory,
    playerStats: room.playerStats,
    usedWordIds: room.usedWordIds,
    wordPackSummary: toWordPackSummary(room.wordPack),
    timerEndsAt: room.timerEndsAt,
    timerPhase: room.timerPhase,
    timerPaused: room.timerPaused,
    pausedTimerPhase: room.pausedTimerPhase,
    timeoutPauseReason: room.timeoutPauseReason,
    consecutiveTimeouts: room.consecutiveTimeouts,
    firstTurnBonusUsed: room.firstTurnBonusUsed,
    replayId: room.replayId,
    currentRoundScore: room.currentRoundScore,
    comboStreaks: room.comboStreaks,
    viewer: buildViewerState(room, viewer),
    serverNow: Date.now()
  };
}

export function sanitizeRoundHighlightsForPhase(
  highlights: RoundHighlight[] | undefined,
  phase: Room["phase"]
): RoundHighlight[] | undefined {
  if (!highlights) return undefined;
  if (phase === "finished") return highlights;
  return highlights.map((highlight) => ({ ...highlight, missedCards: [] }));
}
