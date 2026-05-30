import { useCallback } from "react";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, ClientSession } from "@acg-codenames/shared";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RevealGuessActions {
  addPuzzle: (imageUrl: string, answer: string, aliases: string[], hints: string[]) => void;
  startGame: () => void;
  revealCell: (cellId: string) => void;
  submitAnswer: (answer: string, type: "priority" | "buzz" | "formal") => void;
  openBuzz: () => void;
  closeBuzz: () => void;
  buzzIn: () => void;
  judgeAnswer: (answerId: string, verdict: "correct" | "wrong" | "partial") => void;
  showHint: (hint: string) => void;
  nextPuzzle: () => void;
  skipPuzzle: () => void;
  adjustScore: (targetPlayerId: string, amount: number, reason: string) => void;
  transferJudge: (newJudgeId: string) => void;
  returnToSetup: () => void;
  openFreeReveal: () => void;
}

export function useRevealGuessActions(
  socket: AppSocket,
  session: ClientSession | null,
  setError: (v: string) => void
): RevealGuessActions {
  const roomId = session?.roomId;

  const addPuzzle = useCallback((imageUrl: string, answer: string, aliases: string[], hints: string[]) => {
    if (!roomId) return;
    socket.emit("reveal_guess_add_puzzle" as any, { roomId, imageUrl, answer, aliases, hints });
  }, [roomId, socket]);

  const startGame = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_start" as any, { roomId });
  }, [roomId, socket]);

  const revealCell = useCallback((cellId: string) => {
    if (!roomId) return;
    socket.emit("reveal_guess_reveal_cell" as any, { roomId, cellId });
  }, [roomId, socket]);

  const submitAnswer = useCallback((answer: string, type: "priority" | "buzz" | "formal") => {
    if (!roomId) return;
    socket.emit("reveal_guess_submit_answer" as any, { roomId, answer, type });
  }, [roomId, socket]);

  const openBuzz = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_open_buzz" as any, { roomId });
  }, [roomId, socket]);

  const closeBuzz = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_close_buzz" as any, { roomId });
  }, [roomId, socket]);

  const buzzIn = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_buzz_in" as any, { roomId });
  }, [roomId, socket]);

  const judgeAnswer = useCallback((answerId: string, verdict: "correct" | "wrong" | "partial") => {
    if (!roomId) return;
    socket.emit("reveal_guess_judge_answer" as any, { roomId, answerId, verdict });
  }, [roomId, socket]);

  const showHint = useCallback((hint: string) => {
    if (!roomId) return;
    socket.emit("reveal_guess_show_hint" as any, { roomId, hint });
  }, [roomId, socket]);

  const nextPuzzle = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_next_puzzle" as any, { roomId });
  }, [roomId, socket]);

  const skipPuzzle = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_skip_puzzle" as any, { roomId });
  }, [roomId, socket]);

  const adjustScore = useCallback((targetPlayerId: string, amount: number, reason: string) => {
    if (!roomId) return;
    socket.emit("reveal_guess_adjust_score" as any, { roomId, targetPlayerId, amount, reason });
  }, [roomId, socket]);

  const transferJudge = useCallback((newJudgeId: string) => {
    if (!roomId) return;
    socket.emit("reveal_guess_transfer_judge" as any, { roomId, newJudgeId });
  }, [roomId, socket]);

  const returnToSetup = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_return_to_setup" as any, { roomId });
  }, [roomId, socket]);

  const openFreeReveal = useCallback(() => {
    if (!roomId) return;
    socket.emit("reveal_guess_open_free_reveal" as any, { roomId });
  }, [roomId, socket]);

  return { addPuzzle, startGame, revealCell, submitAnswer, openBuzz, closeBuzz, buzzIn, judgeAnswer, showHint, nextPuzzle, skipPuzzle, adjustScore, transferJudge, returnToSetup, openFreeReveal };
}
