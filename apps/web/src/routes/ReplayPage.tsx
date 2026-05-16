import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchReplay } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { TEAM_LABELS, type GameReplay, type Team } from "@acg-codenames/shared";

function ReplayBoard({ finalBoard }: { finalBoard: GameReplay["finalBoard"] }) {
  return (
    <div className="replay-board">
      {finalBoard.map((card) => (
        <div
          key={card.id}
          className={`replay-board-card replay-card-role-${card.role}${card.revealed ? "" : " replay-card-unrevealed"}`}
        >
          <span className="replay-board-word">{card.word}</span>
          {card.revealed && card.guessedByNickname ? (
            <span className="replay-board-guesser">{card.guessedByNickname}</span>
          ) : null}
          {!card.revealed ? (
            <span className="replay-board-tag">未翻</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min} 分 ${sec} 秒`;
}

function modeLabel(mode: GameReplay["mode"]): string {
  const parts: string[] = [mode.boardMode];
  if (mode.scoringMode === "classic") parts.push("经典");
  if (mode.timerMode === "timed") parts.push("限时");
  return parts.join(" / ");
}

function teamName(team: Team | null): string {
  if (!team) return "未定";
  return TEAM_LABELS[team];
}

function resultLabel(result: "hit" | "opponent" | "neutral" | "assassin"): string {
  if (result === "hit") return "命中 ✅";
  if (result === "assassin") return "刺客 💀";
  if (result === "neutral") return "中立 ⚪";
  return "误伤 ❌";
}

export function ReplayPage() {
  const { replayId } = useParams<{ replayId: string }>();
  const navigate = useNavigate();
  const [replay, setReplay] = useState<GameReplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFail, setCopyFail] = useState(false);

  useEffect(() => {
    if (!replayId) return;
    setLoading(true);
    fetchReplay(replayId)
      .then((r) => { setReplay(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : "加载复盘失败"); setLoading(false); });
  }, [replayId]);

  const copyReplayLink = async () => {
    const url = `${window.location.origin}/?replay=${replayId}`;
    const ok = await copyText(url);
    if (ok) {
      setCopyFail(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopied(false);
      setCopyFail(true);
    }
  };

  if (loading) {
    return (
      <section className="panel replay-panel">
        <h2>加载复盘...</h2>
      </section>
    );
  }

  if (error || !replay) {
    return (
      <section className="panel replay-panel">
        <h2>复盘不可用</h2>
        <p className="hint-text">{error || "复盘不存在或已过期"}</p>
        <button className="primary-button" onClick={() => navigate("/")}>返回大厅</button>
      </section>
    );
  }

  const expiryDays = Math.max(0, Math.ceil((replay.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  const sortedRounds = [...replay.rounds].sort((a, b) => a.index - b.index);

  return (
    <div className="replay-page">
      <section className="panel replay-panel replay-hero">
        <div className="replay-hero-header">
          {replay.roomId ? (
            <button onClick={() => navigate(`/room/${replay.roomId}`)}>← 返回原房间</button>
          ) : null}
          <button onClick={copyReplayLink}>{copyFail ? `复制失败，请手动复制: ${window.location.origin}/?replay=${replayId}` : copied ? "已复制" : "复制复盘链接"}</button>
          <button onClick={() => navigate("/")}>回到大厅</button>
        </div>
        <h1 className="replay-title">对局复盘</h1>
        <div className="replay-meta-grid">
          <div className="replay-meta-item">
            <span className="micro-label">房间</span>
            <strong>{replay.roomId}</strong>
          </div>
          <div className="replay-meta-item">
            <span className="micro-label">时间</span>
            <strong>{new Date(replay.createdAt).toLocaleString("zh-CN")}</strong>
          </div>
          <div className="replay-meta-item">
            <span className="micro-label">模式</span>
            <strong>{modeLabel(replay.mode)}</strong>
          </div>
          <div className="replay-meta-item">
            <span className="micro-label">胜方</span>
            <strong>{teamName(replay.winner)}</strong>
          </div>
          <div className="replay-meta-item">
            <span className="micro-label">总时长</span>
            <strong>{replay.durationMs ? formatDuration(replay.durationMs) : "暂无"}</strong>
          </div>
          <div className="replay-meta-item">
            <span className="micro-label">有效期</span>
            <span>{expiryDays > 0 ? `将在 ${expiryDays} 天后过期` : "即将过期"}</span>
          </div>
        </div>
        <div className="replay-players">
          {replay.players.map((p) => (
            <span key={p.id} className="replay-player-chip">
              {p.nickname}{p.isHost ? " 👑" : ""} ({teamName(p.team)})
            </span>
          ))}
        </div>
      </section>

      <section className="panel replay-panel">
        <div className="panel-heading">
          <h2>终局棋盘</h2>
        </div>
        <ReplayBoard finalBoard={replay.finalBoard} />
      </section>

      <section className="panel replay-panel replay-timeline">
        <div className="panel-heading">
          <h2>回合时间线</h2>
        </div>
        {sortedRounds.length === 0 ? (
          <p className="empty-text">暂无回合记录。</p>
        ) : (
          sortedRounds.map((round) => (
            <div key={round.index} className={`replay-round replay-round-${round.team}`}>
              <div className="replay-round-header">
                <span className="replay-round-num">第 {round.index} 回合</span>
                <span className="replay-round-team">{teamName(round.team)}</span>
                <span className="soft-chip">{round.clueWord} {round.clueCount}</span>
              </div>
              <div className="replay-guesses">
                {round.guesses.map((g, j) => (
                  <div key={j} className={`replay-guess replay-guess-${g.result}`}>
                    <span>{g.word}</span>
                    <span className="replay-guess-result">{resultLabel(g.result)}</span>
                  </div>
                ))}
              </div>
              {round.missed && round.missed.length > 0 ? (
                <div className="replay-missed">
                  <span className="replay-missed-label">漏选：</span>
                  {round.missed.map((m) => (
                    <span key={m.word} className="replay-missed-tag">{m.word}</span>
                  ))}
                </div>
              ) : null}
              {(round.captainLabel || round.teamLabel) ? (
                <div className="replay-round-footer">
                  {round.captainLabel ? <span>队长：{round.captainLabel}</span> : null}
                  {round.teamLabel ? <span>队员：{round.teamLabel}</span> : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      {replay.keyEvents.length > 0 ? (
        <section className="panel replay-panel replay-event-list">
          <div className="panel-heading">
            <h2>关键事件</h2>
          </div>
          <div className="replay-events">
            {replay.keyEvents.map((ev) => (
              <div key={ev.id} className={`replay-event replay-event-${ev.type}`}>
                <div className="replay-event-header">
                  <span className="replay-event-icon">
                    {ev.type === "great_clue" ? "✨" : ev.type === "assassin" ? "💀" : ev.type === "wrong_hit" ? "⚠️" : ev.type === "low_accuracy_clue" ? "🤔" : "🔥"}
                  </span>
                  <strong>{ev.title}</strong>
                </div>
                <p className="replay-event-desc">{ev.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
