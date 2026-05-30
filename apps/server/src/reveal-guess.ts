import crypto from "node:crypto";
import {
  DEFAULT_REVEAL_GUESS_SETTINGS,
  REVEAL_GUESS_GRID_SIZE,
  type ParticipantType,
  type Player,
  type PublicRevealGuessState,
  type RevealCell,
  type RevealGuessPendingAnswer,
  type RevealGuessPhase,
  type RevealGuessPlayerRoundState,
  type RevealGuessScoreEvent,
  type RevealGuessSettings,
  type RevealGuessState,
  type RevealPuzzle,
  type Room,
} from "@acg-codenames/shared";

/**
 * Reveal Guess / 揭幕猜番 — server-side game logic.
 *
 * All functions are pure: they take a Room, validate, mutate it, and return it.
 * The caller (index.ts socket handlers) is responsible for persisting via RoomStore.
 *
 * Key invariants:
 * - Judge (judgePlayerId || hostPlayerId) can never reveal, buzz, or submit answers.
 * - Each player may reveal at most 1 cell per puzzle.
 * - Each player may submit at most 1 formal guess per puzzle.
 * - Answer text is only visible to the submitting player and the judge.
 * - Scoring: base = max(10, 100 − revealedCount), self-reveal +10, assist +5.
 */

function getJudgeId(room: Room): string {
  return room.judgePlayerId || room.hostPlayerId;
}

function now(): number {
  return Date.now();
}

function uid(): string {
  return crypto.randomUUID();
}

function requirePlayer(room: Room, playerId: string): Player {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) throw new Error("玩家不存在");
  return player;
}

function requireJudge(room: Room, playerId: string): void {
  if (getJudgeId(room) !== playerId) throw new Error("只有裁判可以执行此操作");
}

function requireNotJudge(room: Room, playerId: string): void {
  if (getJudgeId(room) === playerId) throw new Error("裁判不能执行此操作");
}

function requireRevealGuessState(room: Room): RevealGuessState {
  if (!room.revealGuessState) throw new Error("房间不是揭幕猜番模式");
  return room.revealGuessState;
}

function requireCurrentPuzzle(room: Room): RevealPuzzle {
  const state = requireRevealGuessState(room);
  const puzzle = state.puzzles[state.currentPuzzleIndex];
  if (!puzzle) throw new Error("当前没有题目");
  return puzzle;
}

function requirePuzzlePhase(puzzle: RevealPuzzle, ...phases: RevealGuessPhase[]): void {
  if (!phases.includes(puzzle.phase)) {
    throw new Error(`当前题目阶段不允许此操作（当前: ${puzzle.phase}）`);
  }
}

function ensurePlayerRoundState(puzzle: RevealPuzzle, playerId: string): RevealGuessPlayerRoundState {
  if (!puzzle.playerRoundStates[playerId]) {
    puzzle.playerRoundStates[playerId] = { hasRevealed: false, hasGuessed: false };
  }
  return puzzle.playerRoundStates[playerId];
}

function generateCells(): RevealCell[] {
  const cells: RevealCell[] = [];
  for (let row = 0; row < REVEAL_GUESS_GRID_SIZE; row++) {
    for (let col = 0; col < REVEAL_GUESS_GRID_SIZE; col++) {
      cells.push({ id: `cell-${row}-${col}`, row, col, revealed: false });
    }
  }
  return cells;
}

/** Compute base score for a correct guess based on how many cells were revealed. */
export function computeRevealGuessBaseScore(revealedCount: number): number {
  return Math.max(10, 100 - revealedCount);
}

/** Update scores and add a score event. */
function addScoreEvent(
  state: RevealGuessState,
  puzzleIndex: number,
  playerId: string,
  playerNickname: string,
  amount: number,
  reason: RevealGuessScoreEvent["reason"]
): void {
  state.scores[playerId] = (state.scores[playerId] ?? 0) + amount;
  state.scoreEvents.push({
    id: uid(),
    puzzleIndex,
    playerId,
    playerNickname,
    amount,
    reason,
    createdAt: now(),
  });
}

// ═══════════════════════════════════════════
// Init & Puzzle Management
// ═══════════════════════════════════════════

export function initRevealGuessState(room: Room, settings?: Partial<RevealGuessSettings>): Room {
  const merged: RevealGuessSettings = { ...DEFAULT_REVEAL_GUESS_SETTINGS, ...settings };
  room.gameMode = "reveal-guess";
  room.settings.ruleSet = "reveal-guess";
  room.settings.revealGuessSettings = merged;
  room.revealGuessState = {
    puzzles: [],
    currentPuzzleIndex: -1,
    scores: {},
    scoreEvents: [],
    settings: merged,
  };
  return room;
}

