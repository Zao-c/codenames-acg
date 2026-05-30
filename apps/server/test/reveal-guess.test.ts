import assert from "node:assert/strict";
import {
  DEFAULT_WORD_PACK_ID,
  defaultWordPack,
  type Player,
  type RevealGuessSettings,
  type Room,
  type Spectator,
} from "@acg-codenames/shared";
import {
  addPuzzle,
  adjustScore,
  buzzIn,
  computeRevealGuessBaseScore,
  initRevealGuessState,
  judgeAnswer,
  nextPuzzle,
  openBuzzing,
  revealCell,
  sanitizeRevealGuessState,
  showHint,
  startRevealGuessGame,
  submitAnswer,
} from "../src/reveal-guess.ts";

function makePlayer(id: string, nickname: string, isHost: boolean): Player {
  return {
    id,
    nickname,
    profile: { accountType: "guest", username: null, avatarUrl: null },
    team: null,
    role: "operative",
    connected: true,
    isHost,
  };
}

function makeSpectator(id: string, nickname: string): Spectator {
  return {
    id,
    nickname,
    profile: { accountType: "guest", username: null, avatarUrl: null },
    connected: true,
    joinedAt: Date.now(),
  };
}

function makeRoom(hostId: string, players: Player[], spectators: Spectator[] = []): Room {
  return {
    id: "TEST01",
    phase: "lobby",
    players,
    spectators,
    joinQueue: [],
    board: [],
    currentTeam: "red",
    startingTeam: "red",
    clue: null,
    remainingCounts: { red: 0, blue: 0 },
    winner: null,
    settings: {
      ruleSet: "codenames",
      boardMode: "5x5",
      wordPackId: DEFAULT_WORD_PACK_ID,
      scoringMode: "classic",
    },
    wordPack: defaultWordPack,
    scores: { red: 0, blue: 0 },
    roundNumber: 1,
    messages: [],
    hostPlayerId: hostId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastEvent: "",
    lastReveal: null,
  };
}

// ═══════════════════════════════════════════
// initRevealGuessState
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge1", [makePlayer("judge1", "Judge", true)]);
  initRevealGuessState(room);

  assert.equal(room.gameMode, "reveal-guess");
  assert.equal(room.settings.ruleSet, "reveal-guess");
  assert.ok(room.revealGuessState);
  assert.equal(room.revealGuessState!.puzzles.length, 0);
  assert.equal(room.revealGuessState!.currentPuzzleIndex, -1);
  assert.equal(room.revealGuessState!.settings.puzzleCount, 10);
  console.log("ok initRevealGuessState");
}

// ═══════════════════════════════════════════
// addPuzzle
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge1", [makePlayer("judge1", "Judge", true)]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "data:img/1", answer: "EVA", aliases: ["新世纪福音战士"], hints: ["经典机甲"] });

  const state = room.revealGuessState!;
  assert.equal(state.puzzles.length, 1);
  const p = state.puzzles[0];
  assert.equal(p.answer, "EVA");
  assert.deepEqual(p.aliases, ["新世纪福音战士"]);
  assert.deepEqual(p.hints, ["经典机甲"]);
  assert.equal(p.cells.length, 81);
  assert.equal(p.phase, "pre-round");
  assert.equal(p.revealedCount, 0);
  console.log("ok addPuzzle");

  // addPuzzle in playing phase should fail
  startRevealGuessGame(room);
  assert.throws(() => addPuzzle(room, { imageUrl: "x", answer: "x" }), /准备阶段/);
}

// ═══════════════════════════════════════════
// startRevealGuessGame
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge1", [makePlayer("judge1", "Judge", true)]);
  initRevealGuessState(room);

  // No puzzles
  assert.throws(() => startRevealGuessGame(room), /添加题目/);

  addPuzzle(room, { imageUrl: "img1", answer: "test" });
  startRevealGuessGame(room);

  assert.equal(room.phase, "playing");
  assert.equal(room.revealGuessState!.currentPuzzleIndex, 0);
  assert.equal(room.revealGuessState!.puzzles[0].phase, "revealing");
  console.log("ok startRevealGuessGame");
}

