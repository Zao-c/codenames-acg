import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function HomePage() {
  const {
    effectiveIdentity,
    roomSummaries, joinByRoomCode, joinSpecificRoom,
    roomCode, setRoomCode, error, setError
  } = useGame();
  const navigate = useNavigate();

  const requireAuth = (fn: () => void) => {
    if (!effectiveIdentity) {
      setError("请先登录");
      navigate("/login");
      return;
    }
    fn();
  };

  return (
    <>
      <section className="hero home-hero">
        <p className="eyebrow">ACG 猜词推理派对 ( •̀ ω •́ )✧</p>
        <h1 className="hero-title">词牌结社</h1>
        {effectiveIdentity ? (
          <p className="hero-copy">你好，{effectiveIdentity.nickname}</p>
        ) : null}
      </section>

      <div className="home-action-grid">
        <div className="lobby-card">
          <h3>创建房间</h3>
          <p>选择词牌与棋盘，邀请朋友加入</p>
          <button className="primary-button" onClick={() => requireAuth(() => navigate("/create"))}>创建房间</button>
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
            <button className="primary-button" onClick={() => requireAuth(() => joinByRoomCode(false))} disabled={roomCode.length < 6}>加入</button>
          </div>
          <button onClick={() => requireAuth(() => joinByRoomCode(true))} disabled={roomCode.length < 6} className="lobby-spectate-btn">旁观</button>
        </div>
      </div>

      <section className="panel panel-light public-room-panel">
        <div className="panel-heading">
          <h2>公开房间</h2>
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
                  {summary.phase === "finished" ? (
                    <button onClick={() => requireAuth(() => joinSpecificRoom(summary.id, true))}>查看复盘</button>
                  ) : summary.canJoinDirectly ? (
                    <button onClick={() => requireAuth(() => joinSpecificRoom(summary.id, false))}>加入</button>
                  ) : (
                    <button onClick={() => requireAuth(() => joinSpecificRoom(summary.id, true))}>旁观</button>
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