export function addPuzzle(
  room: Room,
  data: { imageUrl: string; answer: string; aliases?: string[]; hints?: string[] }
): Room {
  requireRevealGuessState(room);
  if (room.phase !== "lobby") throw new Error("只能在准备阶段添加题目");

  const state = room.revealGuessState!;
  const puzzle: RevealPuzzle = {
    id: uid(),
    index: state.puzzles.length,
    imageUrl: data.imageUrl,
    answer: data.answer,
    aliases: data.aliases ?? [],
    hints: data.hints ?? [],
    cells: generateCells(),
    revealedCount: 0,
    buzzingOpen: false,
    buzzQueue: [],
    pendingAnswers: [],
    revealRecords: [],
    playerRoundStates: {},
    phase: "pre-round",
    freeRevealUnlocked: false,
  };
  state.puzzles.push(puzzle);
  return room;
}

// ═══════════════════════════════════════════
// Start Game
// ═══════════════════════════════════════════

export function startRevealGuessGame(room: Room): Room {
  const state = requireRevealGuessState(room);
  if (room.phase !== "lobby") throw new Error("只能在准备阶段开始游戏");
  if (state.puzzles.length === 0) throw new Error("请先添加题目");

  room.phase = "playing";
  state.currentPuzzleIndex = 0;
  state.puzzles[0].phase = "revealing";
  return room;
}

// ═══════════════════════════════════════════
// Reveal Cell
// ═══════════════════════════════════════════

export function countActivePlayers(room: Room): number {
  const state = requireRevealGuessState(room);
  const judgeId = getJudgeId(room);
  return room.players.filter(p => p.id !== judgeId && !p.isBot && p.connected).length;
}

function checkAllActivePlayersRevealed(puzzle: RevealPuzzle, room: Room): boolean {
  const state = requireRevealGuessState(room);
  const judgeId = getJudgeId(room);
  return room.players
    .filter(p => p.id !== judgeId && !p.isBot && p.connected)
    .every(p => (puzzle.playerRoundStates[p.id]?.hasRevealed) ?? false);
}

export function revealCell(room: Room, playerId: string, cellId: string): Room {
  const state = requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "revealing");
  requireNotJudge(room, playerId);
  const player = requirePlayer(room, playerId);
  if (player.isBot) throw new Error("机器人不能翻牌");

  const mode = state.settings.revealLimitMode ?? "free-after-all-used";
  const rs = ensurePlayerRoundState(puzzle, playerId);

  if (rs.hasRevealed) {
    if (mode === "once-per-player") {
      throw new Error("本题你已经翻过格子了（once-per-player 模式）");
    }
    if (mode === "free-after-all-used") {
      if (!puzzle.freeRevealUnlocked && !checkAllActivePlayersRevealed(puzzle, room)) {
        throw new Error("你已翻过，请等待其他玩家翻牌或裁判开放自由翻牌");
      }
      // Auto-unlock when all active players have revealed
      if (!puzzle.freeRevealUnlocked && checkAllActivePlayersRevealed(puzzle, room)) {
        puzzle.freeRevealUnlocked = true;
      }
    }
    // mode === "free" — allow unlimited reveals
  }

  const cell = puzzle.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error("格子不存在");
  if (cell.revealed) throw new Error("这个格子已经被翻开了");

  cell.revealed = true;
  cell.revealedBy = playerId;
  cell.revealedAt = now();
  puzzle.revealedCount++;
  rs.hasRevealed = true;
  rs.revealedCellId = cellId;
  puzzle.revealRecords.push({ playerId, cellId, revealedAt: cell.revealedAt });
  puzzle.priorityGuesserId = playerId;

  // After revealing, if free-after-all-used and all have revealed, auto-unlock
  if (mode === "free-after-all-used" && !puzzle.freeRevealUnlocked && checkAllActivePlayersRevealed(puzzle, room)) {
    puzzle.freeRevealUnlocked = true;
  }

  return room;
}

// ═══════════════════════════════════════════
// Open Free Reveal (judge manually removes limit)
// ═══════════════════════════════════════════

export function openFreeReveal(room: Room, judgePlayerId: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");
  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "revealing");
  requireJudge(room, judgePlayerId);
  puzzle.freeRevealUnlocked = true;
  return room;
}