// ═══════════════════════════════════════════
// revealCell
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  const cellId = "cell-3-5";

  // Judge cannot reveal
  assert.throws(() => revealCell(room, "judge", cellId), /裁判/);

  // Player1 reveal
  revealCell(room, "p1", cellId);
  const puzzle = room.revealGuessState!.puzzles[0];
  assert.equal(puzzle.revealedCount, 1);
  assert.equal(puzzle.priorityGuesserId, "p1");

  const cell = puzzle.cells.find((c) => c.id === cellId);
  assert.ok(cell);
  assert.equal(cell.revealed, true);
  assert.equal(cell.revealedBy, "p1");
  assert.ok(typeof cell.revealedAt === "number");

  // Player1 cannot reveal again
  assert.throws(() => revealCell(room, "p1", "cell-0-0"), /已经翻过/);

  // Cannot reveal already revealed cell
  assert.throws(() => revealCell(room, "p2", cellId), /已经被翻开/);

  // Player2 can reveal a different cell
  revealCell(room, "p2", "cell-0-0");
  assert.equal(puzzle.revealedCount, 2);
  assert.equal(puzzle.priorityGuesserId, "p2"); // new revealer gets priority
  console.log("ok revealCell");
}

// ═══════════════════════════════════════════
// submitAnswer — priority
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);
  revealCell(room, "p1", "cell-3-5");

  // Judge cannot submit
  assert.throws(() => submitAnswer(room, "judge", "ans", "formal"), /裁判/);

  // p2 is not priority guesser
  assert.throws(() => submitAnswer(room, "p2", "ans", "priority"), /优先/);

  // p1 can submit as priority
  submitAnswer(room, "p1", "EVA", "priority");
  const puzzle = room.revealGuessState!.puzzles[0];
  assert.equal(puzzle.pendingAnswers.length, 1);
  assert.equal(puzzle.pendingAnswers[0].answer, "EVA");
  assert.equal(puzzle.pendingAnswers[0].type, "priority");
  assert.equal(puzzle.pendingAnswers[0].status, "pending");

  // p1 cannot guess again
  assert.throws(() => submitAnswer(room, "p1", "ans2", "formal"), /已经猜过/);

  console.log("ok submitAnswer_priority");
}

// ═══════════════════════════════════════════
// submitAnswer — formal (no priority needed)
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // p1 can submit formal answer even without revealing
  submitAnswer(room, "p1", "EVA guess", "formal");
  const puzzle = room.revealGuessState!.puzzles[0];
  assert.equal(puzzle.pendingAnswers.length, 1);
  assert.equal(puzzle.pendingAnswers[0].type, "formal");
  console.log("ok submitAnswer_formal");
}

// ═══════════════════════════════════════════
// openBuzzing + buzzIn + submitAnswer buzz
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // Non-judge cannot open buzzing
  assert.throws(() => openBuzzing(room, "p1"), /裁判/);

  openBuzzing(room, "judge");
  const puzzle = room.revealGuessState!.puzzles[0];
  assert.equal(puzzle.phase, "buzzing");
  assert.equal(puzzle.buzzingOpen, true);

  // Judge cannot buzz
  assert.throws(() => buzzIn(room, "judge"), /裁判/);

  buzzIn(room, "p1");
  buzzIn(room, "p2");
  assert.deepEqual(puzzle.buzzQueue, ["p1", "p2"]);

  // Cannot buzz twice
  assert.throws(() => buzzIn(room, "p1"), /已经在抢答队列/);

  // p1 can submit buzz answer
  submitAnswer(room, "p1", "EVA", "buzz");
  assert.equal(puzzle.pendingAnswers.length, 1);

  // p3 not in queue cannot submit buzz
  const room3 = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p3", "Player3", false),
  ]);
  initRevealGuessState(room3);
  addPuzzle(room3, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room3);
  openBuzzing(room3, "judge");
  assert.throws(() => submitAnswer(room3, "p3", "ans", "buzz"), /抢答队列/);

  console.log("ok openBuzzing_buzzIn_submitBuzz");
}

