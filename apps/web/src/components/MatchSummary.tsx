import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAM_LABELS, type PublicRoomState } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { AvatarBadge } from './AvatarBadge';
import { Dialog } from './UI';
import { NextMatchPanel } from './AnimePlay';
import { AnimeBoard } from './AnimeBoard';
import { PrivateReview } from './PrivateReview';

export function CompactMembers({room}:{room:PublicRoomState}) {
  return <section className="compact-members panel" aria-label="队伍与成员"><h2>队伍与成员</h2>{(['red','blue'] as const).map(team=><div className={`compact-team team-${team}`} key={team}><h3>{TEAM_LABELS[team]} <small>{room.players.filter(p=>p.team===team).length} 人</small></h3>{room.players.filter(p=>p.team===team).map(p=><div className="compact-member" key={p.id}><AvatarBadge avatarUrl={p.profile.avatarUrl} fallback={p.nickname} size="small"/><span><strong>{p.nickname}{p.id===room.viewer?.participantId?' · 你':''}</strong><small>{p.role==='spymaster'?'队长':'队员'}{p.isHost?' · 房主':''}</small></span><i className={p.connected?'online':'offline'} title={p.connected?'在线':'离线'} aria-label={p.connected?'在线':'离线'}/></div>)}</div>)}{!!room.spectators.length&&<details><summary>旁观 · {room.spectators.length} 人</summary>{room.spectators.map(p=><p key={p.id}>{p.nickname}</p>)}</details>}{room.phase==='playing'&&room.viewer?.participantType==='player'&&!room.viewer.isHost&&<MatchManagement/>}</section>;
}

export function MatchManagement(){
  const g=useGame();const [open,setOpen]=useState(false);
  const room=g.room;if(!room)return null;
  const surrender=room.viewer?.team&&(room.viewer.isHost||room.viewer.role==='spymaster'||!room.players.some(p=>p.team===room.viewer?.team&&p.role==='spymaster'&&p.connected));
  return <><button onClick={()=>setOpen(true)}>{room.viewer?.isHost?'房间管理':'对局操作'}</button>{open&&<Dialog title="房间管理" close={()=>setOpen(false)}><div className="quick-settings">{room.phase==='playing'&&<><p className="hint-text">队长暂时掉线可等待恢复，房主可在下一局面板中交接当前队长。中止不计胜负和本局积分，认输仅代表自己的队伍。</p>{room.viewer?.isHost&&<button onClick={()=>{if(window.confirm('中止本局？无胜者，不计本局积分、成就和账号战绩。')){g.socket.emit('force_end_game',{roomId:room.id,mode:'abort'});setOpen(false);}}}>中止本局（不计胜负）</button>}{surrender&&<button onClick={()=>{if(window.confirm(`确定代表${room.viewer?.team==='red'?'红队':'蓝队'}认输？对方获胜，不授予账号战绩和成就。`)){g.socket.emit('force_end_game',{roomId:room.id,mode:'surrender'});setOpen(false);}}}>本队认输</button>}</>}{room.viewer?.isHost&&<button className="danger-button" onClick={g.disbandRoom}>解散房间</button>}</div></Dialog>}</>;
}

export function MatchResult({room}:{room:PublicRoomState}) {
  const g=useGame();const navigate=useNavigate();const [next,setNext]=useState(false);
  const anime=room.nextPlan?.variant==='anime'||room.settings.variant==='anime';
  return <section className="match-result">
    <header className="result-room-strip"><strong className="room-code">{room.id}</strong><span className="soft-chip">第 {room.roundNumber} 局 · {room.settings.variant==='anime'?'动画组牌':'经典词牌'} · {room.settings.boardMode}</span></header>
    <section className={`result-hero-card winner-${room.winner??'none'}`}>
      <p className="eyebrow">MATCH COMPLETE · 第 {room.roundNumber} 局</p>
      <h1>{room.endReason==='aborted'?'本局已中止':room.winner?`${TEAM_LABELS[room.winner]}${room.endReason==='forfeit'?'获胜 · 对方认输':'胜利'}`:'对局结束'}</h1><p className="hint-text">{room.lastEvent}</p>
      <div className="result-team-scores"><div className="red"><span>红队</span><strong>{room.scores.red}</strong></div><span>—</span><div className="blue"><span>蓝队</span><strong>{room.scores.blue}</strong></div></div>
      <div className="result-main-actions">{anime?<button className="primary-button" onClick={()=>setNext(true)}>准备下一局</button>:room.viewer?.canRestartGame&&<button className="primary-button" onClick={g.restartGame}>再来一局</button>}{room.replayId?<button onClick={()=>navigate(`/replay/${room.replayId}`)}>查看本局复盘</button>:<span className="hint-text">复盘生成中…</span>}</div>
    </section>
    <div className="result-two-columns"><section className="panel"><h2>本局称号</h2><div className="result-honors">{room.achievements?.map(a=><article key={a.id}><strong>{a.title}</strong><small>{a.nickname} · {a.description}</small></article>)}</div>{!room.achievements?.length&&<p className="hint-text">本局暂无称号，默契留待下一局。</p>}</section><section className="panel"><h2>精彩回顾</h2>{room.roundHighlights?.slice(-4).map(h=><div key={h.id} className="result-highlight"><strong>{TEAM_LABELS[h.team]} · {h.clueWord} {h.clueCount}</strong><p>{h.teamTitle} · 命中 {h.hitCards.length} 张</p></div>)}{!room.roundHighlights?.length&&<p className="hint-text">完整过程可在本局复盘中查看。</p>}</section></div>
    <section className="result-next-entry"><div><h2>下一局计划</h2><p>选择玩法、队长与作品池，进入完整工作区继续准备。</p></div><button onClick={()=>setNext(true)}>{anime?'打开下一局设置':'准备下一局'}</button></section>
    <PrivateReview room={room}/>
    <details className="panel result-fold"><summary>回合历史 · {room.clueRecords?.length??0} 条线索</summary>{room.clueRecords?.map(c=><article key={c.clueId}><strong>{TEAM_LABELS[c.team]} · {c.word} {c.count}</strong><p>{c.giverNickname}</p>{c.guesses.map((v,i)=><p key={i}>{v.nickname} · {v.cardWord} · {v.isOwnHit?'命中':'失误'}</p>)}</article>)}</details>
    <details className="panel result-fold result-board"><summary>查看本局终局棋盘</summary>{room.settings.variant==='anime'?<AnimeBoard room={room}/>:<div className="result-classic-board" style={{gridTemplateColumns:`repeat(${Number(room.settings.boardMode[0])},minmax(0,1fr))`}}>{room.board.map(c=><div className={`card-tile role-${c.role}`} key={c.id}>{c.word}</div>)}</div>}</details>
    <details className="panel result-fold"><summary>详细积分</summary>{room.roundScoreHistory?.map((s,i)=><p key={i}>回合 {i+1} · {TEAM_LABELS[s.team]} · {s.totalRound} 分（己方 +{s.ownPoints} / 中立 -{s.neutralPenalty} / 刺客 -{s.assassinPenalty} / 精准 +{s.precisionBonus} / 胜利 +{s.victoryBonus}）</p>)}</details>
    {g.error&&<p className="error-text" role="alert">{g.error}</p>}
    {next&&<Dialog title="下一局计划" close={()=>setNext(false)} wide><NextMatchPanel room={room} embedded/></Dialog>}
  </section>;
}
