import { RoundHistory } from './RoundHistory';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAM_LABELS, type PublicRoomState } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { AvatarBadge } from './AvatarBadge';
import { Dialog } from './UI';
import { AnimeBoard } from './AnimeBoard';
import { PrivateReview } from './PrivateReview';

export function CompactMembers({room}:{room:PublicRoomState}) {
  return <section className="compact-members panel" aria-label="队伍与成员"><details open><summary>队伍与成员 · {room.players.length} 人</summary><div className="compact-members-list">{(['red','blue'] as const).map(team=><div className={`compact-team team-${team}`} key={team}><h3>{TEAM_LABELS[team]} <small>{room.players.filter(p=>p.team===team).length} 人</small></h3>{room.players.filter(p=>p.team===team).map(p=><div className="compact-member" key={p.id}><AvatarBadge avatarUrl={p.profile.avatarUrl} fallback={p.nickname} size="small"/><span><strong>{p.nickname}{p.id===room.viewer?.participantId?' · 你':''}</strong><small>{p.role==='spymaster'?'队长':'队员'}{p.isHost?' · 房主':''}</small></span><i className={p.connected?'online':'offline'} title={p.connected?'在线':'离线'} aria-label={p.connected?'在线':'离线'}/></div>)}</div>)}</div></details>{!!room.spectators.length&&<details><summary>旁观 · {room.spectators.length} 人</summary>{room.spectators.map(p=><p key={p.id}>{p.nickname}</p>)}</details>}{room.phase==='playing'&&room.viewer?.participantType==='player'&&!room.viewer.isHost&&<MatchManagement/>}</section>;
}

export function MatchManagement(){
  const g=useGame();const [open,setOpen]=useState(false);
  const room=g.room;if(!room)return null;
  const surrender=room.viewer?.team&&(room.viewer.isHost||room.viewer.role==='spymaster'||!room.players.some(p=>p.team===room.viewer?.team&&p.role==='spymaster'&&p.connected));
  return <><button onClick={()=>setOpen(true)}>{room.viewer?.isHost?'房间管理':'对局操作'}</button>{open&&<Dialog title="房间管理" close={()=>setOpen(false)}><div className="quick-settings">{room.phase==='playing'&&<><p className="hint-text">队长暂时掉线可等待恢复，房主可在下一局面板中交接当前队长。中止不计胜负和本局积分，认输仅代表自己的队伍。</p>{room.viewer?.isHost&&<button onClick={()=>{if(window.confirm('中止本局？无胜者，不计本局积分、成就和账号战绩。')){g.socket.emit('force_end_game',{roomId:room.id,mode:'abort'});setOpen(false);}}}>中止本局（不计胜负）</button>}{surrender&&<button onClick={()=>{if(window.confirm(`确定代表${room.viewer?.team==='red'?'红队':'蓝队'}认输？对方获胜，不授予账号战绩和成就。`)){g.socket.emit('force_end_game',{roomId:room.id,mode:'surrender'});setOpen(false);}}}>本队认输</button>}</>}{room.viewer?.isHost&&<button className="danger-button" onClick={g.disbandRoom}>解散房间</button>}</div></Dialog>}</>;
}

