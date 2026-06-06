import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import {
  type ClientSession,
  type PublicRoomState,
  type RoomSummary,
} from "@acg-codenames/shared";

const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:3001";

type TestSocket = Socket<
  { room_state: (p: PublicRoomState) => void; session: (p: ClientSession) => void;
    room_summaries: (p: RoomSummary[]) => void; error_message: (p: { message: string }) => void;
    room_closed: (p: { roomId: string; reason: string }) => void; },
  Record<string, never>
>;

function mk(): TestSocket { return io(SERVER_URL, { transports: ["websocket"], forceNew: true, reconnection: false }); }
function waitConn(s: TestSocket) { return new Promise<void>(r => s.on("connect", () => r())); }
function onceSess(s: TestSocket, ms = 15000) {
  return new Promise<ClientSession>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("session timeout")), ms);
    s.once("session", p => { clearTimeout(t); resolve(p); });
    s.once("error_message", p => { clearTimeout(t); reject(new Error(p.message)); });
  });
}
function onceRS(s: TestSocket, ms = 15000) {
  return new Promise<PublicRoomState>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("room_state timeout")), ms);
    s.once("room_state", p => { clearTimeout(t); resolve(p); });
    s.once("error_message", p => { clearTimeout(t); reject(new Error(p.message)); });
  });
}
function waitRS(s: TestSocket, pred: (p: PublicRoomState) => boolean, ms = 15000, label = "") {
  const lastRS: PublicRoomState[] = [];
  let lastErr: string | null = null;
  s.on("room_state", p => { lastRS.push(p); if (lastRS.length > 5) lastRS.shift(); });
  s.on("error_message", p => { lastErr = p.message; });
  return new Promise<PublicRoomState>((resolve, reject) => {
    const t = setTimeout(() => {
      s.off("room_state", onRS); s.off("error_message", onErr);
      const l = lastRS[lastRS.length - 1];
      const extra = l ? ` lastPhase=${l.revealGuessPublic?.phase} lastScores=${JSON.stringify(l.revealGuessPublic?.scores)} lastEvents#=${l.revealGuessPublic?.scoreEvents?.length} jpid=${l.judgePlayerId} hpid=${l.hostPlayerId}` : "";
      reject(new Error(`pred timeout${label ? " " + label : ""} lastErr=${lastErr}${extra}`));
    }, ms);
    function onRS(p: PublicRoomState) { if (!pred(p)) return; clearTimeout(t); s.off("room_state", onRS); s.off("error_message", onErr); resolve(p); }
    function onErr(p: { message: string }) { clearTimeout(t); s.off("room_state", onRS); s.off("error_message", onErr); reject(new Error(p.message)); }
    s.on("room_state", onRS); s.on("error_message", onErr);
  });
}
function onceErr(s: TestSocket) { return new Promise<string>(r => s.once("error_message", p => r(p.message))); }

function log(name: string) { console.log("running " + name); }

async function setup(players = 2) {
  const judge = mk(), socks = [judge];
  for (let i = 0; i < players; i++) socks.push(mk());
  await Promise.all(socks.map(waitConn));

  judge.emit("create_reveal_guess_room", { nickname: "J", profile: { accountType: "guest" }, settings: { puzzleCount: 5, timerEnabled: false } });
  const [jSess] = await Promise.all([onceSess(judge), onceRS(judge)]);
  const rid = jSess.roomId;

  const names = [];
  for (let i = 0; i < players; i++) {
    const s = socks[i + 1]; const n = `P${i + 1}`; names.push(n);
    s.emit("join_room", { roomId: rid, nickname: n, profile: { accountType: "guest" } });
    await Promise.all([onceSess(s), onceRS(s)]);
  }

  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "AnswerOne", aliases: ["AO", "One"], hints: ["StartHint"] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 1);
  judge.emit("reveal_guess_start", { roomId: rid });
  // Capture all sockets' room_state in parallel
  const allRS = await Promise.all([waitRS(judge, r => r.phase === "playing" && r.revealGuessPublic!.phase === "revealing"),
     ...socks.slice(1).map(p => new Promise<any>((resolve, reject) => {
       p.once("room_state", resolve);
       setTimeout(() => reject(new Error("player rs timeout")), 10000);
     }))]);
  return { judge, players: socks.slice(1), socks, rid, jSess, names, jRoom: allRS[0],
    syncRS: async (s: TestSocket, ms = 5000) => {
      s.emit("sync_room_state", { roomId: rid } as any);
      return new Promise<PublicRoomState>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("sync rs timeout")), ms);
        s.once("room_state", p => { clearTimeout(t); resolve(p); });
        s.once("error_message", p => { clearTimeout(t); reject(new Error(p.message)); });
      });
    }
  };
}

