import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from 'react-router-dom';
import { MatchNotifications, type NotificationScope } from '../lib/match-notifications';
import { ClueRequestLifecycle } from '../lib/pending-clue';

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
import {
  applyRoomDelta,
  type RoomSnapshot,
  type RoomDelta,
  BOARD_MODE_CONFIG,
  MAX_CLUE_COUNT,
  MIN_CLUE_COUNT,
  PLAYER_ROLE_LABELS,
  TEAM_LABELS,
  wordPackSummaries,
  roomTurnKey,
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
  type SavedImagePack,
  type PublicImagePack,
  type PublicImagePackSummary,
  type PublicRevealGuessState,
  type RevealEvent,
  type RevealGuessSettings,
  type RevealOutcome,
  type RoundHighlight,
  type AchievementUnlockPayload,
  type RoomSummary,
  type SavedWordPack,
  type Team
} from "@acg-codenames/shared";
import { listPublicWordPacks, getPublicWordPackDetail, listPublicImagePacks, getPublicImagePackDetail, loginNamedUser, logoutNamedUser as apiLogoutNamedUser, updateNamedUser } from "../lib/api";
import { getSocket } from "../lib/socket";
import { privateIdentityKey, activatePrivateIdentity } from '../lib/private-identity';
import { clearIdentity, clearSession, loadIdentity, loadRecentUsernames, loadSession, saveIdentity, saveSession, loadRecoverableSessions, saveRecoverableSessions, removeRecoverableSession, invalidateRoomSession, roomInvalidationKey, type LocalIdentity } from "../lib/storage";
import { copyText } from "../lib/clipboard";
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