// ═══════════════════════════════════════════
// Submit Answer
// ═══════════════════════════════════════════

export function submitAnswer(
  room: Room,
  playerId: string,
  answer: string,
  type: "priority" | "buzz" | "formal"
): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "revealing", "buzzing");
  requireNotJudge(room, playerId);
  const player = requirePlayer(room, playerId);

  const rs = ensurePlayerRoundState(puzzle, playerId);
  if (rs.hasGuessed) throw new Error("本题你已经猜过了");

  if (type === "priority" && puzzle.priorityGuesserId !== playerId) {
    throw new Error("你没有优先猜答权");
  }
  if (type === "buzz" && !puzzle.buzzingOpen) {
    throw new Error("抢答尚未开放");
  }
  if (type === "buzz" && !puzzle.buzzQueue.includes(playerId)) {
    throw new Error("你不在抢答队列中");
  }

  const trimmed = answer.trim();
  if (!trimmed) throw new Error("答案不能为空");

  const pendingAnswer: RevealGuessPendingAnswer = {
    id: uid(),
    playerId,
    playerNickname: player.nickname,
    answer: trimmed,
    submittedAt: now(),
    type,
    status: "pending",
  };

  puzzle.pendingAnswers.push(pendingAnswer);
  rs.hasGuessed = true;

  return room;
}

// ═══════════════════════════════════════════
// Open Buzzing
// ═══════════════════════════════════════════

export function openBuzzing(room: Room, judgePlayerId: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "revealing");
  requireJudge(room, judgePlayerId);

  puzzle.phase = "buzzing";
  puzzle.buzzingOpen = true;
  puzzle.priorityGuesserId = undefined;

  return room;
}

export function closeBuzzing(room: Room, judgePlayerId: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "buzzing");
  requireJudge(room, judgePlayerId);

  puzzle.phase = "revealing";
  puzzle.buzzingOpen = false;
  puzzle.buzzQueue = [];

  return room;
}

export function skipPuzzle(room: Room, judgePlayerId: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requireJudge(room, judgePlayerId);

  puzzle.phase = "round-end";
  puzzle.buzzingOpen = false;
  puzzle.buzzQueue = [];
  puzzle.priorityGuesserId = undefined;

  return room;
}

// ═══════════════════════════════════════════
// Transfer Judge
// ═══════════════════════════════════════════

export function transferJudge(room: Room, callerId: string, newJudgeId: string): Room {
  requireRevealGuessState(room);
  // Host or current judge can transfer
  const currentJudge = getJudgeId(room);
  if (room.hostPlayerId !== callerId && currentJudge !== callerId) {
    throw new Error("只有房主或当前裁判可以转让裁判");
  }
  const target = room.players.find(p => p.id === newJudgeId);
  if (!target) throw new Error("目标玩家不存在");
  if (target.isBot) throw new Error("不能转让给机器人");
  room.judgePlayerId = newJudgeId;
  return room;
}

// ═══════════════════════════════════════════
// Return to Setup
// ═══════════════════════════════════════════

export function returnToSetup(room: Room, callerId: string): Room {
  const state = requireRevealGuessState(room);
  const currentJudge = getJudgeId(room);
  if (room.hostPlayerId !== callerId && currentJudge !== callerId) {
    throw new Error("只有房主或当前裁判可以回到准备阶段");
  }
  if (room.phase === "lobby") throw new Error("已经在准备阶段");
  // Reset to lobby
  room.phase = "lobby";
  state.currentPuzzleIndex = -1;
  for (const p of state.puzzles) {
    p.phase = "pre-round";
    p.buzzingOpen = false;
    p.buzzQueue = [];
    p.priorityGuesserId = undefined;
    p.revealedCount = 0;
    p.revealRecords = [];
    p.playerRoundStates = {};
    p.freeRevealUnlocked = false;
    for (const c of p.cells) {
      c.revealed = false;
      c.revealedBy = undefined;
      c.revealedAt = undefined;
    }
  }
  state.scores = {};
  state.scoreEvents = [];
  return room;
}

// ═══════════════════════════════════════════
// Buzz In
// ═══════════════════════════════════════════

export function buzzIn(room: Room, playerId: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requirePuzzlePhase(puzzle, "buzzing");
  requireNotJudge(room, playerId);
  requirePlayer(room, playerId);

  if (puzzle.buzzQueue.includes(playerId)) throw new Error("你已经在抢答队列中了");

  puzzle.buzzQueue.push(playerId);
  return room;
}

