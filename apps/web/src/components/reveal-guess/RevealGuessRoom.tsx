import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../../context/GameContext";
import { useRevealGuessActions } from "./useRevealGuessActions";
import type { RevealCell as RevealCellType, RevealGuessPhase } from "@acg-codenames/shared";

const GRID = 9;
const P = (pct: number) => `${(100 / GRID) * pct}%`;

function phaseLabel(phase: RevealGuessPhase | undefined): string {
  switch (phase) {
    case "pre-round": return "准备中";
    case "revealing": return "🀄 自由翻牌";
    case "buzzing": return "⚡ 抢答中";
    case "round-end": return "🏆 已结束";
    case "game-end": return "🎉 游戏结束";
    default: return "加载中";
  }
}

function CellButton({
  cell, imageUrl, canClick, onReveal, playerNickname, gridPx, isRecent,
}: {
  cell: RevealCellType; imageUrl: string; canClick: boolean;
  onReveal: () => void; playerNickname?: string; gridPx: number;
  isRecent?: boolean;
}) {
  return (
    <button
      className={`rg-cell${canClick ? " rg-cell-clickable" : ""}${cell.revealed ? " rg-cell-revealed" : ""}${isRecent ? " rg-cell-recent" : ""}`}
      aria-label={`格子 ${cell.row + 1}-${cell.col + 1}${cell.revealed ? " 已翻开" : " 未翻开"}`}
      onClick={onReveal}
      disabled={!canClick}
      style={{ width: P(1), aspectRatio: "1" }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && canClick) { e.preventDefault(); onReveal(); } }}
    >
      {cell.revealed ? (
        <>
          <span className="rg-cell-img" style={{
            backgroundImage: `url(${imageUrl})`, backgroundSize: `${GRID * 100}% ${GRID * 100}%`,
            backgroundPosition: `${P(cell.col)} ${P(cell.row)}`,
          }} />
          {playerNickname && gridPx >= 200 ? (
            <span className="rg-cell-tag">{playerNickname}</span>
          ) : null}
        </>
      ) : (
        <span className="rg-cell-qmark">{canClick ? "?" : ""}</span>
      )}
    </button>
  );
}