// ═══════════════════════════════════════════
// judgeAnswer — correct (base score)
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // No reveal, 1 formal answer, judge correct
  submitAnswer(room, "p1", "EVA", "formal");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;

  // Non-judge cannot judge
  assert.throws(() => judgeAnswer(room, "p1", ansId, "correct"), /裁判/);

  judgeAnswer(room, "judge", ansId, "correct");

  const state = room.revealGuessState!;
  const puzzle = state.puzzles[0];

  // 0 reveals → baseScore = max(10, 100-0) = 100
  // No self-reveal bonus, no assist
  assert.equal(puzzle.phase, "round-end");
  assert.equal(state.scores["p1"], 100);

  const correctEvents = state.scoreEvents.filter((e) => e.reason === "correct-guess");
  assert.equal(correctEvents.length, 1);
  assert.equal(correctEvents[0].amount, 100);

  console.log("ok judgeAnswer_correct_base");
}

// ═══════════════════════════════════════════
// judgeAnswer — correct (self-reveal bonus)
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // p1 reveals, then submits, judge correct
  revealCell(room, "p1", "cell-0-0");
  assert.equal(room.revealGuessState!.puzzles[0].revealedCount, 1);
  submitAnswer(room, "p1", "EVA", "priority");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ansId, "correct");

  const state = room.revealGuessState!;
  // 1 reveal → baseScore = max(10, 100-1) = 99
  // + self-reveal bonus 10 → total 109
  assert.equal(state.scores["p1"], 109);
  assert.equal(state.scoreEvents.filter((e) => e.reason === "correct-guess")[0].amount, 99);
  assert.equal(state.scoreEvents.filter((e) => e.reason === "self-reveal-bonus")[0].amount, 10);
  assert.equal(state.scoreEvents.filter((e) => e.reason === "reveal-assist").length, 0);

  console.log("ok judgeAnswer_correct_selfReveal");
}

// ═══════════════════════════════════════════
// judgeAnswer — correct (assist bonus)
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // p1 reveals 1 cell, then p2 submits formal answer, judge correct
  revealCell(room, "p1", "cell-0-0");
  submitAnswer(room, "p2", "EVA", "formal");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ansId, "correct");

  const state = room.revealGuessState!;
  // 1 reveal → baseScore = max(10, 100-1) = 99 for p2
  // p1 gets assist bonus +5
  assert.equal(state.scores["p2"], 99);
  assert.equal(state.scores["p1"], 5);
  const correctEvents = state.scoreEvents.filter((e) => e.reason === "correct-guess");
  assert.equal(correctEvents.length, 1);
  assert.equal(correctEvents[0].amount, 99);
  assert.equal(correctEvents[0].playerId, "p2");
  const assistEvents = state.scoreEvents.filter((e) => e.reason === "reveal-assist");
  assert.equal(assistEvents.length, 1);
  assert.equal(assistEvents[0].amount, 5);
  assert.equal(assistEvents[0].playerId, "p1");

  console.log("ok judgeAnswer_correct_assist");
}

// ═══════════════════════════════════════════
// judgeAnswer — correct (minimum base 10 with many reveals)
// ═══════════════════════════════════════════