async function testCreateRoomWithInitialPuzzle() {
  const judge = mk();
  await waitConn(judge);
  try {
    judge.emit("create_reveal_guess_room", {
      nickname: "J",
      profile: { accountType: "guest" },
      settings: { puzzleCount: 3, timerEnabled: false },
      initialPuzzle: {
        imageUrl: "data:image/png;base64,iVBORw0KGgo=",
        answer: "InitialAnswer",
        aliases: ["IA"],
        hints: ["FirstHint"],
      },
    } as any);
    const [, room] = await Promise.all([onceSess(judge), onceRS(judge)]);
    assert.equal(room.revealGuessPublic!.puzzleCount, 1);
    assert.equal(room.revealGuessPublic!.puzzleList[0].hasAnswer, true);
    assert.equal(room.revealGuessPublic!.puzzleList[0].aliasCount, 1);
    assert.equal(room.revealGuessPublic!.puzzleList[0].hintCount, 1);
    assert.match(room.revealGuessPublic!.puzzleList[0].imageUrl ?? "", /^\/api\/reveal-images\//);
    console.log("ok create_room_with_initial_puzzle");
  } finally {
    judge.disconnect();
  }
}

// ═══════════════════════════════════════════
// SANITIZE: non-judge can't see answer/aliases during game
// ═══════════════════════════════════════════
async function testSanitizeNoAnswerForPlayer() {
  const { judge, players, socks, syncRS } = await setup(1);
  try {
    const pr = await syncRS(players[0]);
    assert.equal(pr.revealGuessPublic!.currentPuzzle!.answer, undefined, "player should not see answer");
    assert.equal(pr.revealGuessPublic!.currentPuzzle!.aliases, undefined, "player should not see aliases");

    const jr = await syncRS(judge);
    assert.equal(jr.revealGuessPublic!.currentPuzzle!.answer, "AnswerOne", "judge should see answer");
    assert.deepEqual(jr.revealGuessPublic!.currentPuzzle!.aliases, ["AO", "One"], "judge should see aliases");
    console.log("ok sanitize_no_answer_for_player");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SANITIZE: player can't see other's answer text
// ═══════════════════════════════════════════
async function testSanitizePlayerCantSeeOtherAnswer() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "SECRET_P1", type: "formal" });
    await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);

    const p2r = await syncRS(players[1]);
    const p2Other = p2r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers!;
    assert.ok(p2Other.some(a => a.playerNickname === "P1"));
    for (const a of p2Other) assert.ok(!("answer" in (a as any)), "P2 should not see P1 answer text");

    const p1r = await syncRS(players[0]);
    assert.ok(p1r.revealGuessPublic!.currentPuzzle!.myPendingAnswer);
    assert.equal(p1r.revealGuessPublic!.currentPuzzle!.myPendingAnswer!.answer, "SECRET_P1");

    const jr = await syncRS(judge);
    const jOther = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers!;
    assert.ok(jOther.length >= 1);
    assert.equal(jOther[0].answer, "SECRET_P1");
    assert.equal(jOther[0].type, "formal");
    console.log("ok sanitize_player_cant_see_other_answer");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SANITIZE: round-end everyone sees answer
