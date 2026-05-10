import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  TEAM_LABELS, PLAYER_ROLE_LABELS, BOARD_MODE_CONFIG,
  wordPackSummaries, type ChatReaction, type ParticipantType,
  type PublicPlayer, type PublicSpectator, type ChatMessage,
  type RevealOutcome, type PublicCard, type Team, type BoardMode
} from "@acg-codenames/shared";
import { useGame, isPlayer, getActionTeamText, getCurrentClueText, getRoomStageLabel, getSelfSummary, queuedForSpectator, roleLabelShort } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";
import { SakuraParticles } from "../lib/SakuraParticles";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const g = useGame();
  const navigate = useNavigate();

  const {
    socket, room, session, identity, effectiveIdentity,
    connectionState, error, focusMode, setFocusMode,
    clueWord, setClueWord, clueCount, setClueCount,
    chatText, setChatText, copied, sideTab, setSideTab,
    jumpToLatest, chatListRef, handleChatScroll, scrollChatToBottom,
    revealBanner, reactionEffects, pendingGuess, revealingCardIds,
    maskSpymasterHints, setMaskSpymasterHints, showSakura, globalReaction,
    collapsedSections, toggleSection,
    canSeeHiddenRoles, showSpymasterHints, isDebugController,
    viewer, self, boardColumns, isLobby, isFinished,
    inviteLink, renderHint,
    chooseTeam, chooseRole, updateBoardMode, updateBuiltinPack,
    uploadRoomPack, useAccountPackForRoom, usePublicPackForRoom,
    startGame, restartGame, returnToLobby, transferHost, disbandRoom,
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
          <div>
            <p className="micro-label">Room</p>
            <h2>{connectionState === "connecting" ? "正在连接房间..." : "等待进入房间"}</h2>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" onClick={navigateHome}>返回首页</button>
      </section>
    );
  }

  return (
    <section className={`room-grid ${focusMode ? "room-grid-focus" : ""}`}>
      <SakuraParticles active={showSakura} />
      <ReactionOverlay reaction={globalReaction} />

      <header className="room-bar room-bar-clean">
        <div className="room-bar-main room-bar-stack">
          <div className="room-title-stack">
            <button className="logo-button" onClick={() => { if (window.confirm("确定要离开密令房回到首页吗？")) { leaveRoom(); navigateHome(); } }} title="回到首页">🃏 词牌结社</button>
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
          <button onClick={() => { setFocusMode(!focusMode); requestAnimationFrame(() => { document.querySelector('.board-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); }}>{focusMode ? "退出专注模式" : "专注模式"}</button>
          <button onClick={() => { void copyLink(); }}>{copied ? "已复制" : "复制链接"}</button>
        </div>
      </header>

      {viewer?.canDisbandRoom ? (
        <section className="panel host-control-panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">Host controls</p>
              <h2>结社长控制台</h2>
            </div>
            <span className="soft-chip">{room.phase === "lobby" ? "准备阶段" : "对局管理"}</span>
          </div>
          <div className="host-control-grid">
            <button onClick={returnToLobby} disabled={!viewer.canReturnToLobby}>回到大厅</button>
            <div className="host-transfer-row">
              <select value={transferHostTargetId} onChange={(e) => setTransferHostTargetId(e.target.value)} disabled={!viewer.canTransferHost}>
                {hostTransferCandidates.length === 0 ? <option value="">暂无可转让玩家</option> : null}
                {hostTransferCandidates.map((player) => (
                  <option key={player.id} value={player.id}>{player.nickname}</option>
                ))}
              </select>
              <button onClick={transferHost} disabled={!viewer.canTransferHost || !transferHostTargetId}>👑 转让社长</button>
            </div>
            <button className="danger-button" onClick={disbandRoom}>💥 解散密令房</button>
          </div>
        </section>
      ) : null}

      <div className={`room-layout ${room.phase === "playing" ? "room-layout-playing" : ""}`}>
        <aside className="left-column">
          <SeatPanel self={self} room={room} viewer={viewer} g={g} reactionEffects={reactionEffects} />
          <MembersPanel room={room} selfId={session?.participantId} collapsedSections={collapsedSections} toggleSection={toggleSection} reactionEffects={reactionEffects} sendReaction={sendReaction} />
        </aside>

        <section className="center-column">
          {isLobby && viewer?.participantType === "player" ? (
            <LobbySettings room={room} viewer={viewer} self={self} g={g} accountPacks={accountPacks} publicPacks={publicPacks} makePublicPackKey={makePublicPackKey} />
          ) : null}

          {!isFinished && revealBanner ? <RevealBanner reveal={revealBanner} /> : null}

          {isFinished ? (
            <>
            <section className={`result-banner ${room.winner ? `winner-${room.winner}` : ""}`}>
              <div>
                <p className="micro-label">Result</p>
                <h2>{room.winner ? `${TEAM_LABELS[room.winner]}胜利！( •̀ ω •́ )✧` : "对局结束"}</h2>
                <p className="hint-text">{room.lastEvent}</p>
              </div>
              <div className="result-score">
                <span className="score-chip red-chip">红队 {room.scores.red}</span>
                <span className="score-chip blue-chip">蓝队 {room.scores.blue}</span>
                {viewer?.canRestartGame ? <button className="primary-button" onClick={restartGame}>再来一把</button> : null}
              </div>
            </section>
            {room.achievements && room.achievements.length > 0 ? (
              <section className="panel achievements-panel">
                <div className="panel-heading">
                  <div>
                    <p className="micro-label">Titles</p>
                    <h2>🏆 本局称号</h2>
                  </div>
                </div>
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
            </>
          ) : null}

          <BoardPanel room={room} viewer={viewer} g={g} />

          {viewer?.participantType === "player" ? (
            <ActionPanel viewer={viewer} g={g} />
          ) : null}
        </section>

        <aside className="right-column">
          <SideTabPanel g={g} room={room} session={session} />
        </aside>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

// ─── sub-components ──────────────────────────────────

function SeatPanel({ self, room, viewer, g, reactionEffects }: { self: ReturnType<typeof useGame>["self"]; room: ReturnType<typeof useGame>["room"]; viewer: ReturnType<typeof useGame>["viewer"]; g: ReturnType<typeof useGame>; reactionEffects: Record<string, ChatReaction> }) {
  const { isLobby, renderHint, chooseTeam, chooseRole, queueForNextRound, cancelQueueJoin } = g;
  const isSelfPlayer = self && isPlayer(self);
  return (
    <section className={`panel seat-panel ${isSelfPlayer && self.team ? `seat-${self.team}` : viewer?.participantType === "spectator" ? "seat-spectator" : ""}`}>
      <div className="panel-heading">
        <div>
          <p className="micro-label">Identity</p>
          <h2>我的位置</h2>
        </div>
        <span className="soft-chip">{room ? getSelfSummary(self, room) : ""}</span>
      </div>
      <div className="seat-summary">
        <AvatarBadge avatarUrl={self?.profile.avatarUrl ?? null} fallback={self?.nickname ?? "?"} size="large" effect={self ? reactionEffects[self.id] : undefined} />
        <div>
          <strong>{self?.nickname ?? "未加入"}</strong>
          <p className="panel-subtle">{renderHint()}</p>
        </div>
      </div>
      <div className="identity-target">
        <span className={`team-mark ${viewer?.targetTeam ?? "neutral"}`}>{viewer?.targetTeam ? getActionTeamText(viewer.targetTeam) : "等待下一步"}</span>
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
        <div className="spectator-tools">
          <button className="primary-button" onClick={queueForNextRound} disabled={!viewer?.canQueueForNextRound || viewer.isQueuedForNextRound}>排队加入下一局</button>
          <button onClick={cancelQueueJoin} disabled={!viewer?.canCancelQueue}>取消排队</button>
        </div>
      )}
    </section>
  );
}

function MembersPanel({ room, selfId, collapsedSections, toggleSection, reactionEffects, sendReaction }: {
  room: NonNullable<ReturnType<typeof useGame>["room"]>;
  selfId?: string;
  collapsedSections: Set<string>;
  toggleSection: (t: string) => void;
  reactionEffects: Record<string, ChatReaction>;
  sendReaction: (r: ChatReaction, id: string, t: ParticipantType) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Players</p>
          <h2>对局成员</h2>
        </div>
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
    <div className="team-section">
      <button className="team-section-toggle" onClick={onToggleCollapse}>
        <h3>{title} <span className="soft-chip">{players.length}</span></h3>
        <span className={`toggle-arrow ${collapsed ? "" : "toggle-expanded"}`}>{collapsed ? "▸" : "▾"}</span>
      </button>
      {players.length === 0 ? <p className="empty-text">暂无成员</p> : null}
      {visiblePlayers.map((player) => (
        <ParticipantRow key={player.id} participant={player} label={`${player.team ? TEAM_LABELS[player.team] : "未分队"} / ${PLAYER_ROLE_LABELS[player.role]}`} isSelf={player.id === selfId} effect={reactionEffects[player.id]} onReact={onReact} />
      ))}
      {collapsed && players.length > 2 ? <button className="chip-button expand-hint" onClick={onToggleCollapse}>显示全部 {players.length} 人</button> : null}
    </div>
  );
}

function ParticipantRow({ participant, label, isSelf, effect, onReact }: {
  participant: PublicPlayer | PublicSpectator; label: string; isSelf: boolean;
  effect?: ChatReaction;
  onReact: (r: ChatReaction, id: string, t: ParticipantType) => void;
}) {
  const type: ParticipantType = "team" in participant ? "player" : "spectator";
  return (
    <div className={`participant-row ${isSelf ? "participant-self" : ""} ${effect ? `participant-effect-${effect}` : ""}`}>
      <div className="participant-main">
        <AvatarBadge avatarUrl={participant.profile.avatarUrl} fallback={participant.nickname} size="small" effect={effect} />
        <div>
          <strong>{participant.nickname}{isSelf ? " · 你" : ""}</strong>
          <p>{label}</p>
        </div>
      </div>
      <div className="participant-actions">
        {"isHost" in participant && participant.isHost ? <span className="soft-chip">社长</span> : null}
        {"connected" in participant && !participant.connected ? <span className="soft-chip">离线</span> : null}
        {"isBot" in participant && participant.isBot ? <span className="soft-chip">测试位</span> : null}
        {!isSelf ? (
          <>
            <button className="icon-button" onClick={() => onReact("flower", participant.id, type)} title="送花">💐 花</button>
            <button className="icon-button" onClick={() => onReact("egg", participant.id, type)} title="丢蛋">🥚 蛋</button>
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
  return (
    <section className="panel compact-panel">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Room settings</p>
          <h2>密令房设置</h2>
        </div>
        <span className="soft-chip">{viewer.canEditRoom ? "房主可编辑" : "等待房主调整"}</span>
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
      <div className="settings-row">
        <div className="settings-block">
          <strong>房间词牌</strong>
          <div className="toolbar-inline compact-stack">
            <select value={room.wordPackSummary.isBuiltin ? room.wordPackSummary.id : wordPackSummaries[0]?.id ?? ""} disabled={!viewer.canEditRoom} onChange={(e) => g.updateBuiltinPack(e.target.value)}>
              {wordPackSummaries.map((pack) => (<option key={pack.id} value={pack.id}>{pack.name} ({pack.entryCount})</option>))}
            </select>
            <input type="file" accept=".txt,.json" disabled={!viewer.canEditRoom} onChange={(e) => { void g.uploadRoomPack(e.target.files?.[0] ?? null); }} />
          </div>
          {accountPacks.length > 0 ? (
            <div className="chip-wrap">
              {accountPacks.map((pack) => (
                <button key={pack.id} className="chip-button" disabled={!viewer.canEditRoom} onClick={() => g.useAccountPackForRoom(pack)}>使用 {pack.name}</button>
              ))}
            </div>
          ) : null}
          {publicPacks.length > 0 ? (
            <div className="chip-wrap">
              {publicPacks.slice(0, 8).map((pack) => (
                <button key={makePublicPackKey(pack)} className="chip-button" disabled={!viewer.canEditRoom} onClick={() => g.usePublicPackForRoom(pack)}>公共 {pack.name}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {self && isPlayer(self) && self.isHost ? (
        <div className="host-actions host-actions-inline">
          <button className="primary-button" onClick={g.startGame} disabled={!viewer.canStartGame}>任务开始</button>
          {viewer.canUseDebugFill ? <button onClick={g.debugFillRoom}>一键补 3 个测试位</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function BoardPanel({ room, viewer, g }: { room: NonNullable<ReturnType<typeof useGame>["room"]>; viewer: NonNullable<ReturnType<typeof useGame>["viewer"]> | null; g: ReturnType<typeof useGame> }) {
  const { boardColumns, canSeeHiddenRoles, showSpymasterHints, maskSpymasterHints, setMaskSpymasterHints, revealBanner, revealingCardIds, pendingGuess, guessCard: doGuess, renderHint } = g;
  return (
    <section className="panel board-panel">
      <div className={`board-header board-header-tight ${room.phase === "playing" ? "board-header-compact" : ""}`}>
        <div className="board-status">
          <div className="status-chip clue-chip">
            <p className="status-key">队长密令</p>
            <strong>{getCurrentClueText(room)}</strong>
          </div>
          <div className="status-chip">
            <p className="status-key">行动队伍</p>
            <strong>{viewer?.targetTeam ? getActionTeamText(viewer.targetTeam) : "等待中"}</strong>
          </div>
        </div>
        <p className="board-hint">{renderHint()}</p>
        {canSeeHiddenRoles ? (
          <div className="spymaster-warning">
            <span>密令模式：你可以看到未翻牌的真实身份，注意屏幕隐私。</span>
            <button type="button" className="chip-button" onClick={() => setMaskSpymasterHints(!maskSpymasterHints)}>{maskSpymasterHints ? "显示密令标记" : "隐藏密令标记"}</button>
          </div>
        ) : null}
      </div>
      <div className={`board-grid board-${boardColumns}`} style={{ gridTemplateColumns: `repeat(${boardColumns}, minmax(0, 1fr))` }}>
        {room.board.map((card) => (
          <CardButton
            key={card.id}
            card={card}
            disabled={!viewer?.canGuess || card.revealed || room.phase !== "playing" || pendingGuess === card.id}
            onClick={() => doGuess(card.id)}
            flash={room.lastReveal?.cardId === card.id}
            flashOutcome={room.lastReveal?.cardId === card.id ? room.lastReveal.outcome : null}
            pending={pendingGuess === card.id}
            revealing={revealingCardIds.has(card.id)}
            showSpymasterHints={showSpymasterHints}
          />
        ))}
      </div>
    </section>
  );
}

function ActionPanel({ viewer, g }: { viewer: NonNullable<ReturnType<typeof useGame>["viewer"]>; g: ReturnType<typeof useGame> }) {
  const { clueWord, setClueWord, clueCount, setClueCount, submitClue, renderHint, endTurn } = g;
  return (
    <section className={`panel action-panel dock-panel ${viewer.canGuess || viewer.canSubmitClue ? "dock-active" : "dock-dimmed"}`}>
      <div className="action-main">
        {viewer.canSubmitClue ? (
          <div className="clue-form">
            <label className="field">
              <span>密令词</span>
              <input value={clueWord} onChange={(e) => setClueWord(e.target.value)} maxLength={12} placeholder="例如：机甲 / 学园 / 主角团" />
            </label>
            <label className="field count-field">
              <span>数字</span>
              <input type="number" min={1} max={9} value={clueCount} onChange={(e) => setClueCount(Math.max(1, Math.min(9, Number(e.target.value) || 1)))} />
            </label>
            <button className="primary-button" onClick={submitClue} disabled={!clueWord.trim()}>提交密令</button>
          </div>
        ) : (
          <div className="action-copy">
            <p className="micro-label">操作提示</p>
            <p className="hint-text">{renderHint()}</p>
          </div>
        )}
      </div>
      <div className="action-side">
        <button onClick={endTurn} disabled={!viewer.canEndTurn}>结束回合</button>
      </div>
    </section>
  );
}

function SideTabPanel({ g, room, session }: { g: ReturnType<typeof useGame>; room: NonNullable<ReturnType<typeof useGame>["room"]>; session: ReturnType<typeof useGame>["session"] }) {
  const { sideTab, setSideTab, chatText, setChatText, chatListRef, handleChatScroll, jumpToLatest, scrollChatToBottom, sendChatMessage, sendQuickPhrase } = g;
  return (
    <div className="panel tab-panel">
      <div className="panel-heading">
        <div>
          <p className="micro-label">💬 Room sidecar</p>
          <h2>📌 面板</h2>
        </div>
        <div className="tab-strip">
          <button className={sideTab === "chat" ? "selected" : ""} onClick={() => setSideTab("chat")}>💬 聊天</button>
          <button className={sideTab === "spectators" ? "selected" : ""} onClick={() => setSideTab("spectators")}>👁️ 旁观</button>
          <button className={sideTab === "score" ? "selected" : ""} onClick={() => setSideTab("score")}>📊 积分</button>
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
          {jumpToLatest ? <button className="jump-latest" onClick={scrollChatToBottom}>跳到最新消息</button> : null}
          <div className="chat-compose">
            <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={120} placeholder="发一句话..." />
            <button onClick={sendChatMessage} disabled={!chatText.trim()}>发送</button>
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
              effect={g.reactionEffects[spectator.id]}
              onReact={g.sendReaction}
            />
          ))}
        </section>
      ) : null}
      {sideTab === "score" ? (
        <section className="score-column">
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
              <div className="score-detail-row">
                <span>己方词 ×{room.currentRoundScore.ownHits}</span><span>+{room.currentRoundScore.ownPoints}</span>
              </div>
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
              {room.clue && !room.currentRoundScore.assassinHit && room.currentRoundScore.neutralHits === 0 && room.currentRoundScore.opponentHits === 0 ? (
                <p className="panel-subtle">精准奖励待定：猜中 {room.currentRoundScore.ownHits}/{room.clue.count}</p>
              ) : null}
            </div>
          ) : null}
          {room.roundScoreHistory && room.roundScoreHistory.length > 0 ? (
            <div className="info-card">
              <strong>历史回合</strong>
              {room.roundScoreHistory.map((r, i) => (
                <div key={i} className="score-detail-row">
                  <span>第{i+1}局 {TEAM_LABELS[r.team]}</span>
                  <span>{r.totalRound > 0 ? "+" : ""}{r.totalRound}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="info-card">
            <strong>当前词牌</strong>
            <p className="panel-subtle">{room.wordPackSummary.name}</p>
          </div>
          <div className="info-card">
            <strong>得分模式</strong>
            <p className="panel-subtle">{room.settings.scoringMode === "scoring" ? "积分密令" : room.settings.scoringMode === "gamble" ? "豪赌密令" : "经典密令"}</p>
          </div>
        </section>
      ) : null}
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

function ReactionOverlay({ reaction }: { reaction: { reaction: ChatReaction; sender: string; target: string } | null }) {
  if (!reaction) return null;
  const isFlower = reaction.reaction === "flower";
  const particles = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div className={`reaction-overlay ${isFlower ? "reaction-overlay-flower" : "reaction-overlay-egg"}`}>
      <div className="reaction-overlay-banner">
        <span className="reaction-overlay-emoji">{isFlower ? "💐" : "🥚"}</span>
        <span className="reaction-overlay-text">
          {isFlower ? `${reaction.sender} → ${reaction.target} ♡` : `${reaction.sender} → ${reaction.target} 🥚!!💥`}
        </span>
      </div>
      <div className="reaction-particles">
        {particles.map((i) => (
          <span key={i} className={`reaction-particle ${isFlower ? "particle-flower" : "particle-egg"}`}
            style={{ left: `${10 + Math.random() * 80}%`, animationDelay: `${Math.random() * 0.6}s`, animationDuration: `${1.4 + Math.random() * 1.2}s` }}>
            {isFlower ? (i % 3 === 0 ? "🌸" : i % 3 === 1 ? "💮" : "✿") : (i % 2 === 0 ? "💥" : "💢")}
          </span>
        ))}
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

function CardButton({ card, disabled, onClick, flash, flashOutcome, pending, revealing, showSpymasterHints }: {
  card: PublicCard; disabled: boolean; onClick: () => void;
  flash: boolean; flashOutcome: RevealOutcome | null; pending: boolean; revealing: boolean; showSpymasterHints: boolean;
}) {
  const classes = ["card-tile"];
  const showRevealedRole = Boolean(card.revealed && card.role);
  const showRoleHint = Boolean(showSpymasterHints && card.role && !card.revealed);
  if (showRevealedRole) classes.push(card.role!);
  else classes.push("hidden");
  if (disabled) classes.push("disabled");
  if (flash) { classes.push("card-flash"); if (flashOutcome) classes.push(`flash-${flashOutcome}`); }
  if (pending) classes.push("pending");
  if (revealing) classes.push("revealing");
  if (showRoleHint && card.role) classes.push("spymaster-hint", `hint-${card.role}`);
  return (
    <button className={classes.join(" ")} disabled={disabled} onClick={onClick} title={card.revealed ? "已翻开，无法再选" : undefined}>
      <span>{card.word}</span>
      {showRoleHint && card.role ? <small>{roleLabelShort(card.role)}</small> : null}
      {card.revealed ? <div className="flip-badge">已翻牌</div> : null}
    </button>
  );
}
