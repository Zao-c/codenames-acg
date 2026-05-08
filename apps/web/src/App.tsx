﻿import { useEffect, useMemo, useRef, useState } from "react";
import {
  BOARD_MODE_CONFIG,
  PLAYER_ROLE_LABELS,
  TEAM_LABELS,
  wordPackSummaries,
  type BoardMode,
  type CandidateEntry,
  type CandidatePack,
  type CardRole,
  type ChatMessage,
  type ChatReaction,
  type ClientSession,
  type JoinRequest,
  type NamedUserAccount,
  type ParticipantType,
  type PublicCard,
  type PublicPlayer,
  type PublicRoomState,
  type PublicSpectator,
  type PublicWordPack,
  type RevealEvent,
  type RevealOutcome,
  type RoomSummary,
  type SavedWordPack,
  type Team
} from "@acg-codenames/shared";
import { listPublicWordPacks, loginNamedUser, updateNamedUser } from "./lib/api";
import { CandidateReview } from "./lib/CandidateReview";
import { SakuraParticles } from "./lib/SakuraParticles";
import {
  playAssassinHit,
  playEndTurn,
  playGameStart,
  playNeutralHit,
  playOpponentHit,
  playOwnHit,
  playSubmitClue,
  playVictory
} from "./lib/sound";
import {
  defaultExportFilters,
  exportPlayablePack,
  getCandidateEntryIssues,
  parseImportedWordPackText,
  type CandidateExportFilters,
  type ImportedWordPackFile
} from "./lib/word-pack-review";
import { getSocket } from "./lib/socket";
import { clearIdentity, clearSession, loadIdentity, loadRecentUsernames, loadSession, saveIdentity, saveSession, type LocalIdentity } from "./lib/storage";

type ConnectionState = "idle" | "connecting" | "ready";
type PackSource = "builtin" | "account" | "public";
type SideTab = "chat" | "spectators" | "score";
type RoomParticipant = PublicPlayer | PublicSpectator;

const ROOM_ID_LENGTH = 6;
const boardModes: BoardMode[] = ["5x5", "7x7", "9x9"];
const isLocalDebugHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

function updateRoomQuery(roomId: string | null): void {
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set("room", roomId);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState({}, "", url);
}

function parsePackEntries(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
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

        resolve({
          kind: "playable",
          pack: {
            name: file.name.replace(/\.[^.]+$/, ""),
            entries: parsePackEntries(content)
          }
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取题库文件失败"));
    reader.readAsText(file, "utf-8");
  });
}