export function MatchResult({room}:{room:PublicRoomState}) {
  const g=useGame();const navigate=useNavigate();const [returning,setReturning]=useState(false);
  const returnToRoom=()=>{if(returning)return;setReturning(true);g.socket.emit('return_to_lobby',{roomId:room.id});};
  useEffect(()=>{if(g.error)setReturning(false);},[g.error]);
  useEffect(()=>{if(!returning)return;const timer=setTimeout(()=>setReturning(false),8000);return()=>clearTimeout(timer);},[returning]);
  return <section className="match-result">
    <header className="result-room-strip"><strong className="room-code">{room.id}</strong><span className="soft-chip">第 {room.roundNumber} 局 · {room.settings.variant==='anime'?'动画组牌':'经典词牌'} · {room.settings.boardMode}</span></header>
    <section className={`result-hero-card winner-${room.winner??'none'}`}>
      <p className="eyebrow">MATCH COMPLETE · 第 {room.roundNumber} 局</p>
      <h1>{room.endReason==='aborted'?'本局已中止':room.winner?`${TEAM_LABELS[room.winner]}${room.endReason==='forfeit'?'获胜 · 对方认输':'胜利'}`:'对局结束'}</h1><p className="hint-text">{room.lastEvent}</p>
      <div className="result-team-scores"><div className="red"><span>红队</span><strong>{room.scores.red}</strong></div><span>—</span><div className="blue"><span>蓝队</span><strong>{room.scores.blue}</strong></div></div>
      <div className="result-main-actions">{room.viewer?.canReturnToLobby?<button className="primary-button" disabled={returning} onClick={returnToRoom}>{returning?'正在返回房间…':'返回房间'}</button>:<span className="hint-text">等待房主返回房间，即可重新分队与准备。</span>}{room.replayId?<button onClick={()=>navigate(`/replay/${room.replayId}`)}>查看本局复盘</button>:<span className="hint-text">复盘生成中…</span>}</div>
    </section>
    <section className="panel result-board" aria-label="本局终局棋盘"><div className="result-board-heading"><h2>本局棋盘</h2><p className="hint-text">已翻标记为实际翻牌；未翻卡的阵营仅为赛后归属。</p></div>{room.settings.variant==='anime'?<AnimeBoard room={room}/>:<div className="result-classic-board" style={{gridTemplateColumns:`repeat(${Number(room.settings.boardMode[0])},minmax(0,1fr))`}}>{room.board.map(c=><div className={`card-tile result-classic-card role-${c.role} ${c.revealed?'is-revealed':''}`} key={c.id}><strong>{c.word}</strong><small>{c.revealed?'已翻':'未翻 · 赛后归属'} · {c.role==='red'?'红队':c.role==='blue'?'蓝队':c.role==='neutral'?'中立':'刺客'}</small></div>)}</div>}</section>
    <div className="result-two-columns"><section className="panel"><h2>本局称号</h2><div className="result-honors">{room.achievements?.map(a=><article key={a.id}><strong>{a.title}</strong><small>{a.nickname} · {a.description}</small></article>)}</div>{!room.achievements?.length&&<p className="hint-text">本局暂无称号，默契留待下一局。</p>}</section><ResultHighlights room={room}/></div>
    <PrivateReview room={room}/>
    <RoundHistory records={room.clueRecords??[]}/>
    <details className="panel result-fold"><summary>详细积分</summary>{room.roundScoreHistory?.map((s,i)=><p key={i}>回合 {i+1} · {TEAM_LABELS[s.team]} · {s.totalRound} 分（己方 +{s.ownPoints} / 中立 -{s.neutralPenalty} / 刺客 -{s.assassinPenalty} / 超时 -{s.timeoutPenalty??0} / 精准 +{s.precisionBonus} / 胜利 +{s.victoryBonus}）</p>)}</details>
    {g.error&&<p className="error-text" role="alert">{g.error}</p>}
  </section>;
}

function ResultHighlights({room}:{room:PublicRoomState}) {
  const reviews=room.clueRecords?.length?room.clueRecords.slice(-4).map(r=>({id:r.clueId,team:r.team,word:r.word,count:r.count,giver:r.giverNickname,guesses:r.guesses})):room.roundHighlights?.slice(-4).map(h=>({id:h.id,team:h.team,word:h.clueWord,count:h.clueCount,giver:h.giverNickname,guesses:[...h.hitCards.map(c=>({nickname:c.guessedByNickname,cardWord:c.word,cardRole:c.role,isOwnHit:true})),...h.wrongCards.map(c=>({nickname:c.guessedByNickname,cardWord:c.word,cardRole:c.role,isOwnHit:false}))]}))??[];
  return <section className="panel result-reviews"><h2>精彩回顾</h2>{reviews.map(r=><article key={r.id} className="result-highlight"><strong>{TEAM_LABELS[r.team]} · {r.word} ×{r.count}</strong><p>{r.giver} 出题 · 命中 {r.guesses.filter(g=>g.isOwnHit).length} 张</p>{r.guesses.length?<ul>{r.guesses.map((guess,i)=><li key={i} className={`result-guess role-${guess.cardRole}`}><span>{guess.nickname} 翻开 <strong>《{guess.cardWord}》</strong></span><small>{guess.isOwnHit?'命中己方':guess.cardRole==='assassin'?'刺客 · 对局结束':guess.cardRole==='neutral'?'中立 · 回合结束':`翻到${guess.cardRole==='red'?'红队':'蓝队'} · 回合结束`}</small></li>)}</ul>:<p>本回合未翻牌。</p>}</article>)}{!reviews.length&&<p className="hint-text">本局没有已记录的线索与翻牌。</p>}<p className="hint-text">展示最近四个回合；完整过程可进入本局复盘逐回合查看。</p></section>;
}
