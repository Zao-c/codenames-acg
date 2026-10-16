import { useEffect, useState } from "react";
import type { AnimeWork } from "@acg-codenames/shared";
import { Icon } from "../components/UI";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function HomePage() {
  const {
    effectiveIdentity, createRoom,
    roomSummaries, joinByRoomCode, joinSpecificRoom,
    roomCode, setRoomCode, error, setError
  } = useGame();
  const navigate = useNavigate();
  const [covers,setCovers]=useState<AnimeWork[]>([]);
  useEffect(()=>{let live=true;fetch(`${import.meta.env.VITE_SERVER_URL||''}/api/anime/catalog`).then(r=>r.json()).then(data=>{if(live)setCovers((data.works??[]).filter((w:AnimeWork)=>w.cover).slice(-6));}).catch(()=>{});return()=>{live=false;};},[]);

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
        <div className="home-hero-copy"><p className="eyebrow">ACG × 多人桌游</p><h1 className="hero-title">一个词，<br/>找到同频的你。</h1><p className="hero-copy">从熟悉的动画，到意想不到的联想。<br/>邀请朋友入座，把默契交给下一张词牌。</p><div className="hero-meta"><span>经典词牌</span><span>动画组牌</span><span>揭幕猜番</span></div></div>
        <div className="hero-covers" aria-label="动画目录精选">{covers.map(w=><figure key={w.id}><img src={w.cover} alt={w.title} loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.visibility='hidden';}}/><figcaption>{w.title}</figcaption></figure>)}</div>
      </section>
      <div className="home-action-grid">
        <div className="lobby-card">
          <div className="lobby-card-heading"><Icon name="cards"/><h3>开一局，等你入座</h3><span className="step-number">01</span></div>
          <p>先创建大厅邀请朋友，再一起选择玩法</p>
          <button className="primary-button" onClick={() => requireAuth(() => createRoom(true))}>创建房间</button>
          <button onClick={() => requireAuth(() => navigate("/create"))}>揭幕猜番 / 高级建房</button>
        </div>
        <div className="lobby-card">
          <div className="lobby-card-heading"><Icon name="users"/><h3>加入朋友的房间</h3><span className="step-number">02</span></div>
          <p>输入 6 位房间号，加入朋友的游戏</p>
          <div className="room-code-input">
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              aria-label="房间号" placeholder="输入 6 位房号" onKeyDown={e=>{if(e.key==='Enter'&&roomCode.length===6)requireAuth(()=>joinByRoomCode(false));}}
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
          <p className="empty-text">还没有人开局。创建一个房间，邀请朋友一起加入。</p>
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
                    <button onClick={() => requireAuth(() => {
                      if (summary.replayId) navigate(`/replay/${summary.replayId}`);
                      else joinSpecificRoom(summary.id, true);
                    })}>查看复盘</button>
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
