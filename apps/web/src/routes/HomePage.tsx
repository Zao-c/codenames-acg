import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";

export function HomePage() {
  const {
    effectiveIdentity, guestNicknameInput, setGuestNicknameInput,
    roomSummaries, createRoom, joinByRoomCode, joinSpecificRoom,
    roomCode, setRoomCode, continueAsGuest, error, setError,
    packSource, selectedAccountPack, selectedPublicPack
  } = useGame();
  const navigate = useNavigate();

  return (
    <>
      <section className="hero">
        <div className="hero-copy-block">
          <p className="eyebrow">ACG social deduction (◕‿◕)ﾉ</p>
          <h1>🃏 行动代号 Online</h1>
          <p className="hero-copy">用户名模式可跨设备保留头像、题库和战绩。游客模式可直接开玩，但不保证跨设备保留数据。</p>
        </div>
        {effectiveIdentity ? (
          <div className="hero-actions">
            <AvatarBadge avatarUrl={effectiveIdentity.avatarUrl} fallback={effectiveIdentity.nickname} size="large" />
            <div className="hero-tags">
              <span>{effectiveIdentity.mode === "named" ? "用户名账户" : "游客模式"}</span>
              <span>{effectiveIdentity.nickname}</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel quick-start-panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">Quick Start</p>
            <h2>⚡ 快速开局</h2>
          </div>
          {effectiveIdentity ? (
            <div className="quick-start-identity">
              <AvatarBadge avatarUrl={effectiveIdentity.avatarUrl} fallback={effectiveIdentity.nickname} size="small" />
              <strong>{effectiveIdentity.nickname}</strong>
              <span className="soft-chip">{effectiveIdentity.mode === "named" ? "账户" : "游客"}</span>
            </div>
          ) : (
            <span className="soft-chip">未登录</span>
          )}
        </div>
        {!effectiveIdentity ? (
          <div className="quick-start-row">
            <label className="field">
              <span>昵称</span>
              <input value={guestNicknameInput} onChange={(e) => setGuestNicknameInput(e.target.value)} maxLength={12} placeholder="输入昵称直接开玩" />
            </label>
            <div className="quick-start-actions">
              <button className="primary-button" onClick={continueAsGuest} disabled={!guestNicknameInput.trim()}>游客进入</button>
            </div>
          </div>
        ) : null}
        <div className="quick-start-row">
          <div className="quick-start-actions">
            <button className="primary-button" onClick={createRoom} disabled={!effectiveIdentity || (packSource === "account" && !selectedAccountPack) || (packSource === "public" && !selectedPublicPack)}>创建房间</button>
            <button onClick={() => navigate("/create")}>开房设置</button>
          </div>
          <div className="join-row">
            <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="输入 6 位房间号" maxLength={6} />
            <button onClick={() => joinByRoomCode(false)} disabled={!effectiveIdentity}>加入</button>
            <button onClick={() => joinByRoomCode(true)} disabled={!effectiveIdentity}>旁观</button>
          </div>
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
                  <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, false)}>加入战局</button>
                ) : summary.canSpectate ? (
                  <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, true)}>旁观激战</button>
                ) : (
                  <button disabled>已结束</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
