import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BOARD_MODE_CONFIG,
  MAX_CLUE_COUNT,
  MIN_CLUE_COUNT,
  PLAYER_ROLE_LABELS,
  TEAM_LABELS,
  wordPackSummaries,
  type BoardMode,
  type ScoringMode,
  type CandidateEntry,
  type CandidatePack,
  type CardRole,
  type ChatMessage,
  type ChatReaction,
  type ClientSession,
  type DanmakuMessage,
  type JoinRequest,
  type NamedUserAccount,
  type ParticipantType,
  type PublicCard,
  type PublicPlayer,
  type PublicRoomState,
  type PublicSpectator,
  type PublicWordPack,
  type PublicWordPackSummary,
  type RevealEvent,
  type RevealOutcome,
  type RoundHighlight,
  type AchievementUnlockPayload,
  type RoomSummary,
  type SavedWordPack,
  type Team
} from "@acg-codenames/shared";
import { listPublicWordPacks, getPublicWordPackDetail, loginNamedUser, logoutNamedUser as apiLogoutNamedUser, updateNamedUser } from "../lib/api";
import { getSocket } from "../lib/socket";
import { clearIdentity, clearSession, loadIdentity, loadRecentUsernames, loadSession, saveIdentity, saveSession, type LocalIdentity } from "../lib/storage";
import {
  defaultExportFilters,
  exportPlayablePack,
  getCandidateEntryIssues,
  parseImportedWordPackText,
  type CandidateExportFilters,
  type ImportedWordPackFile
} from "../lib/word-pack-review";
import {
  playAssassinHit,
  playEndTurn,
  playGameStart,
  playNeutralHit,
  playOpponentHit,
  playOwnHit,
  playClick,
  playSubmitClue,
  playVictory,
  setSoundMuted,
  unlockAudio
} from "../lib/sound";

type ConnectionState = "idle" | "connecting" | "ready";
type PackSource = "builtin" | "account" | "public";
type SideTab = "chat" | "battle" | "score" | "spectators";
type RoomParticipant = PublicPlayer | PublicSpectator;

const ROOM_ID_LENGTH = 6;
const boardModes: BoardMode[] = ["5x5", "7x7", "9x9"];

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