// ═══════════════════════════════════════════
// Judge Answer
// ═══════════════════════════════════════════

export function judgeAnswer(
  room: Room,
  judgePlayerId: string,
  answerId: string,
  verdict: "correct" | "wrong" | "partial"
): Room {
  const state = requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requireJudge(room, judgePlayerId);

  const idx = puzzle.pendingAnswers.findIndex((a) => a.id === answerId);
  if (idx === -1) throw new Error("答案不存在");

  const pendingAnswer = puzzle.pendingAnswers[idx];
  if (pendingAnswer.status !== "pending") throw new Error("该答案已经被判定过了");

  if (verdict === "correct") {
    pendingAnswer.status = "correct";

    const baseScore = computeRevealGuessBaseScore(puzzle.revealedCount);
    const lastReveal = puzzle.revealRecords.length > 0
      ? puzzle.revealRecords[puzzle.revealRecords.length - 1]
      : undefined;
    const lastRevealerId = lastReveal?.playerId;

    const isSelfReveal = pendingAnswer.playerId === lastRevealerId;
    const selfBonus = isSelfReveal ? 10 : 0;

    addScoreEvent(state, puzzle.index, pendingAnswer.playerId, pendingAnswer.playerNickname, baseScore, "correct-guess");

    if (isSelfReveal) {
      addScoreEvent(state, puzzle.index, pendingAnswer.playerId, pendingAnswer.playerNickname, 10, "self-reveal-bonus");
    }

    if (!isSelfReveal && lastRevealerId) {
      const revealer = requirePlayer(room, lastRevealerId);
      addScoreEvent(state, puzzle.index, lastRevealerId, revealer.nickname, 5, "reveal-assist");
    }

    puzzle.phase = "round-end";
    puzzle.buzzingOpen = false;
    puzzle.priorityGuesserId = undefined;
  } else {
    pendingAnswer.status = verdict;
    puzzle.pendingAnswers.splice(idx, 1);

    if (pendingAnswer.playerId === puzzle.priorityGuesserId) {
      puzzle.priorityGuesserId = undefined;
    }
    if (puzzle.phase === "buzzing") {
      puzzle.buzzQueue = puzzle.buzzQueue.filter((id) => id !== pendingAnswer.playerId);
    }
  }

  return room;
}

// ═══════════════════════════════════════════
// Show Hint
// ═══════════════════════════════════════════

export function showHint(room: Room, judgePlayerId: string, hintText: string): Room {
  requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = requireCurrentPuzzle(room);
  requireJudge(room, judgePlayerId);

  const trimmed = hintText.trim();
  if (!trimmed) throw new Error("提示不能为空");

  puzzle.hints.push(trimmed);
  return room;
}

// ═══════════════════════════════════════════
// Next Puzzle
// ═══════════════════════════════════════════

export function nextPuzzle(room: Room, judgePlayerId: string): Room {
  const state = requireRevealGuessState(room);
  if (room.phase !== "playing") throw new Error("当前不在对局中");

  const puzzle = state.puzzles[state.currentPuzzleIndex];
  if (!puzzle) throw new Error("当前没有题目");

  requireJudge(room, judgePlayerId);

  const nextIndex = state.currentPuzzleIndex + 1;
  if (nextIndex >= state.puzzles.length) {
    puzzle.phase = "game-end";
    state.currentPuzzleIndex = nextIndex;
    room.phase = "finished";
    return room;
  }

  puzzle.phase = "round-end";
  state.currentPuzzleIndex = nextIndex;
  state.puzzles[nextIndex].phase = "revealing";
  return room;
}

// ═══════════════════════════════════════════
// Adjust Score
// ═══════════════════════════════════════════

export function adjustScore(
  room: Room,
  judgePlayerId: string,
  targetPlayerId: string,
  amount: number,
  reason: string
): Room {
  const state = requireRevealGuessState(room);
  requireJudge(room, judgePlayerId);
  const targetPlayer = requirePlayer(room, targetPlayerId);

  const puzzleIndex = state.puzzles[state.currentPuzzleIndex]?.index ?? -1;

  state.scores[targetPlayerId] = (state.scores[targetPlayerId] ?? 0) + amount;
  state.scoreEvents.push({
    id: uid(),
    puzzleIndex,
    playerId: targetPlayerId,
    playerNickname: targetPlayer.nickname,
    amount,
    reason: "judge-adjust",
    createdAt: now(),
  });

  return room;
}