// ═══════════════════════════════════════════
async function testSanitizeRoundEndShowsAnswer() {
  // Custom setup with 2 puzzles
  const judge = mk(), p1 = mk();
  const socks = [judge, p1];
  await Promise.all(socks.map(waitConn));
  judge.emit("create_reveal_guess_room", { nickname: "J", profile: { accountType: "guest" }, settings: { puzzleCount: 5, timerEnabled: false } });
  const [jSess] = await Promise.all([onceSess(judge), onceRS(judge)]);
  const rid = jSess.roomId;
  p1.emit("join_room", { roomId: rid, nickname: "P1", profile: { accountType: "guest" } });
  await Promise.all([onceSess(p1), onceRS(p1)]);
  // Add 2 puzzles before starting
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "AnswerOne", aliases: ["AO"], hints: ["H1"] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 1);
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "AnswerTwo", aliases: ["AT"], hints: ["H2"] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 2);
  judge.emit("reveal_guess_start", { roomId: rid });
  await Promise.all([waitRS(judge, r => r.phase === "playing"), new Promise(r => { p1.once("room_state", r); setTimeout(() => {}, 5000); })]);
  const syncRS = async (s: TestSocket) => { s.emit("sync_room_state", { roomId: rid } as any); return new Promise<any>(r => s.once("room_state", r)); };

  try {
    p1.emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id, verdict: "correct" });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    for (const s of [judge, p1]) {
      const r = await syncRS(s);
      assert.ok(r.revealGuessPublic!.lastPuzzleResult, "should have lastPuzzleResult");
      assert.equal(r.revealGuessPublic!.lastPuzzleResult!.answer, "AnswerOne");
    }
    console.log("ok sanitize_round_end_shows_answer");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SANITIZE: non-judge only sees public hints
