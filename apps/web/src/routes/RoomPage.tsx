import { useCallback, useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  TEAM_LABELS, PLAYER_ROLE_LABELS,
  wordPackSummaries, type ChatReaction, type ParticipantType,
  type PublicPlayer, type PublicSpectator, type ChatMessage,
  type RevealOutcome, type PublicCard, type Team, type BoardMode
} from "@acg-codenames/shared";
import { useGame, isPlayer, getRoomStageLabel, getSelfSummary, queuedForSpectator, roleLabelShort } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";
import { SakuraParticles } from "../lib/SakuraParticles";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const g = useGame();
  const navigate = useNavigate();

  type PlayerMark = "red" | "blue" | "neutral" | "assassin" | null;
  const [cardMarks, setCardMarks] = useState<Record<string, PlayerMark>>({});

  const markCard = (cardId: string) => {
    const marks: PlayerMark[] = ["red", "blue", "neutral", "assassin", null];
    setCardMarks((prev) => {
      const cur = prev[cardId];
      const curIdx = cur ? marks.indexOf(cur) : -1;
      const next = marks[(curIdx + 1) % marks.length];
      const nextState = { ...prev };
      if (next === null) delete nextState[cardId];
      else nextState[cardId] = next;
      return nextState;
    });
  };

  const {
    room, session,
    connectionState, error, focusMode, setFocusMode,
    clueWord, setClueWord, clueCount, setClueCount,
    chatText, setChatText, copied, sideTab, setSideTab,
    jumpToLatest, chatListRef, handleChatScroll, scrollChatToBottom,
    revealBanner, reactionEffects, pendingGuess, revealingCardIds,
    maskSpymasterHints, setMaskSpymasterHints, showSakura, globalReaction,
    collapsedSections, toggleSection,
    canSeeHiddenRoles, showSpymasterHints, isDebugController,
    viewer, self, boardColumns, isLobby, isFinished,
    renderHint,
    chooseTeam, chooseRole, updateBoardMode, updateBuiltinPack, updateScoringMode,
    uploadRoomPack, useAccountPackForRoom, usePublicPackForRoom,
    startGame, restartGame, returnToLobby, transferHost, disbandRoom, forceEndGame,
    queueForNextRound, cancelQueueJoin, debugFillRoom,
    submitClue, guessCard, endTurn, sendChatMessage, sendQuickPhrase, sendReaction, copyLink, leaveRoom,
    transferHostTargetId, setTransferHostTargetId, hostTransferCandidates,
    accountPacks, publicPacks, makePublicPackKey,
  } = g;

  const navigateHome = useCallback(() => { navigate("/"); }, [navigate]);

  useEffect(() => {
    if (!roomId && room?.id) {
      navigate(`/room/${room.id}`, { replace: true });
    }
  }, [room?.id, roomId, navigate]);

  if (!room) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h2>{connectionState === "connecting" ? "正在连接房间..." : "等待进入房间"}</h2>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" onClick={navigateHome}>返回首页</button>
      </section>
    );
  }

  const phaseClass =
    focusMode ? "room-layout-focus"
    : isLobby ? "room-layout-lobby"
    : isFinished ? "room-layout-finished"
    : "room-layout-playing";

  return (
    <section className={`room-layout ${phaseClass}`} key={room.id + (focusMode ? "-f" : "")}>
      <SakuraParticles active={showSakura} />
      {globalReaction ? <ReactionBanner reaction={globalReaction} /> : null}

      {focusMode ? (
        <FocusBar room={room} viewer={viewer} onExitFocus={() => setFocusMode(false)} g={g} />
      ) : (
        <header className="room-bar room-bar-clean">
          <div className="room-bar-main room-bar-stack">
            <div className="room-title-stack">
              <button className="logo-button" onClick={() => { if (window.confirm("确定要离开房间回到首页吗？")) { leaveRoom(); navigateHome(); } }} title="回到首页">✦ 词牌结社</button>
              <strong className="room-code">{room.id}</strong>
              <p className="room-subtitle">{room.wordPackSummary.name}</p>
            </div>
            <div className="status-strip">
              <span className="status-pill emphasis">{getRoomStageLabel(room, connectionState)}</span>
              {room.phase === "playing" ? (
                <>
                  <span className={`status-pill team-pill team-pill-${room.currentTeam}`}>{TEAM_LABELS[room.currentTeam]}</span>
                  <span className="status-pill clue-pill">{room.clue ? `提示：${room.clue.word} ${room.clue.count}` : "暂无提示"}</span>
                </>
              ) : null}
              {room.timerEndsAt ? <TimerPill room={room} /> : null}
              {room.timerPaused ? (
                <span className="status-pill timer-pill-paused">⏸ 计时暂停</span>
              ) : null}
              {viewer?.canResumeTimer ? (
                <button className="primary-button" onClick={g.resumeTimer} style={{ marginLeft: 4, padding: "3px 10px", fontSize: 12 }}>▶ 继续</button>
              ) : null}
              <span className="status-pill soft-chip">{room.settings.boardMode} · 第 {room.roundNumber} 局</span>
            </div>
          </div>
          <div className="bar-actions">
            {room.phase === "playing" ? (
              <>
                <button onClick={() => setFocusMode(true)}>专注模式</button>
                {viewer?.isHost ? (
                  <button onClick={() => { if (window.confirm("确定要强制结束当前对局吗？当前队伍视为认输。")) { g.forceEndGame(); } }}>结束对局</button>
                ) : null}
              </>
            ) : null}
            <button onClick={() => { void copyLink(); }}>{copied ? "已复制" : "复制链接"}</button>
          </div>
        </header>
      )}

      {isLobby && !focusMode ? (
        <>
          <SeatPanel self={self} room={room} viewer={viewer} g={g} reactionEffects={reactionEffects} />
          <MembersPanel room={room} selfId={session?.participantId} collapsedSections={collapsedSections} toggleSection={toggleSection} reactionEffects={reactionEffects} sendReaction={sendReaction} />
          {viewer?.participantType === "player" ? (
            <LobbySettings room={room} viewer={viewer} self={self} g={g} accountPacks={accountPacks} publicPacks={publicPacks} makePublicPackKey={makePublicPackKey} />
          ) : null}
          {viewer?.canDisbandRoom ? (
            <HostControls viewer={viewer} returnToLobby={returnToLobby} transferHost={transferHost} disbandRoom={disbandRoom} hostTransferCandidates={hostTransferCandidates} transferHostTargetId={transferHostTargetId} setTransferHostTargetId={setTransferHostTargetId} />
          ) : null}
          <SideTabPanel g={g} room={room} session={session} />
        </>
      ) : null}

      {!isLobby && !focusMode ? (
        <>
          {isFinished ? null : (
            <aside className="room-left-col">
              <SeatPanel self={self} room={room} viewer={viewer} g={g} reactionEffects={reactionEffects} />
              <MembersPanel room={room} selfId={session?.participantId} collapsedSections={collapsedSections} toggleSection={toggleSection} reactionEffects={reactionEffects} sendReaction={sendReaction} />
              {viewer?.canDisbandRoom ? (
                <div className="panel" style={{ marginTop: 12, padding: 16 }}>
                  <button className="danger-button" onClick={disbandRoom} style={{ width: "100%" }}>解散房间</button>
                </div>
              ) : null}
            </aside>
          )}

          <div className="room-center-col">
            {!isFinished && revealBanner ? <RevealBanner reveal={revealBanner} /> : null}

            {isFinished ? (
              <>
                <section className={`result-banner ${room.winner ? `winner-${room.winner}` : ""}`}>
                  <h2>{room.winner ? `${TEAM_LABELS[room.winner]}胜利！( •̀ ω •́ )✧` : "对局结束"}</h2>
                  <p className="hint-text">{room.lastEvent}</p>
                  <div className="result-score" style={{ marginTop: 12 }}>
                    <span className="score-chip red-chip">红队 {room.scores.red}</span>
                    <span className="score-chip blue-chip">蓝队 {room.scores.blue}</span>
                  </div>
                  <div className="result-actions" style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    {viewer?.canRestartGame ? <button className="primary-button" onClick={restartGame}>再来一局</button> : null}
                    {viewer?.canReturnToLobby ? <button onClick={returnToLobby}>回到准备房间</button> : null}
                  </div>
                </section>

                {room.achievements && room.achievements.length > 0 ? (
                  <section className="panel achievements-panel" style={{ marginTop: 16 }}>
                    <div className="panel-heading"><h2>本局称号</h2></div>
                    <div className="achievements-list">
                      {room.achievements.map((a) => (
                        <div key={a.id} className={`achievement-card achievement-${a.tier}`}>
                          <div className="achievement-header">
                            <span className="achievement-tier">{a.tier === "positive" ? "🏆" : a.tier === "funny" ? "💀" : "🌟"}</span>
                            <strong>{a.title}</strong>
                          </div>
                          <span className="achievement-name">{a.nickname}</span>
                          <p className="achievement-desc">{a.description}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {room.clueRecords && room.clueRecords.length > 0 ? (
                  <section className="panel" style={{ marginTop: 16 }}>
                    <div className="panel-heading"><h2>回合历史</h2></div>
                    <div className="round-history">
                      {room.clueRecords.map((cr, i) => (
                        <div key={i} className={`round-block ${cr.team === "red" ? "round-block-red" : "round-block-blue"}`}>
                          <div className="round-clue">
                            <span className="round-num">#{i + 1}</span>
                            <strong>{cr.giverNickname}</strong>
                            <span>提示：{cr.word} {cr.count}</span>
                          </div>
                          {cr.guesses.length === 0 ? (
                            <p className="hint-text" style={{ margin: "2px 0 0 32px" }}>未选择词牌</p>
                          ) : null}
                          <div className="round-guesses">
                            {cr.guesses.map((g, j) => (
                              <div key={j} className={`round-guess round-guess-${g.cardRole}`}>
                                <strong>{g.nickname}</strong>
                                <span>「{g.cardWord}」{g.isOwnHit ? "命中" : "错误"} · {g.cardRole === "red" ? "红方" : g.cardRole === "blue" ? "蓝方" : g.cardRole === "neutral" ? "中立" : "刺客"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {room.roundScoreHistory && room.roundScoreHistory.length > 0 ? (
                  <section className="panel" style={{ marginTop: 16 }}>
                    <div className="panel-heading"><h2>积分明细</h2></div>
                    <div className="score-history-list">
                      {room.roundScoreHistory.map((rs, i) => (
                        <div key={i} className="score-history-row">
                          <span className="soft-chip">回合 {i + 1}</span>
                          <span className="score-chip">{TEAM_LABELS[rs.team]}</span>
                          {rs.ownPoints > 0 ? <span className="score-chip">+{rs.ownPoints}</span> : null}
                          {rs.neutralPenalty > 0 ? <span className="score-chip" style={{ color: "var(--muted)" }}>-{rs.neutralPenalty}</span> : null}
                          {rs.opponentPointsLost > 0 ? <span className="score-chip" style={{ color: "var(--danger)" }}>-{rs.opponentPointsLost}</span> : null}
                          {rs.assassinPenalty > 0 ? <span className="score-chip" style={{ color: "var(--danger)" }}>-{rs.assassinPenalty}</span> : null}
                          {rs.precisionBonus > 0 ? <span className="score-chip">精准+{rs.precisionBonus}</span> : null}
                          {rs.victoryBonus > 0 ? <span className="score-chip">胜利+{rs.victoryBonus}</span> : null}
                          <span className="score-chip" style={{ fontWeight: 700 }}>合计 {rs.totalRound}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}

            <BoardPanel room={room} viewer={viewer} g={g} cardMarks={cardMarks} markCard={markCard} />

            {viewer?.participantType === "player" && !isFinished ? (
              <ActionPanel viewer={viewer} g={g} />
            ) : null}
          </div>

          {isFinished ? null : (
            <aside className="room-right-col">
              <SideTabPanel g={g} room={room} session={session} />
            </aside>
          )}
        </>
      ) : null}

      {focusMode ? (
        <>
          <BoardPanel room={room} viewer={viewer} g={g} cardMarks={cardMarks} markCard={markCard} />
          {viewer?.participantType === "player" ? (
            <ActionPanel viewer={viewer} g={g} />
          ) : null}
        </>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

// ─── sub-components ──────────────────────────────────

function TimerPill({ room }: { room: NonNullable<ReturnType<typeof useGame>["room"]> }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil(((room.timerEndsAt ?? 0) - Date.now()) / 1000)));
    tick();
    const i = window.setInterval(tick, 500);
    return () => window.clearInterval(i);
  }, [room.timerEndsAt]);
  if (left <= 0) return null;
  return (
    <span className={`status-pill timer-pill ${left <= 10 ? "timer-pill-urgent" : ""}`}>
      {room.timerPhase === "clue" ? "⏳ 提示" : "⏳ 猜词"} {left}s
    </span>
  );
}

function FocusBar({ room, viewer, onExitFocus, g }: { room: NonNullable<ReturnType<typeof useGame>["room"]>; viewer: ReturnType<typeof useGame>["viewer"]; onExitFocus: () => void; g: ReturnType<typeof useGame> }) {
  return (
    <div className="focus-bar">
      <strong className="room-code">{room.id}</strong>
      {room.phase === "playing" ? (
        <>
          <span className={`status-pill team-pill team-pill-${room.currentTeam}`}>{TEAM_LABELS[room.currentTeam]}</span>
          <span className="status-pill clue-pill">{room.clue ? `${room.clue.word} ${room.clue.count}` : "等待提示"}</span>
        </>
      ) : null}
      {room.timerEndsAt ? <TimerPill room={room} /> : null}
      {room.timerPaused ? <span className="status-pill timer-pill-paused">⏸ 计时暂停</span> : null}
      <span className="flex-spacer" />
      {viewer?.canResumeTimer ? <button className="primary-button" onClick={g.resumeTimer} style={{ marginRight: 8 }}>▶ 继续</button> : null}
      {viewer?.canReturnToLobby ? <button onClick={g.returnToLobby} style={{ marginRight: 8 }}>回准备房</button> : null}
      <button onClick={onExitFocus}>退出专注</button>
    </div>
  );
}

function HostControls({ viewer, returnToLobby, transferHost, disbandRoom, hostTransferCandidates, transferHostTargetId, setTransferHostTargetId }: {
  viewer: NonNullable<ReturnType<typeof useGame>["viewer"]>;
  returnToLobby: () => void; transferHost: () => void; disbandRoom: () => void;
  hostTransferCandidates: ReturnType<typeof useGame>["hostTransferCandidates"];
  transferHostTargetId: string; setTransferHostTargetId: (v: string) => void;
}) {
  return (
    <div className="panel" style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button onClick={returnToLobby} disabled={!viewer.canReturnToLobby}>回到大厅</button>
      <select value={transferHostTargetId} onChange={(e) => setTransferHostTargetId(e.target.value)} disabled={!viewer.canTransferHost}>
        {hostTransferCandidates.length === 0 ? <option value="">暂无可转让玩家</option> : null}
        {hostTransferCandidates.map((p) => (<option key={p.id} value={p.id}>{p.nickname}</option>))}
      </select>
      <button onClick={transferHost} disabled={!viewer.canTransferHost || !transferHostTargetId}>转让社长</button>
      <button className="danger-button" onClick={disbandRoom}>解散房间</button>
    </div>
  );
}

function SeatPanel({ self, room, viewer, g, reactionEffects }: {
  self: ReturnType<typeof useGame>["self"]; room: ReturnType<typeof useGame>["room"];
  viewer: ReturnType<typeof useGame>["viewer"]; g: ReturnType<typeof useGame>;
  reactionEffects: Record<string, ChatReaction>;
}) {
  const { isLobby, renderHint, chooseTeam, chooseRole, queueForNextRound, cancelQueueJoin } = g;
  const isSelfPlayer = self && isPlayer(self);
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-heading">
        <h2>我的位置</h2>
        <span className="soft-chip">{room ? getSelfSummary(self, room) : ""}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <AvatarBadge avatarUrl={self?.profile.avatarUrl ?? null} fallback={self?.nickname ?? "?"} size="large" effect={self ? reactionEffects[self.id] : undefined} />
        <div>
          <strong>{self?.nickname ?? "未加入"}</strong>
          <p className="panel-subtle">{renderHint()}</p>
        </div>
      </div>
      {viewer?.participantType === "player" && isSelfPlayer ? (
        <div className="selection-grid">
          <button className={self.team === "red" ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam("red")}>红队</button>
          <button className={self.team === "blue" ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam("blue")}>蓝队</button>
          <button className={self.team === null ? "selected" : ""} disabled={!isLobby} onClick={() => chooseTeam(null)}>待定</button>
          <button className={self.role === "spymaster" ? "selected" : ""} disabled={!isLobby || !self.team} onClick={() => chooseRole("spymaster")}>队长</button>
          <button className={self.role === "operative" ? "selected" : ""} disabled={!isLobby || !self.team} onClick={() => chooseRole("operative")}>队员</button>
        </div>
      ) : (
        <div className="toolbar-inline" style={{ gap: 8 }}>
          <button className="primary-button" onClick={queueForNextRound} disabled={!viewer?.canQueueForNextRound || viewer.isQueuedForNextRound}>排队加入下一局</button>
          <button onClick={cancelQueueJoin} disabled={!viewer?.canCancelQueue}>取消排队</button>
        </div>
      )}
    </section>
  );
}

function MembersPanel({ room, selfId, collapsedSections, toggleSection, reactionEffects, sendReaction }: {
  room: NonNullable<ReturnType<typeof useGame>["room"]>; selfId?: string;
  collapsedSections: Set<string>; toggleSection: (t: string) => void;
  reactionEffects: Record<string, ChatReaction>;
  sendReaction: (r: ChatReaction, id: string, t: ParticipantType) => void;
}) {
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-heading">
        <h2>对局成员</h2>
        <span className="soft-chip">{room.players.length} 人</span>
      </div>
      <PlayerSection title="红队" players={room.players.filter((p) => p.team === "red")} selfId={selfId} reactionEffects={reactionEffects} onReact={sendReaction} collapsed={collapsedSections.has("红队")} onToggleCollapse={() => toggleSection("红队")} />
      <PlayerSection title="蓝队" players={room.players.filter((p) => p.team === "blue")} selfId={selfId} reactionEffects={reactionEffects} onReact={sendReaction} collapsed={collapsedSections.has("蓝队")} onToggleCollapse={() => toggleSection("蓝队")} />
      {room.phase !== "playing" ? (
        <PlayerSection title="待分队" players={room.players.filter((p) => p.team === null)} selfId={selfId} reactionEffects={reactionEffects} onReact={sendReaction} collapsed={collapsedSections.has("待分队")} onToggleCollapse={() => toggleSection("待分队")} />
      ) : null}
    </section>
  );
}

function PlayerSection({ title, players, selfId, reactionEffects, onReact, collapsed, onToggleCollapse }: {
  title: string; players: PublicPlayer[]; selfId?: string;
  reactionEffects: Record<string, ChatReaction>;
  onReact: (r: ChatReaction, id: string, t: ParticipantType) => void;
  collapsed: boolean; onToggleCollapse: () => void;
}) {
  const visiblePlayers = collapsed ? players.slice(0, 2) : players;
  return (
    <div style={{ marginBottom: 8 }}>
      <button className="chip-button" onClick={onToggleCollapse} style={{ marginBottom: 4 }}>
        {title} <span className="soft-chip" style={{ marginLeft: 4 }}>{players.length}</span>
        <span style={{ marginLeft: 4 }}>{collapsed ? "▸" : "▾"}</span>
      </button>
      {players.length === 0 ? <p className="empty-text">暂无成员</p> : null}
      {visiblePlayers.map((player) => (
        <ParticipantRow key={player.id} participant={player} label={`${player.team ? TEAM_LABELS[player.team] : "未分队"} / ${PLAYER_ROLE_LABELS[player.role]}`} isSelf={player.id === selfId} effect={reactionEffects[player.id]} onReact={onReact} />
      ))}
      {collapsed && players.length > 2 ? <button className="chip-button" onClick={onToggleCollapse}>显示全部 {players.length} 人</button> : null}
    </div>
  );
}

function ParticipantRow({ participant, label, isSelf, effect, onReact }: {
  participant: PublicPlayer | PublicSpectator; label: string; isSelf: boolean;
  effect?: ChatReaction;
  onReact: (r: ChatReaction, id: string, t: ParticipantType) => void;
}) {
  const type: ParticipantType = "team" in participant ? "player" : "spectator";
  const isPlayer = "team" in participant;
  const team = isPlayer ? participant.team : null;
  const role = isPlayer ? participant.role : null;
  const teamClass = team === "red" ? "participant-team-red" : team === "blue" ? "participant-team-blue" : "";
  return (
    <div className={`participant-row ${isSelf ? "participant-self" : ""} ${teamClass} ${effect ? `participant-effect-${effect}` : ""}`}>
      <div className="participant-main">
        <AvatarBadge avatarUrl={participant.profile.avatarUrl} fallback={participant.nickname} size="small" effect={effect} />
        <div>
          <strong>{participant.nickname}{isSelf ? " · 你" : ""}</strong>
          <p>{label}</p>
        </div>
      </div>
      <div className="participant-actions">
        {"isHost" in participant && participant.isHost ? <span className="soft-chip">社长</span> : null}
        {team ? <span className={`role-chip role-chip-${team}`}>{team === "red" ? "红队" : "蓝队"}</span> : null}
        {role ? <span className={`role-chip role-chip-role`}>{role === "spymaster" ? "队长" : "队员"}</span> : null}
        {"connected" in participant && !participant.connected ? <span className="soft-chip">离线</span> : null}
        {"isBot" in participant && participant.isBot ? <span className="soft-chip">测试位</span> : null}
        {!isSelf ? (
          <>
            <button onClick={() => onReact("flower", participant.id, type)} title="送花">💐</button>
            <button onClick={() => onReact("egg", participant.id, type)} title="丢蛋">🥚</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function LobbySettings({ room, viewer, self, g, accountPacks, publicPacks, makePublicPackKey }: {
  room: NonNullable<ReturnType<typeof useGame>["room"]>;
  viewer: NonNullable<ReturnType<typeof useGame>["viewer"]>;
  self: ReturnType<typeof useGame>["self"];
  g: ReturnType<typeof useGame>;
  accountPacks: ReturnType<typeof useGame>["accountPacks"];
  publicPacks: ReturnType<typeof useGame>["publicPacks"];
  makePublicPackKey: ReturnType<typeof useGame>["makePublicPackKey"];
}) {
  const boardModes: BoardMode[] = ["5x5", "7x7", "9x9"];
  const [packTab, setPackTab] = useState<"builtin" | "account" | "public">("builtin");

  const currentPackId = room.wordPackSummary.id;
  const isCurrentBuiltin = room.wordPackSummary.isBuiltin;
  const currentAccountPack = accountPacks.find((p) => p.id === currentPackId || p.name === room.wordPackSummary.name);
  const currentPublicPack = publicPacks.find((p) => makePublicPackKey(p) === currentPackId || p.name === room.wordPackSummary.name);
  const currentPackLabel =
    isCurrentBuiltin ? (wordPackSummaries.find((p) => p.id === currentPackId)?.name ?? room.wordPackSummary.name)
    : currentAccountPack ? currentAccountPack.name
    : currentPublicPack ? currentPublicPack.name
    : room.wordPackSummary.name;
  const currentPackMeta = room.wordPackSummary.entryCount ? `${room.wordPackSummary.entryCount} 个词` : "";

  const isSelected = (packId: string) => packId === currentPackId || `custom:${packId}` === currentPackId;

  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-heading">
        <h2>房间设置</h2>
        <span className="soft-chip">{viewer.canEditRoom ? "社长可编辑" : "等待社长调整"}</span>
      </div>
      <div className="settings-row">
        <div className="settings-block">
          <strong>棋盘模式</strong>
          <div className="selection-grid">
            {boardModes.map((mode) => (
              <button key={mode} className={room.settings.boardMode === mode ? "selected" : ""} disabled={!viewer.canEditRoom} onClick={() => g.updateBoardMode(mode)}>{mode}</button>
            ))}
          </div>
        </div>
        <div className="settings-block">
          <strong>得分模式</strong>
          <div className="selection-grid">
            {(["classic", "scoring"] as const).map((mode) => (
              <button key={mode} className={room.settings.scoringMode === mode ? "selected" : ""} disabled={!viewer.canEditRoom} onClick={() => g.updateScoringMode(mode)}>
                {mode === "classic" ? "经典" : "积分"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="settings-block">
        <div className="panel-heading" style={{ marginBottom: 10 }}>
          <strong>房间题库</strong>
          <div className="selection-grid" style={{ marginLeft: 10 }}>
            <button className={packTab === "builtin" ? "selected" : ""} onClick={() => setPackTab("builtin")}>内置</button>
            <button className={packTab === "account" ? "selected" : ""} disabled={accountPacks.length === 0} onClick={() => setPackTab("account")}>我的题库</button>
            <button className={packTab === "public" ? "selected" : ""} onClick={() => setPackTab("public")}>公共题库</button>
          </div>
        </div>

        {packTab === "builtin" ? (
          <div className="pack-select-list">
            {wordPackSummaries.map((pack) => (
              <button key={pack.id} className={`pack-select-row ${isCurrentBuiltin && isSelected(pack.id) ? "pack-select-row-active" : ""}`} disabled={!viewer.canEditRoom} onClick={() => g.updateBuiltinPack(pack.id)}>
                <span className="pack-select-name">{pack.name}</span>
                <span className="pack-select-meta">{pack.entryCount} 个词</span>
                <span className="pack-select-action">{isCurrentBuiltin && isSelected(pack.id) ? "✓ 已选中" : "选择此题库"}</span>
              </button>
            ))}
          </div>
        ) : packTab === "account" ? (
          <div className="pack-select-list">
            {accountPacks.length === 0 ? <p className="empty-text">还没有个人题库，去题库页上传吧。</p> : null}
            {accountPacks.map((pack) => (
              <button key={pack.id} className={`pack-select-row ${currentAccountPack?.id === pack.id ? "pack-select-row-active" : ""}`} disabled={!viewer.canEditRoom} onClick={() => g.useAccountPackForRoom(pack)}>
                <span className="pack-select-name">{pack.name}</span>
                <span className="pack-select-meta">{pack.entries.length} 个词</span>
                <span className="pack-select-action">{currentAccountPack?.id === pack.id ? "✓ 已选中" : "选择此题库"}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pack-select-list">
            {publicPacks.length === 0 ? <p className="empty-text">还没有公共题库。</p> : null}
            {publicPacks.map((pack) => {
              const key = makePublicPackKey(pack);
              return (
                <button key={key} className={`pack-select-row ${currentPublicPack && makePublicPackKey(currentPublicPack) === key ? "pack-select-row-active" : ""}`} disabled={!viewer.canEditRoom} onClick={() => g.usePublicPackForRoom(pack)}>
                  <span className="pack-select-name">{pack.name}</span>
                  <span className="pack-select-meta">{pack.entries.length} 个词 / {pack.ownerUsername}</span>
                  <span className="pack-select-action">{currentPublicPack && makePublicPackKey(currentPublicPack) === key ? "✓ 已选中" : "选择此题库"}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="current-pack-card" style={{ marginTop: 10 }}>
          <span className="micro-label">当前使用</span>
          <strong className="current-pack-name">{currentPackLabel}</strong>
          {currentPackMeta ? <span className="current-pack-meta">{currentPackMeta}</span> : null}
        </div>

        {viewer.canEditRoom ? (
          <div style={{ marginTop: 8 }}>
            <input type="file" accept=".txt,.json" onChange={(e) => { void g.uploadRoomPack(e.target.files?.[0] ?? null); }} />
          </div>
        ) : null}
      </div>
      {self && isPlayer(self) && self.isHost ? (
        <div className="toolbar-inline" style={{ marginTop: 8, gap: 8 }}>
          <button className="primary-button" onClick={g.startGame} disabled={!viewer.canStartGame}>开始游戏</button>
          {viewer.canUseDebugFill ? <button onClick={g.debugFillRoom}>补 3 个测试位</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function BoardPanel({ room, viewer, g, cardMarks, markCard }: {
  room: NonNullable<ReturnType<typeof useGame>["room"]>;
  viewer: NonNullable<ReturnType<typeof useGame>["viewer"]> | null;
  g: ReturnType<typeof useGame>;
  cardMarks: Record<string, "red" | "blue" | "neutral" | "assassin" | null>;
  markCard: (cardId: string) => void;
}) {
  const { boardColumns, canSeeHiddenRoles, showSpymasterHints, maskSpymasterHints, setMaskSpymasterHints, revealingCardIds, pendingGuess, guessCard: doGuess, renderHint } = g;
  const boardSizeClass = `board-${boardColumns}`;
  const [showPrivacyTip, setShowPrivacyTip] = useState(false);
  return (
    <section className="panel board-panel" style={{ marginBottom: 12 }}>
      {room.phase === "playing" ? (
        <div className="board-header">
          <span className="board-hint">{renderHint()}</span>
          {canSeeHiddenRoles ? (
            <span className="privacy-toggle" onClick={() => setShowPrivacyTip(!showPrivacyTip)} title="队长模式隐私提示">
              {showPrivacyTip ? "✕" : "?"}
            </span>
          ) : null}
          {canSeeHiddenRoles && showPrivacyTip ? (
            <div className="privacy-tip">
              <span>队长可见未翻牌真实身份，注意屏幕隐私。</span>
              <button className="chip-button" onClick={() => setMaskSpymasterHints(!maskSpymasterHints)}>{maskSpymasterHints ? "显示标识" : "隐藏标识"}</button>
              <button className="chip-button" onClick={() => setShowPrivacyTip(false)}>✕</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`board-grid ${boardSizeClass}`}>
        {room.board.map((card) => (
          <CardButton
            key={card.id}
            card={card}
            boardColumns={boardColumns}
            disabled={!viewer?.canGuess || card.revealed || room.phase !== "playing" || pendingGuess === card.id}
            onClick={() => doGuess(card.id)}
            flash={room.lastReveal?.cardId === card.id}
            flashOutcome={room.lastReveal?.cardId === card.id ? room.lastReveal.outcome : null}
            pending={pendingGuess === card.id}
            revealing={revealingCardIds.has(card.id)}
            mark={cardMarks[card.id] ?? null}
            onMark={() => markCard(card.id)}
            showSpymasterHints={showSpymasterHints}
          />
        ))}
      </div>
    </section>
  );
}

function ActionPanel({ viewer, g }: { viewer: NonNullable<ReturnType<typeof useGame>["viewer"]>; g: ReturnType<typeof useGame> }) {
  const { clueWord, setClueWord, clueCount, setClueCount, submitClue, renderHint, endTurn, resumeTimer } = g;
  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      {viewer.canSubmitClue ? (
        <div className="clue-form">
          <label className="field">
            <span>提示词</span>
            <input value={clueWord} onChange={(e) => setClueWord(e.target.value)} maxLength={12} placeholder="例如：机甲 / 学园 / 主角团" />
          </label>
          <label className="field count-field">
            <span>数字</span>
            <input type="number" min={1} max={9} value={clueCount} onChange={(e) => setClueCount(Math.max(1, Math.min(9, Number(e.target.value) || 1)))} />
          </label>
          <button className="primary-button" onClick={submitClue} disabled={!clueWord.trim()}>提交提示</button>
        </div>
      ) : (
        <p className="hint-text">{renderHint()}</p>
      )}
      <div style={{ marginTop: viewer.canSubmitClue ? 8 : 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={endTurn} disabled={!viewer.canEndTurn}>结束回合</button>
        {viewer.canResumeTimer ? (
          <button className="primary-button" onClick={resumeTimer}>▶ 继续计时</button>
        ) : null}
      </div>
    </section>
  );
}

function SideTabPanel({ g, room, session }: {
  g: ReturnType<typeof useGame>; room: NonNullable<ReturnType<typeof useGame>["room"]>;
  session: ReturnType<typeof useGame>["session"];
}) {
  const { sideTab, setSideTab, chatText, setChatText, chatListRef, battleListRef, handleChatScroll, handleBattleScroll, jumpToLatest, scrollChatToBottom, sendChatMessage, sendQuickPhrase } = g;
  const [collapsed, setCollapsed] = useState(false);
  const chatMessages = useMemo(() => room.messages.filter((m) => m.type === "chat" || m.type === "reaction"), [room.messages]);
  const battleMessages = useMemo(() => room.messages.filter((m) => m.type === "system"), [room.messages]);

  return (
    <div className={`panel side-panel${collapsed ? " side-panel-collapsed" : ""}`}>
      <div className="side-panel-hdr">
        <div className="selection-grid side-tab-row">
          <button className={sideTab === "chat" ? "selected" : ""} onClick={() => { setSideTab("chat"); if (collapsed) setCollapsed(false); }}>聊天</button>
          <button className={sideTab === "battle" ? "selected" : ""} onClick={() => { setSideTab("battle"); if (collapsed) setCollapsed(false); }}>战况</button>
          <button className={sideTab === "score" ? "selected" : ""} onClick={() => { setSideTab("score"); if (collapsed) setCollapsed(false); }}>积分</button>
          <button className={sideTab === "spectators" ? "selected" : ""} onClick={() => { setSideTab("spectators"); if (collapsed) setCollapsed(false); }}>旁观</button>
        </div>
        <button className="side-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "展开面板" : "收起面板"}>
          {collapsed ? "◀" : "▶"}
        </button>
      </div>

      {!collapsed ? (
        <>
          {sideTab === "chat" ? (
            <>
              <div className="chat-list" ref={chatListRef} onScroll={handleChatScroll} style={{ maxHeight: 240 }}>
                {chatMessages.length === 0 ? <p className="empty-text">还没有聊天。</p> : null}
                {chatMessages.map((message) => (
                  <MessageRow key={message.id} message={message} selfId={session?.participantId} />
                ))}
              </div>
              {jumpToLatest ? <button className="chip-button jump-button" onClick={scrollChatToBottom} style={{ margin: "4px 0" }}>⬇ 有新消息</button> : null}
            </>
          ) : sideTab === "battle" ? (
            <>
              <div className="chat-list" ref={battleListRef} onScroll={handleBattleScroll} style={{ maxHeight: 320 }}>
                {battleMessages.length === 0 ? <p className="empty-text">暂无战况记录。</p> : null}
                {battleMessages.map((message) => (
                  <MessageRow key={message.id} message={message} selfId={session?.participantId} />
                ))}
              </div>
              {jumpToLatest ? <button className="chip-button jump-button" onClick={() => { const list = battleListRef.current; if (!list) return; list.scrollTop = list.scrollHeight; scrollChatToBottom(); }} style={{ margin: "4px 0" }}>⬇ 有新战况</button> : null}
            </>
          ) : null}

          {sideTab === "chat" ? (
            <>
              <div className="chat-bar" style={{ marginTop: 8 }}>
                <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={120} placeholder="发一句话..." style={{ flex: 1 }} />
                <button onClick={sendChatMessage} disabled={!chatText.trim()}>发送</button>
              </div>
              <div className="chip-wrap" style={{ marginTop: 6 }}>
                <button className="chip-button" onClick={() => sendQuickPhrase("GG")}>GG</button>
                <button className="chip-button" onClick={() => sendQuickPhrase("大佬带带我")}>大佬带带我</button>
                <button className="chip-button" onClick={() => sendQuickPhrase("好猜！")}>好猜！</button>
                <button className="chip-button" onClick={() => sendQuickPhrase("这个太难了")}>这个太难了</button>
                <button className="chip-button" onClick={() => sendQuickPhrase("666")}>666</button>
              </div>
            </>
          ) : null}

          {sideTab === "spectators" ? (
            <>
              <span className="soft-chip">旁观 {room.spectators.length}</span>
              <span className="soft-chip" style={{ marginLeft: 6 }}>排队 {room.joinQueue.length}</span>
              {room.spectators.length === 0 ? <p className="empty-text">当前没有旁观者。</p> : null}
              {room.spectators.map((spectator) => (
                <ParticipantRow
                  key={spectator.id}
                  participant={spectator}
                  label={queuedForSpectator(spectator, room.joinQueue) ? "已排队下一局" : "旁观中"}
                  isSelf={spectator.id === session?.participantId}
                  effect={g.reactionEffects[spectator.id]}
                  onReact={g.sendReaction}
                />
              ))}
            </>
          ) : null}

          {sideTab === "score" ? (
            <div className="score-column">
              <div className="score-board">
                <div className="score-box score-red"><span>红队</span><strong>{room.scores.red}</strong></div>
                <div className="score-box score-blue"><span>蓝队</span><strong>{room.scores.blue}</strong></div>
              </div>
              <div className="score-pair">
                <span>红队剩余 {room.remainingCounts.red}</span>
                <span>蓝队剩余 {room.remainingCounts.blue}</span>
              </div>
              {room.currentRoundScore ? (
                <div className="info-card">
                  <strong>本回合 {TEAM_LABELS[room.currentRoundScore.team]} 得分</strong>
                  {room.currentRoundScore.ownHits > 0 ? (
                    <div className="score-detail-row"><span>己方词 ×{room.currentRoundScore.ownHits}</span><span>+{room.currentRoundScore.ownPoints}</span></div>
                  ) : null}
                  {room.currentRoundScore.comboBonus > 0 ? (
                    <div className="score-detail-row"><span>连击加成</span><span>+{room.currentRoundScore.comboBonus}</span></div>
                  ) : null}
                  {room.currentRoundScore.neutralPenalty > 0 ? (
                    <div className="score-detail-row"><span>中立词 ×{room.currentRoundScore.neutralHits}</span><span>-{room.currentRoundScore.neutralPenalty}</span></div>
                  ) : null}
                  {room.currentRoundScore.opponentPointsLost > 0 ? (
                    <div className="score-detail-row"><span>猜中对方词 ×{room.currentRoundScore.opponentHits}</span><span>-{room.currentRoundScore.opponentPointsLost}</span></div>
                  ) : null}
                  {room.currentRoundScore.assassinPenalty > 0 ? (
                    <div className="score-detail-row"><span>踩中刺客</span><span>-{room.currentRoundScore.assassinPenalty}</span></div>
                  ) : null}
                  {room.currentRoundScore.maxCombo > 1 ? (
                    <div className="score-detail-row"><span>最高连击</span><span>×{room.currentRoundScore.maxCombo}</span></div>
                  ) : null}
                </div>
              ) : null}
              <div className="info-card">
                <strong>词牌</strong>
                <p className="panel-subtle">{room.wordPackSummary.name}</p>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="hint-text" style={{ textAlign: "center", margin: 0 }}>面板已收起</p>
      )}
    </div>
  );
}

function RevealBanner({ reveal }: { reveal: NonNullable<ReturnType<typeof useGame>["revealBanner"]> }) {
  const teamLabel = TEAM_LABELS[reveal.guessedByTeam];
  const title =
    reveal.outcome === "own-hit" ? `${teamLabel} 命中`
    : reveal.outcome === "opponent-hit" ? `${teamLabel} 猜到对方词`
    : reveal.outcome === "neutral-hit" ? `${teamLabel} 猜到中立词`
    : `${teamLabel} 踩中刺客`;
  return (
    <section className={`reveal-banner reveal-${reveal.outcome}`} style={{ marginBottom: 12, padding: 16, borderRadius: 14, background: "var(--surface-soft)" }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <span className="score-chip">{reveal.word}</span>
        <span className="score-chip">{roleLabelShort(reveal.role)}</span>
      </div>
    </section>
  );
}

function ReactionBanner({ reaction }: { reaction: { reaction: ChatReaction; sender: string; target: string } }) {
  const isFlower = reaction.reaction === "flower";
  return (
    <div className={isFlower ? "reaction-float reaction-flower" : "reaction-float reaction-egg"} key={Date.now()}>
      <div className="reaction-float-banner">
        <span className="reaction-float-emoji">{isFlower ? "💐" : "🥚"}</span>
        <span className="reaction-float-msg">
          {isFlower ? `${reaction.sender} 送花给 ${reaction.target} ♡` : `${reaction.sender} 向 ${reaction.target} 丢鸡蛋！！💥`}
        </span>
      </div>
      <div className={isFlower ? "reaction-burst-petals" : "reaction-burst-eggs"}>
        {Array.from({ length: 16 }, (_, i) => {
          const angle = (i / 16) * 360;
          const dist = 60 + Math.random() * 180;
          const tx = Math.cos((angle * Math.PI) / 180) * dist;
          const ty = Math.sin((angle * Math.PI) / 180) * dist;
          const r = (Math.random() - 0.5) * 720;
          return (
            <span
              key={i}
              className={isFlower ? "burst-petal" : "burst-eggshell"}
              style={{
                animationDelay: `${Math.random() * 0.6}s`,
                "--tx": String(Math.round(tx)),
                "--ty": String(Math.round(ty)),
                "--r": `${Math.round(r)}deg`,
              } as React.CSSProperties}
            />
          );
        })}
      </div>
    </div>
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

function fontSizeForBoard(boardColumns: number, wordLength: number): string {
  if (boardColumns === 5) {
    if (wordLength <= 4) return "20px";
    if (wordLength <= 8) return "17px";
    if (wordLength <= 13) return "15px";
    return "13px";
  }
  if (boardColumns === 7) {
    if (wordLength <= 4) return "17px";
    if (wordLength <= 8) return "15px";
    if (wordLength <= 13) return "13px";
    return "12px";
  }
  if (wordLength <= 4) return "14px";
  if (wordLength <= 8) return "13px";
  if (wordLength <= 13) return "12px";
  return "11px";
}

function CardButton({ card, disabled, onClick, flash, flashOutcome, pending, revealing, showSpymasterHints, boardColumns, mark, onMark }: {
  card: PublicCard; disabled: boolean; onClick: () => void; boardColumns: number;
  flash: boolean; flashOutcome: RevealOutcome | null; pending: boolean; revealing: boolean; showSpymasterHints: boolean;
  mark: "red" | "blue" | "neutral" | "assassin" | null;
  onMark: () => void;
}) {
  const classes = ["card-tile"];
  if (card.revealed) classes.push("card-revealed", `card-revealed-${card.role}`);
  if (!card.revealed) classes.push("card-hidden");
  if (disabled) classes.push("card-disabled");
  if (flash) { classes.push("card-flash"); if (flashOutcome) classes.push(`flash-${flashOutcome}`); }
  if (pending) classes.push("card-pending");
  if (revealing) classes.push("card-revealing");
  if (showSpymasterHints && card.role && !card.revealed) classes.push("card-spymaster-hint");

  const hintBadgeClass =
    card.role === "red" ? "card-role-badge card-role-badge-red"
    : card.role === "blue" ? "card-role-badge card-role-badge-blue"
    : card.role === "assassin" ? "card-role-badge card-role-badge-assassin"
    : "card-role-badge card-role-badge-neutral";

  const hintLabel =
    card.role === "red" ? "红"
    : card.role === "blue" ? "蓝"
    : card.role === "assassin" ? "刺"
    : "中";

  const markLabel =
    mark === "red" ? "红" : mark === "blue" ? "蓝" : mark === "neutral" ? "中" : mark === "assassin" ? "刺" : null;
  const markClass =
    mark === "red" ? "card-mark card-mark-red"
    : mark === "blue" ? "card-mark card-mark-blue"
    : mark === "neutral" ? "card-mark card-mark-neutral"
    : mark === "assassin" ? "card-mark card-mark-assassin"
    : "";

  const wordLen = card.word.length;
  const dynamicFontSize = fontSizeForBoard(boardColumns, wordLen);

  return (
    <button className={classes.join(" ")} disabled={disabled} onClick={onClick} onContextMenu={(e) => { e.preventDefault(); onMark(); }}>
      <span className="card-word" style={{ fontSize: dynamicFontSize }}>{card.word}</span>
      {markLabel ? <span className={markClass}>{markLabel}</span> : null}
      {showSpymasterHints && card.role && !card.revealed ? (
        <span className={hintBadgeClass}>{hintLabel}</span>
      ) : null}
    </button>
  );
}