{
  // Create 83 players so we can reveal 81 cells + judge + answerer
  const players = [makePlayer("judge", "Judge", true)];
  for (let i = 0; i < 82; i++) {
    players.push(makePlayer(`p${i}`, `Player${i}`, false));
  }
  const room = makeRoom("judge", players);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  const cellIds: string[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      cellIds.push(`cell-${row}-${col}`);
    }
  }

  // Reveal all 81 cells using 81 different players
  for (let i = 0; i < 81; i++) {
    revealCell(room, `p${i}`, cellIds[i]);
  }
  assert.equal(room.revealGuessState!.puzzles[0].revealedCount, 81);

  // Player p81 submits answer (not among revealers)
  submitAnswer(room, "p81", "EVA", "formal");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ansId, "correct");

  const state = room.revealGuessState!;
  // 81 reveals → baseScore = max(10, 100-81) = 19
  // Last revealer (p80) gets assist +5
  const correctEvent = state.scoreEvents.find((e) => e.reason === "correct-guess")!;
  assert.equal(correctEvent.amount, 19);
  assert.equal(state.scores["p81"], 19);
  assert.equal(state.scores["p80"], 5);

  console.log("ok judgeAnswer_correct_minBase");
}

// ═══════════════════════════════════════════
// judgeAnswer — wrong
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);
  revealCell(room, "p1", "cell-0-0");
  submitAnswer(room, "p1", "wrong guess", "priority");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;

  judgeAnswer(room, "judge", ansId, "wrong");

  const puzzle = room.revealGuessState!.puzzles[0];
  // Pending answer removed
  assert.equal(puzzle.pendingAnswers.length, 0);
  // Priority cleared (because wrong answerer was priority guesser)
  assert.equal(puzzle.priorityGuesserId, undefined);
  // Player still has hasGuessed=true
  assert.equal(puzzle.playerRoundStates["p1"]?.hasGuessed, true);
  // Cannot guess again
  assert.throws(() => submitAnswer(room, "p1", "retry", "formal"), /已经猜过/);
  // Phase stays revealing
  assert.equal(puzzle.phase, "revealing");
  // No scores
  assert.equal(room.revealGuessState!.scores["p1"] ?? 0, 0);

  console.log("ok judgeAnswer_wrong");
}

// ═══════════════════════════════════════════
// judgeAnswer — wrong in buzzing phase
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);
  openBuzzing(room, "judge");
  buzzIn(room, "p1");
  buzzIn(room, "p2");
  submitAnswer(room, "p1", "wrong", "buzz");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;

  judgeAnswer(room, "judge", ansId, "wrong");

  const puzzle = room.revealGuessState!.puzzles[0];
  // p1 removed from buzz queue
  assert.deepEqual(puzzle.buzzQueue, ["p2"]);
  // Phase stays buzzing
  assert.equal(puzzle.phase, "buzzing");
  // p1 cannot guess again
  assert.throws(() => submitAnswer(room, "p1", "retry", "buzz"), /已经猜过/);

  console.log("ok judgeAnswer_wrong_buzzing");
}

// ═══════════════════════════════════════════
// judgeAnswer — partial
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);
  submitAnswer(room, "p1", "partial answer", "formal");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;

  judgeAnswer(room, "judge", ansId, "partial");

  const puzzle = room.revealGuessState!.puzzles[0];
  assert.equal(puzzle.pendingAnswers.length, 0);
  // No score change
  assert.equal(room.revealGuessState!.scores["p1"] ?? 0, 0);
  // Phase stays
  assert.equal(puzzle.phase, "revealing");

  console.log("ok judgeAnswer_partial");
}

// ═══════════════════════════════════════════
// showHint
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  assert.throws(() => showHint(room, "p1", "hint"), /裁判/);
  assert.throws(() => showHint(room, "judge", "   "), /不能为空/);

  showHint(room, "judge", "这是一部经典动画");
  showHint(room, "judge", "机甲题材");

  const puzzle = room.revealGuessState!.puzzles[0];
  assert.deepEqual(puzzle.hints, ["这是一部经典动画", "机甲题材"]);
  console.log("ok showHint");
}