// ═══════════════════════════════════════════
async function testSanitizeHintsOnlyPublic() {
  const { judge, players, socks, rid, syncRS } = await setup(1);
  try {
    judge.emit("reveal_guess_show_hint", { roomId: rid, hint: "Public hint 2" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.hints.length >= 2);
    const pr = await syncRS(players[0]);
    assert.deepEqual(pr.revealGuessPublic!.currentPuzzle!.hints, ["StartHint", "Public hint 2"]);
    // Player should not have access to unpublished hints (which don't exist in public state anyway)
    console.log("ok sanitize_hints_only_public");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: judge cannot reveal
// ═══════════════════════════════════════════
async function testJudgeCannotReveal() {
  const { judge, socks, rid } = await setup(1);
  try {
    const err = onceErr(judge);
    judge.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    assert.match(await err, /裁判/);
    console.log("ok perm_judge_cannot_reveal");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: judge cannot buzz
// ═══════════════════════════════════════════
async function testJudgeCannotBuzz() {
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount >= 1);
    judge.emit("reveal_guess_open_buzz", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "buzzing");
    const err = onceErr(judge);
    judge.emit("reveal_guess_buzz_in", { roomId: rid });
    assert.match(await err, /裁判/);
    console.log("ok perm_judge_cannot_buzz");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: judge cannot submit answer
// ═══════════════════════════════════════════
async function testJudgeCannotSubmitAnswer() {
  const { judge, socks, rid } = await setup(1);
  try {
    const err = onceErr(judge);
    judge.emit("reveal_guess_submit_answer", { roomId: rid, answer: "test", type: "formal" });
    assert.match(await err, /裁判/);
    console.log("ok perm_judge_cannot_submit_answer");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: player cannot judge
// ═══════════════════════════════════════════
async function testPlayerCannotJudge() {
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "test", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const ansId = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    const err = onceErr(players[1]);
    players[1].emit("reveal_guess_judge_answer", { roomId: rid, answerId: ansId, verdict: "correct" });
    assert.match(await err, /裁判/);
    console.log("ok perm_player_cannot_judge");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: player cannot adjust score
// ═══════════════════════════════════════════
async function testPlayerCannotAdjustScore() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    const p = await syncRS(players[0]);
    const pid = p.players.find(pl => pl.nickname === "P1")!.id;
    const err = onceErr(players[1]);
    players[1].emit("reveal_guess_adjust_score", { roomId: rid, targetPlayerId: pid, amount: 10, reason: "test" });
    assert.match(await err, /裁判/);
    console.log("ok perm_player_cannot_adjust_score");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: player cannot next puzzle
// ═══════════════════════════════════════════
async function testPlayerCannotNextPuzzle() {
  const { judge, players, socks, rid } = await setup(2);
  try {
    // Finish current puzzle first
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id, verdict: "correct" });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");

    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_next_puzzle", { roomId: rid });
    assert.match(await err, /裁判/);
    console.log("ok perm_player_cannot_next_puzzle");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: spectator cannot reveal
// ═══════════════════════════════════════════
async function testSpectatorCannotReveal() {
  const { judge, socks, rid } = await setup(1);
  const spec = mk();
  try {
    await waitConn(spec);
    spec.emit("join_spectator", { roomId: rid, nickname: "Watcher", profile: { accountType: "guest" } });
    await onceSess(spec);
    const err = onceErr(spec);
    spec.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    assert.match(await err, /旁观者/);
    console.log("ok perm_spectator_cannot_reveal");
  } finally { [spec, ...socks].forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// PERMISSION: spectator cannot submit answer
// ═══════════════════════════════════════════
async function testSpectatorCannotSubmitAnswer() {
  const { judge, socks, rid } = await setup(1);
  const spec = mk();
  try {
    await waitConn(spec);
    spec.emit("join_spectator", { roomId: rid, nickname: "Watcher", profile: { accountType: "guest" } });
    await onceSess(spec);
    const err = onceErr(spec);
    spec.emit("reveal_guess_submit_answer", { roomId: rid, answer: "test", type: "formal" });
    assert.match(await err, /旁观者/);
    console.log("ok perm_spectator_cannot_submit_answer");
  } finally { [spec, ...socks].forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// RULE: same player cannot reveal twice
// ═══════════════════════════════════════════
async function testRuleNoDoubleReveal() {
  // Needs 2 players: free-after-all-used allows solo player to re-reveal
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    assert.match(await err, /等待/);
    console.log("ok rule_no_double_reveal");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// RULE: same player cannot guess twice
// ═══════════════════════════════════════════
async function testRuleNoDoubleGuess() {
  const { judge, players, socks, rid } = await setup(1);
  try {
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "guess1", type: "formal" });
    await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "guess2", type: "formal" });
    assert.match(await err, /已经猜过/);
    console.log("ok rule_no_double_guess");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// RULE: cannot buzz when buzzing is closed
// ═══════════════════════════════════════════
async function testRuleCantBuzzWhenClosed() {
  const { judge, players, socks, rid } = await setup(1);
  try {
    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_buzz_in", { roomId: rid });
    assert.match(await err, /buzzing|不允许|阶段/); // Should fail because phase is revealing, not buzzing
    console.log("ok rule_cant_buzz_when_closed");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// RULE: cannot reveal already-revealed cell
// ═══════════════════════════════════════════
async function testRuleCantRevealRevealed() {
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-4-4" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    const err = onceErr(players[1]);
    players[1].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-4-4" });
    assert.match(await err, /已经被翻开/);
    console.log("ok rule_cant_reveal_revealed");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SCORE: base score with 0 reveals = 100
// ═══════════════════════════════════════════
async function testScoreBase100() {
  const { judge, players, socks, rid } = await setup(1);
  try {
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const ansId = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: ansId, verdict: "correct" });
    const fr = await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    const pid = fr.players.find(p => p.nickname === "P1")!.id;
    assert.equal(fr.revealGuessPublic!.scores[pid], 100);
    assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "correct-guess" && e.amount === 100));
    console.log("ok score_base_100");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SCORE: self-reveal bonus
// ═══════════════════════════════════════════
async function testScoreSelfRevealBonus() {
  const { judge, players, socks, rid } = await setup(1);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "priority" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id, verdict: "correct" });
    const fr = await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    const pid = fr.players.find(p => p.nickname === "P1")!.id;
    // base = max(10, 100-1) = 99, + self-bonus 10 = 109
    assert.equal(fr.revealGuessPublic!.scores[pid], 109);
    assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "correct-guess" && e.amount === 99));
    assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "self-reveal-bonus" && e.amount === 10));
    console.log("ok score_self_reveal_bonus");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SCORE: assist bonus
// ═══════════════════════════════════════════
async function testScoreAssistBonus() {
  const { judge, players, socks, rid } = await setup(3);
  try {
    // P1 reveals 1 cell
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    // P2 answers correctly
    players[1].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id, verdict: "correct" });
    const fr = await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    const p1id = fr.players.find(p => p.nickname === "P1")!.id;
    const p2id = fr.players.find(p => p.nickname === "P2")!.id;
    // P2: base 99, P1: assist +5
    assert.equal(fr.revealGuessPublic!.scores[p2id], 99);
    assert.equal(fr.revealGuessPublic!.scores[p1id], 5);
    assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "reveal-assist" && e.amount === 5 && e.playerId === p1id));
    console.log("ok score_assist_bonus");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SCORE: minimum base = 10 (91+ reveals)
// ═══════════════════════════════════════════
async function testScoreMinBase10() {
  // With MAX_PLAYERS=8, we test the formula with fewer reveals.
  // Full formula coverage is in the unit tests (reveal-guess.test.ts).
  const { judge, players, socks, rid } = await setup(5);
  try {
    // 5 players + judge joined. 5 players each reveal 1 cell = 5 reveals.
    for (let i = 0; i < 5; i++) {
      players[i].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: `cell-${i}-${i}` });
      await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === i + 1);
    }
    // Player 4 (last revealer) answers
    players[4].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id, verdict: "correct" });
    const fr = await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    // 5 reveals → base = max(10, 95) = 95, self-reveal +10 → 105 for P5
     const p4id = fr.players.find(p => p.nickname === "P5")!.id;
     assert.equal(fr.revealGuessPublic!.scores[p4id], 105);
     assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "self-reveal-bonus" && e.amount === 10));
     // Only the last revealer (P5) gets self-reveal; earlier revealers get no assist (only last revealer gets assist if someone else answers)
     const p1id = fr.players.find(p => p.nickname === "P1")!.id;
     assert.equal(fr.revealGuessPublic!.scores[p1id] ?? 0, 0, "P1 should have 0 (not last revealer, not answerer)");
     // Verify we have a correct-guess event for the base score
     assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "correct-guess" && e.amount === 95));
    console.log("ok score_min_base_10");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SCORE: manual adjust creates score event
