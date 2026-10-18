import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../../context/GameContext";
import { useRevealGuessActions } from "./useRevealGuessActions";
import { PrepRoom } from "./PrepRoom";
import { RevealGuessBoard, type BoardCellData } from "./RevealGuessBoard";
import type { RevealCell as RevealCellType, RevealGuessPhase } from "@acg-codenames/shared";

const GRID = 9;

function phaseLabel(phase: RevealGuessPhase | string | undefined): string {
  switch (phase) {
    case "pre-round": return "准备中";
    case "revealing": return "自由翻牌中";
    case "buzzing": return "抢答开放中";
    case "round-end": return "本题结算";
    case "game-end": return "已结束";
    default: return "";
  }
}

export function RevealGuessRoom() {
  const g = useGame();
  const navigate = useNavigate();
  const { socket, session, room, error, setError, connectionState, focusMode, exitFocusMode } = g;
  const actions = useRevealGuessActions(socket, session, setError);

  const [answerInput, setAnswerInput] = useState("");
  const [hintInput, setHintInput] = useState("");
  const [showFullImage, setShowFullImage] = useState(false);
  const [adjustPlayerId, setAdjustPlayerId] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [recentCellId, setRecentCellId] = useState<string | null>(null);
  const [showScoreAdjust, setShowScoreAdjust] = useState(false);

  const rg = room?.revealGuessPublic;
  const isHost = room?.hostPlayerId === session?.participantId;
  const judgeId = room?.judgePlayerId || room?.hostPlayerId;
  const isJudge = session?.participantId === judgeId;
  const puzzle = rg?.currentPuzzle;
  const isRevealPhase = puzzle?.phase === "revealing";
  const isBuzzing = puzzle?.phase === "buzzing";
  const isRoundEnd = puzzle?.phase === "round-end" || rg?.phase === "game-end";
  const isPreRound = rg?.phase === "pre-round";
  const hasPuzzle = !!puzzle;
  const hasPending = (puzzle?.otherPendingAnswers?.length ?? 0) > 0;
  const myPending = puzzle?.myPendingAnswer;
  const canAct = session?.participantType === "player" && !isJudge;
  const imageUrl = puzzle?.imageUrl ?? "";
  const myHasRevealed = puzzle?.myHasRevealed ?? false;
  const freeUnlocked = !!puzzle?.freeRevealUnlocked;
  const gridPx = Math.min(540, typeof window !== "undefined" ? window.innerWidth - 48 : 540);
  const typeLabel = (t: string) => t === "priority" ? "🎯 优先" : t === "buzz" ? "⚡ 抢答" : " 📝";

  const handleSubmitAnswer = useCallback(() => {
    if (!answerInput.trim()) return;
    actions.submitAnswer(answerInput.trim(), "formal");
    setAnswerInput("");
  }, [actions, answerInput]);

  const handlePrioritySubmit = useCallback(() => {
    if (!answerInput.trim()) return;
    actions.submitAnswer(answerInput.trim(), "priority");
    setAnswerInput("");
  }, [actions, answerInput]);

  const handleBuzzSubmit = useCallback(() => {
    if (!answerInput.trim()) return;
    actions.submitAnswer(answerInput.trim(), "buzz");
    setAnswerInput("");
  }, [actions, answerInput]);

  async function compressImage(file: File): Promise<string> {
    const img = new Image();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const MAX = 1280;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
          else { w = Math.round(w * (MAX / h)); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        try {
          canvas.toBlob((blob) => {
            if (!blob) return resolve(dataUrl);
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          }, "image/webp", 0.85);
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = dataUrl;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && focusMode) exitFocusMode(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, exitFocusMode]);

  useEffect(() => {
    if (!recentCellId) return;
    const t = setTimeout(() => setRecentCellId(null), 700);
    return () => clearTimeout(t);
  }, [recentCellId]);

  const handleReveal = useCallback((cellId: string) => {
    actions.revealCell(cellId);
    setRecentCellId(cellId);
  }, [actions]);

  const boardCells: BoardCellData[] = useMemo(() =>
    puzzle?.cells.map(cell => ({
      cell,
      imageUrl,
      canClick: canAct && isRevealPhase && !cell.revealed && !showFullImage,
      onReveal: () => handleReveal(cell.id),
      playerNickname: cell.revealedBy && room ? room.players.find(p => p.id === cell.revealedBy)?.nickname : undefined,
      isRecent: cell.id === recentCellId,
    })) ?? [],
  [puzzle?.cells, imageUrl, canAct, isRevealPhase, showFullImage, handleReveal, room, recentCellId]);

  if (!room) {
    return <section className="panel"><h2>{connectionState === "connecting" ? "正在连接..." : "等待进入房间"}</h2>
      {error ? <p className="error-text">{error}</p> : null}
      <button className="primary-button" onClick={() => navigate("/")}>返回首页</button></section>;
  }

  return (
    <section className="panel rg-room">
      {/* ═══════ Focus Mode ═══════ */}
      {focusMode ? (
        <div className="rg-focus-layout">
          <button className="rg-focus-exit" onClick={exitFocusMode} aria-label="退出专注模式">
            退出专注
          </button>
          {puzzle && imageUrl ? (
            <div className="rg-focus-board-area">
              <div className="rg-focus-status">
                第 {rg ? rg.currentPuzzleIndex + 1 : "?"} / {rg?.puzzleCount ?? "?"} 题 · 已揭开 {puzzle.revealedCount} / 81 · {phaseLabel(puzzle.phase)}
              </div>
              <RevealGuessBoard cells={boardCells} className="rg-board-focus" showFullImage={showFullImage} isRoundEnd={isRoundEnd} />
              {canAct && !isJudge && (
                <div className="rg-focus-hint">
                  {myHasRevealed && !freeUnlocked ? "你已翻过，请等待其他玩家翻牌" :
                   freeUnlocked ? "自由翻牌已开放，可以继续揭幕" :
                   isRevealPhase && !myHasRevealed ? "选择一个白幕格子揭开" :
                   isBuzzing ? "抢答阶段" : ""}
                </div>
              )}
              {isRoundEnd && rg?.lastPuzzleResult && (
                <div className="rg-answer-card" style={{ marginTop: 12 }}>
                  <strong>正确答案：{rg.lastPuzzleResult.answer}</strong>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
              等待裁判开始游戏...
            </div>
          )}
        </div>
      ) : (
      <>
        <div className="rg-topbar">
          <div className="rg-topbar-left">
            <span className="rg-title">揭幕猜番</span>
            <span className="rg-chip">房间 {room.id}</span>
            <span className="rg-chip">裁判: {room.players.find(p => p.id === judgeId)?.nickname ?? judgeId}</span>
            {!isPreRound && <span className="rg-chip">第 {rg ? rg.currentPuzzleIndex + 1 : "?"} / {rg?.puzzleCount ?? "?"} 题</span>}
            {!isPreRound && <span className="rg-chip">已揭开 {puzzle?.revealedCount ?? 0} / 81</span>}
            <span className="rg-chip rg-chip-accent">{phaseLabel(puzzle?.phase ?? rg?.phase)}</span>
          </div>
        </div>
      {error ? <p className="error-text">{error}</p> : null}

      {/* ═══════ Preparation Room: Judge View ═══════ */}
      {!focusMode && isJudge && isPreRound && (
        <PrepRoom
          room={room} rg={rg} actions={actions} g={g} isJudge={isJudge}
          compressImage={compressImage} setError={setError}
        />
      )}

      {/* ═══════ Preparation Room: Player View ═══════ */}
      {!focusMode && !isJudge && isPreRound && (
        <div className="rg-card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 4px" }}>等待裁判准备题目中</p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            当前裁判：<strong>{room.players.find(p => p.id === judgeId)?.nickname ?? judgeId}</strong>
          </p>
          {rg?.puzzleCount != null && rg.puzzleCount > 0 && (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
              已添加 {rg.puzzleCount} 道题
            </p>
          )}
        </div>
      )}

      {/* ═══════ Playing: Two-column ═══════ */}
      {hasPuzzle && !isPreRound && (
        <div className="rg-two-col-main">
          {/* Left: Board */}
          <div>
            {puzzle && imageUrl ? (
              <div className="rg-board-card">
                <div className="rg-board-header">
                  <span style={{ fontWeight: 600 }}>第 {rg ? rg.currentPuzzleIndex + 1 : "?"} / {rg?.puzzleCount ?? "?"} 题</span>
                  <span className="rg-chip">已揭开 {puzzle.revealedCount} / 81</span>
                  {isJudge && (
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}>
                      <input type="checkbox" checked={showFullImage} onChange={e => setShowFullImage(e.target.checked)} /> 预览完整图
                    </label>
                  )}
                </div>
                <RevealGuessBoard cells={boardCells} className="rg-board-normal" showFullImage={showFullImage} isRoundEnd={isRoundEnd} />
              </div>
            ) : puzzle && !imageUrl ? (
              <div className="rg-card" style={{ textAlign: "center", padding: 40 }}>
                <p style={{ color: "var(--muted)", margin: 0 }}>等待裁判上传图片...</p>
              </div>
            ) : null}

            {!focusMode && isRoundEnd && rg?.lastPuzzleResult && (
              <div className="rg-answer-card">
                <strong>正确答案：{rg.lastPuzzleResult.answer}</strong>
                {rg.lastPuzzleResult.aliases.length > 0 && <p style={{ margin: "4px 0 0", fontSize: 13 }}>别名：{rg.lastPuzzleResult.aliases.join("、")}</p>}
              </div>
            )}
          </div>

          {/* Right: Panel */}
          <div>
            {/* Judge panel */}
            {!focusMode && isJudge && (
              <div className="rg-card" style={{ borderColor: "rgba(99,102,241,0.25)", borderWidth: 2 }}>
                <div className="rg-card-title" style={{ fontSize: 15 }}>裁判台</div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>当前提交</div>
                  {!hasPending ? (
                    <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>暂无</p>
                  ) : (
                    <div className="rg-card-col">
                      {puzzle!.otherPendingAnswers!.map(a => (
                        <div key={a.id} className="rg-pending-item">
                          <div className="rg-pending-header">
                            <strong style={{ fontSize: 14 }}>{a.playerNickname}</strong>
                            <span className="rg-chip">{a.type ? typeLabel(a.type) : ""}</span>
                          </div>
                          <div className="rg-pending-answer" style={{ fontSize: 17 }}>「{a.answer ?? "?"}」</div>
                          <div className="rg-pending-actions">
                            <button className="primary-button" style={{ padding: "5px 14px", fontSize: 12 }} onClick={() => actions.judgeAnswer(a.id, "correct")}>判定正确</button>
                            <button style={{ padding: "5px 14px", fontSize: 12, borderColor: "var(--danger)", color: "var(--danger)" }} onClick={() => actions.judgeAnswer(a.id, "wrong")}>判定错误</button>
                            <button style={{ padding: "5px 14px", fontSize: 12 }} onClick={() => actions.judgeAnswer(a.id, "partial")}>要求补充</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>流程控制</div>
                  <div className="rg-card-row">
                    {isRevealPhase ? (
                      <>
                        <button className="rg-btn-sm" onClick={actions.openBuzz}>开放抢答</button>
                        {freeUnlocked ? (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>已开放自由翻牌</span>
                        ) : (
                          <button className="rg-btn-sm" onClick={actions.openFreeReveal}>开放自由翻牌</button>
                        )}
                        <button className="rg-btn-sm" onClick={actions.skipPuzzle} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>跳过</button>
                      </>
                    ) : isBuzzing ? (
                      <>
                        <button className="rg-btn-sm" onClick={actions.closeBuzz}>关闭抢答</button>
                        <button className="rg-btn-sm" onClick={actions.skipPuzzle} style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>跳过</button>
                      </>
                    ) : null}
                    {isRoundEnd && (
                      <button className="primary-button" onClick={actions.nextPuzzle} style={{ padding: "5px 16px", fontSize: 13, fontWeight: 600 }}>下一题</button>
                    )}
                    {room.phase !== "lobby" && (
                      <button className="rg-btn-ghost" onClick={actions.returnToSetup}>回准备室</button>
                    )}
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>提示 · 已公开 {puzzle?.hints.length ?? 0} 条</div>
                  <div className="rg-hint-list">
                    {puzzle && puzzle.hints.length > 0
                      ? puzzle.hints.map((h, i) => <span key={i} className="rg-chip">{h}</span>)
                      : <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>}
                  </div>
                  <div className="rg-card-row" style={{ marginTop: 4 }}>
                    <input aria-label="新提示" value={hintInput} onChange={e => setHintInput(e.target.value)} placeholder="输入新提示" style={{ flex: 1, fontSize: 12 }} />
                    <button className="rg-btn-sm" onClick={() => { actions.showHint(hintInput); setHintInput(""); }} disabled={!hintInput.trim()}>公开</button>
                  </div>
                </div>
                <div style={{ padding: "6px 8px", background: "var(--surface-soft)", borderRadius: 8, marginBottom: 8, fontSize: 12 }}>
                  答案：<strong>{puzzle?.answer ?? "—"}</strong>
                  &nbsp;·&nbsp;别名：{puzzle?.aliases?.join("、") || "—"}
                </div>
                <div>
                  <button
                    onClick={() => setShowScoreAdjust(!showScoreAdjust)}
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    手动改分 {showScoreAdjust ? "▲" : "▼"}
                  </button>
                  {showScoreAdjust && (
                    <div className="rg-card-row" style={{ marginTop: 6 }}>
                      <select aria-label="选择玩家" value={adjustPlayerId} onChange={e => setAdjustPlayerId(e.target.value)} style={{ minWidth: 80, fontSize: 12 }}>
                        <option value="">玩家</option>
                        {room.players.filter(p => !p.isBot).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
                      </select>
                      <input aria-label="分数" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder="±分" style={{ width: 50, fontSize: 12 }} />
                      <button className="rg-btn-sm" onClick={() => { actions.adjustScore(adjustPlayerId, Number(adjustAmount) || 0, "裁判调整"); setAdjustAmount(""); }} disabled={!adjustPlayerId || !adjustAmount}>调整</button>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>转让裁判</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select aria-label="选择新裁判" value={transferTarget} onChange={e => setTransferTarget(e.target.value)} style={{ fontSize: 11, flex: 1 }}>
                      <option value="">选择玩家</option>
                      {room.players.filter(p => !p.isBot && p.id !== judgeId).map(p => (
                        <option key={p.id} value={p.id}>{p.nickname}</option>
                      ))}
                    </select>
                    <button className="rg-btn-sm" onClick={() => { if (transferTarget) { actions.transferJudge(transferTarget); setTransferTarget(""); } }} disabled={!transferTarget} style={{ fontSize: 11 }}>转让</button>
                  </div>
                </div>
              </div>
            )}

            {/* Player panel */}
            {canAct && !isJudge && (
              <div className="rg-card" style={{ borderColor: "rgba(99,102,241,0.15)" }}>
                {myPending ? (
                  <div style={{ textAlign: "center", padding: "8px 0" }}>
                    <p style={{ margin: 0, fontSize: 14 }}>你的答案：<strong>{myPending.answer}</strong></p>
                    <span className="rg-chip" style={{ marginTop: 4 }}>
                      {myPending.status === "pending" ? "⏳ 等待判定" : myPending.status === "correct" ? "✓ 正确" : myPending.status === "wrong" ? "✗ 错误" : "部分正确"}
                    </span>
                    {myPending.judgeNote && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{myPending.judgeNote}</p>}
                  </div>
                ) : myHasRevealed && !freeUnlocked ? (
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14, color: "var(--muted)" }}>
                    你已翻过，请等待其他玩家翻牌
                  </div>
                ) : freeUnlocked ? (
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14 }}>
                    自由翻牌已开放，可以继续揭幕
                  </div>
                ) : isRevealPhase ? (
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14, color: "var(--muted)" }}>
                    选择一个白幕格子揭开
                  </div>
                ) : isBuzzing ? (
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14 }}>
                    抢答阶段
                  </div>
                ) : null}

                {!myPending && (isRevealPhase || isBuzzing) && (
                  <div className="rg-card-row" style={{ marginTop: 8 }}>
                    <input aria-label="输入答案" value={answerInput} onChange={e => setAnswerInput(e.target.value)}
                      placeholder={isBuzzing ? "输入抢答答案" : "输入答案"}
                      style={{ flex: 1, fontSize: 13 }}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); isBuzzing ? handleBuzzSubmit() : handleSubmitAnswer(); } }} />
                    {isRevealPhase ? (
                      <>
                        <button className="primary-button" onClick={handleSubmitAnswer} disabled={!answerInput.trim()} style={{ fontSize: 13 }}>提交</button>
                        {puzzle?.priorityGuesserNickname === g.self?.nickname && (
                          <button className="rg-btn-sm" style={{ background: "var(--rg-accent-light)", fontWeight: 600 }} onClick={handlePrioritySubmit} disabled={!answerInput.trim()}>优先</button>
                        )}
                      </>
                    ) : isBuzzing ? (
                      <>
                        <button className="rg-btn-sm" onClick={actions.buzzIn}>抢答</button>
                        <button className="primary-button" onClick={handleBuzzSubmit} disabled={!answerInput.trim()} style={{ fontSize: 13 }}>提交</button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Scoreboard */}
            {!focusMode && rg && Object.keys(rg.scores).length > 0 && (
              <div className="rg-card" style={{ padding: "10px 14px" }}>
                <strong style={{ fontSize: 13 }}>排行</strong>
                <div style={{ marginTop: 4 }}>
                  {Object.entries(rg.scores).sort(([, a], [, b]) => b - a).map(([pid, score], i) => {
                    const p = room?.players.find(pl => pl.id === pid);
                    return (
                      <div key={pid} className="rg-score-row" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                        <span>{i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : ""}{p?.nickname ?? pid}</span>
                        <strong>{score}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ No puzzle yet ═══════ */}
      {!hasPuzzle && !isPreRound && (
        <div className="rg-card" style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
          等待裁判开始游戏...
        </div>
      )}

      {/* ═══════ Chat (bottom, compact) ═══════ */}
      {!focusMode && (
        <div className="rg-chat-bottom">
          <div className="rg-card-row" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>聊天</span>
          </div>
          <div className="rg-card-row" style={{ gap: 6 }}>
            <input aria-label="聊天" value={g.chatText} onChange={e => g.setChatText(e.target.value)} placeholder="发一句话..."
              style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); g.sendChatMessage(); } }} />
            <button className="rg-btn-sm" onClick={g.sendChatMessage} disabled={!g.chatText.trim()} style={{ padding: "4px 10px" }}>发送</button>
          </div>
          <div style={{ maxHeight: 60, overflow: "auto", marginTop: 4, lineHeight: 1.4 }}>
            {(room?.messages ?? []).filter(m => m.type === "chat" || m.type === "reaction").map(m => (
              <div key={m.id} style={{ padding: "1px 0", fontSize: 11 }}><strong>{m.nickname}:</strong> {m.text}</div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </section>
  );
}
