import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function HomePage() {
  const {
    effectiveIdentity,
    roomSummaries, createRoom, joinByRoomCode, joinSpecificRoom,
    roomCode, setRoomCode, error
  } = useGame();
  const navigate = useNavigate();

  return (
    <>
      <section className="hero">
        <p className="eyebrow">ACG 猜词推理派对 ( •̀ ω •́ )✧</p>
        <h1>词牌结社</h1>
        {effectiveIdentity ? (
          <p className="hero-copy">你好，{effectiveIdentity.nickname}</p>
        ) : null}
      </section>

      <div className="lobby-grid">
        <div className="lobby-card">
          <h3>创建房间</h3>
          <p>选择词牌与棋盘，邀请朋友加入</p>
          <button className="primary-button" onClick={() => navigate("/create")} disabled={!effectiveIdentity}>创建房间</button>
        </div>
        <div className="lobby-card">
          <h3>加入房间</h3>
          <p>输入 6 位房间号，加入朋友的游戏</p>
          <div className="room-code-input">
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="输入房号"
              maxLength={6}
            />
            <button className="primary-button" onClick={() => joinByRoomCode(false)} disabled={!effectiveIdentity || roomCode.length < 6}>加入</button>
          </div>
          <button onClick={() => joinByRoomCode(true)} disabled={!effectiveIdentity || roomCode.length < 6}>旁观</button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>公开房间</h2>
          </div>
          <span className="soft-chip">{roomSummaries.length} 个</span>
        </div>
        {roomSummaries.length === 0 ? (
          <p className="empty-text">暂无公开房间，来创建第一个吧 (＞﹏＜)</p>
        ) : (
          <div className="room-list">
            {roomSummaries.map((summary) => (
              <div className="room-list-item" key={summary.id}>
                <div className="room-list-main">
                  <div className="room-list-title">
                    <strong>{summary.id}</strong>
                    <span className="soft-chip">{summary.phase === "playing" ? "进行中" : summary.phase === "lobby" ? "准备中" : "已结束"}</span>
                    <span className="soft-chip">{summary.boardMode}</span>
                    <span className="soft-chip">{summary.wordPackSummary.name}</span>
                  </div>
                  <div className="room-list-meta">
                    <span>社长 {summary.hostNickname}</span>
                    <span>玩家 {summary.playerCount}</span>
                    <span>旁观 {summary.spectatorCount}</span>
                  </div>
                  <p className="panel-subtle">{summary.lastEvent}</p>
                </div>
                <div className="room-list-actions">
                  {summary.canJoinDirectly ? (
                    <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, false)}>加入</button>
                  ) : summary.canSpectate ? (
                    <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(summary.id, true)}>旁观</button>
                  ) : (
                    <button disabled>已结束</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