// ═══════════════════════════════════════════
async function testScoreManualAdjust() {
  const { judge, players, socks, rid, syncRS } = await setup(1);
  try {
    const pr = await syncRS(judge);
    const pid = pr.players.find(p => p.nickname === "P1")!.id;
    judge.emit("reveal_guess_adjust_score", { roomId: rid, targetPlayerId: pid, amount: 42, reason: "精彩表现" });
    await waitRS(judge, r => (r.revealGuessPublic!.scores[pid] ?? 0) === 42, 15000, "adjust+42");
     const fr = await syncRS(judge);
     assert.equal(fr.revealGuessPublic!.scores[pid], 42);
     assert.ok(fr.revealGuessPublic!.scoreEvents.some(e => e.reason === "judge-adjust" && e.amount === 42 && e.playerId === pid));
     // Negative adjustment
     judge.emit("reveal_guess_adjust_score", { roomId: rid, targetPlayerId: pid, amount: -5, reason: "违规" });
     await waitRS(judge, r => (r.revealGuessPublic!.scores[pid] ?? 0) === 37, 15000, "adjust-5");
     const fr2 = await syncRS(judge);
     assert.equal(fr2.revealGuessPublic!.scores[pid], 37);
     console.log("ok score_manual_adjust");
   } finally { socks.forEach(s => s.disconnect()); }
 }

// ═══════════════════════════════════════════
// COMPLETE FLOW: wrong answer → buzzing → correct
// ═══════════════════════════════════════════
async function testFullFlow() {
  const { judge, players, socks, rid } = await setup(2);
  try {
    // P1 reveals
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    // P1 submits wrong answer
    players[0].emit("reveal_guess_submit_answer", { roomId: rid, answer: "wrong", type: "priority" });
    let jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const wrongId = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: wrongId, verdict: "wrong" });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "revealing");
    // Open buzzing
    judge.emit("reveal_guess_open_buzz", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "buzzing");
    // P2 buzzes and answers
    players[1].emit("reveal_guess_buzz_in", { roomId: rid });
    players[1].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "buzz" });
    jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const ansId = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    // Verify pending answer has type buzz
    assert.equal(jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].type, "buzz");
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: ansId, verdict: "correct" });
    const fr = await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    const p1id = fr.players.find(p => p.nickname === "P1")!.id;
    const p2id = fr.players.find(p => p.nickname === "P2")!.id;
    assert.equal(fr.revealGuessPublic!.scores[p2id], 99);
    assert.equal(fr.revealGuessPublic!.scores[p1id], 5); // assist
    console.log("ok full_flow_wrong_to_buzz");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// SKIP: judge skips puzzle → no scores