export function RevealGuessRoom() {
  const g = useGame();
  const navigate = useNavigate();
  const { socket, session, room, error, setError, connectionState, focusMode, exitFocusMode } = g;
  const actions = useRevealGuessActions(socket, session, setError);

  const [answerInput, setAnswerInput] = useState("");
  const [hintInput, setHintInput] = useState("");
  const [showFullImage, setShowFullImage] = useState(false);
  const [addPuzzleImage, setAddPuzzleImage] = useState("");
  const [addPuzzleAnswer, setAddPuzzleAnswer] = useState("");
  const [addPuzzleAliases, setAddPuzzleAliases] = useState("");
  const [addPuzzleHints, setAddPuzzleHints] = useState("");
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

  const handleAddPuzzle = useCallback(() => {
    const aliases = addPuzzleAliases.split("\n").map(s => s.trim()).filter(Boolean);
    const hints = addPuzzleHints.split("\n").map(s => s.trim()).filter(Boolean);
    actions.addPuzzle(addPuzzleImage, addPuzzleAnswer, aliases, hints);
    setAddPuzzleImage(""); setAddPuzzleAnswer(""); setAddPuzzleAliases(""); setAddPuzzleHints("");
    setPreviewUrl(null);
  }, [actions, addPuzzleImage, addPuzzleAnswer, addPuzzleAliases, addPuzzleHints]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("不支持的图片格式，仅支持 PNG / JPEG / WebP");
      return;
    }
    setError("");
    compressImage(file).then(url => {
      setAddPuzzleImage(url);
      setPreviewUrl(url);
    }).catch(err => setError(err instanceof Error ? err.message : "图片处理失败"));
    e.target.value = "";
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

  if (!room) {
    return <section className="panel"><h2>{connectionState === "connecting" ? "正在连接..." : "等待进入房间"}</h2>
      {error ? <p className="error-text">{error}</p> : null}
      <button className="primary-button" onClick={() => navigate("/")}>返回首页</button></section>;
  }

  return (
    <section className="panel rg-room">
      {focusMode && (
        <button className="rg-focus-exit" onClick={exitFocusMode} aria-label="退出专注模式">
          退出专注
        </button>
      )}

      {/* ═══════ Top Bar ═══════ */}
      {!focusMode && (
        <div className="rg-topbar">
          <div className="rg-topbar-left">
            <span className="rg-title">揭幕猜番</span>
            <span className="rg-chip">房间 {room.id}</span>
            <span className="rg-chip rg-chip-accent">{phaseLabel(rg?.phase)}</span>
            <span className="rg-chip rg-chip-accent">裁判: {room.players.find(p => p.id === judgeId)?.nickname ?? judgeId}</span>
            {!isPreRound && <span className="rg-chip">第 {rg ? rg.currentPuzzleIndex + 1 : "?"} / {rg?.puzzleCount ?? "?"} 题</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="rg-btn-sm" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/room/${room.id}`); }}>复制邀请</button>
            <button className="rg-btn-sm" onClick={g.enterFocusMode}>专注</button>
            <button className="rg-btn-sm" onClick={() => { g.leaveRoom(); navigate("/"); }}>离开</button>
          </div>
        </div>
      )}
      {error ? <p className="error-text">{error}</p> : null}

      {/* ═══════ Preparation Room: Judge View ═══════ */}
      {!focusMode && isJudge && isPreRound && (
        <div className="rg-two-col" style={{ marginBottom: 12 }}>
          {/* Left: Add puzzle */}
          <div className="rg-card">
            <div className="rg-card-title">📸 新增题目</div>
            <div className="rg-card-col">
              <label className="file-upload-btn" style={{ width: "fit-content", padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "var(--rg-accent-light)", color: "var(--rg-accent-text)" }}>
                {previewUrl ? "更换图片" : "上传图片"}
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} style={{ display: "none" }} />
              </label>
              <input aria-label="图片 URL" value={addPuzzleImage} onChange={e => { setAddPuzzleImage(e.target.value); setPreviewUrl(null); }} placeholder="或粘贴图片 URL" style={{ fontSize: 12 }} />
              {(previewUrl || addPuzzleImage) && (
                <img src={previewUrl || addPuzzleImage} alt="题目预览" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
              )}
              <div>
                <strong style={{ fontSize: 13 }}>标准答案</strong>
                <input aria-label="标准答案" value={addPuzzleAnswer} onChange={e => setAddPuzzleAnswer(e.target.value)} placeholder="例如：新世纪福音战士" style={{ width: "100%", marginTop: 2 }} />
              </div>
              <div>
                <strong style={{ fontSize: 13 }}>可接受别名</strong>
                <textarea aria-label="别名" value={addPuzzleAliases} onChange={e => setAddPuzzleAliases(e.target.value)} placeholder="EVA / Evangelion" rows={1} style={{ width: "100%", marginTop: 2 }} />
              </div>
              <div>
                <strong style={{ fontSize: 13 }}>提示</strong>
                <textarea aria-label="提示" value={addPuzzleHints} onChange={e => setAddPuzzleHints(e.target.value)} placeholder="经典机甲番 / 庵野秀明" rows={1} style={{ width: "100%", marginTop: 2 }} />
              </div>
            </div>
            <button className="primary-button" onClick={handleAddPuzzle} style={{ marginTop: 10, width: "100%" }}>
              保存题目
            </button>
          </div>
          {/* Right: Puzzle queue */}
          <div className="rg-card">
            <div className="rg-card-title">题目库 · {rg?.puzzleCount ?? 0} 题</div>
            {rg?.puzzleList && rg.puzzleList.length > 0 ? (
              <div className="rg-card-col">
                {rg.puzzleList.map((pz) => (
                  <div key={pz.index} style={{
                    display: "flex", gap: 10, alignItems: "center", padding: "8px 10px",
                    background: "var(--surface-soft)", borderRadius: 8, border: "1px solid var(--border)"
                  }}>
                    <img src={pz.imageUrl} alt={`题 ${pz.index + 1}`} style={{
                      width: 48, height: 48, objectFit: "cover", borderRadius: 6,
                      border: "1px solid var(--border)", flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13 }}>第 {pz.index + 1} 题</strong>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        <span>{pz.hasAnswer ? "有答案" : "未填答案"}</span>
                        {pz.aliasCount > 0 && <span>{pz.aliasCount} 别名</span>}
                        {pz.hintCount > 0 && <span>{pz.hintCount} 提示</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                <p style={{ fontSize: 28, margin: "0 0 8px" }}>🎴</p>
                <p style={{ margin: 0, fontSize: 13 }}>还没有题目，裁判先上传一张动画截图吧</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════ Prep bottom bar (judge) ═══════ */}
      {!focusMode && isJudge && isPreRound && (
        <>
          <div className="rg-card" style={{ marginBottom: 8 }}>
            <div className="rg-card-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>
                当前裁判：<strong>{room.players.find(p => p.id === judgeId)?.nickname ?? judgeId}</strong>
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select aria-label="选择新裁判" value={transferTarget} onChange={e => setTransferTarget(e.target.value)} style={{ fontSize: 12 }}>
                  <option value="">转让给...</option>
                  {room.players.filter(p => !p.isBot && p.id !== judgeId).map(p => (
                    <option key={p.id} value={p.id}>{p.nickname}</option>
                  ))}
                </select>
                <button className="rg-btn-sm" onClick={() => { if (transferTarget) { actions.transferJudge(transferTarget); setTransferTarget(""); } }} disabled={!transferTarget}>转让</button>
              </div>
            </div>
          </div>
          <button
            className="primary-button"
            style={{ width: "100%", padding: "12px 0", fontSize: 16, fontWeight: 700, marginBottom: 8 }}
            onClick={actions.startGame}
            disabled={(rg?.puzzleCount ?? 0) === 0}
          >
            ▶ 开始揭幕
          </button>
          {(rg?.puzzleCount ?? 0) === 0 && (
            <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: -4, marginBottom: 8 }}>
              至少添加 1 道题目
            </p>
          )}
        </>
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
                  <span className="rg-chip rg-chip-accent">{phaseLabel(rg?.phase)}</span>
                  {freeUnlocked && <span className="rg-chip rg-chip-green">自由翻牌</span>}
                  {!focusMode && !isJudge && (
                    <button onClick={g.enterFocusMode} className="rg-btn-sm">专注</button>
                  )}
                  {isJudge && !focusMode && (
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}>
                      <input type="checkbox" checked={showFullImage} onChange={e => setShowFullImage(e.target.checked)} /> 预览
                    </label>
                  )}
                </div>
                <div role="grid" aria-label="揭幕猜番棋盘" className="rg-grid-wrap"
                  style={showFullImage || isRoundEnd ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                >
                  {puzzle.cells.map(cell => (
                    <CellButton key={cell.id} cell={cell} imageUrl={imageUrl} gridPx={gridPx}
                      canClick={canAct && isRevealPhase && !cell.revealed && !showFullImage}
                      onReveal={() => handleReveal(cell.id)}
                      playerNickname={cell.revealedBy ? room.players.find(p => p.id === cell.revealedBy)?.nickname : undefined}
                      isRecent={cell.id === recentCellId}
                    />
                  ))}
                </div>
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
                        <button className="rg-btn-sm" onClick={actions.openFreeReveal}>自由翻牌</button>
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

      {/* ═══════ Chat (bottom) ═══════ */}
      {!focusMode && (
        <div className="rg-chat-bottom">
          <div className="rg-card-row" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>聊天</span>
          </div>
          <div className="rg-card-row">
            <input aria-label="聊天" value={g.chatText} onChange={e => g.setChatText(e.target.value)} placeholder="发一句话..."
              style={{ flex: 1, fontSize: 12 }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); g.sendChatMessage(); } }} />
            <button className="rg-btn-sm" onClick={g.sendChatMessage} disabled={!g.chatText.trim()}>发送</button>
          </div>
          <div style={{ maxHeight: 80, overflow: "auto", marginTop: 4 }}>
            {(room?.messages ?? []).filter(m => m.type === "chat" || m.type === "reaction").map(m => (
              <div key={m.id} style={{ padding: "1px 0", fontSize: 12 }}><strong>{m.nickname}:</strong> {m.text}</div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
