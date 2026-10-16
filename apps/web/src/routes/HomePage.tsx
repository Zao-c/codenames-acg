import { loadRecoverableSessions } from '../lib/storage';
import { useEffect, useRef, useState } from "react";
import { MAX_PLAYERS, type AnimeWork } from "@acg-codenames/shared";
import { Dialog, Icon } from "../components/UI";
import { AvatarBadge } from "../components/AvatarBadge";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function HomePage() {
  const g = useGame();
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const [creating,setCreating] = useState(params.has('create'));
  const [mode,setMode] = useState<'classic'|'anime'|'reveal'>('classic');
  const [filter,setFilter] = useState<'all'|'waiting'|'playing'>('all');
  const codeInput = useRef<HTMLInputElement>(null);
  const [covers,setCovers] = useState<AnimeWork[]>([]);
  useEffect(()=>{if(params.has('create'))setCreating(true);},[params]);
  useEffect(()=>{let live=true;fetch(`${import.meta.env.VITE_SERVER_URL||''}/api/anime/catalog`).then(r=>r.json()).then(data=>{if(live)setCovers((data.works??[]).filter((w:AnimeWork)=>w.cover).slice(-4));}).catch(()=>{});return()=>{live=false;};},[]);
  const requireAuth = (fn:()=>void) => {if(!g.effectiveIdentity){g.setError('请先登录');navigate(`/login?next=${encodeURIComponent(g.roomCode.length===6?`/room/${g.roomCode}?join=1`:'/?create=1')}`);return;}fn();};
  const closeCreate = () => {setCreating(false);if(params.has('create'))setParams({}, {replace:true});};
  const mine=(id:string)=>g.session?.roomId===id||!!loadRecoverableSessions()[id];
  const rooms = [...g.roomSummaries].filter(r=>filter==='all'||(filter==='waiting'?r.phase==='lobby'&&r.canJoinDirectly:r.phase==='playing')).sort((a,b)=>Number(b.phase==='lobby'&&b.canJoinDirectly)-Number(a.phase==='lobby'&&a.canJoinDirectly)||b.updatedAt-a.updatedAt);
  return <div className="home-screen lobby-v2">
    <section className="home-intro">
      <div className="home-welcome"><p className="eyebrow">ACG · 和朋友一起玩</p><h1>找同好，<br/>开一局。</h1><p>选择熟悉的作品，交换线索与默契。建个房间邀请朋友，或加入正在等待的队伍。</p>
        <div className="home-welcome-actions"><button className="primary-button" onClick={()=>requireAuth(()=>setCreating(true))}>＋ 创建房间</button><button onClick={()=>{codeInput.current?.scrollIntoView({block:'center',behavior:'smooth'});codeInput.current?.focus({preventScroll:true});}}>加入好友的房间 ↗</button></div>
        <div className="home-welcome-meta"><span>经典词牌</span><span>动画组牌</span><span>揭幕猜番</span></div>
      </div>
      {!!covers.length&&<div className="home-feature" aria-label="动画目录精选"><div className="feature-covers">{covers.map(w=><figure className="feature-cover" key={w.id}><img src={w.cover} alt={w.title} loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.visibility='hidden';}}/><span>{w.title}</span></figure>)}</div><div className="feature-caption">想玩的作品，成为共同的词牌</div></div>}
    </section>
    <section className="join-inline" aria-label="通过房号加入"><div className="join-copy"><strong>已有房号？</strong><span>输入六位房号，直接加入朋友的局</span></div><form className="join-form" onSubmit={e=>{e.preventDefault();requireAuth(()=>g.joinByRoomCode(false));}}><input ref={codeInput} value={g.roomCode} onChange={e=>g.setRoomCode(e.target.value.toUpperCase())} aria-label="房间号" placeholder="输入 6 位房号" maxLength={6} autoComplete="off" spellCheck={false}/><button type="submit" className="primary-button" disabled={g.roomCode.length!==6}>加入房间 →</button><button type="button" disabled={g.roomCode.length!==6} onClick={()=>requireAuth(()=>g.joinByRoomCode(true))}>旁观</button></form></section>
    <section className="public-lobby"><div className="public-heading"><div><p className="eyebrow">DISCOVER / PUBLIC ROOMS</p><h2>公开房间 <span className="public-count">{rooms.length} 间</span></h2><p className="hint-text">找到还差队友的房间，或旁观进行中的对局。</p></div><div className="public-filter" role="group" aria-label="筛选公开房间">{(['all','waiting','playing'] as const).map((f,i)=><button key={f} className={filter===f?'active':''} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{['全部','可加入','进行中'][i]}</button>)}</div></div>
      <div className="home-room-grid">{rooms.map(r=>{const reveal=r.gameMode==='reveal-guess';const title=reveal?'揭幕猜番':r.variant==='anime'?'动画组牌':'经典词牌';return <article className="home-room" key={r.id} data-room-id={r.id}><div className="home-room-top"><div className="home-room-name"><span className="home-room-ico"><Icon name={reveal?'cards':r.variant==='anime'?'book':'chat'}/></span><div><strong>{title}</strong><small>房间 {r.id}</small></div></div><span className={`home-room-state ${r.phase==='lobby'&&r.canJoinDirectly?'waiting':'playing'}`}>{r.phase==='playing'?'进行中':r.phase==='finished'?'已结束':r.canJoinDirectly?'等待加入':'准备中'}</span></div><div className="home-room-metas">{!reveal&&<span className="tag">{r.boardMode.replace('x','×')} 棋盘</span>}<span className="tag">{reveal?'揭开画面，猜出作品':r.poolName||r.wordPackSummary.name}</span><span className="tag">{r.spectatorCount} 人旁观</span></div><div className="home-room-bottom"><div className="home-room-owner"><AvatarBadge avatarUrl={r.hostProfile.avatarUrl} fallback={r.hostNickname} size="small"/><span>{r.hostNickname}<br/><em>{r.playerCount} / {MAX_PLAYERS}</em> 玩家</span></div><button className={`home-room-btn ${r.phase==='lobby'&&r.canJoinDirectly?'primary-button':''}`} onClick={()=>requireAuth(()=>{if(mine(r.id))g.joinSpecificRoom(r.id,false);else if(r.phase==='finished'&&r.replayId)navigate(`/replay/${r.replayId}`);else g.joinSpecificRoom(r.id,!r.canJoinDirectly);})}>{mine(r.id)?'返回房间':r.phase==='finished'&&r.replayId?'查看复盘':r.canJoinDirectly?'加入房间':'旁观'}</button></div></article>;})}</div>
      {!rooms.length&&<div className="home-room-empty">{g.roomSummaries.length?'当前没有符合条件的房间。':'还没有人开局。创建一个房间，邀请朋友一起加入。'}</div>}
    </section>
    {g.error&&<p className="error-text" role="alert">{g.error}</p>}
    {creating&&<Dialog title="创建一间房间" close={closeCreate}><p className="hint-text">先选玩法，其余设置进入准备大厅后统一调整。</p><div className="create-option-list" role="group" aria-label="选择游戏玩法">{(['classic','anime','reveal'] as const).map((m,i)=><button key={m} aria-label={['经典词牌','动画组牌','揭幕猜番'][i]} className={`create-choice ${mode===m?'active':''}`} aria-pressed={mode===m} onClick={()=>setMode(m)}><span className="create-choice-icon"><Icon name={i===0?'chat':i===1?'book':'cards'}/></span><span><strong>{['经典词牌','动画组牌','揭幕猜番'][i]}</strong><small>{['队长给出线索，队员联想猜词','从真实动画作品池挑选牌面','揭开画面猜作品，使用专用准备流程'][i]}</small></span><span className="check">✓</span></button>)}</div><div className="v2-dialog-actions"><button onClick={closeCreate}>取消</button><button className="primary-button" onClick={()=>requireAuth(()=>{closeCreate();if(mode==='reveal')g.createRevealGuessRoom();else g.createRoom(true,mode);})}>创建房间 →</button></div><button className="v2-text-button" onClick={()=>{closeCreate();navigate('/create');}}>高级建房：预设文字题库或揭幕题目</button></Dialog>}
  </div>;
}