// ═══════════════════════════════════════════
// nextPuzzle
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img1", answer: "P1" });
  addPuzzle(room, { imageUrl: "img2", answer: "P2" });
  addPuzzle(room, { imageUrl: "img3", answer: "P3" });
  startRevealGuessGame(room);

  // Must have been judged correct (round-end)
  submitAnswer(room, "p1", "P1", "formal");
  const ansId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ansId, "correct");

  assert.equal(room.revealGuessState!.puzzles[0].phase, "round-end");

  assert.throws(() => nextPuzzle(room, "p1"), /裁判/);

  nextPuzzle(room, "judge");
  const state = room.revealGuessState!;
  assert.equal(state.currentPuzzleIndex, 1);
  assert.equal(state.puzzles[0].phase, "round-end");
  assert.equal(state.puzzles[1].phase, "revealing");

  // Next again
  submitAnswer(room, "p1", "P2", "formal");
  const ans2Id = state.puzzles[1].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ans2Id, "correct");
  nextPuzzle(room, "judge");
  assert.equal(state.currentPuzzleIndex, 2);
  assert.equal(state.puzzles[2].phase, "revealing");

  // Last puzzle → finish
  submitAnswer(room, "p1", "P3", "formal");
  const ans3Id = state.puzzles[2].pendingAnswers[0].id;
  judgeAnswer(room, "judge", ans3Id, "correct");
  nextPuzzle(room, "judge");

  assert.equal(state.currentPuzzleIndex, 3);
  assert.equal(state.puzzles[2].phase, "game-end");
  assert.equal(room.phase, "finished");

  console.log("ok nextPuzzle");
}

// ═══════════════════════════════════════════
// adjustScore
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  assert.throws(() => adjustScore(room, "p1", "p1", 10, "test"), /裁判/);

  adjustScore(room, "judge", "p1", 15, "精彩表现");
  assert.equal(room.revealGuessState!.scores["p1"], 15);

  adjustScore(room, "judge", "p1", -5, "轻微违规");
  assert.equal(room.revealGuessState!.scores["p1"], 10);

  const events = room.revealGuessState!.scoreEvents.filter((e) => e.reason === "judge-adjust");
  assert.equal(events.length, 2);
  assert.equal(events[0].amount, 15);
  assert.equal(events[1].amount, -5);

  console.log("ok adjustScore");
}

// ═══════════════════════════════════════════
// sanitizeRevealGuessState — privacy
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA", aliases: ["新世纪"], hints: ["经典"] });
  startRevealGuessGame(room);
  submitAnswer(room, "p1", "secret answer", "formal");

  // Judge view — should NOT include myPendingAnswer
  const judgeView = sanitizeRevealGuessState(room, "judge", "player");
  assert.ok(judgeView);
  assert.equal(judgeView.currentPuzzle?.myPendingAnswer, undefined, "judge should not have myPendingAnswer");
  // Judge sees other answers as otherPendingAnswers WITH answer text
  assert.equal(judgeView.currentPuzzle!.otherPendingAnswers.length, 1);
  assert.equal(judgeView.currentPuzzle!.otherPendingAnswers[0].playerNickname, "Player1");
  assert.ok("answer" in judgeView.currentPuzzle!.otherPendingAnswers[0], "judge should see answer text");
  assert.equal(judgeView.currentPuzzle!.otherPendingAnswers[0].answer, "secret answer");

  // p1 view — should see own answer text
  const p1View = sanitizeRevealGuessState(room, "p1", "player");
  assert.ok(p1View);
  assert.equal(p1View.currentPuzzle!.myPendingAnswer!.answer, "secret answer");
  assert.equal(p1View.currentPuzzle!.myPendingAnswer!.status, "pending");

  // p2 view — should NOT see p1's answer text
  const p2View = sanitizeRevealGuessState(room, "p2", "player");
  assert.ok(p2View);
  assert.equal(p2View.currentPuzzle?.myPendingAnswer, undefined, "p2 should not have myPendingAnswer");
  assert.equal(p2View.currentPuzzle!.otherPendingAnswers.length, 1);
  assert.equal(p2View.currentPuzzle!.otherPendingAnswers[0].playerNickname, "Player1");
  assert.ok(!("answer" in p2View.currentPuzzle!.otherPendingAnswers[0]));

  // Spectator view
  const specView = sanitizeRevealGuessState(room, "spec1", "spectator");
  assert.ok(specView);
  assert.equal(specView.currentPuzzle?.myPendingAnswer, undefined);

  console.log("ok sanitizeRevealGuessState_privacy");
}

