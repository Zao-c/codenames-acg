import { MAX_PLAYERS, MIN_PLAYERS_TO_START, TEAM_LABELS } from "./constants.js";
import { analysisPermissions } from "./analysis-view.js";
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
  const isCodenamesMode = room.settings.ruleSet !== "reveal-guess";
  const locked = !!room.nextPlan?.lockedPlayerIds || room.nextPlan?.stage === "sealed";
  const canEditRoom = viewer.isHost === true && room.phase === "lobby" && !room.countdown && !locked && isPlayer;
  const canStartGame = viewer.isHost === true && isPlayer && room.phase === "lobby" && !room.countdown && (!room.nextPlan || room.nextPlan.variant === "classic" || room.nextPlan.stage === "sealed");
  const canRestartGame = viewer.isHost === true && room.phase === "finished" && isPlayer;
  const canReturnToLobby = viewer.isHost === true && room.phase !== "lobby" && isPlayer;
  const canTransferHost = viewer.isHost === true && isPlayer && room.players.some((player) => !player.isBot && player.id !== viewer.participantId);
  const canDisbandRoom = viewer.isHost === true && isPlayer;
  const canUseDebugFill =
    isCodenamesMode &&
    viewer.isDebugController === true &&
    room.phase === "lobby" &&
    room.players.filter((player) => !player.isBot).length === 1;
  const canSubmitClue =
    isCodenamesMode &&
    isPlayer &&
    room.phase === "playing" &&
    !room.clue &&
    (viewer.isDebugController === true || (viewer.team === room.currentTeam && viewer.role === "spymaster"));
  const canGuess =
    !room.exposedPlayerIds?.includes(viewer.participantId) &&
    isCodenamesMode &&
    isPlayer &&
    room.phase === "playing" &&
    !!room.clue &&
    (viewer.isDebugController === true || (viewer.team === room.currentTeam && viewer.role === "operative"));
  const canEndTurn =
    isCodenamesMode &&
    isPlayer &&
    room.phase === "playing" &&
    !!room.clue &&
    (viewer.isDebugController === true || viewer.team === room.currentTeam);
  const canQueueForNextRound = isSpectator && (room.phase !== "lobby" || locked) && room.players.length < MAX_PLAYERS;
  const canCancelQueue = isSpectator && viewer.isQueuedForNextRound === true;
  const canResumeTimer = viewer.isHost === true && room.timerPaused === true && isPlayer;
  const targetTeam = isCodenamesMode && room.phase === "playing" ? room.currentTeam : null;

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
    boardMode: room.phase === 'lobby' ? room.nextPlan?.settings.boardMode ?? room.settings.boardMode : room.settings.boardMode,
    variant: room.phase === 'lobby' ? room.nextPlan?.variant ?? room.settings.variant : room.settings.variant,
    poolName: room.phase === 'lobby' && room.nextPlan ? (room.nextPlan.variant === 'anime' ? room.nextPlan.poolName : room.nextPlan.wordPack.name) : room.settings.variant === 'anime' ? room.wordPack.name : undefined,
    gameMode: room.settings.ruleSet,
    roundNumber: room.roundNumber,
    wordPackSummary: toWordPackSummary(room.wordPack),
    playerCount: room.players.length,
    spectatorCount: room.spectators.length,
    queuedCount: room.joinQueue.length,
    hostNickname: host?.nickname ?? "房主",
    hostProfile: host?.profile ?? { accountType: "guest", username: null, avatarUrl: null },
    hasOpenSlots: room.players.length < MAX_PLAYERS,
    canJoinDirectly: room.phase !== "playing" && !room.countdown && !room.nextPlan?.lockedPlayerIds && room.players.length < MAX_PLAYERS,
    canSpectate: true,
    canQueueForNextRound: (room.phase !== "lobby" || !!room.nextPlan?.lockedPlayerIds) && room.players.length < MAX_PLAYERS,
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
      anime: card.anime,
      word: canSeeWord ? card.word : "",
      role: revealAll || card.revealed ? card.role : undefined,
      revealed: card.revealed,
      revealedBy: card.revealedBy
    };
  });
  const roundHighlights = sanitizeRoundHighlightsForPhase(room.roundHighlights, room.phase);
  const plan = room.nextPlan;
  const myTeam = viewer.participantType === 'player' && room.players.some(p => p.id === viewer.participantId)
    ? (['red','blue'] as const).find(team => plan?.captains[team] === viewer.participantId) : undefined;
  // Both authorized captains see official draft claims; operatives/spectators see only the static pool.
  const captainClaims = myTeam && plan && plan.stage !== 'sealed'
    ? plan.claims
    : undefined;
  const nextPlan = plan ? {
    id: plan.id, version: plan.version, variant: plan.variant, settings: plan.settings,
    wordPackName: plan.wordPack.name, poolName: plan.poolName, sourcePool: plan.sourcePool, poolIds: plan.pool.map(w => w.id), candidates: plan.candidates,
    startingTeam: plan.startingTeam, stage: plan.stage, captains: plan.captains, endsAt: plan.endsAt,
    myTeam, myBookmarks: myTeam ? plan.bookmarks[viewer.participantId!] ?? [] : undefined,
    captainView: captainClaims ? { claims: captainClaims, ready: plan.ready, done: plan.done } : undefined,
  } : undefined;

  return {
    id: room.id,
    animeEnabled: room.animeEnabled,
    analysis: analysisPermissions(room, viewer),
    nextPlan,
    interferenceReview: room.endReason === "normal" && room.phase === "finished" && room.draftReview && room.draftReview.matchId === room.matchId && room.draftReview.participantIds.includes(viewer.participantId ?? "") ? room.draftReview.interference : undefined,
    matchId: room.matchId,
    gameStartedAt: room.gameStartedAt,
    endReason: room.endReason,
    replayHistory: room.replayHistory,
    countdown: room.countdown,
    phase: room.phase,
    gameMode: room.settings.ruleSet,
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
    judgePlayerId: room.judgePlayerId,
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

