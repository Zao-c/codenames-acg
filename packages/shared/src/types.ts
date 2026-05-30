export type Team = "red" | "blue";
export type CardRole = Team | "neutral" | "assassin";
export type PlayerRole = "spymaster" | "operative";
export type RoomPhase = "lobby" | "playing" | "finished";
export type GameMode = "codenames" | "reveal-guess";
export type RevealGuessPhase =
  | "pre-round"
  | "revealing"
  | "buzzing"
  | "judging"
  | "round-end"
  | "game-end";
export type WordCategory = "title" | "character" | "organization" | "trope" | "production" | "fandom" | "custom";
export type BoardMode = "5x5" | "7x7" | "9x9";
export type ScoringMode = "classic" | "scoring" | "gamble";
export type TimerMode = "unlimited" | "timed";
export type FlipMode = "word-color" | "color-only";
export type ChatReaction = "flower" | "egg";
export type ChatMessageType = "system" | "chat" | "reaction";
export type ParticipantType = "player" | "spectator";
export type AccountType = "guest" | "named";
export type RevealOutcome = "own-hit" | "opponent-hit" | "neutral-hit" | "assassin-hit";
export type CandidateEntryReviewStatus = "pending" | "approved" | "rejected";
export type CandidateSpoilerRisk = "low" | "medium" | "high";
export type CandidateFreshness = "stable" | "seasonal" | "volatile" | "unknown";

export interface UserProfile {
  accountType: AccountType;
  username: string | null;
  avatarUrl: string | null;
  userSessionToken?: string;
}

export interface UserStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  roomsHosted: number;
}