// ═══════════════════════════════════════════
async function testSkipPuzzle() {
  const { judge, players, socks, rid, syncRS } = await setup(1);
  try {
    judge.emit("reveal_guess_skip_puzzle", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    const fr = await syncRS(judge);
    // No scores awarded
    const pid = fr.players.find(p => p.nickname === "P1")!.id;
    assert.equal(fr.revealGuessPublic!.scores[pid] ?? 0, 0);
    // Can go to next
    judge.emit("reveal_guess_next_puzzle", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzleIndex === 1);
    console.log("ok skip_puzzle");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// CLOSE BUZZ: close buzzing returns to revealing
// ═══════════════════════════════════════════
async function testCloseBuzz() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    judge.emit("reveal_guess_open_buzz", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "buzzing");
    players[1].emit("reveal_guess_buzz_in", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.buzzQueueLength >= 1);
    judge.emit("reveal_guess_close_buzz", { roomId: rid });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "revealing");
    const fr = await syncRS(judge);
    assert.equal(fr.revealGuessPublic!.currentPuzzle!.buzzQueueLength, 0);
    console.log("ok close_buzz");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// Judge Transfer
// ═══════════════════════════════════════════
async function testHostDefaultJudge() {
  const { judge, socks, rid, syncRS } = await setup(1);
  try {
    const r = await syncRS(judge);
    // validate public state includes hostPlayerId for judge
    assert.ok(r.hostPlayerId, "room should have hostPlayerId");
    // Judge should be the host by default (judgePlayerId === hostPlayerId or undefined)
    assert.ok(!r.judgePlayerId || r.judgePlayerId === r.hostPlayerId, "default judge should be host");
    console.log("ok judge_host_default");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testTransferJudge() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    const pr = await syncRS(players[0]);
    const p1id = pr.players.find(p => p.nickname === "P1")!.id;
    // Host transfers judge to P1
    judge.emit("reveal_guess_transfer_judge", { roomId: rid, newJudgeId: p1id } as any);
    const r = await waitRS(judge, r => {
      return (r.judgePlayerId || r.hostPlayerId) === p1id;
    }, 10000, "transferJudge");

    // P2 (not judge) can submit, and P1 (new judge) can now judge answers
    players[1].emit("reveal_guess_submit_answer", { roomId: rid, answer: "AnswerOne", type: "formal" });
    const jr = await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const ansId = jr.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    // P1 (new judge) judges correctly
    players[0].emit("reveal_guess_judge_answer", { roomId: rid, answerId: ansId, verdict: "correct" });
    await waitRS(judge, r => r.revealGuessPublic!.phase === "round-end");
    console.log("ok judge_transfer");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testOldJudgeCannotJudge() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    const pr = await syncRS(players[0]);
    const p1id = pr.players.find(p => p.nickname === "P1")!.id;
    judge.emit("reveal_guess_transfer_judge", { roomId: rid, newJudgeId: p1id } as any);
    await waitRS(judge, r => (r.judgePlayerId || r.hostPlayerId) === p1id);

    // P2 submits answer (not the judge)
    players[1].emit("reveal_guess_submit_answer", { roomId: rid, answer: "test", type: "formal" });
    await waitRS(judge, r => (r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers?.length ?? 0) >= 1);
    const r = await syncRS(judge);
    const ansId = r.revealGuessPublic!.currentPuzzle!.otherPendingAnswers![0].id;
    // Old judge (host) can no longer judge
    const err = onceErr(judge);
    judge.emit("reveal_guess_judge_answer", { roomId: rid, answerId: ansId, verdict: "correct" });
    assert.match(await err, /裁判/);
    console.log("ok judge_old_cannot_judge");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testReturnToSetup() {
  const judge = mk(), p1 = mk();
  const socks = [judge, p1];
  await Promise.all(socks.map(waitConn));
  judge.emit("create_reveal_guess_room", { nickname: "J", profile: { accountType: "guest" }, settings: { puzzleCount: 5, timerEnabled: false } });
  const [jSess] = await Promise.all([onceSess(judge), onceRS(judge)]);
  const rid = jSess.roomId;
  p1.emit("join_room", { roomId: rid, nickname: "P1", profile: { accountType: "guest" } });
  await Promise.all([onceSess(p1), onceRS(p1)]);
  // Add puzzles before starting
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "A", aliases: [], hints: [] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 1);
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "B", aliases: [], hints: [] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 2);
  judge.emit("reveal_guess_start", { roomId: rid });
  await waitRS(judge, r => r.phase === "playing");

  try {
    judge.emit("reveal_guess_return_to_setup", { roomId: rid } as any);
    const r = await waitRS(judge, r => r.phase === "lobby");
    assert.equal(r.revealGuessPublic!.phase, "pre-round");
    assert.equal(r.revealGuessPublic!.currentPuzzleIndex, -1);
    console.log("ok judge_return_to_setup");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testPlayerCannotTransferJudge() {
  const { judge, players, socks, rid, syncRS } = await setup(2);
  try {
    const pr = await syncRS(players[0]);
    const p2id = pr.players.find(p => p.nickname === "P2")!.id;
    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_transfer_judge", { roomId: rid, newJudgeId: p2id } as any);
    assert.match(await err, /裁判|房主|转让/);
    console.log("ok judge_player_cannot_transfer");
  } finally { socks.forEach(s => s.disconnect()); }
}

// ═══════════════════════════════════════════
// Reveal Limit Mode (deadlock fix)
// ═══════════════════════════════════════════
async function testTwoPlayerFreeAfterAllUsed() {
  // Judge + 1 player: after first reveal, can reveal again (all revealed)
  const { judge, players, socks, rid } = await setup(1);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    // Should be able to reveal again (all active players have revealed)
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 2);
    assert.ok(true);
    console.log("ok deadlock_two_player");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testThreePlayerCannotRevealTwice() {
  // Judge + 2 players: first reveal OK, second blocked until all reveal
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    const err = onceErr(players[0]);
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    assert.match(await err, /等待/);
    console.log("ok deadlock_three_player_blocked");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testThreePlayerAfterAllReveal() {
  // Both players reveal, then either can continue
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    players[1].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 2);
    // Now player 0 can reveal again
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-2" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 3);
    console.log("ok deadlock_three_player_after_all");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testFreeMode() {
  // free mode allows unlimited reveals
  const judge = mk(), p1 = mk();
  const socks = [judge, p1];
  await Promise.all(socks.map(waitConn));
  judge.emit("create_reveal_guess_room", { nickname: "J", profile: { accountType: "guest" }, settings: { puzzleCount: 2, timerEnabled: false, revealLimitMode: "free" } });
  const [jSess] = await Promise.all([onceSess(judge), onceRS(judge)]);
  const rid = jSess.roomId;
  p1.emit("join_room", { roomId: rid, nickname: "P1", profile: { accountType: "guest" } });
  await Promise.all([onceSess(p1), onceRS(p1)]);
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "A", aliases: [], hints: [] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 1);
  judge.emit("reveal_guess_start", { roomId: rid });
  await Promise.all([waitRS(judge, r => r.phase === "playing"), new Promise(r => { p1.once("room_state", r); setTimeout(() => {}, 5000); })]);
  try {
    // Single player can reveal 3 times in free mode
    p1.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    p1.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 2);
    p1.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-2" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 3);
    console.log("ok deadlock_free_mode");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testOncePerPlayerMode() {
  // Once-per-player: cannot reveal twice even if all have revealed
  const judge = mk(), p1 = mk(), p2 = mk();
  const socks = [judge, p1, p2];
  await Promise.all(socks.map(waitConn));
  judge.emit("create_reveal_guess_room", { nickname: "J", profile: { accountType: "guest" }, settings: { puzzleCount: 2, timerEnabled: false, revealLimitMode: "once-per-player" } });
  const [jSess] = await Promise.all([onceSess(judge), onceRS(judge)]);
  const rid = jSess.roomId;
  for (const [s, n] of [[p1, "P1"], [p2, "P2"]]) {
    s.emit("join_room", { roomId: rid, nickname: n, profile: { accountType: "guest" } });
    await Promise.all([onceSess(s), onceRS(s)]);
  }
  judge.emit("reveal_guess_add_puzzle", { roomId: rid, imageUrl: "data:image/png;base64,iVBOR", answer: "A", aliases: [], hints: [] });
  await waitRS(judge, r => r.revealGuessPublic!.puzzleCount === 1);
  judge.emit("reveal_guess_start", { roomId: rid });
   await waitRS(judge, r => r.phase === "playing");
   await Promise.all([p1, p2].map(s => new Promise(r => { s.once("room_state", r); setTimeout(() => r(undefined), 5000); })));
  try {
    // Both players reveal once
    p1.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    p2.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 2);
    // Even though all have revealed, p1 cannot reveal again
    const err = onceErr(p1);
    p1.emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-2" });
    assert.match(await err, /once-per-player/);
    console.log("ok deadlock_once_per_player");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function testOpenFreeRevealButton() {
  // Judge manually opens free reveal, then a player can reveal twice
  const { judge, players, socks, rid } = await setup(2);
  try {
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-0" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 1);
    // Judge opens free reveal
    judge.emit("reveal_guess_open_free_reveal", { roomId: rid } as any);
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.freeRevealUnlocked === true);
    // Now player 0 can reveal again even though P2 hasn't revealed
    players[0].emit("reveal_guess_reveal_cell", { roomId: rid, cellId: "cell-0-1" });
    await waitRS(judge, r => r.revealGuessPublic!.currentPuzzle!.revealedCount === 2);
    console.log("ok deadlock_open_free_reveal");
  } finally { socks.forEach(s => s.disconnect()); }
}

async function main() {
  const tests: [string, () => Promise<void>][] = [
    ["Create", testCreateRoomWithInitialPuzzle],
    ["Sanitize", testSanitizeNoAnswerForPlayer],
    ["Sanitize", testSanitizePlayerCantSeeOtherAnswer],
    ["Sanitize", testSanitizeRoundEndShowsAnswer],
    ["Sanitize", testSanitizeHintsOnlyPublic],
    ["Permission", testJudgeCannotReveal],
    ["Permission", testJudgeCannotBuzz],
    ["Permission", testJudgeCannotSubmitAnswer],
    ["Permission", testPlayerCannotJudge],
    ["Permission", testPlayerCannotAdjustScore],
    ["Permission", testPlayerCannotNextPuzzle],
    ["Permission", testSpectatorCannotReveal],
    ["Permission", testSpectatorCannotSubmitAnswer],
    ["Rule", testRuleNoDoubleReveal],
    ["Rule", testRuleNoDoubleGuess],
    ["Rule", testRuleCantBuzzWhenClosed],
    ["Rule", testRuleCantRevealRevealed],
    ["Scoring", testScoreBase100],
    ["Scoring", testScoreSelfRevealBonus],
    ["Scoring", testScoreAssistBonus],
    ["Scoring", testScoreMinBase10],
    ["Scoring", testScoreManualAdjust],
    ["Flow", testFullFlow],
    ["Flow", testSkipPuzzle],
    ["Flow", testCloseBuzz],
    ["Judge", testHostDefaultJudge],
    ["Judge", testTransferJudge],
    ["Judge", testOldJudgeCannotJudge],
    ["Judge", testReturnToSetup],
    ["Judge", testPlayerCannotTransferJudge],
    ["Deadlock", testTwoPlayerFreeAfterAllUsed],
    ["Deadlock", testThreePlayerCannotRevealTwice],
    ["Deadlock", testThreePlayerAfterAllReveal],
    ["Deadlock", testFreeMode],
    ["Deadlock", testOncePerPlayerMode],
    ["Deadlock", testOpenFreeRevealButton],
  ];
  let passed = 0;
  for (const [category, fn] of tests) {
    log(`[${category}] ${fn.name}`);
    try {
      await fn();
      passed++;
    } catch (e) {
      console.error(`FAILED ${fn.name}:`, e instanceof Error ? e.message : e);
      throw e;
    }
  }
  console.log(`all ${passed}/${tests.length} reveal-guess e2e checks passed`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