function makePackId(): string {
  return `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makePublicPackKey(pack: { publicId: string }): string {
  return pack.publicId;
}

function dedupePackEntries(entries: string[]): string[] {
  return Array.from(new Set(entries.map((e) => e.trim()).filter(Boolean)));
}

function parsePackEntries(raw: string): string[] {
  return Array.from(new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

export function roleLabelShort(role: CardRole): string {
  switch (role) {
    case "red": return "红";
    case "blue": return "蓝";
    case "neutral": return "中";
    case "assassin": return "刺";
    default: return "";
  }
}

async function imageFileToAvatarDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("读取头像失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("头像解码失败"));
    element.src = dataUrl;
  });
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持头像裁剪");
  const sourceSize = Math.min(image.width, image.height);
  const sourceX = (image.width - sourceSize) / 2;
  const sourceY = (image.height - sourceSize) / 2;
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return canvas.toDataURL("image/webp", 0.9);
}

function parseCustomWordFile(file: File): Promise<ImportedWordPackFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = String(reader.result ?? "");
        if (content.includes("\uFFFD")) {
          reject(new Error("文件编码可能不是 UTF-8，请将题库文件另存为 UTF-8 编码后重试"));
          return;
        }
        if (file.name.toLowerCase().endsWith(".json")) {
          resolve(parseImportedWordPackText(content, file.name.replace(/\.[^.]+$/, "")));
          return;
        }
        resolve({ kind: "playable", pack: { name: file.name.replace(/\.[^.]+$/, ""), entries: parsePackEntries(content) } });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取题库文件失败"));
    reader.readAsText(file, "utf-8");
  });
}

function buildSavedPackFromPlayable(pack: { name: string; description?: string; entries: string[] }): SavedWordPack {
  const timestamp = Date.now();
  return {
    id: makePackId(),
    name: pack.name,
    description: pack.description,
    entries: dedupePackEntries(pack.entries),
    isPublic: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function applyCandidateAutoReview(pack: CandidatePack): CandidatePack {
  return {
    ...pack,
    entries: pack.entries.map((entry) => {
      if (entry.reviewStatus !== "pending") return entry;
      const issues = getCandidateEntryIssues(entry, pack.entries);
      const hasBlockingError = issues.some((i) => i.level === "error");
      const hasNeedsReviewWarning = issues.some((i) => i.code === "high-spoiler" || i.code === "low-playability" || i.code === "low-uniqueness");
      if (hasBlockingError) return { ...entry, reviewStatus: "rejected" as const, reviewNotes: entry.reviewNotes ?? "导入时自动拒绝：存在结构性错误" };
      if (hasNeedsReviewWarning) return { ...entry, reviewStatus: "pending" as const };
      return { ...entry, reviewStatus: "approved" as const, reviewNotes: entry.reviewNotes ?? "导入时自动通过基础预审" };
    })
  };
}

function autoExportCandidatePack(pack: CandidatePack): SavedWordPack {
  return exportPlayablePack(applyCandidateAutoReview(pack), defaultExportFilters);
}

function requireNamedUserSessionToken(identity: LocalIdentity | null): string {
  if (identity?.mode !== "named" || !identity.userSessionToken) throw new Error("用户登录已失效，请重新登录");
  return identity.userSessionToken;
}

export function getIdentityProfile(identity: LocalIdentity | null, account: NamedUserAccount | null): LocalIdentity | null {
  if (!identity) return null;
  if (identity.mode === "named" && account) {
    return { mode: "named", username: account.username, nickname: account.username, avatarUrl: account.avatarUrl, userSessionToken: identity.userSessionToken };
  }
  return identity;
}

export function isPlayer(participant: RoomParticipant | null): participant is PublicPlayer {
  return Boolean(participant && "team" in participant);
}

export function getActionTeamText(targetTeam: Team | null): string {
  if (!targetTeam) return "等待下一步";
  return `${TEAM_LABELS[targetTeam]}正在猜${targetTeam === "red" ? "红色" : "蓝色"}词`;
}

export function getCurrentClueText(room: PublicRoomState | null): string {
  if (!room?.clue) return "等待队长发提示";
  return `${room.clue.word} ${room.clue.count}`;
}

export function getRoomStageLabel(room: PublicRoomState | null, connectionState: ConnectionState): string {
  if (!room) return connectionState === "connecting" ? "正在连接密令房" : "等待进入密令房";
  if (room.phase === "lobby") return "准备阶段";
  if (room.phase === "playing") return room.viewer?.targetTeam ? `${TEAM_LABELS[room.viewer.targetTeam]}行动中` : "对局中";
  return room.winner ? `${TEAM_LABELS[room.winner]}获胜` : "本局结束";
}

export function getSelfSummary(participant: RoomParticipant | null, room: PublicRoomState | null): string {
  if (!participant || !room?.viewer) return "未加入";
  if (room.viewer.participantType === "spectator" || !isPlayer(participant)) return "旁观";
  const teamLabel = participant.team ? TEAM_LABELS[participant.team] : "未分队";
  return `${teamLabel} / ${PLAYER_ROLE_LABELS[participant.role]}`;
}

export function queuedForSpectator(spectator: PublicSpectator, queue: JoinRequest[]): boolean {
  return queue.some((entry) => entry.spectatorId === spectator.id);
}

export interface GameContextType {
  socket: ReturnType<typeof getSocket>;
  identity: LocalIdentity | null;
  setIdentity: (v: LocalIdentity | null) => void;
  namedAccount: NamedUserAccount | null;
  guestNicknameInput: string;
  setGuestNicknameInput: (v: string) => void;
  namedUsernameInput: string;
  setNamedUsernameInput: (v: string) => void;
  recentUsers: string[];
  session: ClientSession | null;
  room: PublicRoomState | null;
  roomSummaries: RoomSummary[];
  error: string;
  setError: (v: string) => void;
  connectionState: ConnectionState;
  effectiveIdentity: LocalIdentity | null;
  publicPacks: PublicWordPackSummary[];
  createBoardMode: BoardMode;
  setCreateBoardMode: (v: BoardMode) => void;
  scoringMode: ScoringMode;
  setScoringMode: (v: ScoringMode) => void;
  createTimerMode: import("@acg-codenames/shared").TimerMode;
  setCreateTimerMode: (v: import("@acg-codenames/shared").TimerMode) => void;
  createTimerClueSeconds: number;
  setCreateTimerClueSeconds: (v: number) => void;
  createTimerGuessSeconds: number;
  setCreateTimerGuessSeconds: (v: number) => void;
  createNeutralCount: number;
  setCreateNeutralCount: (v: number) => void;
  createFlipMode: import("@acg-codenames/shared").FlipMode;
  setCreateFlipMode: (v: import("@acg-codenames/shared").FlipMode) => void;
  packSource: PackSource;
  setPackSource: (v: PackSource) => void;
  selectedBuiltinPackId: string;
  setSelectedBuiltinPackId: (v: string) => void;
  selectedAccountPackId: string;
  setSelectedAccountPackId: (v: string) => void;
  selectedPublicPackId: string;
  setSelectedPublicPackId: (v: string) => void;
  accountPacks: SavedWordPack[];
  selectedAccountPack: SavedWordPack | null;
  selectedPublicPack: PublicWordPackSummary | null;

  handleNamedLogin: (usernameOverride?: string) => Promise<void>;
  continueAsGuest: () => void;
  handleAvatarUpload: (file: File | null) => Promise<void>;
  createRoom: () => void;
  joinByRoomCode: (asSpectator: boolean) => void;
  joinSpecificRoom: (roomId: string, asSpectator: boolean) => void;
  leaveRoom: () => void;
  logoutNamedUser: () => void;
  refreshPublicPacks: () => Promise<void>;
  fetchPublicPackDetail: (publicId: string) => Promise<PublicWordPack | null>;
  addAccountPack: () => Promise<void>;
  importAccountPack: (file: File | null) => Promise<void>;
  removeAccountPack: (packId: string) => Promise<void>;
  toggleAccountPackPublic: (packId: string) => Promise<void>;
  chooseAccountPackForCreate: (packId: string) => void;

  savedPackName: string;
  setSavedPackName: (v: string) => void;
  savedPackEntries: string;
  setSavedPackEntries: (v: string) => void;
  candidatePack: CandidatePack | null;
  setCandidatePack: (v: CandidatePack | null) => void;
  updateCandidateEntry: (display: string, patch: Partial<CandidateEntry>) => void;
  bulkSetVisibleEntries: (displays: string[], reviewStatus: CandidateEntry["reviewStatus"]) => void;
  exportCandidateAsPlayable: (filters: CandidateExportFilters) => Promise<void>;
  resetCandidateReview: (pack: CandidatePack) => void;

  transferHostTargetId: string;
  setTransferHostTargetId: (v: string) => void;
  hostTransferCandidates: PublicPlayer[];
  roomCode: string;
  setRoomCode: (v: string) => void;
  isLobby: boolean;
  isFinished: boolean;
  viewer: PublicRoomState["viewer"];
  self: RoomParticipant | null;
  inviteLink: string;
  boardColumns: number;

  chooseTeam: (team: Team | null) => void;
  chooseRole: (role: "spymaster" | "operative") => void;
  randomizeTeams: () => void;
  updateBoardMode: (boardMode: BoardMode) => void;
  updateScoringMode: (mode: ScoringMode) => void;
  updateBuiltinPack: (wordPackId: string) => void;
  uploadRoomPack: (file: File | null) => Promise<void>;
  useAccountPackForRoom: (pack: SavedWordPack) => void;
  usePublicPackForRoom: (pack: PublicWordPackSummary) => void;
  startGame: () => void;
  restartGame: () => void;
  returnToLobby: () => void;
  transferHost: () => void;
  disbandRoom: () => void;
  forceEndGame: () => void;
  queueForNextRound: () => void;
  cancelQueueJoin: () => void;
  debugFillRoom: () => void;
  submitClue: () => void;
  guessCard: (cardId: string) => void;
  endTurn: () => void;
  resumeTimer: () => void;
  sendChatMessage: () => void;
  sendQuickPhrase: (text: string) => void;
  sendReaction: (reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType) => void;
  copyLink: () => Promise<void>;

  clueWord: string;
  setClueWord: (v: string) => void;
  clueCountInput: string;
  setClueCountInput: (v: string) => void;
  chatText: string;
  setChatText: (v: string) => void;
  danmakuQueue: DanmakuMessage[];
  showDanmaku: boolean;
  setShowDanmaku: (v: boolean) => void;
  roundHighlights: RoundHighlight[];
  roundAchievements: AchievementUnlockPayload[];
  highlightToast: RoundHighlight | null;
  achievementToast: AchievementUnlockPayload | null;
  copied: boolean;
  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  enterFocusMode: () => void;
  exitFocusMode: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;
  sideTab: SideTab;
  setSideTab: (v: SideTab) => void;
  mobileRoomTab: "board" | "players" | "chat";
  setMobileRoomTab: (v: "board" | "players" | "chat") => void;
  jumpToLatest: boolean;
  chatListRef: React.RefObject<HTMLDivElement | null>;
  battleListRef: React.RefObject<HTMLDivElement | null>;
  handleChatScroll: () => void;
  handleBattleScroll: () => void;
  scrollChatToBottom: () => void;
  revealBanner: RevealEvent | null;
  reactionEffects: Record<string, ChatReaction>;
  pendingGuess: string | null;
  revealingCardIds: Set<string>;
  maskSpymasterHints: boolean;
  setMaskSpymasterHints: (v: boolean) => void;
  showSakura: boolean;
  globalReaction: import("@acg-codenames/shared").ReactionEffectPayload | null;
  reactionQueue: import("@acg-codenames/shared").ReactionEffectPayload[];
  collapsedSections: Set<string>;
  setCollapsedSections: (v: Set<string>) => void;
  toggleSection: (title: string) => void;
  canSeeHiddenRoles: boolean;
  showSpymasterHints: boolean;
  stickToChatBottomRef: React.RefObject<boolean>;
  stickToBattleBottomRef: React.RefObject<boolean>;
  isDebugController: boolean;

  renderHint: () => string;
  boardModes: BoardMode[];
  ROOM_ID_LENGTH: number;
  makePublicPackKey: (pack: { publicId: string }) => string;
}

const GameContext = createContext<GameContextType | null>(null);

export function useGame(): GameContextType {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be inside GameProvider");
  return ctx;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const socket = useMemo(() => getSocket(), []);
  const [identity, _setIdentity] = useState<LocalIdentity | null>(loadIdentity());
  const [recentUsers, setRecentUsers] = useState<string[]>(loadRecentUsernames());
  const [namedAccount, setNamedAccount] = useState<NamedUserAccount | null>(null);
  const [namedUsernameInput, setNamedUsernameInput] = useState(loadIdentity()?.mode === "named" ? loadIdentity()?.username ?? "" : "");
  const [guestNicknameInput, setGuestNicknameInput] = useState(loadIdentity()?.mode === "guest" ? loadIdentity()?.nickname ?? "" : "");
  const [savedPackName, setSavedPackName] = useState("");
  const [savedPackEntries, setSavedPackEntries] = useState("");
  const [candidatePack, setCandidatePack] = useState<CandidatePack | null>(null);
  const [createBoardMode, _setCreateBoardModeRaw] = useState<BoardMode>("5x5");
  const NEUTRAL_COUNT_OPTIONS: Record<BoardMode, readonly number[]> = {
    "5x5": [3, 5, 7, 9, 11],
    "7x7": [7, 9, 11, 13, 15, 17, 19],
    "9x9": [15, 19, 21, 25]
  };
  const setCreateBoardMode = useCallback((v: BoardMode) => {
    _setCreateBoardModeRaw(v);
    setCreateNeutralCount((prev) => {
      if (prev === 0) return 0;
      const allowed = NEUTRAL_COUNT_OPTIONS[v];
      return allowed.includes(prev) ? prev : 0;
    });
  }, []);
  const [scoringMode, setScoringMode] = useState<ScoringMode>("classic");
  const [createTimerMode, setCreateTimerMode] = useState<import("@acg-codenames/shared").TimerMode>("unlimited");
  const [createTimerClueSeconds, setCreateTimerClueSeconds] = useState(90);
  const [createTimerGuessSeconds, setCreateTimerGuessSeconds] = useState(90);
  const [createNeutralCount, setCreateNeutralCount] = useState(0);
  const [createFlipMode, setCreateFlipMode] = useState<import("@acg-codenames/shared").FlipMode>("word-color");
  const [packSource, setPackSource] = useState<PackSource>("builtin");
  const [selectedBuiltinPackId, setSelectedBuiltinPackId] = useState(wordPackSummaries[0]?.id ?? "");
  const [selectedAccountPackId, setSelectedAccountPackId] = useState("");
  const [selectedPublicPackId, setSelectedPublicPackId] = useState("");
  const [transferHostTargetId, setTransferHostTargetId] = useState("");
  const [publicPacks, setPublicPacks] = useState<PublicWordPackSummary[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<ClientSession | null>(loadSession());
  const activeRoomIdRef = useRef<string | null>(null);
  const freshSessionRef = useRef(false);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [roomSummaries, setRoomSummaries] = useState<RoomSummary[]>([]);
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [clueWord, setClueWord] = useState("");
  const [clueCountInput, setClueCountInputRaw] = useState("2");
  const [chatText, setChatText] = useState("");
  const [danmakuQueue, setDanmakuQueue] = useState<DanmakuMessage[]>([]);
  const [showDanmakuRaw, setShowDanmakuRaw] = useState(() => {
    try { return localStorage.getItem("showDanmaku") !== "off"; } catch { return true; }
  });
  const [copied, setCopied] = useState(false);
  const [didReconnect, setDidReconnect] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const clearReactions = useCallback(() => {
    setReactionQueue([]);
    setGlobalReaction(null);
  }, []);
  const enterFocusMode = useCallback(() => { setFocusMode(true); clearReactions(); }, [clearReactions]);
  const exitFocusMode = useCallback(() => { setFocusMode(false); }, []);
  const [soundEnabled, setSoundEnabledRaw] = useState(() => {
    try { return localStorage.getItem("sound") !== "off"; } catch { return true; }
  });
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const setClueCountInput = (value: string) => {
    if (/^\d*$/.test(value)) {
      setClueCountInputRaw(value);
      setError("");
    }
  };
  const handleSetSoundEnabled = (v: boolean) => {
    setSoundEnabledRaw(v);
    try { localStorage.setItem("sound", v ? "on" : "off"); } catch {}
    setError(v ? "音效已开启" : "音效已关闭");
    setSoundMuted(!v);
    if (v) {
      unlockAudio().then(() => playClick()).catch((err: unknown) => console.warn("Audio unlock failed", err));
    }
  };
  const setShowDanmaku = (v: boolean) => {
    setShowDanmakuRaw(v);
    if (!v) setDanmakuQueue([]);
    try { localStorage.setItem("showDanmaku", v ? "on" : "off"); } catch {}
  };
  const [mobileRoomTab, setMobileRoomTab] = useState<"board" | "players" | "chat">("board");
  const [sideTab, setSideTab] = useState<SideTab>("chat");
  const [jumpToLatest, setJumpToLatest] = useState(false);
  const [revealBanner, setRevealBanner] = useState<RevealEvent | null>(null);
  const [reactionEffects, setReactionEffects] = useState<Record<string, ChatReaction>>({});
  const [pendingGuess, setPendingGuess] = useState<string | null>(null);
  const guessLockRef = useRef(false);
  const [revealingCardIds, setRevealingCardIds] = useState<Set<string>>(new Set());
  const [maskSpymasterHints, setMaskSpymasterHints] = useState(false);
  const [showSakura, setShowSakura] = useState(false);
  const [globalReaction, setGlobalReaction] = useState<import("@acg-codenames/shared").ReactionEffectPayload | null>(null);
  const [reactionQueue, setReactionQueue] = useState<import("@acg-codenames/shared").ReactionEffectPayload[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(["待分队"]));
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const battleListRef = useRef<HTMLDivElement | null>(null);
  const lastRevealIdRef = useRef<string | null>(null);
  const lastReactionIdRef = useRef<string | null>(null);
  const stickToChatBottomRef = useRef(true);
  const stickToBattleBottomRef = useRef(true);
  const prevCanSubmitClueRef = useRef(false);
  const pendingCreateConfigRef = useRef<{
    boardMode: BoardMode;
    builtinWordPackId?: string;
    customWordPack?: { name: string; entries: string[] };
    scoringMode?: ScoringMode;
    timerMode?: import("@acg-codenames/shared").TimerMode;
    timerClueSeconds?: number;
    timerGuessSeconds?: number;
    neutralCount?: number | null;
    flipMode?: import("@acg-codenames/shared").FlipMode;
  } | null>(null);

  const accountPacks = namedAccount?.customWordPacks ?? [];
  const selectedAccountPack = accountPacks.find((pack) => pack.id === selectedAccountPackId) ?? null;
  const selectedPublicPack = publicPacks.find((pack) => makePublicPackKey(pack) === selectedPublicPackId) ?? null;
  const hostTransferCandidates = room?.players.filter((player) => !player.isBot && player.id !== session?.participantId) ?? [];
  const effectiveIdentity: LocalIdentity | null = useMemo(() => getIdentityProfile(identity, namedAccount), [identity, namedAccount]);
  const viewer = room?.viewer ?? null;
  const self: RoomParticipant | null =
    room?.players.find((p) => p.id === session?.participantId) ?? room?.spectators.find((s) => s.id === session?.participantId) ?? null;
  const inviteLink = session ? `${window.location.origin}/room/${session.roomId}` : "";
  const isLobby = room?.phase === "lobby";
  const isFinished = room?.phase === "finished";
  const isDebugController = Boolean(window.location.hostname === "localhost" && viewer?.isDebugController);
  const canSeeHiddenRoles = Boolean(viewer && (room?.phase === "finished" || viewer.role === "spymaster" || viewer.isDebugController));
  const showSpymasterHints = canSeeHiddenRoles && !maskSpymasterHints;
  const boardColumns = room ? BOARD_MODE_CONFIG[room.settings.boardMode].columns : 5;

  function persistIdentity(nextIdentity: LocalIdentity): void {
    _setIdentity(nextIdentity);
    saveIdentity(nextIdentity);
    setRecentUsers(loadRecentUsernames());
  }

  function setIdentity(v: LocalIdentity | null) {
    if (!v) {
      _setIdentity(null);
      clearIdentity();
      return;
    }
    persistIdentity(v);
  }

  // ─── socket event listeners ───────────────────────────
  useEffect(() => {
    function onSession(p: ClientSession) { setSession(p); saveSession(p); setConnectionState("ready"); setError(""); activeRoomIdRef.current = p.roomId; freshSessionRef.current = true; }
    function onRoomState(p: PublicRoomState) { if (!loadSession() || p.id !== activeRoomIdRef.current) return; setRoom(p); setConnectionState("ready"); setError(""); setPendingGuess(null); guessLockRef.current = false; }
    function onRoomSummaries(p: RoomSummary[]) { setRoomSummaries(p); }
    function onError(p: { message: string }) {
      if (p.message.includes("重连凭证") || p.message.includes("房间不存在")) {
        clearSession();
        setSession(null);
        setRoom(null);
        setConnectionState("idle");
        setDidReconnect(false);
        setRevealBanner(null);
        setError("房间已过期，已返回首页");
        activeRoomIdRef.current = null;
        return;
      }
      setError(p.message); setConnectionState("ready"); setPendingGuess(null); guessLockRef.current = false;
    }
    function onRoomClosed(p: { roomId: string; reason: string }) {
      if (p.roomId !== session?.roomId) return;
      clearSession(); setSession(null); setRoom(null); setConnectionState("idle"); setDidReconnect(false); setRevealBanner(null); setError(p.reason); activeRoomIdRef.current = null;
    }
    socket.on("session", onSession);
    socket.on("room_state", onRoomState);
    socket.on("room_summaries", onRoomSummaries);
    socket.on("error_message", onError);
    socket.on("room_closed", onRoomClosed);
    socket.io.on("reconnect", () => { if (session) { setConnectionState("connecting"); socket.emit("reconnect_room", { roomId: session.roomId, sessionToken: session.sessionToken }); } });
    socket.on("disconnect", () => setConnectionState("connecting"));
    return () => { socket.off("session", onSession); socket.off("room_state", onRoomState); socket.off("room_summaries", onRoomSummaries); socket.off("error_message", onError); socket.off("room_closed", onRoomClosed); socket.io.off("reconnect"); socket.off("disconnect"); };
  }, [session?.roomId, socket]);

  useEffect(() => {
    setDanmakuQueue([]);
  }, [session?.roomId]);

  useEffect(() => {
    function onDanmakuMessage(p: DanmakuMessage) {
      if (!showDanmakuRaw || p.roomId !== session?.roomId) return;
      setDanmakuQueue((prev) => [...prev.slice(-7), p]);
      window.setTimeout(() => {
        setDanmakuQueue((prev) => prev.filter((item) => item.id !== p.id));
      }, 7600);
    }
    socket.on("danmaku_message", onDanmakuMessage);
    return () => { socket.off("danmaku_message", onDanmakuMessage); };
  }, [session?.roomId, showDanmakuRaw, socket]);

  useEffect(() => {
    function onReactionEffect(p: import("@acg-codenames/shared").ReactionEffectPayload) {
      setReactionQueue((prev) => [...prev, p]);
      setReactionEffects((cur) => ({ ...cur, [p.targetParticipantId]: p.reaction }));
      setGlobalReaction(p);
      window.setTimeout(() => {
        setReactionEffects((cur) => { const n = { ...cur }; delete n[p.targetParticipantId]; return n; });
      }, 1600);
      window.setTimeout(() => {
        setReactionQueue((prev) => prev.filter((r) => r.id !== p.id));
        setGlobalReaction(null);
      }, 1800);
    }
    socket.on("reaction_effect", onReactionEffect);
    return () => { socket.off("reaction_effect", onReactionEffect); };
  }, [socket]);

  const [roundHighlights, setRoundHighlights] = useState<RoundHighlight[]>([]);
  const [highlightToast, setHighlightToast] = useState<RoundHighlight | null>(null);
  const highlightToastTimerRef = useRef<number | null>(null);
  const roundUiScopeRef = useRef<{ roomId: string | null; phase: PublicRoomState["phase"] | null; gameKey: string | null }>({
    roomId: null,
    phase: null,
    gameKey: null
  });

  useEffect(() => {
    function onRoundHighlight(p: RoundHighlight) {
      setRoundHighlights((prev) => [...prev, p]);
      setHighlightToast(p);
      if (highlightToastTimerRef.current !== null) window.clearTimeout(highlightToastTimerRef.current);
      highlightToastTimerRef.current = window.setTimeout(() => setHighlightToast(null), 3500);
    }
    socket.on("round_highlight", onRoundHighlight);
    return () => { socket.off("round_highlight", onRoundHighlight); };
  }, [socket]);

  const [roundAchievements, setRoundAchievements] = useState<AchievementUnlockPayload[]>([]);
  const [achievementToast, setAchievementToast] = useState<AchievementUnlockPayload | null>(null);
  const achievementToastTimerRef = useRef<number | null>(null);

  const clearRoundUiCache = useCallback(() => {
    setRoundHighlights([]);
    setRoundAchievements([]);
    setHighlightToast(null);
    setAchievementToast(null);
    if (highlightToastTimerRef.current !== null) {
      window.clearTimeout(highlightToastTimerRef.current);
      highlightToastTimerRef.current = null;
    }
    if (achievementToastTimerRef.current !== null) {
      window.clearTimeout(achievementToastTimerRef.current);
      achievementToastTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const roomId = session?.roomId ?? null;
    const phase = room?.phase ?? null;
    const gameKey = room && room.phase === "playing" && room.board.length > 0
      ? `${room.id}:${room.roundNumber}:${room.board.map((card) => card.id).join(",")}`
      : null;
    const prev = roundUiScopeRef.current;
    const roomChanged = prev.roomId !== roomId;
    const returnedToLobbyAfterFinished = phase === "lobby" && prev.phase === "finished";
    const newPlayingGame = gameKey !== null && prev.gameKey !== null && prev.gameKey !== gameKey;

    if (roomChanged || returnedToLobbyAfterFinished || newPlayingGame) {
      clearRoundUiCache();
    }

    roundUiScopeRef.current = { roomId, phase, gameKey: gameKey ?? prev.gameKey };
  }, [clearRoundUiCache, room, session?.roomId]);

  useEffect(() => {
    function onAchievementUnlock(p: AchievementUnlockPayload) {
      setRoundAchievements((prev) => [...prev, p]);
      setAchievementToast(p);
      if (achievementToastTimerRef.current !== null) window.clearTimeout(achievementToastTimerRef.current);
      achievementToastTimerRef.current = window.setTimeout(() => setAchievementToast(null), 3500);
    }
    socket.on("achievement_unlock", onAchievementUnlock);
    return () => { socket.off("achievement_unlock", onAchievementUnlock); };
  }, [socket]);

  useEffect(() => {
    if (!session || didReconnect || room) return;
    if (freshSessionRef.current) {
      freshSessionRef.current = false;
      return;
    }
    setDidReconnect(true);
    setConnectionState("connecting");
    socket.emit("reconnect_room", { roomId: session.roomId, sessionToken: session.sessionToken });
  }, [didReconnect, room, session, socket]);

  useEffect(() => {
    if (!session || !room || !pendingCreateConfigRef.current) return;
    const hostPlayer = room.players.find((p) => p.id === session.participantId);
    if (!hostPlayer?.isHost || room.phase !== "lobby") return;
    const pending = pendingCreateConfigRef.current;
    pendingCreateConfigRef.current = null;
    socket.emit("update_room_settings", { roomId: session.roomId, boardMode: pending.boardMode, builtinWordPackId: pending.builtinWordPackId, customWordPack: pending.customWordPack, scoringMode: pending.scoringMode, timerMode: pending.timerMode, timerClueSeconds: pending.timerClueSeconds, timerGuessSeconds: pending.timerGuessSeconds, neutralCount: pending.neutralCount, flipMode: pending.flipMode });
  }, [room, session, socket]);
  useEffect(() => { setTransferHostTargetId((cur) => { if (cur && hostTransferCandidates.some((p) => p.id === cur)) return cur; return hostTransferCandidates[0]?.id ?? ""; }); }, [hostTransferCandidates]);
  useEffect(() => {
    const reveal = room?.lastReveal; if (!reveal || reveal.id === lastRevealIdRef.current) return;
    lastRevealIdRef.current = reveal.id;
    setRevealBanner(reveal); setRevealingCardIds((prev) => new Set(prev).add(reveal.cardId)); setPendingGuess(null); guessLockRef.current = false;
    if (soundEnabledRef.current) {
      if (reveal.outcome === "own-hit") playOwnHit(); else if (reveal.outcome === "opponent-hit") playOpponentHit(); else if (reveal.outcome === "neutral-hit") playNeutralHit(); else if (reveal.outcome === "assassin-hit") playAssassinHit();
    }
    const t = window.setTimeout(() => setRevealingCardIds((prev) => { const n = new Set(prev); n.delete(reveal.cardId); return n; }), 520);
    return () => window.clearTimeout(t);
  }, [room?.lastReveal]);
  useEffect(() => {
    if (!pendingGuess || !room) return;
    const guessed = room.board.find((c) => c.id === pendingGuess);
    if (guessed?.revealed || room.phase !== "playing" || !viewer?.canGuess) { setPendingGuess(null); guessLockRef.current = false; }
  }, [pendingGuess, room, viewer?.canGuess]);
  useEffect(() => {
    if (room?.phase === "finished" && room.winner) { if (soundEnabledRef.current) playVictory(); setShowSakura(true); const t = window.setTimeout(() => setShowSakura(false), 8000); return () => window.clearTimeout(t); }
    setShowSakura(false);
  }, [room?.phase, room?.winner]);
  useEffect(() => { if (room?.phase === "playing" && room.roundNumber && soundEnabledRef.current) playGameStart(); }, [room?.phase, room?.roundNumber]);
  useEffect(() => {
    if (sideTab !== "chat") return;
    const list = chatListRef.current; if (!list || !stickToChatBottomRef.current) return;
    list.scrollTop = list.scrollHeight; setJumpToLatest(false);
  }, [room?.messages, sideTab]);
  useEffect(() => {
    if (sideTab !== "battle") return;
    const list = battleListRef.current; if (!list || !stickToBattleBottomRef.current) return;
    list.scrollTop = list.scrollHeight; setJumpToLatest(false);
  }, [room?.messages, sideTab]);
  useEffect(() => {
    const handler = () => { if (document.visibilityState === "visible" && session) socket.emit("sync_room_state", { roomId: session.roomId }); };
    document.addEventListener("visibilitychange", handler); return () => document.removeEventListener("visibilitychange", handler);
  }, [session, socket]);

  useEffect(() => {
    const canSubmit = viewer?.canSubmitClue === true;
    const prevCanSubmit = prevCanSubmitClueRef.current;
    prevCanSubmitClueRef.current = canSubmit;
    if (canSubmit && !prevCanSubmit) {
      setClueWord("");
      setClueCountInput("2");
    }
  }, [viewer?.canSubmitClue]);

  useEffect(() => {
    setSoundMuted(!soundEnabled);
  }, [soundEnabled]);

  // ─── named user loading ───────────────────────────
  useEffect(() => {
    if (!identity || identity.mode !== "named") { setNamedAccount(null); return; }
    void loginNamedUser({ username: identity.username }).then((account) => {
      setNamedAccount(account);
      const ni: LocalIdentity = { mode: "named", username: account.username, nickname: account.username, avatarUrl: account.avatarUrl, userSessionToken: account.sessionToken };
      _setIdentity(ni); saveIdentity(ni); setRecentUsers(loadRecentUsernames());
    }).catch((e) => setError(e instanceof Error ? e.message : "加载账户失败"));
  }, [identity?.mode, identity?.username]);
  useEffect(() => { void refreshPublicPacks(); }, []);

  // ─── handlers ──────────────────────────────────────
  async function handleNamedLogin(usernameOverride?: string) {
    const username = (usernameOverride ?? namedUsernameInput).trim();
    if (!username) { setError("请输入用户名"); return; }
    try {
      const account = await loginNamedUser({ username });
      setNamedAccount(account);
      persistIdentity({ mode: "named", username: account.username, nickname: account.username, avatarUrl: account.avatarUrl, userSessionToken: account.sessionToken });
      setNamedUsernameInput(account.username); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "登录失败"); }
  }

  function continueAsGuest() {
    const nickname = guestNicknameInput.trim();
    if (!nickname) { setError("请输入游客昵称"); return; }
    setNamedAccount(null);
    persistIdentity({ mode: "guest", username: "", nickname, avatarUrl: null }); setError("");
  }

  async function handleAvatarUpload(file: File | null) {
    if (!namedAccount || !file) return;
    try {
      const avatarUrl = await imageFileToAvatarDataUrl(file);
      const updated = await updateNamedUser(namedAccount.username, requireNamedUserSessionToken(identity), { avatarUrl });
      setNamedAccount(updated);
      persistIdentity({ mode: "named", username: updated.username, nickname: updated.username, avatarUrl: updated.avatarUrl, userSessionToken: requireNamedUserSessionToken(identity) });
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "头像上传失败"); }
  }

  async function refreshPublicPacks() {
    try {
      const packs = await listPublicWordPacks(); setPublicPacks(packs);
      setSelectedPublicPackId((cur) => cur && packs.some((p) => makePublicPackKey(p) === cur) ? cur : "");
    } catch (e) { setError(e instanceof Error ? e.message : "公开档案库加载失败"); }
  }

  async function fetchPublicPackDetail(publicId: string): Promise<PublicWordPack | null> {
    try {
      return await getPublicWordPackDetail(publicId);
    } catch (e) { setError(e instanceof Error ? e.message : "加载题库详情失败"); return null; }
  }

  async function saveAccountPacksInternal(nextPacks: SavedWordPack[]) {
    if (!namedAccount) throw new Error("请先使用用户名登录");
    const prev = namedAccount;
    setNamedAccount({ ...namedAccount, customWordPacks: nextPacks, updatedAt: Date.now() });
    try {
      const updated = await updateNamedUser(namedAccount.username, requireNamedUserSessionToken(identity), { customWordPacks: nextPacks });
      setNamedAccount({ ...updated, customWordPacks: updated.customWordPacks.length > 0 ? updated.customWordPacks : nextPacks });
      void refreshPublicPacks(); setError("");
    } catch (e) { setNamedAccount(prev); throw e; }
  }

  async function addAccountPack() {
    if (!namedAccount) { setError("请先使用用户名登录"); return; }
    const name = savedPackName.trim(); const entries = parsePackEntries(savedPackEntries);
    if (!name) { setError("请输入题库名称"); return; }
    if (entries.length < 25) { setError("自定义题库至少需要 25 个词"); return; }
    await saveAccountPacksInternal([...namedAccount.customWordPacks, buildSavedPackFromPlayable({ name, entries })]);
    setSavedPackName(""); setSavedPackEntries("");
  }

  async function importAccountPack(file: File | null) {
    if (!namedAccount || !file) return;
    try {
      const imported = await parseCustomWordFile(file);
      if (imported.kind === "candidate") { resetCandidateReview(imported.pack); setError(""); return; }
      await saveAccountPacksInternal([...namedAccount.customWordPacks, buildSavedPackFromPlayable(imported.pack)]);
    } catch (e) { setError(e instanceof Error ? e.message : "导入题库失败"); }
  }

  async function removeAccountPack(packId: string) {
    if (!namedAccount) return;
    try { await saveAccountPacksInternal(namedAccount.customWordPacks.filter((p) => p.id !== packId)); if (selectedAccountPackId === packId) setSelectedAccountPackId(""); } catch (e) { setError(e instanceof Error ? e.message : "删除题库失败"); }
  }

  async function toggleAccountPackPublic(packId: string) {
    if (!namedAccount) return;
    const ts = Date.now();
    try {
      await saveAccountPacksInternal(namedAccount.customWordPacks.map((p) => {
        if (p.id !== packId) return p;
        const nextIsPublic = p.isPublic !== true;
        return { ...p, isPublic: nextIsPublic, publishedAt: nextIsPublic ? p.publishedAt ?? ts : undefined, updatedAt: ts };
      }));
    } catch (e) { setError(e instanceof Error ? e.message : "更新题库公开状态失败"); }
  }

  function chooseAccountPackForCreate(packId: string) { setSelectedAccountPackId(packId); setPackSource("account"); setError(""); }

  function updateCandidateEntry(display: string, patch: Partial<CandidateEntry>) {
    setCandidatePack((cur) => cur ? { ...cur, entries: cur.entries.map((e) => (e.display === display ? { ...e, ...patch } : e)) } : cur);
  }
  function bulkSetVisibleEntries(displays: string[], reviewStatus: CandidateEntry["reviewStatus"]) {
    setCandidatePack((cur) => cur ? { ...cur, entries: cur.entries.map((e) => (displays.includes(e.display) ? { ...e, reviewStatus } : e)) } : cur);
  }
  async function exportCandidateAsPlayable(filters: CandidateExportFilters) {
    if (!candidatePack) return;
    if (!namedAccount) { setError("请先登录用户名账户，再导出题库"); return; }
    try {
      const pack = exportPlayablePack(candidatePack, filters);
      await saveAccountPacksInternal([...namedAccount.customWordPacks, pack]);
      setCandidatePack(null); setError(`已导出题库：${pack.name}（${pack.entries.length} 个词）`);
    } catch (e) { setError(e instanceof Error ? e.message : "候选题库导出失败"); }
  }
  function resetCandidateReview(pack: CandidatePack) { setCandidatePack(applyCandidateAutoReview(pack)); }

  // ─── room join / create ────────────────────────────
  function buildJoinProfile() {
    if (!effectiveIdentity) { setError("请先登录或进入游客模式"); return null; }
    return effectiveIdentity.mode === "named"
      ? { nickname: effectiveIdentity.username, profile: effectiveIdentity }
      : { nickname: effectiveIdentity.nickname, profile: effectiveIdentity };
  }

  function createRoom() {
    const ji = buildJoinProfile(); if (!ji) return;
    if (packSource === "public" && selectedPublicPack) {
      setError("正在加载题库详情...");
      fetchPublicPackDetail(selectedPublicPack.publicId).then((pack) => {
        if (!pack) return;
        createRoomWithEntries(pack.name, pack.entries);
      });
      return;
    }
    clearSession(); setSession(null); setRoom(null); activeRoomIdRef.current = null;
    const pending: { boardMode: BoardMode; builtinWordPackId?: string; customWordPack?: { name: string; entries: string[] }; scoringMode?: ScoringMode; timerMode?: import("@acg-codenames/shared").TimerMode; timerClueSeconds?: number; timerGuessSeconds?: number; neutralCount?: number | null; flipMode?: import("@acg-codenames/shared").FlipMode } = { boardMode: createBoardMode, scoringMode, timerMode: createTimerMode, timerClueSeconds: createTimerClueSeconds, timerGuessSeconds: createTimerGuessSeconds, neutralCount: createNeutralCount === 0 ? null : createNeutralCount, flipMode: createFlipMode }; 
    if (packSource === "builtin") pending.builtinWordPackId = selectedBuiltinPackId;
    else if (selectedAccountPack) pending.customWordPack = { name: selectedAccountPack.name, entries: selectedAccountPack.entries };
    pendingCreateConfigRef.current = pending;
    setConnectionState("connecting"); setError("");
    socket.emit("create_room", { nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined } });
  }

  function createRoomWithEntries(packName: string, packEntries: string[]) {
    const ji = buildJoinProfile(); if (!ji) return;
    clearSession(); setSession(null); setRoom(null); activeRoomIdRef.current = null;
    const pending: { boardMode: BoardMode; builtinWordPackId?: string; customWordPack?: { name: string; entries: string[] }; scoringMode?: ScoringMode; timerMode?: import("@acg-codenames/shared").TimerMode; timerClueSeconds?: number; timerGuessSeconds?: number; neutralCount?: number | null; flipMode?: import("@acg-codenames/shared").FlipMode } = { boardMode: createBoardMode, scoringMode, timerMode: createTimerMode, timerClueSeconds: createTimerClueSeconds, timerGuessSeconds: createTimerGuessSeconds, neutralCount: createNeutralCount === 0 ? null : createNeutralCount, flipMode: createFlipMode }; 
    pending.customWordPack = { name: packName, entries: packEntries };
    pendingCreateConfigRef.current = pending;
    setConnectionState("connecting"); setError("");
    socket.emit("create_room", { nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined } });
  }

  function joinSpecificRoom(roomId: string, asSpectator: boolean) {
    const ji = buildJoinProfile(); if (!ji) return;
    setConnectionState("connecting"); setError("");

    const storedSession = loadSession();
    if (storedSession && storedSession.roomId === roomId) {
      socket.emit("reconnect_room", { roomId, sessionToken: storedSession.sessionToken });
      return;
    }

    const payload = { roomId, nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined } };
    if (asSpectator) socket.emit("join_spectator", payload);
    else socket.emit("join_room", payload);
  }

  function joinByRoomCode(asSpectator: boolean) {
    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== ROOM_ID_LENGTH) { setError("请输入 6 位密令房号"); return; }
    joinSpecificRoom(normalized, asSpectator);
  }

  // ─── room actions ──────────────────────────────────
  function chooseTeam(team: Team | null) { if (session) socket.emit("set_team", { roomId: session.roomId, team }); }
  function chooseRole(role: "spymaster" | "operative") { if (session) socket.emit("set_role", { roomId: session.roomId, role }); }
  function randomizeTeams() { if (session) socket.emit("randomize_teams", { roomId: session.roomId }); }
  function updateBoardMode(boardMode: BoardMode) { if (session) socket.emit("update_room_settings", { roomId: session.roomId, boardMode }); }
  function updateScoringMode(mode: ScoringMode) { if (session) socket.emit("update_room_settings", { roomId: session.roomId, scoringMode: mode }); }
  function updateBuiltinPack(wordPackId: string) { if (session) socket.emit("update_room_settings", { roomId: session.roomId, builtinWordPackId: wordPackId }); }
  async function uploadRoomPack(file: File | null) {
    if (!session || !file) return;
    try {
      const pack = await parseCustomWordFile(file);
      if (pack.kind === "candidate") { socket.emit("update_room_settings", { roomId: session.roomId, customWordPack: { name: autoExportCandidatePack(pack.pack).name, entries: autoExportCandidatePack(pack.pack).entries } }); setError("已自动转换房间题库"); return; }
      socket.emit("update_room_settings", { roomId: session.roomId, customWordPack: { name: pack.pack.name, entries: pack.pack.entries } }); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "上传房间题库失败"); }
  }
  function useAccountPackForRoom(pack: SavedWordPack) { if (session) socket.emit("update_room_settings", { roomId: session.roomId, customWordPack: { name: pack.name, entries: pack.entries } }); }
  function usePublicPackForRoom(pack: PublicWordPackSummary) {
    if (!session) return;
    setError("正在加载题库详情...");
    fetchPublicPackDetail(pack.publicId).then((fullPack) => {
      if (fullPack) socket.emit("update_room_settings", { roomId: session.roomId, customWordPack: { name: fullPack.name, entries: fullPack.entries } });
    });
  }
  function startGame() { if (session) socket.emit("start_game", { roomId: session.roomId }); }
  function restartGame() { if (session) socket.emit("restart_game", { roomId: session.roomId }); }
  function returnToLobby() { if (session && window.confirm("确定要结束当前对局并回到准备阶段吗？")) socket.emit("return_to_lobby", { roomId: session.roomId }); }
  function transferHost() {
    if (!session || !transferHostTargetId) return;
    const target = hostTransferCandidates.find((p) => p.id === transferHostTargetId);
    if (!target || !window.confirm(`确定把房主转让给 ${target.nickname} 吗？`)) return;
    socket.emit("transfer_host", { roomId: session.roomId, targetPlayerId: target.id });
  }
  function disbandRoom() { if (session && window.confirm("确定要解散密令房吗？所有玩家都会回到首页。")) socket.emit("disband_room", { roomId: session.roomId }); }
  function forceEndGame() { if (session) socket.emit("force_end_game", { roomId: session.roomId }); }
  function queueForNextRound() { if (session) socket.emit("queue_for_next_round", { roomId: session.roomId }); }
  function cancelQueueJoin() { if (session) socket.emit("cancel_queue_join", { roomId: session.roomId }); }
  function debugFillRoom() { if (session) socket.emit("debug_fill_room", { roomId: session.roomId }); }
  function submitClue() {
    if (!session || !viewer?.canSubmitClue || !clueWord.trim()) return;
    const count = Number(clueCountInput);
    if (!Number.isInteger(count) || count < MIN_CLUE_COUNT || count > MAX_CLUE_COUNT) {
      setError(`提示数量无效，请输入 ${MIN_CLUE_COUNT}-${MAX_CLUE_COUNT} 的整数`);
      return;
    }
    socket.emit("submit_clue", { roomId: session.roomId, word: clueWord.trim(), count });
    if (soundEnabled) playSubmitClue();
    setClueWord("");
    setClueCountInput("2");
  }
  function guessCard(cardId: string) { if (!session || !viewer?.canGuess || guessLockRef.current) return; guessLockRef.current = true; setPendingGuess(cardId); socket.emit("guess_card", { roomId: session.roomId, cardId }); }
  function endTurn() { if (session) { socket.emit("end_turn", { roomId: session.roomId }); if (soundEnabled) playEndTurn(); } }
  function resumeTimerFunc() { if (session) { socket.emit("resume_timer", { roomId: session.roomId }); } }
  const chatSendLockRef = useRef(false);
  const lastQuickPhraseRef = useRef({ text: "", time: 0 });
  function sendChatMessage() {
    if (!session || !chatText.trim() || chatSendLockRef.current) return;
    chatSendLockRef.current = true;
    socket.emit("send_chat_message", { roomId: session.roomId, text: chatText.trim() });
    setChatText("");
    window.setTimeout(() => { chatSendLockRef.current = false; }, 500);
  }
  function sendQuickPhrase(text: string) {
    if (!session || chatSendLockRef.current) return;
    const now = Date.now();
    if (text === lastQuickPhraseRef.current.text && now - lastQuickPhraseRef.current.time < 500) return;
    lastQuickPhraseRef.current = { text, time: now };
    chatSendLockRef.current = true;
    socket.emit("send_chat_message", { roomId: session.roomId, text });
    window.setTimeout(() => { chatSendLockRef.current = false; }, 500);
  }
  function sendReaction(reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType) {
    if (!session) return;
    socket.emit("send_reaction", { roomId: session.roomId, reaction, targetParticipantId, targetParticipantType });
    if (soundEnabledRef.current) playClick();
  }
  function leaveRoom() {
    if (session) socket.emit("leave_room", { roomId: session.roomId, sessionToken: session.sessionToken });
    clearSession(); setSession(null); setRoom(null); setConnectionState("idle"); setDidReconnect(false); setRevealBanner(null); setDanmakuQueue([]); setRoundHighlights([]); setRoundAchievements([]); setHighlightToast(null); setAchievementToast(null); setError(""); activeRoomIdRef.current = null;
  }
  function logoutNamedUser() {
    const prevIdentity = identity;
    clearIdentity();
    _setIdentity(null);
    setNamedAccount(null);
    clearSession();
    setSession(null);
    setRoom(null);
    setConnectionState("idle");
    setDidReconnect(false);
    setRevealBanner(null);
    setDanmakuQueue([]);
    setNamedUsernameInput("");
    setError("");
    activeRoomIdRef.current = null;
    if (prevIdentity?.mode === "named" && prevIdentity?.userSessionToken) {
      apiLogoutNamedUser(prevIdentity.username, prevIdentity.userSessionToken).catch(() => {});
    }
  }
  async function copyLink() {
    if (!inviteLink) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const el = document.createElement("textarea");
        el.value = inviteLink;
        el.style.position = "fixed"; el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("复制失败，请手动复制房间号: " + inviteLink);
    }
  }
  function handleChatScroll() { const list = chatListRef.current; if (!list) return; const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24; stickToChatBottomRef.current = nearBottom; setJumpToLatest(!nearBottom); }
  function handleBattleScroll() { const list = battleListRef.current; if (!list) return; const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24; stickToBattleBottomRef.current = nearBottom; setJumpToLatest(!nearBottom); }
  function scrollChatToBottom() { const list = chatListRef.current; if (!list) return; list.scrollTop = list.scrollHeight; stickToChatBottomRef.current = true; setJumpToLatest(false); }
  function toggleSection(title: string) { setCollapsedSections((prev) => { const next = new Set(prev); next.has(title) ? next.delete(title) : next.add(title); return next; }); }
  function renderHint(): string {
    if (!room) return effectiveIdentity ? "先建密令房，或从大厅加入。" : "先用用户名登录，或直接以游客身份进入。";
    return viewer?.statusText ?? "等待房间同步";
  }

  const value: GameContextType = {
    socket, identity, setIdentity, namedAccount,
    guestNicknameInput, setGuestNicknameInput,
    namedUsernameInput, setNamedUsernameInput, recentUsers,
    session, room, roomSummaries, error, setError, connectionState, effectiveIdentity,
    publicPacks, createBoardMode, setCreateBoardMode,
    scoringMode, setScoringMode,
    createTimerMode, setCreateTimerMode,
    createTimerClueSeconds, setCreateTimerClueSeconds,
    createTimerGuessSeconds, setCreateTimerGuessSeconds,
    createNeutralCount, setCreateNeutralCount,
    createFlipMode, setCreateFlipMode,
    packSource, setPackSource,
    selectedBuiltinPackId, setSelectedBuiltinPackId,
    selectedAccountPackId, setSelectedAccountPackId,
    selectedPublicPackId, setSelectedPublicPackId,
    accountPacks, selectedAccountPack, selectedPublicPack,
    handleNamedLogin, continueAsGuest, handleAvatarUpload,
    createRoom, joinByRoomCode, joinSpecificRoom, leaveRoom, logoutNamedUser,
    refreshPublicPacks, fetchPublicPackDetail, addAccountPack, importAccountPack, removeAccountPack, toggleAccountPackPublic, chooseAccountPackForCreate,
    savedPackName, setSavedPackName, savedPackEntries, setSavedPackEntries,
    candidatePack, setCandidatePack, updateCandidateEntry, bulkSetVisibleEntries, exportCandidateAsPlayable, resetCandidateReview,
    transferHostTargetId, setTransferHostTargetId, hostTransferCandidates,
    roomCode, setRoomCode, isLobby, isFinished, viewer, self, inviteLink, boardColumns,
    chooseTeam, chooseRole, randomizeTeams, updateBoardMode, updateScoringMode, updateBuiltinPack,
    uploadRoomPack, useAccountPackForRoom, usePublicPackForRoom,
    startGame, restartGame, returnToLobby, transferHost, disbandRoom, forceEndGame,
    queueForNextRound, cancelQueueJoin, debugFillRoom,
    submitClue, guessCard, endTurn, resumeTimer: resumeTimerFunc, sendChatMessage, sendQuickPhrase, sendReaction, copyLink,
    clueWord, setClueWord, clueCountInput, setClueCountInput,
    chatText, setChatText, danmakuQueue, showDanmaku: showDanmakuRaw, setShowDanmaku,
    roundHighlights, roundAchievements, highlightToast, achievementToast,
    copied, focusMode, setFocusMode,
    enterFocusMode, exitFocusMode,
    soundEnabled, setSoundEnabled: handleSetSoundEnabled,
    sideTab, setSideTab, jumpToLatest,
    mobileRoomTab, setMobileRoomTab,
    chatListRef, battleListRef, handleChatScroll, handleBattleScroll, scrollChatToBottom,
    revealBanner, reactionEffects, pendingGuess, revealingCardIds,
    maskSpymasterHints, setMaskSpymasterHints,
    showSakura, globalReaction, reactionQueue,
    collapsedSections, setCollapsedSections, toggleSection,
    canSeeHiddenRoles, showSpymasterHints, stickToChatBottomRef, stickToBattleBottomRef, isDebugController,
    renderHint, boardModes, ROOM_ID_LENGTH, makePublicPackKey,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