// ═══════════════════════════════════════════
// sanitizeRevealGuessState — buzzing info
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("p1", "Player1", false),
    makePlayer("p2", "Player2", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);
  openBuzzing(room, "judge");
  buzzIn(room, "p1");
  buzzIn(room, "p2");

  const p1View = sanitizeRevealGuessState(room, "p1", "player");
  assert.equal(p1View?.currentPuzzle?.buzzQueueLength, 2);
  // p1 is first in queue, so myBuzzPosition is 0, but indexOf would be -1 if not found
  assert.equal(p1View?.currentPuzzle?.myBuzzPosition, 0);

  const judgeView = sanitizeRevealGuessState(room, "judge", "player");
  assert.equal(judgeView?.currentPuzzle?.myBuzzPosition, undefined, "judge has no buzz position");

  console.log("ok sanitizeRevealGuessState_buzzing");
}

// ═══════════════════════════════════════════
// Full flow: reveal → openBuzzing → buzz → judge correct
// ═══════════════════════════════════════════

{
  const room = makeRoom("judge", [
    makePlayer("judge", "Judge", true),
    makePlayer("a1", "Alpha", false),
    makePlayer("a2", "Beta", false),
    makePlayer("a3", "Gamma", false),
    makePlayer("a4", "Delta", false),
  ]);
  initRevealGuessState(room);
  addPuzzle(room, { imageUrl: "img", answer: "EVA" });
  startRevealGuessGame(room);

  // a1 reveals 1 cell, gets priority
  revealCell(room, "a1", "cell-0-0");
  assert.equal(room.revealGuessState!.puzzles[0].priorityGuesserId, "a1");

  // a1 submits priority answer — wrong
  submitAnswer(room, "a1", "wrong", "priority");
  const wrongId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", wrongId, "wrong");
  assert.equal(room.revealGuessState!.scores["a1"] ?? 0, 0);

  // a2 also reveals
  revealCell(room, "a2", "cell-1-1");

  // Judge opens buzzing
  openBuzzing(room, "judge");
  buzzIn(room, "a3");
  buzzIn(room, "a4");

  // a3 submits buzz answer — correct
  submitAnswer(room, "a3", "EVA", "buzz");
  const correctId = room.revealGuessState!.puzzles[0].pendingAnswers[0].id;
  judgeAnswer(room, "judge", correctId, "correct");

  const state = room.revealGuessState!;
  // 2 reveals → baseScore = max(10, 98) = 98 for a3
  // a3 is not last revealer (a2 was) → a2 gets assist +5
  assert.equal(state.scores["a3"], 98);
  assert.equal(state.scores["a2"], 5);
  assert.equal(state.puzzles[0].phase, "round-end");

  console.log("ok full_flow");
}

// ═══════════════════════════════════════════
// Pure function: computeRevealGuessBaseScore
// ═══════════════════════════════════════════

{
  assert.equal(computeRevealGuessBaseScore(0), 100);
  assert.equal(computeRevealGuessBaseScore(1), 99);
  assert.equal(computeRevealGuessBaseScore(50), 50);
  assert.equal(computeRevealGuessBaseScore(80), 20);
  assert.equal(computeRevealGuessBaseScore(81), 19);
  assert.equal(computeRevealGuessBaseScore(90), 10);
  assert.equal(computeRevealGuessBaseScore(95), 10);
  assert.equal(computeRevealGuessBaseScore(100), 10);
  assert.equal(computeRevealGuessBaseScore(200), 10);
  console.log("ok computeRevealGuessBaseScore");
}

console.log("all reveal-guess tests passed");