// ═══════════════════════════════════════════
// Sanitize for public view
// ═══════════════════════════════════════════

export function sanitizeRevealGuessState(
  room: Room,
  participantId: string,
  participantType: ParticipantType
): PublicRevealGuessState | null {
  const state = room.revealGuessState;
  if (!state) return null;

  const isJudge = getJudgeId(room) === participantId && participantType === "player";
  const puzzle = state.currentPuzzleIndex >= 0 && state.currentPuzzleIndex < state.puzzles.length
    ? state.puzzles[state.currentPuzzleIndex]
    : null;

  const overallPhase: RevealGuessPhase =
    state.currentPuzzleIndex < 0
      ? "pre-round"
      : state.currentPuzzleIndex >= state.puzzles.length
        ? "game-end"
        : (puzzle?.phase ?? "game-end");

  return {
    phase: overallPhase,
    currentPuzzleIndex: state.currentPuzzleIndex,
    puzzleCount: state.puzzles.length,
    puzzleList: state.puzzles.map(p => ({
      index: p.index,
      imageUrl: p.imageUrl,
      hasAnswer: !!p.answer,
      aliasCount: p.aliases.length,
      hintCount: p.hints.length,
    })),
    scores: state.scores,
    scoreEvents: state.scoreEvents,
    settings: state.settings,
    lastPuzzleResult: (() => {
      // Show previous puzzle if we've moved past it
      if (state.currentPuzzleIndex > 0 && state.currentPuzzleIndex <= state.puzzles.length) {
        const prev = state.puzzles[state.currentPuzzleIndex - 1];
        return { index: prev.index, answer: prev.answer, aliases: prev.aliases, imageUrl: prev.imageUrl, cells: prev.cells, scoreEvents: state.scoreEvents.filter(e => e.puzzleIndex === prev.index) };
      }
      // Also show the current puzzle result if it's been settled (round-end/game-end)
      if (puzzle && (puzzle.phase === "round-end" || puzzle.phase === "game-end")) {
        return { index: puzzle.index, answer: puzzle.answer, aliases: puzzle.aliases, imageUrl: puzzle.imageUrl, cells: puzzle.cells, scoreEvents: state.scoreEvents.filter(e => e.puzzleIndex === puzzle.index) };
      }
      return undefined;
    })(),
    currentPuzzle: puzzle
      ? {
          index: puzzle.index,
          imageUrl: puzzle.imageUrl,
          answer: isJudge ? puzzle.answer : undefined,
          aliases: isJudge ? puzzle.aliases : undefined,
          cells: puzzle.cells,
          revealedCount: puzzle.revealedCount,
          buzzingOpen: puzzle.buzzingOpen,
          buzzQueueLength: puzzle.buzzQueue.length,
          myBuzzPosition: isJudge ? undefined : puzzle.buzzQueue.indexOf(participantId),
          priorityGuesserNickname: puzzle.priorityGuesserId
            ? room.players.find((p) => p.id === puzzle.priorityGuesserId)?.nickname
            : undefined,
          phase: puzzle.phase,
          freeRevealUnlocked: puzzle.freeRevealUnlocked,
          myHasRevealed: isJudge ? undefined : puzzle.playerRoundStates[participantId]?.hasRevealed ?? false,
          hints: puzzle.hints,
          timerEndsAt: puzzle.timerEndsAt,
          timerPhase: puzzle.timerPhase,
          timerPaused: puzzle.timerPaused,
          myPendingAnswer: isJudge
            ? undefined
            : (() => {
                const my = puzzle.pendingAnswers.find((a) => a.playerId === participantId);
                if (!my) return undefined;
                return {
                  id: my.id,
                  answer: my.answer,
                  status: my.status,
                  judgeNote: my.judgeNote,
                  submittedAt: my.submittedAt,
                };
              })(),
          otherPendingAnswers: isJudge
            ? puzzle.pendingAnswers
                .filter((a) => a.playerId !== participantId)
                .map((a) => ({
                  id: a.id,
                  playerNickname: a.playerNickname,
                  status: a.status,
                  submittedAt: a.submittedAt,
                  answer: a.answer,
                  type: a.type,
                }))
            : puzzle.pendingAnswers.map((a) => ({
                id: a.id,
                playerNickname: a.playerNickname,
                status: a.status,
                submittedAt: a.submittedAt,
              })),
        }
      : null,
  };
}
