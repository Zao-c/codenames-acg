export type Team = "red" | "blue";
export type CardRole = Team | "neutral" | "assassin";
export type PlayerRole = "spymaster" | "operative";
export type RoomPhase = "lobby" | "playing" | "finished";
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
  word: string;
  count: number;
  team: Team;
  giverPlayerId?: string;
  usedGuesses: number;
}

export interface RoomSettings {
  ruleSet: "classic";
  boardMode: BoardMode;
  wordPackId: string;
  scoringMode: ScoringMode;
  timerMode?: TimerMode;
  timerClueSeconds?: number;
  timerGuessSeconds?: number;
  timerFirstRoundBonus?: boolean;
  neutralCount?: number;
  flipMode?: FlipMode;
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
    cardWord: string;
    cardRole: CardRole;
    isOwnHit: boolean;
  }>;
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
  usedWordIds?: string[];
  timerEndsAt?: number;
  timerPhase?: "clue" | "guess";
  timerPaused?: boolean;
  timeoutPauseReason?: string;
  consecutiveTimeouts?: number;
  firstTurnBonusUsed?: boolean;
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

export interface PublicRoomState extends Omit<Room, "players" | "spectators" | "board" | "wordPack"> {
  players: PublicPlayer[];
  spectators: PublicSpectator[];
  board: PublicCard[];
  wordPackSummary: WordPackSummary;
  viewer: ViewerState | null;
}

export interface RoomSummary {
  id: string;
  phase: RoomPhase;
  boardMode: BoardMode;
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
}