export interface SavedWordPack {
  id: string;
  name: string;
  description?: string;
  entries: string[];
  sourceFranchises?: string[];
  difficultyRange?: [number, number];
  isPublic?: boolean;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicWordPack extends SavedWordPack {
  publicId: string;
  ownerUsername: string;
  ownerAvatarUrl: string | null;
}

export interface PublicWordPackSummary {
  id: string;
  publicId: string;
  name: string;
  description?: string;
  entryCount: number;
  ownerUsername: string;
  ownerAvatarUrl: string | null;
  isPublic?: boolean;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ── Image Packs (图库) ──

export interface ImagePackEntry {
  id: string;
  url: string;
  label: string;
}

export interface SavedImagePack {
  id: string;
  name: string;
  description?: string;
  entries: ImagePackEntry[];
  isPublic?: boolean;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublicImagePack extends SavedImagePack {
  publicId: string;
  ownerUsername: string;
  ownerAvatarUrl: string | null;
}

export interface PublicImagePackSummary {
  id: string;
  publicId: string;
  name: string;
  description?: string;
  entryCount: number;
  ownerUsername: string;
  ownerAvatarUrl: string | null;
  isPublic?: boolean;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CandidatePackSourceMeta {
  generatedBy?: string;
  sourceMaterial?: string;
  createdAt?: string;
  version?: string;
}

export interface CandidateEntry {
  display: string;
  aliases: string[];
  type: string;
  franchise: string;
  tags: string[];
  difficulty: number;
  uniquenessScore: number;
  playabilityScore: number;
  spoilerRisk: CandidateSpoilerRisk;
  freshness: CandidateFreshness;
  reason: string;
  reviewStatus: CandidateEntryReviewStatus;
  reviewNotes?: string;
}

export interface RejectedCandidateExample {
  text: string;
  reason: string;
}

export interface CandidatePack {
  packName: string;
  summary: string;
  recommendedBoardModes: BoardMode[];
  entries: CandidateEntry[];
  rejectedExamples: RejectedCandidateExample[];
  sourceMeta?: CandidatePackSourceMeta;
}

export interface NamedUserAccount {
  username: string;
  avatarUrl: string | null;
  customWordPacks: SavedWordPack[];
  customImagePacks: SavedImagePack[];
  stats: UserStats;
  createdAt: number;
  updatedAt: number;
}

export interface NamedUserLoginResponse extends NamedUserAccount {
  sessionToken: string;
}

export interface WordEntry {
  id: string;
  text: string;
  category: WordCategory;
}

export interface WordPack {
  id: string;
  name: string;
  description: string;
  entries: readonly WordEntry[];
  isBuiltin?: boolean;
}

export interface WordPackSummary {
  id: string;
  name: string;
  description: string;
  entryCount: number;
  isBuiltin?: boolean;
}

export interface Card {
  id: string;
  wordId: string;
  word: string;
  role: CardRole;
  revealed: boolean;
  revealedBy?: Team;
}

export interface Player {
  id: string;
  nickname: string;
  profile: UserProfile;
  team: Team | null;
  role: PlayerRole;
  connected: boolean;
  isHost: boolean;
  isBot?: boolean;
  sessionToken?: string;
}

export interface Spectator {
  id: string;
  nickname: string;
  profile: UserProfile;
  connected: boolean;
  sessionToken?: string;
  joinedAt: number;
}

export interface JoinRequest {
  spectatorId: string;
  nickname: string;
  profile: UserProfile;
  requestedAt: number;
}

export interface Clue {
  id?: string;
  word: string;
  count: number;
  team: Team;
  giverPlayerId?: string;
  usedGuesses: number;
}

export interface RoomSettings {
  ruleSet: GameMode;
  boardMode: BoardMode;
  wordPackId: string;
  scoringMode: ScoringMode;
  timerMode?: TimerMode;
  timerClueSeconds?: number;
  timerGuessSeconds?: number;
  timerFirstRoundBonus?: boolean;
  neutralCount?: number;
  flipMode?: FlipMode;
  revealGuessSettings?: RevealGuessSettings;
}

export type RevealLimitMode = "once-per-player" | "free-after-all-used" | "free";

export interface RevealGuessSettings {
  puzzleCount: number;
  timerEnabled: boolean;
  primaryGuessSeconds: number;
  buzzGuessSeconds: number;
  revealLimitMode: RevealLimitMode;
}

export interface RevealCell {
  id: string;
  row: number;
  col: number;
  revealed: boolean;
  revealedBy?: string;
  revealedAt?: number;
}

export interface RevealGuessPlayerRoundState {
  hasRevealed: boolean;
  hasGuessed: boolean;
  revealedCellId?: string;
}

export interface RevealGuessPendingAnswer {
  id: string;
  playerId: string;
  playerNickname: string;
  answer: string;
  submittedAt: number;
  type: "priority" | "buzz" | "formal";
  status: "pending" | "correct" | "wrong" | "partial";
  judgeNote?: string;
}

export interface RevealGuessScoreEvent {
  id: string;
  puzzleIndex: number;
  playerId: string;
  playerNickname: string;
  amount: number;
  reason: "correct-guess" | "self-reveal-bonus" | "reveal-assist" | "judge-adjust";
  createdAt: number;
}

export interface RevealPuzzle {
  id: string;
  index: number;
  imageUrl: string;
  answer: string;
  aliases: string[];
  hints: string[];
  cells: RevealCell[];
  revealedCount: number;
  priorityGuesserId?: string;
  buzzingOpen: boolean;
  buzzQueue: string[];
  pendingAnswers: RevealGuessPendingAnswer[];
  timerEndsAt?: number;
  timerPhase?: "primary-guess" | "buzz";
  timerPaused?: boolean;
  revealRecords: Array<{ playerId: string; cellId: string; revealedAt: number }>;
  playerRoundStates: Record<string, RevealGuessPlayerRoundState>;
  phase: RevealGuessPhase;
  freeRevealUnlocked: boolean;
}

export interface RevealGuessState {
  puzzles: RevealPuzzle[];
  currentPuzzleIndex: number;
  scores: Record<string, number>;
  scoreEvents: RevealGuessScoreEvent[];
  settings: RevealGuessSettings;
}

export interface PublicRevealGuessState {
  phase: RevealGuessPhase;
  currentPuzzleIndex: number;
  puzzleCount: number;
  puzzleList: Array<{
    index: number;
    imageUrl: string;
    hasAnswer: boolean;
    aliasCount: number;
    hintCount: number;
  }>;
  scores: Record<string, number>;
  scoreEvents: RevealGuessScoreEvent[];
  settings: RevealGuessSettings;
  currentPuzzle: {
    index: number;
    imageUrl: string;
    answer?: string;
    aliases?: string[];
    cells: RevealCell[];
    revealedCount: number;
    buzzingOpen: boolean;
    buzzQueueLength: number;
    myBuzzPosition?: number;
    priorityGuesserNickname?: string;
    phase: RevealGuessPhase;
    freeRevealUnlocked: boolean;
    myHasRevealed?: boolean;
    hints: string[];
    timerEndsAt?: number;
    timerPhase?: "primary-guess" | "buzz";
    timerPaused?: boolean;
    myPendingAnswer?: {
      id: string;
      answer: string;
      status: RevealGuessPendingAnswer["status"];
      judgeNote?: string;
      submittedAt: number;
    };
    otherPendingAnswers: Array<{
      id: string;
      playerNickname: string;
      status: RevealGuessPendingAnswer["status"];
      submittedAt: number;
      answer?: string;
      type?: string;
    }>;
  } | null;
  lastPuzzleResult?: {
    index: number;
    answer: string;
    aliases: string[];
    imageUrl: string;
    cells: RevealCell[];
    scoreEvents: RevealGuessScoreEvent[];
  };
}

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  text: string;
  createdAt: number;
  playerId?: string;
  nickname?: string;
  reaction?: ChatReaction;
  targetParticipantId?: string;
  targetParticipantType?: ParticipantType;
  targetNickname?: string;
  targetProfile?: UserProfile;
}

export interface RoomScore {
  red: number;
  blue: number;
}

export interface RoundScoreDetail {
  team: Team;
  ownHits: number;
  ownPoints: number;
  comboBonus: number;
  maxCombo: number;
  neutralHits: number;
  neutralPenalty: number;
  opponentHits: number;
  opponentPointsLost: number;
  assassinHit: boolean;
  assassinPenalty: number;
  precisionBonus: number;
  victoryBonus: number;
  totalRound: number;
}

export interface ClueRoundRecord {
  clueId: string;
  team: Team;
  giverPlayerId: string;
  giverNickname: string;
  word: string;
  count: number;
  guesses: Array<{
    playerId: string;
    nickname: string;
    cardId?: string;
    cardWord: string;
    cardRole: CardRole;
    isOwnHit: boolean;
  }>;
}

export interface RoundHighlightCard {
  id: string;
  word: string;
  role: string;
  guessedByNickname: string;
}

export interface RoundHighlight {
  id: string;
  clueId?: string;
  roundIndex: number;
  team: Team;
  clueWord: string;
  clueCount: number;
  giverPlayerId: string;
  giverNickname: string;
  hitCards: RoundHighlightCard[];
  wrongCards: RoundHighlightCard[];
  missedCards: RoundHighlightCard[];
  assassinHit: boolean;
  captainTitle: string;
  teamTitle: string;
}

export interface AchievementUnlockPayload {
  id: string;
  title: string;
  playerId: string;
  nickname: string;
  description: string;
}

export interface PlayerRoundStats {
  playerId: string;
  nickname: string;
  team: Team | null;
  role: PlayerRole;
  ownHits: number;
  opponentHits: number;
  neutralHits: number;
  assassinHits: number;
  guesses: number;
  correctGuessStreakMax: number;
  extraGuesses: number;
  cluesGiven: number;
  clueOwnHits: number;
  clueWrongHits: number;
  preciseClues: number;
  chatMessages: number;
  reactionsSent: number;
  endedTurnEarly: number;
}

export interface Achievement {
  id: string;
  title: string;
  playerId: string;
  nickname: string;
  description: string;
  tier: "positive" | "funny" | "vibe";
}

export interface RevealEvent {
  id: string;
  cardId: string;
  word: string;
  role: CardRole;
  guessedByPlayerId: string;
  guessedByNickname: string;
  guessedByTeam: Team;
  outcome: RevealOutcome;
  nextTeam: Team;
  winner: Team | null;
  createdAt: number;
}

export interface Room {
  id: string;
  phase: RoomPhase;
  players: Player[];
  spectators: Spectator[];
  joinQueue: JoinRequest[];
  board: Card[];
  currentTeam: Team;
  startingTeam: Team;
  clue: Clue | null;
  remainingCounts: Record<Team, number>;
  winner: Team | null;
  settings: RoomSettings;
  wordPack: WordPack;
  scores: RoomScore;
  roundNumber: number;
  messages: ChatMessage[];
  hostPlayerId: string;
  judgePlayerId?: string;
  createdAt: number;
  updatedAt: number;
  lastEvent: string;
  lastReveal: RevealEvent | null;
  comboStreaks?: Record<string, number>;
  currentRoundScore?: RoundScoreDetail;
  clueRecords?: ClueRoundRecord[];
  roundScoreHistory?: RoundScoreDetail[];
  playerStats?: Record<string, PlayerRoundStats>;
  achievements?: Achievement[];
  roundHighlights?: RoundHighlight[];
  usedWordIds?: string[];
  timerEndsAt?: number;
  timerPhase?: "clue" | "guess";
  timerPaused?: boolean;
  pausedTimerPhase?: "clue" | "guess";
  timeoutPauseReason?: string;
  consecutiveTimeouts?: number;
  firstTurnBonusUsed?: boolean;
  replayId?: string;
  gameMode?: GameMode;
  revealGuessState?: RevealGuessState;
}

export interface ViewerIdentity {
  participantType?: ParticipantType | null;
  participantId?: string | null;
  team?: Team | null;
  role?: PlayerRole | null;
  isHost?: boolean;
  isDebugController?: boolean;
  revealAll?: boolean;
  isQueuedForNextRound?: boolean;
}

export interface ViewerState {
  participantType: ParticipantType;
  participantId: string | null;
  team: Team | null;
  role: PlayerRole | null;
  isHost: boolean;
  isDebugController: boolean;
  canStartGame: boolean;
  canUseDebugFill: boolean;
  canSubmitClue: boolean;
  canGuess: boolean;
  canEndTurn: boolean;
  canRestartGame: boolean;
  canReturnToLobby: boolean;
  canTransferHost: boolean;
  canDisbandRoom: boolean;
  canEditRoom: boolean;
  canResumeTimer: boolean;
  canQueueForNextRound: boolean;
  canCancelQueue: boolean;
  isQueuedForNextRound: boolean;
  targetTeam: Team | null;
  statusText: string;
  isJudge?: boolean;
  canRevealCell?: boolean;
  canSubmitRevealAnswer?: boolean;
  canBuzzIn?: boolean;
  canOpenBuzzing?: boolean;
  canJudgeAnswer?: boolean;
  canAdjustRevealScore?: boolean;
  canCreateRevealPuzzle?: boolean;
  canSkipRevealPuzzle?: boolean;
  canNextRevealPuzzle?: boolean;
  canSendRevealHint?: boolean;
  canEndRevealGame?: boolean;
  isPriorityGuesser?: boolean;
  hasRevealedThisPuzzle?: boolean;
  hasGuessedThisPuzzle?: boolean;
}

export type PublicPlayer = Omit<Player, "sessionToken">;
export type PublicSpectator = Omit<Spectator, "sessionToken">;

export interface PublicCard {
  id: string;
  wordId: string;
  word: string;
  role?: CardRole;
  revealed: boolean;
  revealedBy?: Team;
}

export interface PublicRoomState extends Omit<Room, "players" | "spectators" | "board" | "wordPack" | "revealGuessState"> {
  players: PublicPlayer[];
  spectators: PublicSpectator[];
  board: PublicCard[];
  wordPackSummary: WordPackSummary;
  viewer: ViewerState | null;
  serverNow: number;
  revealGuessPublic?: PublicRevealGuessState;
}

export interface RoomSummary {
  id: string;
  phase: RoomPhase;
  boardMode: BoardMode;
  gameMode: GameMode;
  roundNumber: number;
  wordPackSummary: WordPackSummary;
  playerCount: number;
  spectatorCount: number;
  queuedCount: number;
  hostNickname: string;
  hostProfile: UserProfile;
  hasOpenSlots: boolean;
  canJoinDirectly: boolean;
  canSpectate: boolean;
  canQueueForNextRound: boolean;
  createdAt: number;
  updatedAt: number;
  lastEvent: string;
  replayId?: string;
}

export interface ClientSession {
  roomId: string;
  playerId: string;
  participantId: string;
  participantType: ParticipantType;
  sessionToken: string;
}

export interface ErrorMessagePayload {
  message: string;
}

export interface CreateRoomPayload {
  nickname: string;
  profile?: Partial<UserProfile>;
}

export interface JoinRoomPayload {
  roomId: string;
  nickname: string;
  profile?: Partial<UserProfile>;
}

export interface JoinSpectatorPayload {
  roomId: string;
  nickname: string;
  profile?: Partial<UserProfile>;
}

export interface ReconnectRoomPayload {
  roomId: string;
  sessionToken: string;
}

export interface SetTeamPayload {
  roomId: string;
  team: Team | null;
}

export interface SetRolePayload {
  roomId: string;
  role: PlayerRole;
}

export interface RandomizeTeamsPayload {
  roomId: string;
}

export interface StartGamePayload {
  roomId: string;
}

export interface RestartGamePayload {
  roomId: string;
}

export interface ReturnToLobbyPayload {
  roomId: string;
}

export interface TransferHostPayload {
  roomId: string;
  targetPlayerId: string;
}

export interface DisbandRoomPayload {
  roomId: string;
}

export interface SubmitCluePayload {
  roomId: string;
  word: string;
  count: number;
}

export interface GuessCardPayload {
  roomId: string;
  cardId: string;
}

export interface EndTurnPayload {
  roomId: string;
}

export interface LeaveRoomPayload {
  roomId: string;
  sessionToken?: string;
}

export interface SyncRoomStatePayload {
  roomId: string;
}

export interface DebugFillRoomPayload {
  roomId: string;
}

export interface QueueForNextRoundPayload {
  roomId: string;
}

export interface CancelQueueJoinPayload {
  roomId: string;
}

export interface CustomWordPackInput {
  name: string;
  entries: string[];
}

export interface UpdateRoomSettingsPayload {
  roomId: string;
  boardMode?: BoardMode;
  builtinWordPackId?: string;
  customWordPack?: CustomWordPackInput | null;
  scoringMode?: ScoringMode;
  timerMode?: TimerMode;
  timerClueSeconds?: number;
  timerGuessSeconds?: number;
  timerFirstRoundBonus?: boolean;
  neutralCount?: number | null;
  flipMode?: FlipMode;
}

export interface SendChatMessagePayload {
  roomId: string;
  text: string;
}

export interface DanmakuMessage {
  id: string;
  roomId: string;
  senderNickname: string;
  text: string;
  createdAt: number;
}

export interface SendReactionPayload {
  roomId: string;
  reaction: ChatReaction;
  targetParticipantId: string;
  targetParticipantType: ParticipantType;
}

export interface UsernameLoginPayload {
  username: string;
}

export interface UpdateNamedUserPayload {
  avatarUrl?: string | null;
  customWordPacks?: SavedWordPack[];
  customImagePacks?: SavedImagePack[];
}

export interface ReplayBoardCard {
  id: string;
  word: string;
  role: "red" | "blue" | "neutral" | "assassin";
  revealed: boolean;
  guessedByNickname?: string;
  guessedByTeam?: Team;
}

export interface ReplayRound {
  index: number;
  team: Team;
  clueWord: string;
  clueCount: number;
  giverNickname: string;
  guesses: {
    word: string;
    role: "red" | "blue" | "neutral" | "assassin";
    guessedByNickname: string;
    result: "hit" | "opponent" | "neutral" | "assassin";
  }[];
  missed?: { word: string; role: Team }[];
  captainLabel?: string;
  teamLabel?: string;
}

export interface ReplayKeyEvent {
  id: string;
  type: "great_clue" | "wrong_hit" | "assassin" | "last_second" | "low_accuracy_clue" | "combo";
  title: string;
  description: string;
  roundIndex?: number;
  playerNickname?: string;
  team?: Team;
}

export interface GameReplay {
  id: string;
  roomId: string;
  createdAt: number;
  expiresAt: number;
  mode: {
    boardMode: BoardMode;
    scoringMode: ScoringMode;
    timerMode: TimerMode;
  };
  players: {
    id: string;
    nickname: string;
    team: Team | null;
    role: PlayerRole;
    isHost?: boolean;
  }[];
  winner: Team | null;
  durationMs?: number;
  finalBoard: ReplayBoardCard[];
  rounds: ReplayRound[];
  keyEvents: ReplayKeyEvent[];
  achievements?: AchievementUnlockPayload[];
  saved?: boolean;
  savedBy?: string[];
  visibility?: "link-only" | "private" | "public";
}

export interface CreateRevealPuzzlePayload {
  roomId: string;
  imageUrl: string;
  answer: string;
  aliases?: string[];
  hints?: string[];
}

export interface CreateRevealGuessRoomPayload {
  nickname: string;
  profile?: Partial<UserProfile>;
  settings?: Partial<RevealGuessSettings>;
}

export interface StartRevealGamePayload {
  roomId: string;
}

export interface EndRevealGamePayload {
  roomId: string;
}

export interface RevealCellPayload {
  roomId: string;
  cellId: string;
}

export interface WaivePriorityGuessPayload {
  roomId: string;
}

export interface SubmitRevealAnswerPayload {
  roomId: string;
  answer: string;
  type: "priority" | "buzz" | "formal";
}

export interface OpenBuzzingPayload {
  roomId: string;
}

export interface BuzzInPayload {
  roomId: string;
}

export interface JudgeRevealAnswerPayload {
  roomId: string;
  answerId: string;
  verdict: "correct" | "wrong" | "partial";
  note?: string;
}

export interface ResetRevealPlayerGuessPayload {
  roomId: string;
  targetPlayerId: string;
}

export interface SendRevealHintPayload {
  roomId: string;
  hint: string;
}

export interface SkipRevealPuzzlePayload {
  roomId: string;
}

export interface NextRevealPuzzlePayload {
  roomId: string;
}

export interface AdjustRevealScorePayload {
  roomId: string;
  targetPlayerId: string;
  amount: number;
  reason: string;
}

export interface ResumeRevealTimerPayload {
  roomId: string;
}

export interface RevealHintBroadcast {
  puzzleIndex: number;
  hint: string;
  sentBy: string;
  sentAt: number;
}

export interface RevealAnswerUpdateBroadcast {
  puzzleIndex: number;
  answer: RevealGuessPendingAnswer;
}

export interface RevealScoreUpdateBroadcast {
  playerId: string;
  playerNickname: string;
  newScore: number;
  event: RevealGuessScoreEvent;
}

export interface RevealCellAnimatedBroadcast {
  puzzleIndex: number;
  cellId: string;
  row: number;
  col: number;
  revealedBy: string;
  revealedByNickname: string;
}

export interface RevealBuzzingOpenBroadcast {
  puzzleIndex: number;
}

export interface RevealGameEndedBroadcast {
  winnerId?: string;
  finalScores: Record<string, number>;
}