function makePackId(): string {
  return `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makePublicPackKey(pack: PublicWordPack): string {
  return pack.publicId;
}

function dedupePackEntries(entries: string[]): string[] {
  return Array.from(
    new Set(
      entries
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function isPlayer(participant: RoomParticipant | null): participant is PublicPlayer {
  return Boolean(participant && "team" in participant);
}

function getActionTeamText(targetTeam: Team | null): string {
  if (!targetTeam) {
    return "等待下一步";
  }
  return `${TEAM_LABELS[targetTeam]}正在猜${targetTeam === "red" ? "红色" : "蓝色"}词`;
}

function getCurrentClueText(room: PublicRoomState | null): string {
  if (!room?.clue) {
    return "等待队长发提示";
  }
  return `${room.clue.word} ${room.clue.count}`;
}

function getRoomStageLabel(room: PublicRoomState | null, connectionState: ConnectionState): string {
  if (!room) {
    return connectionState === "connecting" ? "正在连接房间" : "等待进入房间";
  }
  if (room.phase === "lobby") {
    return "准备阶段";
  }
  if (room.phase === "playing") {
    return room.viewer?.targetTeam ? `${TEAM_LABELS[room.viewer.targetTeam]}行动中` : "对局中";
  }
  return room.winner ? `${TEAM_LABELS[room.winner]}获胜` : "本局结束";
}

function getSelfSummary(participant: RoomParticipant | null, room: PublicRoomState | null): string {
  if (!participant || !room?.viewer) {
    return "未加入";
  }
  if (room.viewer.participantType === "spectator" || !isPlayer(participant)) {
    return "旁观";
  }
  const teamLabel = participant.team ? TEAM_LABELS[participant.team] : "未分队";
  return `${teamLabel} / ${PLAYER_ROLE_LABELS[participant.role]}`;
}

function getIdentityProfile(identity: LocalIdentity | null, account: NamedUserAccount | null): LocalIdentity | null {
  if (!identity) {
    return null;
  }
  if (identity.mode === "named" && account) {
    return {
      mode: "named",
      username: account.username,
      nickname: account.username,
      avatarUrl: account.avatarUrl
    };
  }
  return identity;
}

function roleLabelShort(role: CardRole): string {
  switch (role) {
    case "red":
      return "红";
    case "blue":
      return "蓝";
    case "neutral":
      return "中";
    case "assassin":
      return "刺";
    default:
      return "";
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
  if (!context) {
    throw new Error("浏览器不支持头像裁剪");
  }

  const sourceSize = Math.min(image.width, image.height);
  const sourceX = (image.width - sourceSize) / 2;
  const sourceY = (image.height - sourceSize) / 2;
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return canvas.toDataURL("image/webp", 0.9);
}

function App() {
  const socket = useMemo(() => getSocket(), []);
  const [identity, setIdentity] = useState<LocalIdentity | null>(loadIdentity());
  const [recentUsers, setRecentUsers] = useState<string[]>(loadRecentUsernames());
  const [namedAccount, setNamedAccount] = useState<NamedUserAccount | null>(null);
  const [namedUsernameInput, setNamedUsernameInput] = useState(loadIdentity()?.mode === "named" ? loadIdentity()?.username ?? "" : "");
  const [guestNicknameInput, setGuestNicknameInput] = useState(loadIdentity()?.mode === "guest" ? loadIdentity()?.nickname ?? "" : "");
  const [savedPackName, setSavedPackName] = useState("");
  const [savedPackEntries, setSavedPackEntries] = useState("");
  const [candidatePack, setCandidatePack] = useState<CandidatePack | null>(null);
  const [createBoardMode, setCreateBoardMode] = useState<BoardMode>("5x5");
  const [packSource, setPackSource] = useState<PackSource>("builtin");
  const [selectedBuiltinPackId, setSelectedBuiltinPackId] = useState(wordPackSummaries[0]?.id ?? "");
  const [selectedAccountPackId, setSelectedAccountPackId] = useState("");
  const [selectedPublicPackId, setSelectedPublicPackId] = useState("");
  const [transferHostTargetId, setTransferHostTargetId] = useState("");
  const [publicPacks, setPublicPacks] = useState<PublicWordPack[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<ClientSession | null>(loadSession());
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [roomSummaries, setRoomSummaries] = useState<RoomSummary[]>([]);
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [clueWord, setClueWord] = useState("");
  const [clueCount, setClueCount] = useState(2);
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const [didReconnect, setDidReconnect] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("chat");
  const [jumpToLatest, setJumpToLatest] = useState(false);
  const [revealBanner, setRevealBanner] = useState<RevealEvent | null>(null);
  const [reactionEffects, setReactionEffects] = useState<Record<string, ChatReaction>>({});
  const [pendingGuess, setPendingGuess] = useState<string | null>(null);
  const guessLockRef = useRef(false);
  const [revealingCardIds, setRevealingCardIds] = useState<Set<string>>(new Set());
  const [maskSpymasterHints, setMaskSpymasterHints] = useState(false);
  const [showSakura, setShowSakura] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(["待分队"]));
  const [rightPanelPinned, setRightPanelPinned] = useState(false);
  const [leftPanelPinned, setLeftPanelPinned] = useState(false);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const lastRevealIdRef = useRef<string | null>(null);
  const lastReactionIdRef = useRef<string | null>(null);
  const stickToChatBottomRef = useRef(true);
  const pendingCreateConfigRef = useRef<{
    boardMode: BoardMode;
    builtinWordPackId?: string;
    customWordPack?: { name: string; entries: string[] };
  } | null>(null);

  const accountPacks = namedAccount?.customWordPacks ?? [];
  const selectedAccountPack = accountPacks.find((pack) => pack.id === selectedAccountPackId) ?? null;
  const selectedPublicPack = publicPacks.find((pack) => makePublicPackKey(pack) === selectedPublicPackId) ?? null;
  const hostTransferCandidates = room?.players.filter((player) => !player.isBot && player.id !== session?.participantId) ?? [];
  const effectiveIdentity = getIdentityProfile(identity, namedAccount);
  const viewer = room?.viewer ?? null;
  const self =
    room?.players.find((player) => player.id === session?.participantId) ??
    room?.spectators.find((spectator) => spectator.id === session?.participantId) ??
    null;
  const inviteLink = session ? `${window.location.origin}?room=${session.roomId}` : "";
  const isLobby = room?.phase === "lobby";
  const isFinished = room?.phase === "finished";
  const isDebugController = Boolean(isLocalDebugHost && viewer?.isDebugController);
  const canSeeHiddenRoles = Boolean(viewer && (viewer.role === "spymaster" || viewer.isDebugController));
  const showSpymasterHints = canSeeHiddenRoles && !maskSpymasterHints;
  const boardColumns = room ? BOARD_MODE_CONFIG[room.settings.boardMode].columns : 5;

  useEffect(() => {
    function onSession(payload: ClientSession): void {
      setSession(payload);
      saveSession(payload);
      setConnectionState("ready");
      setError("");
    }

    function onRoomState(payload: PublicRoomState): void {
      setRoom(payload);
      setConnectionState("ready");
      setError("");
      setPendingGuess(null);
      guessLockRef.current = false;
    }

    function onRoomSummaries(payload: RoomSummary[]): void {
      setRoomSummaries(payload);
    }

    function onError(payload: { message: string }): void {
      setError(payload.message);
      setConnectionState("ready");
      setPendingGuess(null);
      guessLockRef.current = false;
    }

    function onRoomClosed(payload: { roomId: string; reason: string }): void {
      if (payload.roomId !== session?.roomId) {
        return;
      }
      clearSession();
      setSession(null);
      setRoom(null);
      setConnectionState("idle");
      setDidReconnect(false);
      setRevealBanner(null);
      setError(payload.reason);
      updateRoomQuery(null);
    }

    socket.on("session", onSession);
    socket.on("room_state", onRoomState);
    socket.on("room_summaries", onRoomSummaries);
    socket.on("error_message", onError);
    socket.on("room_closed", onRoomClosed);

    return () => {
      socket.off("session", onSession);
      socket.off("room_state", onRoomState);
      socket.off("room_summaries", onRoomSummaries);
      socket.off("error_message", onError);
      socket.off("room_closed", onRoomClosed);
    };
  }, [session?.roomId, socket]);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(window.location.search).get("room");
    if (codeFromUrl) {
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      const code = new URLSearchParams(window.location.search).get("room");
      if (code && !session) {
        setRoomCode(code.toUpperCase());
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [session]);

  useEffect(() => {
    updateRoomQuery(session?.roomId ?? null);
  }, [session?.roomId]);

  useEffect(() => {
    if (!identity || identity.mode !== "named") {
      setNamedAccount(null);
      return;
    }
    void loginNamedUser({ username: identity.username })
      .then((account) => {
        setNamedAccount(account);
        const nextIdentity: LocalIdentity = {
          mode: "named",
          username: account.username,
          nickname: account.username,
          avatarUrl: account.avatarUrl
        };
        setIdentity(nextIdentity);
        saveIdentity(nextIdentity);
        setRecentUsers(loadRecentUsernames());
      })
      .catch((loginError) => {
        setError(loginError instanceof Error ? loginError.message : "加载账户失败");
      });
  }, [identity?.mode, identity?.username]);

  useEffect(() => {
    void refreshPublicPacks();
  }, []);

  useEffect(() => {
    if (!session || didReconnect || room) {
      return;
    }
    setDidReconnect(true);
    setConnectionState("connecting");
    socket.emit("reconnect_room", {
      roomId: session.roomId,
      sessionToken: session.sessionToken
    });
  }, [didReconnect, room, session, socket]);

  useEffect(() => {
    if (!session || !room || !pendingCreateConfigRef.current) {
      return;
    }
    const hostPlayer = room.players.find((player) => player.id === session.participantId);
    if (!hostPlayer?.isHost || room.phase !== "lobby") {
      return;
    }
    const pending = pendingCreateConfigRef.current;
    pendingCreateConfigRef.current = null;
    socket.emit("update_room_settings", {
      roomId: session.roomId,
      boardMode: pending.boardMode,
      builtinWordPackId: pending.builtinWordPackId,
      customWordPack: pending.customWordPack
    });
  }, [room, session, socket]);

  useEffect(() => {
    setTransferHostTargetId((current) => {
      if (current && hostTransferCandidates.some((player) => player.id === current)) {
        return current;
      }
      return hostTransferCandidates[0]?.id ?? "";
    });
  }, [hostTransferCandidates]);

  useEffect(() => {
    const reveal = room?.lastReveal;
    if (!reveal || reveal.id === lastRevealIdRef.current) {
      return;
    }
    lastRevealIdRef.current = reveal.id;
    setRevealBanner(reveal);
    setRevealingCardIds((prev) => new Set(prev).add(reveal.cardId));
    setPendingGuess(null);
    guessLockRef.current = false;
    if (reveal.outcome === "own-hit") {
      playOwnHit();
    } else if (reveal.outcome === "opponent-hit") {
      playOpponentHit();
    } else if (reveal.outcome === "neutral-hit") {
      playNeutralHit();
    } else if (reveal.outcome === "assassin-hit") {
      playAssassinHit();
    }
    const timeout = window.setTimeout(() => {
      setRevealingCardIds((prev) => {
        const next = new Set(prev);
        next.delete(reveal.cardId);
        return next;
      });
    }, 520);
    return () => window.clearTimeout(timeout);
  }, [room?.lastReveal]);

  useEffect(() => {
    if (!pendingGuess || !room) {
      return;
    }
    const guessedCard = room.board.find((card) => card.id === pendingGuess);
    if (guessedCard?.revealed || room.phase !== "playing" || !viewer?.canGuess) {
      setPendingGuess(null);
      guessLockRef.current = false;
    }
  }, [pendingGuess, room, viewer?.canGuess]);

  useEffect(() => {
    const lastMessage = room?.messages.at(-1);
    if (!lastMessage || lastMessage.type !== "reaction" || !lastMessage.targetParticipantId) {
      return;
    }
    if (lastMessage.id === lastReactionIdRef.current) {
      return;
    }
    lastReactionIdRef.current = lastMessage.id;
    setReactionEffects((current) => ({
      ...current,
      [lastMessage.targetParticipantId!]: lastMessage.reaction!
    }));
    const timeout = window.setTimeout(() => {
      setReactionEffects((current) => {
        const next = { ...current };
        delete next[lastMessage.targetParticipantId!];
        return next;
      });
    }, 1600);
    return () => window.clearTimeout(timeout);
  }, [room?.messages]);

  useEffect(() => {
    if (room?.phase === "finished" && room.winner) {
      playVictory();
      setShowSakura(true);
      const timeout = window.setTimeout(() => setShowSakura(false), 8000);
      return () => window.clearTimeout(timeout);
    } else {
      setShowSakura(false);
    }
  }, [room?.phase, room?.winner]);

  useEffect(() => {
    if (room?.phase === "playing" && room.roundNumber) {
      playGameStart();
    }
  }, [room?.phase, room?.roundNumber]);

  useEffect(() => {
    if (sideTab !== "chat") {
      return;
    }
    const list = chatListRef.current;
    if (!list || !stickToChatBottomRef.current) {
      return;
    }
    list.scrollTop = list.scrollHeight;
    setJumpToLatest(false);
  }, [room?.messages, sideTab]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && session) {
        socket.emit("sync_room_state", { roomId: session.roomId });
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [session, socket]);

  function persistIdentity(nextIdentity: LocalIdentity): void {
    setIdentity(nextIdentity);
    saveIdentity(nextIdentity);
    setRecentUsers(loadRecentUsernames());
  }

  async function handleNamedLogin(usernameOverride?: string): Promise<void> {
    const username = (usernameOverride ?? namedUsernameInput).trim();
    if (!username) {
      setError("请输入用户名");
      return;
    }
    try {
      const account = await loginNamedUser({ username });
      setNamedAccount(account);
      persistIdentity({
        mode: "named",
        username: account.username,
        nickname: account.username,
        avatarUrl: account.avatarUrl
      });
      setNamedUsernameInput(account.username);
      setError("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    }
  }

  function continueAsGuest(): void {
    const nickname = guestNicknameInput.trim();
    if (!nickname) {
      setError("请输入游客昵称");
      return;
    }
    setNamedAccount(null);
    persistIdentity({
      mode: "guest",
      username: "",
      nickname,
      avatarUrl: null
    });
    setError("");
  }

  async function handleAvatarUpload(file: File | null): Promise<void> {
    if (!namedAccount || !file) {
      return;
    }
    try {
      const avatarUrl = await imageFileToAvatarDataUrl(file);
      const updated = await updateNamedUser(namedAccount.username, { avatarUrl });
      setNamedAccount(updated);
      persistIdentity({
        mode: "named",
        username: updated.username,
        nickname: updated.username,
        avatarUrl: updated.avatarUrl
      });
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "头像上传失败");
    }
  }

  async function refreshPublicPacks(): Promise<void> {
    try {
      const packs = await listPublicWordPacks();
      setPublicPacks(packs);
      setSelectedPublicPackId((current) => {
        if (!current || packs.some((pack) => makePublicPackKey(pack) === current)) {
          return current;
        }
        return "";
      });
    } catch (publicPackError) {
      setError(publicPackError instanceof Error ? publicPackError.message : "公共题库加载失败");
    }
  }

  async function saveAccountPacks(nextPacks: SavedWordPack[]): Promise<void> {
    if (!namedAccount) {
      throw new Error("请先使用用户名登录");
    }
    const previousAccount = namedAccount;
    setNamedAccount({
      ...namedAccount,
      customWordPacks: nextPacks,
      updatedAt: Date.now()
    });
    try {
      const updated = await updateNamedUser(namedAccount.username, { customWordPacks: nextPacks });
      setNamedAccount({
        ...updated,
        customWordPacks: updated.customWordPacks.length > 0 ? updated.customWordPacks : nextPacks
      });
      void refreshPublicPacks();
      setError("");
    } catch (packError) {
      setNamedAccount(previousAccount);
      throw packError;
    }
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
    const reviewedEntries = pack.entries.map((entry) => {
      if (entry.reviewStatus !== "pending") {
        return entry;
      }

      const issues = getCandidateEntryIssues(entry, pack.entries);
      const hasBlockingError = issues.some((issue) => issue.level === "error");
      const hasNeedsReviewWarning = issues.some((issue) =>
        issue.code === "high-spoiler" || issue.code === "low-playability" || issue.code === "low-uniqueness"
      );

      if (hasBlockingError) {
        const reviewStatus: CandidateEntry["reviewStatus"] = "rejected";
        return { ...entry, reviewStatus, reviewNotes: entry.reviewNotes ?? "导入时自动拒绝：存在结构性错误" };
      }

      if (hasNeedsReviewWarning) {
        const reviewStatus: CandidateEntry["reviewStatus"] = "pending";
        return { ...entry, reviewStatus };
      }

      const reviewStatus: CandidateEntry["reviewStatus"] = "approved";
      return { ...entry, reviewStatus, reviewNotes: entry.reviewNotes ?? "导入时自动通过基础预审" };
    });

    return {
      ...pack,
      entries: reviewedEntries
    };
  }

  function resetCandidateReview(pack: CandidatePack): void {
    const reviewedPack = applyCandidateAutoReview(pack);
    setCandidatePack(reviewedPack);
  }

  function updateCandidateEntry(display: string, patch: Partial<CandidateEntry>): void {
    setCandidatePack((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        entries: current.entries.map((entry) => (entry.display === display ? { ...entry, ...patch } : entry))
      };
    });
  }

  function bulkSetVisibleEntries(displays: string[], reviewStatus: CandidateEntry["reviewStatus"]): void {
    setCandidatePack((current) => {
      if (!current) {
        return current;
      }
      const visibleSet = new Set(displays);
      return {
        ...current,
        entries: current.entries.map((entry) => (visibleSet.has(entry.display) ? { ...entry, reviewStatus } : entry))
      };
    });
  }

  async function persistPlayablePack(pack: SavedWordPack): Promise<void> {
    if (!namedAccount) {
      throw new Error("请先使用用户名登录");
    }
    await saveAccountPacks([...namedAccount.customWordPacks, pack]);
    setSelectedAccountPackId(pack.id);
    setPackSource("account");
  }

  function chooseAccountPackForCreate(packId: string): void {
    setSelectedAccountPackId(packId);
    setPackSource("account");
    setError("");
  }

  function autoExportCandidatePack(pack: CandidatePack): SavedWordPack {
    const reviewedPack = applyCandidateAutoReview(pack);
    return exportPlayablePack(reviewedPack, defaultExportFilters);
  }

  async function exportCandidateAsPlayable(filters: CandidateExportFilters): Promise<void> {
    if (!candidatePack) {
      return;
    }
    if (!namedAccount) {
      setError("请先登录用户名账户，再导出题库");
      return;
    }
    try {
      const pack = exportPlayablePack(candidatePack, filters);
      await persistPlayablePack(pack);
      setCandidatePack(null);
      setError(`已导出题库：${pack.name}（${pack.entries.length} 个词）`);
    } catch (candidateError) {
      setError(candidateError instanceof Error ? candidateError.message : "候选题库导出失败");
    }
  }

  async function addAccountPack(): Promise<void> {
    if (!namedAccount) {
      setError("请先使用用户名登录");
      return;
    }
    const name = savedPackName.trim();
    const entries = parsePackEntries(savedPackEntries);
    if (!name) {
      setError("请输入题库名称");
      return;
    }
    if (entries.length < 25) {
      setError("自定义题库至少需要 25 个词");
      return;
    }
    const nextPack = buildSavedPackFromPlayable({ name, entries });
    await persistPlayablePack(nextPack);
    setSavedPackName("");
    setSavedPackEntries("");
  }

  async function importAccountPack(file: File | null): Promise<void> {
    if (!namedAccount || !file) {
      return;
    }
    try {
      const imported = await parseCustomWordFile(file);
      if (imported.kind === "candidate") {
        resetCandidateReview(imported.pack);
        setError("");
        return;
      }
      const saved = buildSavedPackFromPlayable(imported.pack);
      await persistPlayablePack(saved);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "导入题库失败");
    }
  }

  async function removeAccountPack(packId: string): Promise<void> {
    if (!namedAccount) {
      return;
    }
    try {
      await saveAccountPacks(namedAccount.customWordPacks.filter((pack) => pack.id !== packId));
      if (selectedAccountPackId === packId) {
        setSelectedAccountPackId("");
      }
    } catch (packError) {
      setError(packError instanceof Error ? packError.message : "删除题库失败");
    }
  }

  async function toggleAccountPackPublic(packId: string): Promise<void> {
    if (!namedAccount) {
      return;
    }
    const timestamp = Date.now();
    try {
      await saveAccountPacks(
        namedAccount.customWordPacks.map((pack) => {
          if (pack.id !== packId) {
            return pack;
          }
          const nextIsPublic = pack.isPublic !== true;
          return {
            ...pack,
            isPublic: nextIsPublic,
            publishedAt: nextIsPublic ? pack.publishedAt ?? timestamp : undefined,
            updatedAt: timestamp
          };
        })
      );
    } catch (packError) {
      setError(packError instanceof Error ? packError.message : "更新题库公开状态失败");
    }
  }

  function buildJoinProfile(): { nickname: string; profile: LocalIdentity } | null {
    if (!effectiveIdentity) {
      setError("请先登录或进入游客模式");
      return null;
    }
    if (effectiveIdentity.mode === "named") {
      return {
        nickname: effectiveIdentity.username,
        profile: effectiveIdentity
      };
    }
    return {
      nickname: effectiveIdentity.nickname,
      profile: effectiveIdentity
    };
  }

  function createRoom(): void {
    const joinIdentity = buildJoinProfile();
    if (!joinIdentity) {
      return;
    }

    const pending: {
      boardMode: BoardMode;
      builtinWordPackId?: string;
      customWordPack?: { name: string; entries: string[] };
    } = { boardMode: createBoardMode };
    if (packSource === "builtin") {
      pending.builtinWordPackId = selectedBuiltinPackId;
    } else if (selectedAccountPack) {
      pending.customWordPack = {
        name: selectedAccountPack.name,
        entries: selectedAccountPack.entries
      };
    } else if (selectedPublicPack) {
      pending.customWordPack = {
        name: selectedPublicPack.name,
        entries: selectedPublicPack.entries
      };
    }
    pendingCreateConfigRef.current = pending;
    setConnectionState("connecting");
    setError("");
    socket.emit("create_room", {
      nickname: joinIdentity.nickname,
      profile: {
        accountType: joinIdentity.profile.mode,
        username: joinIdentity.profile.mode === "named" ? joinIdentity.profile.username : null,
        avatarUrl: joinIdentity.profile.avatarUrl
      }
    });
  }

  function joinSpecificRoom(roomId: string, asSpectator: boolean): void {
    const joinIdentity = buildJoinProfile();
    if (!joinIdentity) {
      return;
    }
    setConnectionState("connecting");
    setError("");
    const payload = {
      roomId,
      nickname: joinIdentity.nickname,
      profile: {
        accountType: joinIdentity.profile.mode,
        username: joinIdentity.profile.mode === "named" ? joinIdentity.profile.username : null,
        avatarUrl: joinIdentity.profile.avatarUrl
      }
    };
    if (asSpectator) {
      socket.emit("join_spectator", payload);
      return;
    }
    socket.emit("join_room", payload);
  }

  function joinByRoomCode(asSpectator: boolean): void {
    const normalized = normalizeRoomCode(roomCode);
    if (normalized.length !== ROOM_ID_LENGTH) {
      setError("请输入 6 位房间号");
      return;
    }
    joinSpecificRoom(normalized, asSpectator);
  }

  function chooseTeam(team: Team | null): void {
    if (!session) {
      return;
    }
    socket.emit("set_team", { roomId: session.roomId, team });
  }

  function chooseRole(role: "spymaster" | "operative"): void {
    if (!session) {
      return;
    }
    socket.emit("set_role", { roomId: session.roomId, role });
  }

  function updateBoardMode(boardMode: BoardMode): void {
    if (!session) {
      return;
    }
    socket.emit("update_room_settings", { roomId: session.roomId, boardMode });
  }

  function updateBuiltinPack(wordPackId: string): void {
    if (!session) {
      return;
    }
    socket.emit("update_room_settings", { roomId: session.roomId, builtinWordPackId: wordPackId });
  }

  async function uploadRoomPack(file: File | null): Promise<void> {
    if (!session || !file) {
      return;
    }
    try {
      const pack = await parseCustomWordFile(file);
      if (pack.kind === "candidate") {
        const saved = autoExportCandidatePack(pack.pack);
        socket.emit("update_room_settings", {
          roomId: session.roomId,
          customWordPack: {
            name: saved.name,
            entries: saved.entries
          }
        });
        setError(`已自动转换房间题库：${saved.name}`);
        return;
      }
      socket.emit("update_room_settings", {
        roomId: session.roomId,
        customWordPack: {
          name: pack.pack.name,
          entries: pack.pack.entries
        }
      });
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传房间题库失败");
    }
  }

  function useAccountPackForRoom(pack: SavedWordPack): void {
    if (!session) {
      return;
    }
    socket.emit("update_room_settings", {
      roomId: session.roomId,
      customWordPack: {
        name: pack.name,
        entries: pack.entries
      }
    });
  }

  function usePublicPackForRoom(pack: PublicWordPack): void {
    if (!session) {
      return;
    }
    socket.emit("update_room_settings", {
      roomId: session.roomId,
      customWordPack: {
        name: pack.name,
        entries: pack.entries
      }
    });
  }

  function startGame(): void {
    if (!session) {
      return;
    }
    socket.emit("start_game", { roomId: session.roomId });
  }

  function restartGame(): void {
    if (!session) {
      return;
    }
    socket.emit("restart_game", { roomId: session.roomId });
  }

  function returnToLobby(): void {
    if (!session || !window.confirm("确定要结束当前对局并回到准备阶段吗？")) {
      return;
    }
    socket.emit("return_to_lobby", { roomId: session.roomId });
  }

  function transferHost(): void {
    if (!session || !transferHostTargetId) {
      return;
    }
    const target = hostTransferCandidates.find((player) => player.id === transferHostTargetId);
    if (!target || !window.confirm(`确定把房主转让给 ${target.nickname} 吗？`)) {
      return;
    }
    socket.emit("transfer_host", { roomId: session.roomId, targetPlayerId: target.id });
  }

  function disbandRoom(): void {
    if (!session || !window.confirm("确定要解散房间吗？所有玩家都会回到首页。")) {
      return;
    }
    socket.emit("disband_room", { roomId: session.roomId });
  }

  function queueForNextRound(): void {
    if (!session) {
      return;
    }
    socket.emit("queue_for_next_round", { roomId: session.roomId });
  }

  function cancelQueueJoin(): void {
    if (!session) {
      return;
    }
    socket.emit("cancel_queue_join", { roomId: session.roomId });
  }

  function debugFillRoom(): void {
    if (!session) {
      return;
    }
    socket.emit("debug_fill_room", { roomId: session.roomId });
  }

  function submitClue(): void {
    if (!session || !clueWord.trim()) {
      return;
    }
    socket.emit("submit_clue", {
      roomId: session.roomId,
      word: clueWord.trim(),
      count: clueCount
    });
    playSubmitClue();
    setClueWord("");
  }

  function guessCard(cardId: string): void {
    if (!session || !viewer?.canGuess || guessLockRef.current) {
      return;
    }
    guessLockRef.current = true;
    setPendingGuess(cardId);
    socket.emit("guess_card", { roomId: session.roomId, cardId });
  }

  function endTurn(): void {
    if (!session) {
      return;
    }
    socket.emit("end_turn", { roomId: session.roomId });
    playEndTurn();
  }

  function sendChatMessage(): void {
    if (!session || !chatText.trim()) {
      return;
    }
    socket.emit("send_chat_message", {
      roomId: session.roomId,
      text: chatText.trim()
    });
    setChatText("");
  }

  function sendQuickPhrase(text: string): void {
    if (!session) return;
    socket.emit("send_chat_message", { roomId: session.roomId, text });
  }

  function sendReaction(reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType): void {
    if (!session) {
      return;
    }
    socket.emit("send_reaction", {
      roomId: session.roomId,
      reaction,
      targetParticipantId,
      targetParticipantType
    });
  }

  function leaveRoom(): void {
    if (session) {
      socket.emit("leave_room", { roomId: session.roomId });
    }
    clearSession();
    setSession(null);
    setRoom(null);
    setConnectionState("idle");
    setDidReconnect(false);
    setRevealBanner(null);
    setError("");
    updateRoomQuery(null);
  }

  function logoutNamedUser(): void {
    clearIdentity();
    clearSession();
    setIdentity(null);
    setNamedAccount(null);
    setSession(null);
    setRoom(null);
    setDidReconnect(false);
    setNamedUsernameInput("");
    setError("");
  }

  async function copyLink(): Promise<void> {
    if (!inviteLink) {
      return;
    }
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function renderHint(): string {
    if (!room) {
      if (!effectiveIdentity) {
        return "先用用户名登录，或者直接以游客身份进入。";
      }
      return "先建房，或者从大厅加入一个已有房间。";
    }
    return viewer?.statusText ?? "等待房间同步";
  }

  function queuedForSpectator(spectator: PublicSpectator, queue: JoinRequest[]): boolean {
    return queue.some((entry) => entry.spectatorId === spectator.id);
  }

  function handleChatScroll(): void {
    const list = chatListRef.current;
    if (!list) {
      return;
    }
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    stickToChatBottomRef.current = nearBottom;
    setJumpToLatest(!nearBottom);
  }

  function scrollChatToBottom(): void {
    const list = chatListRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
    stickToChatBottomRef.current = true;
    setJumpToLatest(false);
  }

  function toggleSection(title: string): void {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />
      <main className="page">
        {!room ? (
          candidatePack ? (
            <CandidateReview
              pack={candidatePack}
              onClose={() => setCandidatePack(null)}
              onUpdateEntry={updateCandidateEntry}
              onBulkSetVisible={bulkSetVisibleEntries}
              onExport={(filters) => void exportCandidateAsPlayable(filters)}
            />
          ) : (
            <>
              <section className="hero">
              <div className="hero-copy-block">
                <p className="eyebrow">ACG social deduction</p>
                <h1>行动代号 Online</h1>
                <p className="hero-copy">用户名模式可跨设备保留头像、题库和战绩。游客模式可直接开玩，但不保证跨设备保留数据。</p>
              </div>
              <div className="hero-actions">
                <AvatarBadge avatarUrl={effectiveIdentity?.avatarUrl ?? null} fallback={effectiveIdentity?.nickname ?? effectiveIdentity?.username ?? "?"} size="large" />
                <div className="hero-tags">
                  <span>{connectionState === "connecting" ? "连接中" : connectionState === "ready" ? "已连接" : "待连接"}</span>
                  <span>{effectiveIdentity?.mode === "named" ? "用户名账户" : effectiveIdentity?.mode === "guest" ? "游客模式" : "未登录"}</span>
                </div>
              </div>
            </section>

            <section className="home-grid">
              <div className="home-main">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Account</p>
                      <h2>用户名登录</h2>
                    </div>
                    <span className="soft-chip">跨设备保留头像 / 题库 / 战绩</span>
                  </div>
                  <div className="toolbar-inline compact-stack">
                    <label className="field">
                      <span>用户名</span>
                      <input value={namedUsernameInput} onChange={(event) => setNamedUsernameInput(event.target.value)} maxLength={24} placeholder="例如：Miku厨" />
                    </label>
                    <button className="primary-button" onClick={() => void handleNamedLogin()}>
                      登录 / 继续
                    </button>
                  </div>
                  {recentUsers.length > 0 ? (
                    <div className="chip-wrap">
                      {recentUsers.map((username) => (
                        <button key={username} className="chip-button" onClick={() => void handleNamedLogin(username)}>
                          {username}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <p className="hint-text">当前版本只有用户名，不做密码校验。方便跨设备继续，但不具备强安全性。</p>
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Guest</p>
                      <h2>游客进入</h2>
                    </div>
                    <span className="soft-chip">不注册也能直接玩</span>
                  </div>
                  <div className="toolbar-inline compact-stack">
                    <label className="field">
                      <span>游客昵称</span>
                      <input value={guestNicknameInput} onChange={(event) => setGuestNicknameInput(event.target.value)} maxLength={12} placeholder="例如：小夜" />
                    </label>
                    <button onClick={continueAsGuest}>使用游客身份</button>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Lobby</p>
                      <h2>当前房间</h2>
                    </div>
                    <span className="soft-chip">{roomSummaries.length} 个房间</span>
                  </div>
                  <div className="room-list">
                    {roomSummaries.length === 0 ? <p className="empty-text">当前没有公开房间。</p> : null}
                    {roomSummaries.map((summary) => (
                      <div className="room-list-item" key={summary.id}>
                        <div className="room-list-main">
                          <div className="room-list-title">
                            <strong>{summary.id}</strong>
                            <span className="soft-chip">
                              {summary.phase === "playing" ? "进行中 · 可旁观" : summary.phase === "lobby" ? "准备中 · 可加入" : "已结束"}
                            </span>
                            <span className="soft-chip">{summary.boardMode}</span>
                            <span className="soft-chip">{summary.wordPackSummary.name}</span>
                          </div>
                          <div className="room-list-meta">
                            <span>房主 {summary.hostNickname}</span>
                            <span>玩家 {summary.playerCount}</span>
                            <span>旁观 {summary.spectatorCount}</span>
                            <span>排队 {summary.queuedCount}</span>
                          </div>
                          <p className="panel-subtle">{summary.lastEvent}</p>
                        </div>
                        <div className="room-list-actions">
                          {summary.canJoinDirectly ? (
                            <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, false)}>
                              加入战局
                            </button>
                          ) : summary.canSpectate ? (
                            <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, true)}>
                              旁观激战
                            </button>
                          ) : (
                            <button disabled>已结束</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="home-side">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Create room</p>
                      <h2>创建房间</h2>
                    </div>
                    <span className="soft-chip">{createBoardMode}</span>
                  </div>
                  <div className="settings-block">
                    <strong>棋盘模式</strong>
                    <div className="selection-grid">
                      {boardModes.map((mode) => (
                        <button key={mode} className={createBoardMode === mode ? "selected" : ""} onClick={() => setCreateBoardMode(mode)}>
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-block">
                    <strong>题库来源</strong>
                    <div className="selection-grid">
                      <button className={packSource === "builtin" ? "selected" : ""} onClick={() => setPackSource("builtin")}>
                        内置
                      </button>
                      <button className={packSource === "account" ? "selected" : ""} disabled={!namedAccount} onClick={() => setPackSource("account")}>
                        我的题库
                      </button>
                      <button className={packSource === "public" ? "selected" : ""} onClick={() => setPackSource("public")}>
                        公共题库
                      </button>
                    </div>
                    {packSource === "builtin" ? (
                      <select value={selectedBuiltinPackId} onChange={(event) => setSelectedBuiltinPackId(event.target.value)}>
                        {wordPackSummaries.map((pack) => (
                          <option key={pack.id} value={pack.id}>
                            {pack.name} ({pack.entryCount})
                          </option>
                        ))}
                      </select>
                    ) : packSource === "account" ? (
                      <select value={selectedAccountPackId} onChange={(event) => setSelectedAccountPackId(event.target.value)}>
                        <option value="">选择我的题库</option>
                        {accountPacks.map((pack) => (
                          <option key={pack.id} value={pack.id}>
                            {pack.name} ({pack.entries.length})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select value={selectedPublicPackId} onChange={(event) => setSelectedPublicPackId(event.target.value)}>
                        <option value="">选择公共题库</option>
                        {publicPacks.map((pack) => (
                          <option key={makePublicPackKey(pack)} value={makePublicPackKey(pack)}>
                            {pack.name} ({pack.entries.length}) / {pack.ownerUsername}
                          </option>
                        ))}
                      </select>
                    )}
                    {packSource === "account" ? (
                      selectedAccountPack ? (
                        <p className="hint-text">
                          当前开房将使用：<strong>{selectedAccountPack.name}</strong>
                        </p>
                      ) : (
                        <p className="hint-text">请先从“我的题库”里选择一个题库用于开房。</p>
                      )
                    ) : packSource === "public" ? (
                      selectedPublicPack ? (
                        <p className="hint-text">
                          当前开房将使用：<strong>{selectedPublicPack.name}</strong> / {selectedPublicPack.ownerUsername}
                        </p>
                      ) : (
                        <p className="hint-text">请选择一个公开题库；没有时可以先在“我的题库”公开自己的题库。</p>
                      )
                    ) : null}
                  </div>
                  <button
                    className="primary-button"
                    onClick={createRoom}
                    disabled={!effectiveIdentity || (packSource === "account" && !selectedAccountPack) || (packSource === "public" && !selectedPublicPack)}
                  >
                    创建房间
                  </button>
                  <div className="settings-block">
                    <strong>按房间号进入</strong>
                    <div className="join-row">
                      <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="输入 6 位房间号" maxLength={ROOM_ID_LENGTH} />
                      <button onClick={() => joinByRoomCode(false)} disabled={!effectiveIdentity}>
                        加入
                      </button>
                      <button onClick={() => joinByRoomCode(true)} disabled={!effectiveIdentity}>
                        旁观
                      </button>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Profile</p>
                      <h2>个人资料</h2>
                    </div>
                    <span className="soft-chip">{namedAccount ? "已登录" : "游客/未登录"}</span>
                  </div>
                  {namedAccount ? (
                    <>
                      <div className="account-summary">
                        <AvatarBadge avatarUrl={namedAccount.avatarUrl} fallback={namedAccount.username} size="large" />
                        <div className="account-stats">
                          <strong>{namedAccount.username}</strong>
                          <p>总场次 {namedAccount.stats.gamesPlayed}</p>
                          <p>胜 {namedAccount.stats.wins} / 负 {namedAccount.stats.losses}</p>
                        </div>
                      </div>
                      <div className="upload-field">
                        <span>上传头像图片</span>
                        <input type="file" accept="image/*" onChange={(event) => void handleAvatarUpload(event.target.files?.[0] ?? null)} />
                      </div>
                      <button onClick={logoutNamedUser}>退出用户名账户</button>
                    </>
                  ) : (
                    <p className="hint-text">用户名账户可以跨设备保留头像、题库和战绩。游客模式只保留当前浏览器状态。</p>
                  )}
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">My packs</p>
                      <h2>我的题库</h2>
                    </div>
                    <span className="soft-chip">{accountPacks.length} 个</span>
                  </div>
                  {namedAccount ? (
                    <>
                      <input value={savedPackName} onChange={(event) => setSavedPackName(event.target.value)} placeholder="题库名称" />
                      <textarea value={savedPackEntries} onChange={(event) => setSavedPackEntries(event.target.value)} placeholder="每行一个词，至少 25 行" />
                      <div className="toolbar-inline compact-stack">
                        <button onClick={() => void addAccountPack()}>保存题库</button>
                        <input type="file" accept=".txt,.json" onChange={(event) => void importAccountPack(event.target.files?.[0] ?? null)} />
                      </div>
                      <div className="pack-library">
                        {accountPacks.length === 0 ? <p className="empty-text">还没有个人题库。</p> : null}
                        {accountPacks.map((pack) => (
                          <div className={`pack-card ${selectedAccountPackId === pack.id ? "pack-card-active" : ""}`} key={pack.id}>
                            <div>
                              <strong>{pack.name}</strong>
                              <p className="pack-card-meta">
                                {pack.entries.length} 个词 / {pack.isPublic ? "已公开" : "仅自己可用"}
                              </p>
                            </div>
                            <div className="pack-card-actions">
                              <button onClick={() => setSelectedAccountPackId(pack.id)}>选中</button>
                              <button onClick={() => chooseAccountPackForCreate(pack.id)}>用于开房</button>
                              <button onClick={() => void toggleAccountPackPublic(pack.id)}>{pack.isPublic ? "取消公开" : "公开"}</button>
                              <button onClick={() => void removeAccountPack(pack.id)}>删除</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="hint-text">先使用用户名登录，再管理你的自定义题库。</p>
                  )}
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Public packs</p>
                      <h2>公共题库</h2>
                    </div>
                    <span className="soft-chip">{publicPacks.length} 个</span>
                  </div>
                  <div className="pack-library">
                    {publicPacks.length === 0 ? <p className="empty-text">还没有公开题库。</p> : null}
                    {publicPacks.slice(0, 6).map((pack) => (
                      <div className={`pack-card ${selectedPublicPackId === makePublicPackKey(pack) ? "pack-card-active" : ""}`} key={makePublicPackKey(pack)}>
                        <div>
                          <strong>{pack.name}</strong>
                          <p className="pack-card-meta">
                            {pack.entries.length} 个词 / {pack.ownerUsername}
                          </p>
                        </div>
                        <div className="pack-card-actions">
                          <button onClick={() => setSelectedPublicPackId(makePublicPackKey(pack))}>选中</button>
                          <button
                            onClick={() => {
                              setSelectedPublicPackId(makePublicPackKey(pack));
                              setPackSource("public");
                            }}
                          >
                            用于开房
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </section>
          </>
          )
        ) : (
          <>
            <SakuraParticles active={showSakura} />
            <section className={`room-grid ${focusMode ? "room-grid-focus" : ""}`}>
            <header className="room-bar room-bar-clean">
              <div className="room-bar-main room-bar-stack">
                <div className="room-title-stack">
                  <p className="micro-label">Room</p>
                  <strong className="room-code">{room.id}</strong>
                  <p className="room-subtitle">{room.wordPackSummary.name}</p>
                </div>
                <div className="status-strip wrap">
                  <span className="status-pill emphasis">{getRoomStageLabel(room, connectionState)}</span>
                  <span className="status-pill">{room.settings.boardMode}</span>
                  <span className="status-pill">第 {room.roundNumber} 局</span>
                  {isDebugController ? <span className="status-pill debug">本地调试</span> : null}
                </div>
              </div>
              <div className="bar-actions">
                <button onClick={() => { setFocusMode((value) => !value); requestAnimationFrame(() => { document.querySelector('.board-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); }}>{focusMode ? "退出专注模式" : "专注模式"}</button>
                <button onClick={() => void copyLink()}>{copied ? "已复制" : "复制链接"}</button>
                <button onClick={leaveRoom}>离开</button>
              </div>
            </header>

            {viewer?.canDisbandRoom ? (
              <section className="panel host-control-panel">
                <div className="panel-heading">
                  <div>
                    <p className="micro-label">Host controls</p>
                    <h2>房主控制台</h2>
                  </div>
                  <span className="soft-chip">{room.phase === "lobby" ? "准备阶段" : "对局管理"}</span>
                </div>
                <div className="host-control-grid">
                  <button onClick={returnToLobby} disabled={!viewer.canReturnToLobby}>
                    回到大厅
                  </button>
                  <div className="host-transfer-row">
                    <select value={transferHostTargetId} onChange={(event) => setTransferHostTargetId(event.target.value)} disabled={!viewer.canTransferHost}>
                      {hostTransferCandidates.length === 0 ? <option value="">暂无可转让玩家</option> : null}
                      {hostTransferCandidates.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.nickname}
                        </option>
                      ))}
                    </select>
                    <button onClick={transferHost} disabled={!viewer.canTransferHost || !transferHostTargetId}>
                      转让房主
                    </button>
                  </div>
                  <button className="danger-button" onClick={disbandRoom}>
                    解散房间
                  </button>
                </div>
              </section>
            ) : null}

            <div className={`room-layout ${room.phase === "playing" ? "room-layout-playing" : ""}`}>
              <aside className="left-column">
                <section className={`panel seat-panel ${isPlayer(self) && self.team ? `seat-${self.team}` : viewer?.participantType === "spectator" ? "seat-spectator" : ""}`}>
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Identity</p>
                      <h2>我的位置</h2>
                    </div>
                    <span className="soft-chip">{getSelfSummary(self, room)}</span>
                  </div>
                  <div className="seat-summary">
                    <AvatarBadge avatarUrl={self?.profile.avatarUrl ?? null} fallback={self?.nickname ?? "?"} size="large" effect={self ? reactionEffects[self.id] : undefined} />
                    <div>
                      <strong>{self?.nickname ?? "未加入"}</strong>
                      <p className="panel-subtle">{renderHint()}</p>
                    </div>
                  </div>
                  <div className="identity-target">
                    <span className={`team-mark ${viewer?.targetTeam ?? "neutral"}`}>{getActionTeamText(viewer?.targetTeam ?? null)}</span>
                  </div>
                  {viewer?.participantType === "player" && isPlayer(self) ? (
                    <div className="selection-grid">
                      <button className={self.team === "red" ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam("red")}>
                        红队
                      </button>
                      <button className={self.team === "blue" ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam("blue")}>
                        蓝队
                      </button>
                      <button className={self.team === null ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam(null)}>
                        待定
                      </button>
                      <button className={self.role === "spymaster" ? "selected" : ""} disabled={!isLobby || !self.team} onClick={() => chooseRole("spymaster")}>
                        队长
                      </button>
                      <button className={self.role === "operative" ? "selected" : ""} disabled={!isLobby || !self.team} onClick={() => chooseRole("operative")}>
                        队员
                      </button>
                    </div>
                  ) : (
                    <div className="spectator-tools">
                      <button className="primary-button" onClick={queueForNextRound} disabled={!viewer?.canQueueForNextRound || viewer.isQueuedForNextRound}>
                        排队加入下一局
                      </button>
                      <button onClick={cancelQueueJoin} disabled={!viewer?.canCancelQueue}>
                        取消排队
                      </button>
                    </div>
                  )}
                </section>

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Players</p>
                      <h2>对局成员</h2>
                    </div>
                    <span className="soft-chip">{room.players.length} 人</span>
                  </div>
                  <PlayerSection
                    title="红队"
                    players={room.players.filter((player) => player.team === "red")}
                    selfId={session?.participantId}
                    reactionEffects={reactionEffects}
                    onReact={sendReaction}
                    collapsed={collapsedSections.has("红队")}
                    onToggleCollapse={() => toggleSection("红队")}
                  />
                  <PlayerSection
                    title="蓝队"
                    players={room.players.filter((player) => player.team === "blue")}
                    selfId={session?.participantId}
                    reactionEffects={reactionEffects}
                    onReact={sendReaction}
                    collapsed={collapsedSections.has("蓝队")}
                    onToggleCollapse={() => toggleSection("蓝队")}
                  />
                  {room.phase !== "playing" ? (
                    <PlayerSection
                      title="待分队"
                      players={room.players.filter((player) => player.team === null)}
                      selfId={session?.participantId}
                      reactionEffects={reactionEffects}
                      onReact={sendReaction}
                      collapsed={collapsedSections.has("待分队")}
                      onToggleCollapse={() => toggleSection("待分队")}
                    />
                  ) : null}
                </section>
              </aside>

              <section className="center-column">
                {isLobby && viewer?.participantType === "player" ? (
                  <section className="panel compact-panel">
                    <div className="panel-heading">
                      <div>
                        <p className="micro-label">Room settings</p>
                        <h2>房间设置</h2>
                      </div>
                      <span className="soft-chip">{viewer.canEditRoom ? "房主可编辑" : "等待房主调整"}</span>
                    </div>
                    <div className="settings-row">
                      <div className="settings-block">
                        <strong>棋盘模式</strong>
                        <div className="selection-grid">
                          {boardModes.map((mode) => (
                            <button key={mode} className={room.settings.boardMode === mode ? "selected" : ""} disabled={!viewer.canEditRoom} onClick={() => updateBoardMode(mode)}>
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="settings-block">
                        <strong>房间题库</strong>
                        <div className="toolbar-inline compact-stack">
                          <select value={room.wordPackSummary.isBuiltin ? room.wordPackSummary.id : wordPackSummaries[0]?.id ?? ""} disabled={!viewer.canEditRoom} onChange={(event) => updateBuiltinPack(event.target.value)}>
                            {wordPackSummaries.map((pack) => (
                              <option key={pack.id} value={pack.id}>
                                {pack.name} ({pack.entryCount})
                              </option>
                            ))}
                          </select>
                          <input type="file" accept=".txt,.json" disabled={!viewer.canEditRoom} onChange={(event) => void uploadRoomPack(event.target.files?.[0] ?? null)} />
                        </div>
                        {accountPacks.length > 0 ? (
                          <div className="chip-wrap">
                            {accountPacks.map((pack) => (
                              <button key={pack.id} className="chip-button" disabled={!viewer.canEditRoom} onClick={() => useAccountPackForRoom(pack)}>
                                使用 {pack.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {publicPacks.length > 0 ? (
                          <div className="chip-wrap">
                            {publicPacks.slice(0, 8).map((pack) => (
                              <button key={makePublicPackKey(pack)} className="chip-button" disabled={!viewer.canEditRoom} onClick={() => usePublicPackForRoom(pack)}>
                                公共 {pack.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {isPlayer(self) && self.isHost ? (
                      <div className="host-actions host-actions-inline">
                        <button className="primary-button" onClick={startGame} disabled={!viewer.canStartGame}>
                          开始对局
                        </button>
                        {viewer.canUseDebugFill ? <button onClick={debugFillRoom}>一键补 3 个测试位</button> : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {!isFinished && revealBanner ? <RevealBanner reveal={revealBanner} /> : null}

                {isFinished ? (
                  <section className={`result-banner ${room.winner ? `winner-${room.winner}` : ""}`}>
                    <div>
                      <p className="micro-label">Result</p>
                      <h2>{room.winner ? `${TEAM_LABELS[room.winner]}获胜` : "对局结束"}</h2>
                      <p className="hint-text">{room.lastEvent}</p>
                    </div>
                    <div className="result-score">
                      <span className="score-chip red-chip">红队剩余 {room.remainingCounts.red}</span>
                      <span className="score-chip blue-chip">蓝队剩余 {room.remainingCounts.blue}</span>
                      {viewer?.canRestartGame ? (
                        <button className="primary-button" onClick={restartGame}>
                          再来一把
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                <section className="panel board-panel">
                  <div className={`board-header board-header-tight ${room.phase === "playing" ? "board-header-compact" : ""}`}>
                    <div className="board-status">
                      <div className="status-chip clue-chip">
                        <p className="status-key">当前提示</p>
                        <strong>{getCurrentClueText(room)}</strong>
                      </div>
                      <div className="status-chip">
                        <p className="status-key">行动队伍</p>
                        <strong>{getActionTeamText(viewer?.targetTeam ?? null)}</strong>
                      </div>
                    </div>
                    <p className="board-hint">{renderHint()}</p>
                    {canSeeHiddenRoles ? (
                      <div className="spymaster-warning">
                        <span>队长模式：你可以看到未翻牌的真实身份，注意屏幕隐私。</span>
                        <button type="button" className="chip-button" onClick={() => setMaskSpymasterHints((value) => !value)}>
                          {maskSpymasterHints ? "显示队长提示" : "隐藏队长提示"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className={`board-grid board-${boardColumns}`} style={{ gridTemplateColumns: `repeat(${boardColumns}, minmax(0, 1fr))` }}>
                    {room.board.map((card) => (
                      <CardButton
                        key={card.id}
                        card={card}
                        disabled={!viewer?.canGuess || card.revealed || room.phase !== "playing" || pendingGuess === card.id}
                        onClick={() => guessCard(card.id)}
                        flash={room.lastReveal?.cardId === card.id}
                        flashOutcome={room.lastReveal?.cardId === card.id ? room.lastReveal.outcome : null}
                        pending={pendingGuess === card.id}
                        revealing={revealingCardIds.has(card.id)}
                        showSpymasterHints={showSpymasterHints}
                      />
                    ))}
                  </div>
                </section>

                {viewer?.participantType === "player" ? (
                  <section className={`panel action-panel dock-panel ${viewer?.canGuess || viewer?.canSubmitClue ? "dock-active" : "dock-dimmed"}`}>
                    <div className="action-main">
                      {viewer?.canSubmitClue ? (
                        <div className="clue-form">
                          <label className="field">
                            <span>提示词</span>
                            <input value={clueWord} onChange={(event) => setClueWord(event.target.value)} maxLength={12} placeholder="例如：机甲 / 学园 / 主角团" />
                          </label>
                          <label className="field count-field">
                            <span>数字</span>
                            <input type="number" min={1} max={9} value={clueCount} onChange={(event) => setClueCount(Math.max(1, Math.min(9, Number(event.target.value) || 1)))} />
                          </label>
                          <button className="primary-button" onClick={submitClue} disabled={!clueWord.trim()}>
                            提交提示
                          </button>
                        </div>
                      ) : (
                        <div className="action-copy">
                          <p className="micro-label">操作提示</p>
                          <p className="hint-text">{renderHint()}</p>
                        </div>
                      )}
                    </div>
                    <div className="action-side">
                      <button onClick={endTurn} disabled={!viewer?.canEndTurn}>
                        结束回合
                      </button>
                    </div>
                  </section>
                ) : null}
              </section>

              <aside className={`right-column ${rightPanelPinned ? "pinned" : ""}`}>
                <span className="right-column-tab" onClick={() => setRightPanelPinned((v) => !v)} title={rightPanelPinned ? "取消固定" : "固定面板"}>
                  {rightPanelPinned ? "📌" : "💬"}
                </span>
                <div className="panel tab-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="micro-label">Room sidecar</p>
                      <h2>右侧面板</h2>
                    </div>
                    <div className="tab-strip">
                      <button className={sideTab === "chat" ? "selected" : ""} onClick={() => setSideTab("chat")}>
                        聊天
                      </button>
                      <button className={sideTab === "spectators" ? "selected" : ""} onClick={() => setSideTab("spectators")}>
                        旁观
                      </button>
                      <button className={sideTab === "score" ? "selected" : ""} onClick={() => setSideTab("score")}>
                        积分
                      </button>
                    </div>
                  </div>

                  {sideTab === "chat" ? (
                    <section className="chat-panel-inner">
                      <div className="chat-list" ref={chatListRef} onScroll={handleChatScroll}>
                        {room.messages.length === 0 ? <p className="empty-text">还没有消息。</p> : null}
                        {room.messages.map((message) => (
                          <MessageRow key={message.id} message={message} selfId={session?.participantId} />
                        ))}
                      </div>
                      {jumpToLatest ? (
                        <button className="jump-latest" onClick={scrollChatToBottom}>
                          跳到最新消息
                        </button>
                      ) : null}
                      <div className="chat-compose">
                        <input value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={120} placeholder="发一句话..." />
                        <button onClick={sendChatMessage} disabled={!chatText.trim()}>
                          发送
                        </button>
                      </div>
                      <div className="quick-phrases">
                        <button className="chip-button" onClick={() => sendQuickPhrase("GG")}>GG</button>
                        <button className="chip-button" onClick={() => sendQuickPhrase("大佬带带我")}>大佬带带我</button>
                        <button className="chip-button" onClick={() => sendQuickPhrase("好猜！")}>好猜！</button>
                        <button className="chip-button" onClick={() => sendQuickPhrase("这个太难了")}>这个太难了</button>
                        <button className="chip-button" onClick={() => sendQuickPhrase("666")}>666</button>
                      </div>
                    </section>
                  ) : null}

                  {sideTab === "spectators" ? (
                    <section className="spectators-block">
                      <div className="soft-summary">
                        <span>旁观 {room.spectators.length}</span>
                        <span>排队 {room.joinQueue.length}</span>
                      </div>
                      {room.spectators.length === 0 ? <p className="empty-text">当前没有旁观者。</p> : null}
                      {room.spectators.map((spectator) => (
                        <ParticipantRow
                          key={spectator.id}
                          participant={spectator}
                          label={queuedForSpectator(spectator, room.joinQueue) ? "已排队下一局" : "旁观中"}
                          isSelf={spectator.id === session?.participantId}
                          effect={reactionEffects[spectator.id]}
                          onReact={sendReaction}
                        />
                      ))}
                    </section>
                  ) : null}

                  {sideTab === "score" ? (
                    <section className="score-column">
                      <div className="score-board">
                        <div className="score-box score-red">
                          <span>红队</span>
                          <strong>{room.scores.red}</strong>
                        </div>
                        <div className="score-box score-blue">
                          <span>蓝队</span>
                          <strong>{room.scores.blue}</strong>
                        </div>
                      </div>
                      <div className="score-pair">
                        <span>红队剩余 {room.remainingCounts.red}</span>
                        <span>蓝队剩余 {room.remainingCounts.blue}</span>
                      </div>
                      <div className="info-card">
                        <strong>当前题库</strong>
                        <p className="panel-subtle">{room.wordPackSummary.name}</p>
                      </div>
                      <div className="info-card">
                        <strong>最近事件</strong>
                        <p className="panel-subtle">{room.lastEvent}</p>
                      </div>
                    </section>
                  ) : null}
                </div>
              </aside>
            </div>

            {error ? <p className="error-text">{error}</p> : null}
          </section>
          </>
        )}
      </main>
    </div>
  );
}

function PlayerSection({
  title,
  players,
  selfId,
  reactionEffects,
  onReact,
  collapsed,
  onToggleCollapse
}: {
  title: string;
  players: PublicPlayer[];
  selfId?: string;
  reactionEffects: Record<string, ChatReaction>;
  onReact: (reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const visiblePlayers = collapsed ? players.slice(0, 2) : players;
  return (
    <div className="team-section">
      <button className="team-section-toggle" onClick={onToggleCollapse}>
        <h3>
          {title} <span className="soft-chip">{players.length}</span>
        </h3>
        <span className={`toggle-arrow ${collapsed ? "" : "toggle-expanded"}`}>{collapsed ? "▸" : "▾"}</span>
      </button>
      {players.length === 0 ? <p className="empty-text">暂无成员</p> : null}
      {visiblePlayers.map((player) => (
        <ParticipantRow
          key={player.id}
          participant={player}
          label={`${player.team ? TEAM_LABELS[player.team] : "未分队"} / ${PLAYER_ROLE_LABELS[player.role]}`}
          isSelf={player.id === selfId}
          effect={reactionEffects[player.id]}
          onReact={onReact}
        />
      ))}
      {collapsed && players.length > 2 ? (
        <button className="chip-button expand-hint" onClick={onToggleCollapse}>
          显示全部 {players.length} 人
        </button>
      ) : null}
    </div>
  );
}

function ParticipantRow({
  participant,
  label,
  isSelf,
  effect,
  onReact
}: {
  participant: PublicPlayer | PublicSpectator;
  label: string;
  isSelf: boolean;
  effect?: ChatReaction;
  onReact: (reaction: ChatReaction, targetParticipantId: string, targetParticipantType: ParticipantType) => void;
}) {
  const type: ParticipantType = "team" in participant ? "player" : "spectator";
  return (
    <div className={`participant-row ${isSelf ? "participant-self" : ""} ${effect ? `participant-effect-${effect}` : ""}`}>
      <div className="participant-main">
        <AvatarBadge avatarUrl={participant.profile.avatarUrl} fallback={participant.nickname} size="small" effect={effect} />
        <div>
          <strong>
            {participant.nickname}
            {isSelf ? " · 你" : ""}
          </strong>
          <p>{label}</p>
        </div>
      </div>
      <div className="participant-actions">
        {"isHost" in participant && participant.isHost ? <span className="soft-chip">房主</span> : null}
        {"connected" in participant && !participant.connected ? <span className="soft-chip">离线</span> : null}
        {"isBot" in participant && participant.isBot ? <span className="soft-chip">测试位</span> : null}
        {!isSelf ? (
          <>
            <button className="icon-button" onClick={() => onReact("flower", participant.id, type)} title="送花">
              花
            </button>
            <button className="icon-button" onClick={() => onReact("egg", participant.id, type)} title="丢蛋">
              蛋
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function RevealBanner({ reveal }: { reveal: RevealEvent }) {
  const teamLabel = TEAM_LABELS[reveal.guessedByTeam];
  const title =
    reveal.outcome === "own-hit"
      ? `${teamLabel} 命中`
      : reveal.outcome === "opponent-hit"
        ? `${teamLabel} 猜到对方词`
        : reveal.outcome === "neutral-hit"
          ? `${teamLabel} 猜到中立词`
          : `${teamLabel} 踩中刺客`;

  return (
    <section className={`reveal-banner reveal-${reveal.outcome}`}>
      <div>
        <p className="micro-label">Reveal</p>
        <h2>{title}</h2>
      </div>
      <div className="reveal-meta">
        <span className="score-chip">{reveal.word}</span>
        <span className="score-chip">{roleLabelShort(reveal.role)}</span>
      </div>
    </section>
  );
}

function MessageRow({ message, selfId }: { message: ChatMessage; selfId?: string }) {
  const isSelf = selfId && message.playerId === selfId;
  return (
    <div className={`chat-message ${isSelf ? "chat-self" : ""} ${message.type === "system" ? "chat-system" : ""} ${message.type === "reaction" ? "chat-reaction" : ""}`}>
      <div className="chat-meta">
        <strong>{message.nickname ?? "系统"}</strong>
        <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p>{message.text}</p>
    </div>
  );
}

function CardButton({
  card,
  disabled,
  onClick,
  flash,
  flashOutcome,
  pending,
  revealing,
  showSpymasterHints
}: {
  card: PublicCard;
  disabled: boolean;
  onClick: () => void;
  flash: boolean;
  flashOutcome: RevealOutcome | null;
  pending: boolean;
  revealing: boolean;
  showSpymasterHints: boolean;
}) {
  const classes = ["card-tile"];
  const showRevealedRole = Boolean(card.revealed && card.role);
  const showRoleHint = Boolean(showSpymasterHints && card.role && !card.revealed);
  if (showRevealedRole) {
    classes.push(card.role!);
  } else {
    classes.push("hidden");
  }
  if (disabled) {
    classes.push("disabled");
  }
  if (flash) {
    classes.push("card-flash");
    if (flashOutcome) {
      classes.push(`flash-${flashOutcome}`);
    }
  }
  if (pending) {
    classes.push("pending");
  }
  if (revealing) {
    classes.push("revealing");
  }
  if (showRoleHint && card.role) {
    classes.push("spymaster-hint", `hint-${card.role}`);
  }
  return (
    <button className={classes.join(" ")} disabled={disabled} onClick={onClick} title={card.revealed ? "已翻开，无法再选" : undefined}>
      <span>{card.word}</span>
      {showRoleHint && card.role ? <small>{roleLabelShort(card.role)}</small> : null}
      {card.revealed ? <div className="flip-badge">已翻牌</div> : null}
    </button>
  );
}

function AvatarBadge({
  avatarUrl,
  fallback,
  size,
  effect
}: {
  avatarUrl: string | null;
  fallback: string;
  size: "small" | "medium" | "large";
  effect?: ChatReaction;
}) {
  const className = ["avatar-badge", size];
  if (effect) {
    className.push(`avatar-effect-${effect}`);
  }
  const fallbackText = fallback.trim().slice(0, 1).toUpperCase() || "?" ;
  return (
    <div className={className.join(" ")}>
      {avatarUrl ? <img src={avatarUrl} alt={fallback} /> : <span>{fallbackText}</span>}
    </div>
  );
}

export default App;

