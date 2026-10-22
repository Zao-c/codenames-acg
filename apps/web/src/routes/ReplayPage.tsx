import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchReplay } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { TEAM_LABELS, type GameReplay, type Team } from "@acg-codenames/shared";
import { ReplayExport } from '../components/ReplayExport';
import { cumulativeReplayBoard, replayCardId, roleLabel } from '../lib/replay-board';
import { Cover } from "../components/AnimeBoard";
import { CardRevealTint } from '../components/CardRevealTint';

function ReplayBoard({ replay, turn, guessCount, focused }: { replay:GameReplay; turn:number|null; guessCount?:number; focused:string|null }) {
  const board=cumulativeReplayBoard(replay,turn,guessCount);
  return <div className="replay-board" style={{gridTemplateColumns:`repeat(${Math.sqrt(board.length)},minmax(0,1fr))`}}>{board.map(card=><div key={card.id} id={`replay-card-${card.id}`} data-card-id={card.id} data-revealed={card.revealed} tabIndex={-1} title={card.word} className={`replay-board-card replay-card-role-${card.role??'hidden'} ${card.revealed?'is-revealed':'replay-card-unrevealed'} ${focused===card.id?'card-focused':''}`}>
    {card.anime&&<span className="replay-board-cover"><Cover work={card.anime}/></span>}
    {card.anime&&card.revealed&&card.role&&<CardRevealTint role={card.role}/>}
    <span className="replay-board-word">{card.word}</span>
    <span className="replay-board-tag">{card.revealed?`已翻 · ${roleLabel(card.role!)}`:'未翻'}</span>
    {!card.revealed&&turn===null&&<span className="replay-post-affiliation">赛后归属：{roleLabel(card.role!)}</span>}
    {card.revealed&&card.guessedByNickname&&<span className="replay-board-guesser">{card.guessedByNickname}</span>}
  </div>)}</div>;
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
  const currentReplayId=useRef(replayId);currentReplayId.current=replayId;
  const navigate = useNavigate();
  const [replay, setReplay] = useState<GameReplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeRound,setActiveRound]=useState<number|null>(null),[focused,setFocused]=useState<string|null>(null);
  const [activeGuess,setActiveGuess]=useState<number>();
  const [mobileView,setMobileView]=useState<'board'|'timeline'>('board');
  const [detailsOpen,setDetailsOpen]=useState(()=>window.innerWidth>760);
  const [copyFail, setCopyFail] = useState(false);

  useEffect(() => {
    if (!replayId) return;
    let active=true;
    setLoading(true);setReplay(null);setError('');setActiveRound(null);setActiveGuess(undefined);setFocused(null);setCopied(false);setCopyFail(false);setMobileView('board');setDetailsOpen(false);
    fetchReplay(replayId)
      .then((r) => { if(active){setReplay(r); setLoading(false);} })
      .catch((e) => { if(active){setError(e instanceof Error ? e.message : "加载复盘失败"); setLoading(false);} });
    return()=>{active=false;};
  }, [replayId]);

  const copyReplayLink = async () => {
    const url = `${window.location.origin}/replay/${replayId}`;
    const ok = await copyText(url);
    if(currentReplayId.current!==replayId)return;
    if (ok) {
      setCopyFail(false);
      setCopied(true);
      setTimeout(() => {if(currentReplayId.current===replayId)setCopied(false);}, 2000);
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
  const resolveCard=(g:GameReplay['rounds'][number]['guesses'][number])=>replayCardId(replay,g);
  const steps=[{turn:0,count:0},...sortedRounds.flatMap(r=>r.guesses.length?r.guesses.map((_,i)=>({turn:r.index,count:i+1})):[{turn:r.index,count:0}])];
  const stepIndex=activeRound===null?-1:steps.reduce((found,s,i)=>s.turn===activeRound&&(activeGuess===undefined||s.count===activeGuess)?i:found,-1);
  const goStep=(index:number)=>{const s=steps[index];if(s){setActiveRound(s.turn);setActiveGuess(s.count);setFocused(null);}};
  const focusGuess=(g:GameReplay['rounds'][number]['guesses'][number],turn:number,count:number)=>{
    setActiveRound(turn);setActiveGuess(count);
    const id=resolveCard(g);if(!id)return;setFocused(id);setMobileView('board');
    window.setTimeout(()=>{if(currentReplayId.current!==replayId)return;const card=document.getElementById(`replay-card-${id}`);card?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});card?.focus({preventScroll:true});},0);
  };

  return (
    <div className={`replay-page replay-view-${mobileView}`}>
      <section className="panel replay-panel replay-hero">
        <div className="replay-hero-header">
          {replay.roomId ? (
            <button onClick={() => navigate(`/room/${replay.roomId}`)}>← 返回原房间</button>
          ) : null}
          <button onClick={copyReplayLink}>{copyFail ? `复制失败，请手动复制: ${window.location.origin}/replay/${replayId}` : copied ? "已复制" : "复制复盘链接"}</button>
          <button onClick={() => navigate("/")}>回到大厅</button>
        </div>
        <h1 className="replay-title">第 {replay.roundNumber??'—'} 局 · 对局复盘</h1><ReplayExport key={replay.id} replay={replay}/>
        <details className="replay-meta-details" open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary>本局信息 · {teamName(replay.winner)}{replay.endReason==='aborted'?'中止':'获胜'} · {replay.mode.boardMode}</summary>
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
            <strong>{replay.endReason==='aborted'?'房主中止 · 不计胜负':`${teamName(replay.winner)}${replay.endReason==='forfeit'?' · 对方认输':''}`}</strong>
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
        </details>
      </section>

      <nav className="replay-mobile-tabs" aria-label="复盘视图"><button aria-pressed={mobileView==='board'} onClick={()=>setMobileView('board')}>棋盘</button><button aria-pressed={mobileView==='timeline'} onClick={()=>setMobileView('timeline')}>回合时间线</button></nav>
      <section className="panel replay-panel replay-board-panel">
        <div className="panel-heading">
          <h2>{activeRound!==null?`第 ${activeRound} 回合后的棋盘`:'终局棋盘'}</h2><button aria-pressed={activeRound===null} onClick={()=>{setActiveRound(null);setActiveGuess(undefined);setFocused(null);}}>完整棋盘</button><button aria-pressed={activeRound!==null} onClick={()=>{goStep(Math.min(1,steps.length-1));}}>逐回合回看</button>
        </div>
        <p className="hint-text">{activeRound===null?'全部终局牌；未翻状态与赛后归属分别标注。':`累计展示至第 ${activeRound} 回合的实际翻牌；未翻牌不显示未来阵营。`}</p>
        {activeRound!==null&&<div className="replay-step-controls"><button disabled={stepIndex<=0} onClick={()=>goStep(stepIndex-1)}>上一步</button><span>第 {activeRound} 回合 · 步骤 {Math.max(0,stepIndex)} / {steps.length-1}</span><button disabled={stepIndex>=steps.length-1} onClick={()=>goStep(stepIndex+1)}>下一步</button></div>}
        <ReplayBoard replay={replay} turn={activeRound} guessCount={activeGuess} focused={focused}/>

      </section>

      <section className="panel replay-panel replay-timeline">
        <div className="panel-heading">
          <h2>回合时间线</h2>
        </div>
        {sortedRounds.length === 0 ? (
          <p className="empty-text">暂无回合记录。</p>
        ) : (
          sortedRounds.map((round) => (
            <div key={round.index} className={`replay-round replay-round-${round.team} ${activeRound===round.index?'active':''}`}>
              <button className="replay-round-header" aria-pressed={activeRound===round.index} onClick={()=>{setActiveRound(round.index);setActiveGuess(undefined);setFocused(null);}}>
                <span className="replay-round-num">第 {round.index} 回合</span>
                <span className="replay-round-team">{teamName(round.team)}</span>
                <span className="soft-chip">{round.clueWord} {round.clueCount}</span>
                <small>{round.giverNickname} · 命中 {round.guesses.filter(g=>g.result==='hit').length} · 失误 {round.guesses.filter(g=>g.result!=='hit').length}</small>
              </button>
              {activeRound===round.index&&<div className="replay-guesses">
                {round.guesses.map((g, j) => (
                  <button key={j} className={`replay-guess replay-guess-${g.result}`} onClick={()=>focusGuess(g,round.index,j+1)}>
                    <span>{g.word} · {g.guessedByNickname} · {roleLabel(g.role)}</span>
                    <span className="replay-guess-result">{resultLabel(g.result)}</span>
                  </button>
                ))}
              </div>}
              {activeRound===null && round.missed && round.missed.length > 0 ? (
                <div className="replay-missed">
                  <span className="replay-missed-label">漏选：</span>
                  {round.missed.map((m) => (
                    <span key={m.word} className="replay-missed-tag">{m.word}</span>
                  ))}
                </div>
              ) : null}
              {activeRound===round.index&&activeGuess===undefined&&replay.keyEvents.filter(ev=>ev.roundIndex===round.index).map(ev=><div className="replay-bound-event" key={ev.id}><strong>{ev.title}</strong><p>{ev.description}</p></div>)}
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


    </div>
  );
}