export function parseCustomWordFile(file: File): Promise<ImportedWordPackFile> {
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

export function autoExportCandidatePack(pack: CandidatePack): SavedWordPack {
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
  updateTitle: (title: string | null) => Promise<void>;
  createRoom: (defaults?: boolean, variant?: 'classic'|'anime') => void;
  createRevealGuessRoom: (settings?: Partial<RevealGuessSettings>, initialPuzzle?: { imageUrl: string; answer: string; aliases?: string[]; hints?: string[] }) => void;
  joinByRoomCode: (asSpectator: boolean) => void;
  joinSpecificRoom: (roomId: string, asSpectator: boolean) => void;
  leaveRoom: () => void;
  logoutNamedUser: () => void;
  refreshPublicPacks: () => Promise<void>;
  fetchPublicPackDetail: (publicId: string) => Promise<PublicWordPack | null>;
  addAccountPack: () => Promise<void>;
  importAccountPack: (file: File | null) => Promise<void>;
  editAccountPack: (packId: string, name: string, entries: string) => Promise<void>;
  removeAccountPack: (packId: string) => Promise<void>;
  toggleAccountPackPublic: (packId: string) => Promise<void>;
  chooseAccountPackForCreate: (packId: string) => void;

  // Image packs
  publicImagePacks: PublicImagePackSummary[];
  accountImagePacks: SavedImagePack[];
  refreshPublicImagePacks: () => Promise<void>;
  fetchPublicImagePackDetail: (publicId: string) => Promise<PublicImagePack | null>;
  addAccountImagePack: (name: string, entries: { url: string; label: string }[]) => Promise<void>;
  editAccountImagePack: (packId: string, name: string, entries: { url: string; label: string }[]) => Promise<void>;
  removeAccountImagePack: (packId: string) => Promise<void>;
  toggleAccountImagePackPublic: (packId: string) => Promise<void>;

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
  randomizeTeams: (mode?: 'all'|'keep-captains') => void;
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
  cluePending: boolean;
  clueSyncing: boolean;
  retryClue: () => void;
  guessCard: (cardId: string) => void;
  endTurn: () => void;
  resumeTimer: () => void;
  hostTakeover: (kind: 'request'|'approve'|'reject'|'cancel') => void;
  syncRoomState: () => void;
  joinError: string;
  clearJoinError: () => void;
  lostRoom: { roomId: string; message: string } | null;
  actionStatus: string;
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
  chatUnread: number;
  battleUnread: number;
  chatPending: boolean;
  chatError: string;
  scrollBattleToBottom: () => void;
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
  const navigate = useNavigate();
  const socket = useMemo(() => getSocket(), []);
  const [identity, _setIdentity] = useState<LocalIdentity | null>(()=>{const value=loadIdentity();if(value)activatePrivateIdentity(`${value.mode}:${value.username||value.nickname}`);return value;});
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
    "6x6": [10],
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
  const [publicImagePacks, setPublicImagePacks] = useState<PublicImagePackSummary[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<ClientSession | null>(loadSession());
  const notificationScope = useRef<NotificationScope | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const freshSessionRef = useRef(false);
  const navigateAfterSession = useRef(false);
  const recoveryAttempt = useRef<{roomId:string;retry:boolean}|null>(null);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [roomSummaries, setRoomSummaries] = useState<RoomSummary[]>([]);
  const [error, setError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [lostRoom, setLostRoom] = useState<{ roomId: string; message: string } | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const clueDraftRevisionRef = useRef(0);
  const [clueWord, setClueWordRaw] = useState("");
  const [cluePending, setCluePending] = useState(false);
  const [clueSyncing, setClueSyncing] = useState(false);
  const setClueWord = (value: string) => {
    clueDraftRevisionRef.current += 1;
    setClueWordRaw(value);
    clearActionError('clue');
  };
  const [clueCountInput, setClueCountInputRaw] = useState("2");
  const [chatText, setChatText] = useState("");
  const [danmakuQueue, setDanmakuQueue] = useState<DanmakuMessage[]>([]);
  const [showDanmakuRaw, setShowDanmakuRaw] = useState(() => {
    try { return localStorage.getItem("showDanmaku") !== "off"; } catch { return true; }
  });
  const [copied, setCopied] = useState(false);
  const [copyFail, setCopyFail] = useState(false);
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
      clueDraftRevisionRef.current += 1;
      setClueCountInputRaw(value);
      if (scopedErrorRef.current?.scope === 'clue') { scopedErrorRef.current = null; setError(''); }
    }
  };
  const setActionError = (scope: 'clue' | 'guess' | 'endTurn', message: string) => {
    scopedErrorRef.current = { scope, message };
    setError(message);
  };
  const clearActionError = (scope: 'clue' | 'guess' | 'endTurn') => {
    if (scopedErrorRef.current?.scope === scope) {
      scopedErrorRef.current = null;
      setError('');
    }
  };
  const releaseCreateAttempt = () => {
    createAttemptRef.current = null;
    clearTimeout(createTimerRef.current);
    createTimerRef.current = undefined;
    navigateAfterSession.current = false;
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
  const [chatUnread,setChatUnread]=useState(0),[battleUnread,setBattleUnread]=useState(0);
  const jumpToLatest=chatUnread>0;
  const [chatPending,setChatPending]=useState(false),[chatError,setChatError]=useState('');
  const joinLockRef=useRef(false),joinTimerRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const releaseJoin=()=>{joinLockRef.current=false;clearTimeout(joinTimerRef.current);};
  const scrollPositions=useRef({chat:0,battle:0});
  const seenMessageIds=useRef<{roomId?:string;ids:Set<string>}>({ids:new Set()});
  const [revealBanner, setRevealBanner] = useState<RevealEvent | null>(null);
  const [reactionEffects, setReactionEffects] = useState<Record<string, ChatReaction>>({});
  const [pendingGuess, setPendingGuess] = useState<string | null>(null);
  const guessLockRef = useRef(false);
  const endTurnLockRef = useRef(false);
  const clueLifecycleRef = useRef<ClueRequestLifecycle | null>(null);
  const guessActionRef = useRef<{ requestId: string; cardId: string; turnKey: string; matchId?: string } | null>(null);
  const endTurnActionRef = useRef<{ requestId: string; turnKey: string; matchId?: string } | null>(null);
  const scopedErrorRef = useRef<{ scope: 'clue' | 'guess' | 'endTurn'; message: string } | null>(null);
  const createAttemptRef = useRef<{ previousRoomId?: string; previousPhase?: string; previousToken?: string } | null>(null);
  const createTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const guessUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endTurnUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const joinAttemptRef = useRef<{ roomId: string; spectator: boolean; previousRoomId?: string; previousPhase?: string; previousToken?: string } | null>(null);
  if (!clueLifecycleRef.current) clueLifecycleRef.current = new ClueRequestLifecycle((event, request, message) => {
    setCluePending(event === 'pending' || event === 'syncing');
    setClueSyncing(event === 'syncing');
    if (event === 'pending') {
      clearActionError('clue');
      setActionStatus('正在提交提示…');
    } else if (event === 'syncing') {
      setActionStatus('提示尚未确认，正在同步；输入已保留，请勿重复提交。');
      if (activeRoomIdRef.current === request.roomId) socket.emit('sync_room_state', { roomId: request.roomId });
    } else {
      setActionStatus('');
      if (event === 'rejected') setActionError('clue', `提示未提交：${message ?? '服务器拒绝'}。输入已保留。`);
      else {
        clearActionError('clue');
        if (event === 'accepted' && clueDraftRevisionRef.current === request.draftRevision) {
          setClueWordRaw('');
          setClueCountInputRaw('2');
        }
      }
    }
  });
  useEffect(() => () => clueLifecycleRef.current?.cancel(), []);
  useEffect(() => {
    if (clueLifecycleRef.current?.pending?.roomId !== session?.roomId) clueLifecycleRef.current?.cancel();
  }, [session?.roomId]);
  const [revealingCardIds, setRevealingCardIds] = useState<Set<string>>(new Set());
  const [maskSpymasterHints, setMaskSpymasterHints] = useState(false);
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
    variant?: 'classic'|'anime';
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
  const accountImagePacks = namedAccount?.customImagePacks ?? [];
  const selectedAccountPack = accountPacks.find((pack) => pack.id === selectedAccountPackId) ?? null;
  const selectedPublicPack = publicPacks.find((pack) => makePublicPackKey(pack) === selectedPublicPackId) ?? null;
  const hostTransferCandidates = room?.players.filter((player) => !player.isBot && player.id !== session?.participantId) ?? [];
  const effectiveIdentity: LocalIdentity | null = useMemo(() => getIdentityProfile(identity, namedAccount), [identity, namedAccount]);
  const viewer = room?.viewer ?? null;
  const self: RoomParticipant | null =
    room?.players.find((p) => p.id === session?.participantId) ?? room?.spectators.find((s) => s.id === session?.participantId) ?? null;
  const inviteLink = session ? `${window.location.origin}/?room=${session.roomId}` : "";
  const isLobby = room?.phase === "lobby";
  const isFinished = room?.phase === "finished";
  const isDebugController = Boolean(window.location.hostname === "localhost" && viewer?.isDebugController);
  const canSeeHiddenRoles = Boolean(viewer && (room?.phase === "finished" || viewer.role === "spymaster" || viewer.isDebugController));
  const showSpymasterHints = canSeeHiddenRoles && !maskSpymasterHints;
  const boardColumns = room ? BOARD_MODE_CONFIG[room.settings.boardMode].columns : 5;

  function persistIdentity(nextIdentity: LocalIdentity): void {
    const previous=loadIdentity();
    const owner=(i:LocalIdentity|null)=>i?`${i.mode}:${i.username||i.nickname}`:'';
    if(owner(previous)!==owner(nextIdentity)) {
      socket.disconnect(); setRoom(null); setSession(null); setDidReconnect(false); activeRoomIdRef.current=null;
    }
    activatePrivateIdentity(owner(nextIdentity));
    _setIdentity(nextIdentity);
    saveIdentity(nextIdentity);
    if(owner(previous)!==owner(nextIdentity)){setSession(loadSession());socket.connect();}
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

  useEffect(()=>{
    const changed=()=>{socket.disconnect();setRoom(null);activeRoomIdRef.current=null;setDidReconnect(false);_setIdentity(loadIdentity());setSession(loadSession());socket.connect();};
    const storage=(e:StorageEvent)=>{
      if(e.key==='acg-codenames-identity'||e.key==='cipai.private-identity.v1')changed();
      if(e.key===roomInvalidationKey()&&e.newValue){
        try {
          const {roomId}=JSON.parse(e.newValue);
          if(typeof roomId==='string'&&activeRoomIdRef.current===roomId){
            setSession(null);setRoom(null);activeRoomIdRef.current=null;
            setConnectionState('idle');setDidReconnect(false);setRevealBanner(null);
          }
        } catch { /* Ignore malformed external storage notifications. */ }
      }
    };
    window.addEventListener('storage',storage);window.addEventListener('private-identity-changed',changed);
    return()=>{window.removeEventListener('storage',storage);window.removeEventListener('private-identity-changed',changed);};
  },[socket]);

  // ─── socket event listeners ───────────────────────────
  useEffect(() => {
    function onSession(p: ClientSession) {
      if (activeRoomIdRef.current && activeRoomIdRef.current !== p.roomId) {
        clueLifecycleRef.current?.cancel();
        scopedErrorRef.current = null;
      }
      const attempt=joinAttemptRef.current;
      const created=createAttemptRef.current;
      releaseJoin();
      clearTimeout(createTimerRef.current);
      createTimerRef.current=undefined;
      createAttemptRef.current=null;
      joinAttemptRef.current=null;
      recoveryAttempt.current=null;
      setJoinError('');setLostRoom(null);
      setSession(p); saveSession(p); setConnectionState("ready"); if (!scopedErrorRef.current) setError(""); activeRoomIdRef.current = p.roomId; freshSessionRef.current = true;
      const previous = attempt ?? created;
      if(previous&&previous.previousRoomId&&previous.previousRoomId!==p.roomId&&previous.previousPhase==='lobby'&&previous.previousToken){
        // The new seat is confirmed; explicitly release the old lobby seat without risking rollback.
        socket.emit('leave_room',{roomId:previous.previousRoomId,sessionToken:previous.previousToken,identityKey:privateIdentityKey()});
        removeRecoverableSession(previous.previousRoomId);
      }
      const recoverable = loadRecoverableSessions();
      recoverable[p.roomId] = { sessionToken: p.sessionToken, participantType: p.participantType, savedAt: Date.now() };
      saveRecoverableSessions(recoverable);
      if(navigateAfterSession.current){navigateAfterSession.current=false;navigate(`/room/${p.roomId}`);}
    }
    let wireState: RoomSnapshot | null = null;
    function onDelta(delta: RoomDelta) {
      if (delta.roomId !== activeRoomIdRef.current) return;
      const next = applyRoomDelta(wireState, delta);
      if (next) onRoomState(next);
      else { wireState = null; socket.emit("sync_room_state", {roomId: delta.roomId}); }
    }
    function onRoomState(p: RoomSnapshot) {
      if (!loadSession() || p.id !== activeRoomIdRef.current) return;
      wireState = p;
      if(p.phase==='playing'&&notificationScope.current?.matchId!==p.matchId)setSideTab('battle');
      notificationScope.current = p.matchId ? {roomId:p.id,matchId:p.matchId,roundNumber:p.roundNumber,latestTurn:p.clueRecords?.length??0} : null;
      setRoom(p); setConnectionState("ready"); setLostRoom(null);
      // Only a local action-scoped error survives unrelated room broadcasts.
      if (!scopedErrorRef.current) setError("");
      const pendingGuessAction = guessActionRef.current;
      if (pendingGuessAction) {
        const targetRevealed = p.board.some(card => card.id === pendingGuessAction.cardId && card.revealed);
        const turnChanged = roomTurnKey(p) !== pendingGuessAction.turnKey || p.phase !== 'playing' || (!!pendingGuessAction.matchId && p.matchId !== pendingGuessAction.matchId);
        if (targetRevealed || turnChanged) {
          guessActionRef.current = null;
          guessLockRef.current = false;
          setPendingGuess(null);
          clearTimeout(guessUnlockTimerRef.current);
        }
      }
      const pendingEndTurn = endTurnActionRef.current;
      if (pendingEndTurn) {
        const turnChanged = roomTurnKey(p) !== pendingEndTurn.turnKey || p.phase !== 'playing' || (!!pendingEndTurn.matchId && p.matchId !== pendingEndTurn.matchId);
        if (turnChanged) {
          endTurnActionRef.current = null;
          endTurnLockRef.current = false;
          clearTimeout(endTurnUnlockTimerRef.current);
        }
      }
      clueLifecycleRef.current?.observe(p);
    }
    function onRoomSummaries(p: RoomSummary[]) { setRoomSummaries(p); }
    function onAnalysisState(p: { roomId: string; analysis: import('@acg-codenames/shared').AnalysisPermissions }) {
      setRoom(current => current?.id === p.roomId && current.matchId === p.analysis.matchId ? { ...current, analysis: p.analysis } : current);
    }
    function onError(p: { message: string; code?:string; roomId?:string; action?:string }) {
      // submit_clue has a correlated ACK. Its legacy error broadcast has no
      // requestId, so it must not overwrite this or a later action's feedback.
      if (p.action === 'submit_clue') return;
      const attempt=joinAttemptRef.current;
      // Tabs may own different live rooms while sharing one persisted "last room".
      const activeId=activeRoomIdRef.current??session?.roomId??loadSession()?.roomId??undefined;
      if(p.action==='create_room'||p.action==='create_reveal_guess_room'){
        releaseCreateAttempt();
        pendingCreateConfigRef.current=null;
        setConnectionState(activeId?'ready':'idle');
        const message=`创建新房间失败：${p.message}${activeId?'。你仍留在原房间。':'。'}`;
        if(activeId) setError(message); else setJoinError(message);
        return;
      }
      // A failed attempt to enter another room must never tear down the room we are still in.
      if(p.action==='join_room'||p.action==='join_spectator'||(attempt&&attempt.roomId===(p.roomId??attempt.roomId))){
        releaseJoin();joinAttemptRef.current=null;
        const target=p.roomId??attempt?.roomId;
        if(target&&p.message.includes('房间不存在')){
          invalidateRoomSession(target);
          if(target===activeId){setSession(null);setRoom(null);activeRoomIdRef.current=null;setDidReconnect(false);}
        }
        setJoinError(target?`无法加入房间 ${target}：${p.message}。${activeId?'你仍留在原房间。':'可返回大厅重试。'}`:`无法加入房间：${p.message}`);
        setConnectionState(activeRoomIdRef.current?'ready':'idle');
        if(activeId&&activeId!==target)setError('');
        return;
      }
      releaseJoin();
      if(p.code==='ROOM_RECOVERY_FAILED') {
        const id=p.roomId??recoveryAttempt.current?.roomId;
        // A late recovery failure for room A must never disturb a successfully joined room B.
        if(id&&activeId&&id!==activeId){
          removeRecoverableSession(id);
          if(recoveryAttempt.current?.roomId===id)recoveryAttempt.current=null;
          return;
        }
        const recoveringCurrent=!!id&&id===activeId;
        if(id)invalidateRoomSession(id);
        const wasInGame=recoveringCurrent&&(room?.phase==='playing'||room?.phase==='finished');
        if(recoveringCurrent){
          clearSession(id);setSession(null);setRoom(null);activeRoomIdRef.current=null;setDidReconnect(false);
        }
        const attemptRef=recoveryAttempt.current;recoveryAttempt.current=null;
        if(id&&attemptRef?.retry&&!p.message.includes('身份')&&!p.message.includes('房间不存在')) {
          const ji=buildJoinProfile();
          if(ji){socket.emit('join_room',{roomId:id,identityKey:privateIdentityKey(),nickname:ji.nickname,profile:{accountType:ji.profile.mode,username:ji.profile.mode==='named'?ji.profile.username:null,avatarUrl:ji.profile.avatarUrl,userSessionToken:ji.profile.userSessionToken}});return;}
        }
        setConnectionState('idle');
        if(wasInGame){setLostRoom({roomId:id!,message:`房间 ${id} 已结束或已无法恢复：${p.message}`});setError('');return;}
        if(id&&!activeId){setJoinError(`邀请的房间 ${id} 已失效：${p.message}`);return;}
        setError('');
        return;
      }
      if (p.message.includes("重连凭证") || p.message.includes("房间不存在")) {
        const currentRoomId = activeId;
        if (!currentRoomId) {
          // Background cleanup on the lobby page must stay silent.
          if(p.roomId)removeRecoverableSession(p.roomId);
          setError('');return;
        }
        if(p.roomId&&p.roomId!==currentRoomId){invalidateRoomSession(p.roomId);setError('');return;}
        invalidateRoomSession(currentRoomId);
        const wasInGame=room?.phase==='playing'||room?.phase==='finished';
        clearSession(currentRoomId);setSession(null);setRoom(null);setConnectionState("idle");setDidReconnect(false);setRevealBanner(null);
        activeRoomIdRef.current = null;
        if(wasInGame){setLostRoom({roomId:currentRoomId,message:'当前房间已结束或已解散，本局无法继续。'});setError('');}
        else setJoinError(`房间 ${currentRoomId} 已失效：${p.message}`);
        return;
      }
      setError(p.message); setConnectionState("ready");
    }
    function onRoomClosed(p: { roomId: string; reason: string }) {
      invalidateRoomSession(p.roomId);
      if (p.roomId !== activeRoomIdRef.current) return;
      clueLifecycleRef.current?.cancel();
      setSession(null); setRoom(null); setConnectionState("idle"); setDidReconnect(false); setRevealBanner(null); setError(p.reason); activeRoomIdRef.current = null;
    }
    const onConnect=()=>{wireState=null;socket.emit("enable_room_deltas");if(!loadSession()&&!joinLockRef.current)setConnectionState('idle');};
    socket.on('connect',onConnect);
    socket.on("session", onSession);
    socket.on("room_state", onRoomState);
    socket.on("room_state_delta", onDelta);
    socket.emit("enable_room_deltas");
    socket.on('analysis_state', onAnalysisState);
    socket.on("room_summaries", onRoomSummaries);
    socket.on("error_message", onError);
    socket.on("room_closed", onRoomClosed);
    socket.io.on("reconnect", () => { if (session) { setConnectionState("connecting"); recoveryAttempt.current={roomId:session.roomId,retry:true};socket.emit("reconnect_room", { roomId: session.roomId, sessionToken: session.sessionToken,identityKey:privateIdentityKey() }); } });
    socket.on("disconnect", () => setConnectionState("connecting"));
    return () => { socket.off('connect',onConnect);socket.off('analysis_state', onAnalysisState); socket.off("session", onSession); socket.off("room_state", onRoomState); socket.off("room_state_delta", onDelta); socket.off("room_summaries", onRoomSummaries); socket.off("error_message", onError); socket.off("room_closed", onRoomClosed); socket.io.off("reconnect"); socket.off("disconnect"); };
  }, [session?.roomId, socket]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && activeRoomIdRef.current) {
        socket.emit('sync_room_state', { roomId: activeRoomIdRef.current });
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [socket]);

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
    const gate = new MatchNotifications();
    type Notice = {kind:'highlight'; value:RoundHighlight} | {kind:'achievement'; value:AchievementUnlockPayload};
    const queue: Notice[] = [];
    let timer: number | undefined;
    const display = () => {
      const next = queue.shift();
      setHighlightToast(null); setAchievementToast(null);
      if (!next) {timer=undefined;return;}
      const p=next.value, scope=notificationScope.current;
      if (!scope || p.roomId!==scope.roomId || p.matchId!==scope.matchId || (p.roundIndex??0)<scope.latestTurn) {display();return;}
      if(next.kind==='highlight')setHighlightToast(next.value);else setAchievementToast(next.value);
      timer=window.setTimeout(display,1400);
    };
    const receive=(notice:Notice)=>{
      if(notice.value.roomId!==activeRoomIdRef.current)return;
      const result=gate.receive(notice.kind,notice.value,notificationScope.current);
      if(!result)return;
      if(notice.kind==='highlight')setRoundHighlights(prev=>[...prev,notice.value]);
      else setRoundAchievements(prev=>[...prev,notice.value]);
      if(result.toast){queue.push(notice);if(timer===undefined)display();}
    };
    const highlight=(value:RoundHighlight)=>receive({kind:'highlight',value});
    const achievement=(value:AchievementUnlockPayload)=>receive({kind:'achievement',value});
    socket.on('round_highlight',highlight);socket.on('achievement_unlock',achievement);
    return()=>{window.clearTimeout(timer);socket.off('round_highlight',highlight);socket.off('achievement_unlock',achievement);};
  }, [socket]);

  useEffect(() => {
    if (!session || didReconnect || room) return;
    if (freshSessionRef.current) {
      freshSessionRef.current = false;
      return;
    }
    setDidReconnect(true);
    setConnectionState("connecting");
    recoveryAttempt.current={roomId:session.roomId,retry:true};
    socket.emit("reconnect_room", { roomId: session.roomId, sessionToken: session.sessionToken,identityKey:privateIdentityKey() });
  }, [didReconnect, room, session, socket]);

  useEffect(() => {
    if (!session || !room || !pendingCreateConfigRef.current) return;
    const hostPlayer = room.players.find((p) => p.id === session.participantId);
    if (!hostPlayer?.isHost || room.phase !== "lobby") return;
    const pending = pendingCreateConfigRef.current;
    pendingCreateConfigRef.current = null;
    if (pending.variant === 'anime') { socket.emit('plan_action',{roomId:session.roomId,kind:'configure',variant:'anime',boardMode:pending.boardMode}); return; }
    socket.emit("update_room_settings", { roomId: session.roomId, boardMode: pending.boardMode, builtinWordPackId: pending.builtinWordPackId, customWordPack: pending.customWordPack, scoringMode: pending.scoringMode, timerMode: pending.timerMode, timerClueSeconds: pending.timerClueSeconds, timerGuessSeconds: pending.timerGuessSeconds, neutralCount: pending.neutralCount, flipMode: pending.flipMode });
  }, [room, session, socket]);
  useEffect(() => { setTransferHostTargetId((cur) => { if (cur && hostTransferCandidates.some((p) => p.id === cur)) return cur; return hostTransferCandidates[0]?.id ?? ""; }); }, [hostTransferCandidates]);
  useEffect(() => {
    const reveal = room?.lastReveal; if (!reveal || reveal.id === lastRevealIdRef.current) return;
    lastRevealIdRef.current = reveal.id;
    setRevealBanner(reveal); setRevealingCardIds((prev) => new Set(prev).add(reveal.cardId));
    if (soundEnabledRef.current) {
      if (reveal.outcome === "own-hit") playOwnHit(); else if (reveal.outcome === "opponent-hit") playOpponentHit(); else if (reveal.outcome === "neutral-hit") playNeutralHit(); else if (reveal.outcome === "assassin-hit") playAssassinHit();
    }
    const t = window.setTimeout(() => setRevealingCardIds((prev) => { const n = new Set(prev); n.delete(reveal.cardId); return n; }), 520);
    return () => window.clearTimeout(t);
  }, [room?.lastReveal]);
  useEffect(() => {
    if (!pendingGuess || !room) return;
    const action = guessActionRef.current;
    if (!action) return;
    const guessed = room.board.find((c) => c.id === pendingGuess);
    const turnChanged = roomTurnKey(room) !== action.turnKey || room.phase !== 'playing';
    if (guessed?.revealed || turnChanged) {
      guessActionRef.current = null;
      setPendingGuess(null);
      guessLockRef.current = false;
      clearTimeout(guessUnlockTimerRef.current);
    }
  }, [pendingGuess, room]);
  useEffect(() => {
    if (room?.phase === "finished" && room.winner && soundEnabledRef.current) playVictory();
  }, [room?.phase, room?.winner]);
  useEffect(() => { if (room?.phase === "playing" && room.roundNumber && soundEnabledRef.current) playGameStart(); }, [room?.phase, room?.roundNumber]);
  useEffect(() => {
    if(!room)return;
    const previous=seenMessageIds.current;
    const sameRoom=previous.roomId===room.id;
    const incoming=sameRoom?room.messages.filter(m=>!previous.ids.has(m.id)):[];
    seenMessageIds.current={roomId:room.id,ids:new Set(room.messages.map(m=>m.id))};
    if(!sameRoom){scrollPositions.current={chat:0,battle:0};stickToChatBottomRef.current=true;stickToBattleBottomRef.current=true;setChatUnread(0);setBattleUnread(0);}
    for(const kind of ['chat','battle'] as const){
      const list=kind==='chat'?chatListRef.current:battleListRef.current;
      const stick=kind==='chat'?stickToChatBottomRef:stickToBattleBottomRef;
      const setUnread=kind==='chat'?setChatUnread:setBattleUnread;
      const count=incoming.filter(m=>kind==='battle'?m.type==='system':m.type==='chat'||m.type==='reaction').length;
      if(sideTab===kind&&list&&list.getClientRects().length){
        list.scrollTop=stick.current?list.scrollHeight:scrollPositions.current[kind];
        if(stick.current)setUnread(0);else if(count)setUnread(n=>n+count);
      }else if(count)setUnread(n=>n+count);
    }
  }, [room?.messages,room?.id,sideTab,mobileRoomTab]);
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
    const username = typeof identity.username === "string" ? identity.username.trim() : "";
    if (!username) {
      // Corrupted local identity (e.g. written before response validation was added):
      // clear it instead of retrying username-less logins (server replies "username 参数无效").
      clearIdentity(); _setIdentity(null); setNamedAccount(null);
      setError("本地登录信息已失效，请重新登录");
      return;
    }
    // A successful interactive login already supplied this account and session.
    // Do not log in twice and consume the shared login rate budget on every entry.
    if (namedAccount?.username === username && identity.userSessionToken) return;
    void loginNamedUser({ username }).then((account) => {
      if(loadIdentity()?.username!==username)return;
      if (!account || typeof account.username !== "string" || !account.username.trim()) {
        throw new Error("登录响应无效，请重试");
      }
      setNamedAccount(account);
      const ni: LocalIdentity = { mode: "named", username: account.username, nickname: account.username, avatarUrl: account.avatarUrl, userSessionToken: account.sessionToken };
      _setIdentity(ni); saveIdentity(ni); setRecentUsers(loadRecentUsernames());
    }).catch((e) => setError(e instanceof Error ? e.message : "加载账户失败"));
  }, [identity?.mode, identity?.username]);
  useEffect(() => { void refreshPublicPacks(); void refreshPublicImagePacks(); }, []);

  // ─── handlers ──────────────────────────────────────
  async function handleNamedLogin(usernameOverride?: string) {
    const username = (usernameOverride ?? namedUsernameInput).trim();
    if (!username) { setError("请输入用户名"); return; }
    try {
      const account = await loginNamedUser({ username });
      if (!account || typeof account.username !== "string" || !account.username.trim()) {
        throw new Error("登录响应无效，请重试");
      }
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

  async function updateTitle(title: string | null) {
    if (identity?.mode === 'named' && namedAccount) {
      const updated = await updateNamedUser(namedAccount.username, requireNamedUserSessionToken(identity), { title });
      setNamedAccount(updated);
      return;
    }
    const key = `cipai.title:${privateIdentityKey()}`;
    if (title) localStorage.setItem(key, title); else localStorage.removeItem(key);
  }

  async function handleAvatarUpload(file: File | null) {
    if (!namedAccount || !file) return;
    try {
      const avatarUrl = await imageFileToAvatarDataUrl(file);
      const updated = await updateNamedUser(namedAccount.username, requireNamedUserSessionToken(identity), { avatarUrl });
      if (!updated || typeof updated.username !== "string" || !updated.username.trim()) {
        throw new Error("更新响应无效，请重试");
      }
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

  async function refreshPublicImagePacks() {
    try {
      const packs = await listPublicImagePacks(); setPublicImagePacks(packs);
    } catch (e) { setError(e instanceof Error ? e.message : "公开图库加载失败"); }
  }

  async function fetchPublicPackDetail(publicId: string): Promise<PublicWordPack | null> {
    try {
      return await getPublicWordPackDetail(publicId);
    } catch (e) { setError(e instanceof Error ? e.message : "加载题库详情失败"); return null; }
  }

  async function fetchPublicImagePackDetail(publicId: string): Promise<PublicImagePack | null> {
    try {
      return await getPublicImagePackDetail(publicId);
    } catch (e) { setError(e instanceof Error ? e.message : "加载图库详情失败"); return null; }
  }

  async function saveAccountImagePacksInternal(nextPacks: SavedImagePack[]) {
    if (!namedAccount) throw new Error("请先使用用户名登录");
    const prev = namedAccount;
    setNamedAccount({ ...namedAccount, customImagePacks: nextPacks, updatedAt: Date.now() });
    try {
      const updated = await updateNamedUser(namedAccount.username, requireNamedUserSessionToken(identity), { customImagePacks: nextPacks });
      setNamedAccount({ ...updated, customImagePacks: updated.customImagePacks.length > 0 ? updated.customImagePacks : nextPacks });
    } catch (e) { setNamedAccount(prev); setError(e instanceof Error ? e.message : "保存图库失败"); throw e; }
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

  async function editAccountPack(packId: string, name: string, entries: string) {
    if (!namedAccount) { setError("请先使用用户名登录"); return; }
    const trimmedName = name.trim();
    if (!trimmedName) { setError("请输入题库名称"); return; }
    const parsed = parsePackEntries(entries);
    await saveAccountPacksInternal(namedAccount.customWordPacks.map((p) => {
      if (p.id !== packId) return p;
      return { ...p, name: trimmedName, entries: parsed, updatedAt: Date.now() };
    }));
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

  // ── Image Pack CRUD ──

  async function addAccountImagePack(name: string, entries: { url: string; label: string }[]) {
    if (!namedAccount) { setError("请先使用用户名登录后再创建图库"); return; }
    try {
      const ts = Date.now();
      const pack: SavedImagePack = {
        id: genId(), name, entries: entries.map(e => ({ id: genId(), url: e.url, label: e.label })),
        createdAt: ts, updatedAt: ts,
      };
      await saveAccountImagePacksInternal([...namedAccount.customImagePacks, pack]);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "创建图库失败"); }
  }

  async function editAccountImagePack(packId: string, name: string, entries: { url: string; label: string }[]) {
    if (!namedAccount) { setError("请先登录"); return; }
    await saveAccountImagePacksInternal(namedAccount.customImagePacks.map(p => {
      if (p.id !== packId) return p;
      return { ...p, name, entries: entries.map(e => ({ id: e.url, url: e.url, label: e.label })), updatedAt: Date.now() };
    }));
  }

  async function removeAccountImagePack(packId: string) {
    if (!namedAccount) { setError("请先登录"); return; }
    await saveAccountImagePacksInternal(namedAccount.customImagePacks.filter(p => p.id !== packId));
  }

  async function toggleAccountImagePackPublic(packId: string) {
    if (!namedAccount) { setError("请先登录"); return; }
    const ts = Date.now();
    try {
      await saveAccountImagePacksInternal(namedAccount.customImagePacks.map((p) => {
        if (p.id !== packId) return p;
        const nextIsPublic = p.isPublic !== true;
        return { ...p, isPublic: nextIsPublic, publishedAt: nextIsPublic ? p.publishedAt ?? ts : undefined, updatedAt: ts };
      }));
    } catch (e) { setError(e instanceof Error ? e.message : "更新图库公开状态失败"); }
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

  function beginCreateRoom(emit: () => void, pendingConfig: typeof pendingCreateConfigRef.current) {
    const stored = session?.roomId===activeRoomIdRef.current?session:loadSession();
    createAttemptRef.current = { previousRoomId: stored?.roomId, previousPhase: room?.phase, previousToken: stored?.sessionToken };
    pendingCreateConfigRef.current = pendingConfig;
    navigateAfterSession.current = true;
    setConnectionState("connecting"); setError(""); setJoinError(""); setLostRoom(null);
    clearTimeout(createTimerRef.current);
    createTimerRef.current = setTimeout(() => {
      const active = loadSession()?.roomId ?? activeRoomIdRef.current;
      createAttemptRef.current = null;
      pendingCreateConfigRef.current = null;
      navigateAfterSession.current = false;
      setConnectionState(active ? "ready" : "idle");
      setError(`创建房间未确认：请检查网络后重试。${active ? '你仍留在原房间。' : ''}`);
    }, 12000);
    emit();
  }

  function createRoom(defaults = false, variant: 'classic'|'anime' = 'classic') {
    const ji = buildJoinProfile(); if (!ji) return;

    if (!defaults && packSource === "public" && selectedPublicPack) {
      setError("正在加载题库详情...");
      fetchPublicPackDetail(selectedPublicPack.publicId).then((pack) => {
        if (!pack) return;
        createRoomWithEntries(pack.name, pack.entries);
      });
      return;
    }
    if(session){if(!window.confirm('创建新房间将切换到新房间；失败会保留当前房间，继续？'))return;}
    const pending: { boardMode: BoardMode; builtinWordPackId?: string; customWordPack?: { name: string; entries: string[] }; scoringMode?: ScoringMode; timerMode?: import("@acg-codenames/shared").TimerMode; timerClueSeconds?: number; timerGuessSeconds?: number; neutralCount?: number | null; flipMode?: import("@acg-codenames/shared").FlipMode } = { boardMode: createBoardMode, scoringMode, timerMode: createTimerMode, timerClueSeconds: createTimerClueSeconds, timerGuessSeconds: createTimerGuessSeconds, neutralCount: createNeutralCount === 0 ? null : createNeutralCount, flipMode: createFlipMode };
    if (packSource === "builtin") pending.builtinWordPackId = selectedBuiltinPackId;
    else if (selectedAccountPack) pending.customWordPack = { name: selectedAccountPack.name, entries: selectedAccountPack.entries };
    beginCreateRoom(() => socket.emit("create_room", { identityKey: privateIdentityKey(), nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined } }), variant === 'anime' ? { boardMode: '5x5', variant } : defaults ? null : pending);
  }

  function createRoomWithEntries(packName: string, packEntries: string[]) {
    const ji = buildJoinProfile(); if (!ji) return;
    if(session){if(!window.confirm('创建新房间将切换到新房间；失败会保留当前房间，继续？'))return;}
    const pending: { boardMode: BoardMode; builtinWordPackId?: string; customWordPack?: { name: string; entries: string[] }; scoringMode?: ScoringMode; timerMode?: import("@acg-codenames/shared").TimerMode; timerClueSeconds?: number; timerGuessSeconds?: number; neutralCount?: number | null; flipMode?: import("@acg-codenames/shared").FlipMode } = { boardMode: createBoardMode, scoringMode, timerMode: createTimerMode, timerClueSeconds: createTimerClueSeconds, timerGuessSeconds: createTimerGuessSeconds, neutralCount: createNeutralCount === 0 ? null : createNeutralCount, flipMode: createFlipMode };
    pending.customWordPack = { name: packName, entries: packEntries };
    beginCreateRoom(() => socket.emit("create_room", { identityKey: privateIdentityKey(), nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined } }), pending);
  }

  function createRevealGuessRoom(settings?: Partial<RevealGuessSettings>, initialPuzzle?: { imageUrl: string; answer: string; aliases?: string[]; hints?: string[] }) {
    const ji = buildJoinProfile(); if (!ji) return;
    if(session){if(!window.confirm('创建新房间将切换到新房间；失败会保留当前房间，继续？'))return;}
    beginCreateRoom(() => socket.emit("create_reveal_guess_room", {
      identityKey:privateIdentityKey(),
      nickname: ji.nickname,
      profile: {
        accountType: ji.profile.mode,
        username: ji.profile.mode === "named" ? ji.profile.username : null,
        avatarUrl: ji.profile.avatarUrl,
        userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined
      },
      settings,
      initialPuzzle
    }), null);
  }

  function joinSpecificRoom(roomId: string, asSpectator: boolean) {
    if(joinLockRef.current)return;
    const target=normalizeRoomCode(roomId);
    const ji = buildJoinProfile(); if (!ji) return;
    const storedSession=session?.roomId===activeRoomIdRef.current?session:loadSession();
    const enteringPlayerSeat=storedSession?.roomId===target&&storedSession.participantType==='spectator'&&!asSpectator;
    if(storedSession&&storedSession.roomId===target&&!enteringPlayerSeat){
      // Returning to the seat we already own must not create a duplicate player.
      setConnectionState("connecting");setError("");setJoinError("");
      recoveryAttempt.current={roomId:target,retry:false};
      navigateAfterSession.current=true;
      socket.emit('reconnect_room',{roomId:target,sessionToken:storedSession.sessionToken,identityKey:privateIdentityKey()});
      return;
    }
    const previousRoomId=storedSession?.roomId;
    joinAttemptRef.current={roomId:target,spectator:asSpectator,previousRoomId,previousPhase:room?.phase,previousToken:storedSession?.sessionToken};
    setConnectionState("connecting"); setError(""); setJoinError(""); setLostRoom(null);
    joinLockRef.current=true;
    clearTimeout(joinTimerRef.current);
    joinTimerRef.current=setTimeout(()=>{
      releaseJoin();joinAttemptRef.current=null;navigateAfterSession.current=false;
      setConnectionState(activeRoomIdRef.current?'ready':'idle');
      setJoinError(`加入房间 ${target} 超时，请检查网络或房号。${activeRoomIdRef.current?'你仍留在原房间，可稍后重试。':'可返回大厅重试。'}`);
    },12000);
    navigateAfterSession.current=true;
    const saved=loadRecoverableSessions()[target];
    const token=storedSession?.roomId===target?storedSession.sessionToken:saved?.sessionToken;
    if(!asSpectator&&token&&!enteringPlayerSeat){recoveryAttempt.current={roomId:target,retry:false};socket.emit('reconnect_room',{roomId:target,sessionToken:token,identityKey:privateIdentityKey()});return;}
    recoveryAttempt.current=null;
    const payload = { identityKey: privateIdentityKey(), roomId: target, nickname: ji.nickname, profile: { accountType: ji.profile.mode, username: ji.profile.mode === "named" ? ji.profile.username : null, avatarUrl: ji.profile.avatarUrl, userSessionToken: ji.profile.mode === "named" ? ji.profile.userSessionToken : undefined }, sessionToken: undefined };
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
  function randomizeTeams(mode: 'all'|'keep-captains' = 'all') { if (session) socket.emit('randomize_teams', { roomId: session.roomId, mode }); }
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
    if (!session || !room || room.id !== session.roomId || activeRoomIdRef.current !== room.id || connectionState !== 'ready' || !viewer?.canSubmitClue || !clueWord.trim() || clueLifecycleRef.current?.pending) return;
    const count = Number(clueCountInput);
    if (!Number.isInteger(count) || count < MIN_CLUE_COUNT || count > MAX_CLUE_COUNT) {
      setActionError('clue', `提示数量无效，请输入 ${MIN_CLUE_COUNT}-${MAX_CLUE_COUNT} 的整数`);
      return;
    }
    const word=clueWord.trim(), requestId=genId();
    const started = clueLifecycleRef.current!.start({
      requestId, roomId:room.id, matchId:room.matchId, roundNumber:room.roundNumber,
      turnVersion:roomTurnKey(room), roomVersion:room.updatedAt, team:room.currentTeam,
      giverPlayerId:session.participantId, recordCount:room.clueRecords?.length ?? 0,
      word, count, draftRevision:clueDraftRevisionRef.current
    });
    if (!started) return;
    socket.emit("submit_clue", { roomId: session.roomId, word, count, requestId }, result => {
      if (activeRoomIdRef.current !== session.roomId) return;
      clueLifecycleRef.current?.acknowledge(requestId, result);
    });
    if (soundEnabled) playSubmitClue();
  }
  function retryClue() {
    if (connectionState !== 'ready' || clueLifecycleRef.current?.pending?.roomId !== activeRoomIdRef.current) return;
    const request = clueLifecycleRef.current?.retry();
    if (!request) return;
    // Reuse the exact requestId and payload. Server idempotency makes this safe
    // even if the original action was accepted but every confirmation was lost.
    socket.emit('submit_clue', {roomId:request.roomId,requestId:request.requestId,word:request.word,count:request.count}, result => {
      if (activeRoomIdRef.current === request.roomId) clueLifecycleRef.current?.acknowledge(request.requestId, result);
    });
  }
  function guessCard(cardId: string) {
    if (!session || !viewer?.canGuess || guessLockRef.current) return;
    const requestId=genId();
    const turnKey=room?roomTurnKey(room):'';
    guessActionRef.current={requestId,cardId,turnKey,matchId:room?.matchId};
    guessLockRef.current = true; setPendingGuess(cardId); clearActionError('guess');
    let settled=false;
    const timer=setTimeout(()=>{
      if(settled)return;settled=true;guessActionRef.current=null;guessLockRef.current=false;setPendingGuess(null);
      setActionError('guess','猜牌未确认：已同步最新棋盘，请确认后再操作，重复点击不会重复翻牌。');
      socket.emit('sync_room_state',{roomId:session.roomId});
    },9000);
    guessUnlockTimerRef.current=timer;
    socket.emit("guess_card", { roomId: session.roomId, cardId, requestId }, result => {
      if(settled)return;settled=true;clearTimeout(timer);
      if(!result?.ok){
        guessActionRef.current=null;guessLockRef.current=false;setPendingGuess(null);
        setActionError('guess',`猜牌未完成：${result?.message??'服务器拒绝'}`);
        return;
      }
      guessActionRef.current=null;guessLockRef.current=false;setPendingGuess(null);clearActionError('guess');
    });
  }
  function endTurn() {
    if (!session || !viewer?.canEndTurn || endTurnLockRef.current) return;
    const requestId=genId();
    endTurnActionRef.current={requestId,turnKey:room?roomTurnKey(room):'',matchId:room?.matchId};
    endTurnLockRef.current = true; setActionStatus('正在结束回合…'); clearActionError('endTurn');
    let settled=false;
    const timer=setTimeout(()=>{
      if(settled)return;settled=true;endTurnActionRef.current=null;endTurnLockRef.current=false;setActionStatus('');
      setActionError('endTurn','结束回合未确认：已同步最新局面。');
      socket.emit('sync_room_state',{roomId:session.roomId});
    },9000);
    endTurnUnlockTimerRef.current=timer;
    socket.emit('end_turn',{roomId:session.roomId,requestId},result=>{
      if(settled)return;settled=true;clearTimeout(timer);endTurnActionRef.current=null;endTurnLockRef.current=false;setActionStatus('');
      if(!result?.ok)setActionError('endTurn',`结束回合未完成：${result?.message??'服务器拒绝'}`);
      else { clearActionError('endTurn'); if (soundEnabled) playEndTurn(); }
    });
  }
  function hostTakeover(kind: 'request'|'approve'|'reject'|'cancel') {
    if(!session)return;
    socket.emit('host_takeover',{roomId:session.roomId,kind},result=>{
      if(!result?.ok)setError(result?.message??'社长接任未完成');
      else setError('');
    });
  }
  function syncRoomState() {
    if(session)socket.emit('sync_room_state',{roomId:session.roomId});
  }
  function resumeTimerFunc() { if (session) { socket.emit("resume_timer", { roomId: session.roomId }); } }
  const chatSendLockRef = useRef(false);
  const chatRetryRef = useRef<{text:string;requestId:string}|null>(null);
  function sendText(text:string) {
    if (!session || !text.trim() || chatSendLockRef.current) return;
    if(!socket.connected){setChatError('连接已断开，恢复后可重试。');return;}
    chatSendLockRef.current=true;setChatPending(true);setChatError('');
    const attempt=chatRetryRef.current?.text===text?chatRetryRef.current:{text,requestId:genId()};
    chatRetryRef.current=attempt;
    const timer=setTimeout(()=>{chatSendLockRef.current=false;setChatPending(false);setChatError('发送未确认，请重试；同一条消息不会重复发送。');},8000);
    socket.emit('send_chat_message',{roomId:session.roomId,text,requestId:attempt.requestId},result=>{
      clearTimeout(timer);chatSendLockRef.current=false;setChatPending(false);
      if(!result.ok){setChatError(result.message??'发送失败，请重试。');return;}
      chatRetryRef.current=null;setChatError('');setChatText(current=>current.trim()===text?'':current);
    });
  }
  function sendChatMessage(){sendText(chatText.trim());}
  function sendQuickPhrase(text:string){sendText(text);}
  function sendReaction(reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType) {
    if (!session) return;
    socket.emit("send_reaction", { roomId: session.roomId, reaction, targetParticipantId, targetParticipantType });
    if (soundEnabledRef.current) playClick();
  }
  function leaveRoom() {
    clueLifecycleRef.current?.cancel();
    if (session) {
      const isPlaying = room?.phase === "playing" || room?.phase === "finished";
      if (isPlaying) {
        const recoverable = loadRecoverableSessions();
        recoverable[session.roomId] = {
          sessionToken: session.sessionToken,
          participantType: session.participantType,
          savedAt: Date.now()
        };
        saveRecoverableSessions(recoverable);
      } else {
        removeRecoverableSession(session.roomId);
      }
      socket.emit("leave_room", { roomId: session.roomId, sessionToken: session.sessionToken,identityKey:privateIdentityKey() });
    }
    if(session)clearSession(session.roomId);
    setSession(null); setRoom(null); setConnectionState("idle"); setDidReconnect(false); setRevealBanner(null); setDanmakuQueue([]); setRoundHighlights([]); setRoundAchievements([]); setHighlightToast(null); setAchievementToast(null); setError(""); setJoinError(""); setLostRoom(null); setActionStatus(""); activeRoomIdRef.current = null;
    clueLifecycleRef.current?.cancel();guessActionRef.current=null;endTurnActionRef.current=null;guessLockRef.current=false;endTurnLockRef.current=false;setPendingGuess(null);scopedErrorRef.current=null;
    clearTimeout(guessUnlockTimerRef.current);clearTimeout(endTurnUnlockTimerRef.current);
  }
  function logoutNamedUser() {
    const prevIdentity = identity;
    socket.disconnect();socket.connect();
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
  const gameMode = room?.gameMode;
  const gameLabel = gameMode === "reveal-guess" ? "揭幕猜番" : "词牌模式";
  const specLabel = gameMode === "reveal-guess" ? "9x9" : (room?.settings?.boardMode ?? "");
  const inviteText = session ? `词牌结社好友局 ${session.roomId}（${gameLabel} · ${specLabel}）:\n${window.location.origin}/?room=${session.roomId}` : "";

  async function copyLink() {
    if (!inviteText) return;
    const ok = await copyText(inviteText);
    if (ok) {
      setCopyFail(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } else {
      setCopied(false);
      setError("复制失败，请手动复制: " + inviteText);
    }
  }
  function handleChatScroll() { const list=chatListRef.current;if(!list)return;const near=list.scrollHeight-list.scrollTop-list.clientHeight<24;stickToChatBottomRef.current=near;scrollPositions.current.chat=list.scrollTop;if(near)setChatUnread(0); }
  function handleBattleScroll() { const list=battleListRef.current;if(!list)return;const near=list.scrollHeight-list.scrollTop-list.clientHeight<24;stickToBattleBottomRef.current=near;scrollPositions.current.battle=list.scrollTop;if(near)setBattleUnread(0); }
  function scrollChatToBottom() {const list=chatListRef.current;if(!list)return;list.scrollTop=list.scrollHeight;stickToChatBottomRef.current=true;scrollPositions.current.chat=list.scrollTop;setChatUnread(0);}
  function scrollBattleToBottom() {const list=battleListRef.current;if(!list)return;list.scrollTop=list.scrollHeight;stickToBattleBottomRef.current=true;scrollPositions.current.battle=list.scrollTop;setBattleUnread(0);}
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
    handleNamedLogin, continueAsGuest, handleAvatarUpload, updateTitle,
    createRoom, joinByRoomCode, joinSpecificRoom, leaveRoom, logoutNamedUser,
    createRevealGuessRoom,
    refreshPublicPacks, fetchPublicPackDetail, addAccountPack, importAccountPack, editAccountPack, removeAccountPack, toggleAccountPackPublic, chooseAccountPackForCreate,
    savedPackName, setSavedPackName, savedPackEntries, setSavedPackEntries,
    accountImagePacks,
    publicImagePacks, refreshPublicImagePacks, fetchPublicImagePackDetail,
    addAccountImagePack, editAccountImagePack, removeAccountImagePack, toggleAccountImagePackPublic,
    candidatePack, setCandidatePack, updateCandidateEntry, bulkSetVisibleEntries, exportCandidateAsPlayable, resetCandidateReview,
    transferHostTargetId, setTransferHostTargetId, hostTransferCandidates,
    roomCode, setRoomCode, isLobby, isFinished, viewer, self, inviteLink, boardColumns,
    chooseTeam, chooseRole, randomizeTeams, updateBoardMode, updateScoringMode, updateBuiltinPack,
    uploadRoomPack, useAccountPackForRoom, usePublicPackForRoom,
    startGame, restartGame, returnToLobby, transferHost, disbandRoom, forceEndGame,
    queueForNextRound, cancelQueueJoin, debugFillRoom,
    submitClue, cluePending, clueSyncing, retryClue, guessCard, endTurn, resumeTimer: resumeTimerFunc, hostTakeover, syncRoomState, joinError, clearJoinError: () => setJoinError(''), lostRoom, actionStatus, sendChatMessage, sendQuickPhrase, sendReaction, copyLink,
    clueWord, setClueWord, clueCountInput, setClueCountInput,
    chatText, setChatText, danmakuQueue, showDanmaku: showDanmakuRaw, setShowDanmaku,
    roundHighlights, roundAchievements, highlightToast, achievementToast,
    copied, focusMode, setFocusMode,
    enterFocusMode, exitFocusMode,
    soundEnabled, setSoundEnabled: handleSetSoundEnabled,
    sideTab, setSideTab, jumpToLatest, chatUnread, battleUnread, chatPending, chatError, scrollBattleToBottom,
    mobileRoomTab, setMobileRoomTab,
    chatListRef, battleListRef, handleChatScroll, handleBattleScroll, scrollChatToBottom,
    revealBanner, reactionEffects, pendingGuess, revealingCardIds,
    maskSpymasterHints, setMaskSpymasterHints,
    globalReaction, reactionQueue,
    collapsedSections, setCollapsedSections, toggleSection,
    canSeeHiddenRoles, showSpymasterHints, stickToChatBottomRef, stickToBattleBottomRef, isDebugController,
    renderHint, boardModes, ROOM_ID_LENGTH, makePublicPackKey,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
