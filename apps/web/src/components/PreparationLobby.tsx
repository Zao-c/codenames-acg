import { useEffect, useRef, useState } from 'react';
import { MAX_PLAYERS, TEAM_LABELS, type PlanAction, type PublicPlayer, type PublicRoomState, type Team } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { AvatarBadge } from './AvatarBadge';
import { PrivateReview } from './PrivateReview';
import { Dialog, Icon } from './UI';
import { NextMatchPanel, StartCountdown } from './AnimePlay';

/** Preparation is a single workspace. All decisions use the current server snapshot. */
export function PreparationLobby({room}:{room:PublicRoomState}) {
  const g = useGame();
  const [settings,setSettings] = useState(false);
  const [preview,setPreview] = useState(false);
  const [management,setManagement] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const plan = room.nextPlan;
  const stage = plan?.stage ?? 'planning';
  const host = room.viewer?.isHost;
  const locked = !!room.countdown || stage === 'sealed' || stage === 'draft';
  const anime = plan?.variant === 'anime';
  const config = plan?.settings ?? room.settings;
  const self = room.players.find(p=>p.id===room.viewer?.participantId);
  const captain = (team:Team) => plan ? plan.captains[team] : room.players.find(p=>p.team===team&&p.role==='spymaster')?.id;
  const missing = (['red','blue'] as const).filter(t=>!captain(t));
  const balanced = room.players.length>=4 && (['red','blue'] as const).every(t=>room.players.filter(p=>p.team===t).length>=2);
  const rosterReady = balanced && !missing.length;
  const offlineCaptains=(['red','blue'] as const).filter(t=>!room.players.some(p=>p.id===captain(t)&&(p.connected||p.isBot)));
  const myTeam = plan?.myTeam;
  const ready = myTeam ? plan?.captainView?.ready[myTeam] : false;
  const send = (action:Omit<PlanAction,'roomId'|'version'>) => g.socket.emit('plan_action',{roomId:room.id,version:plan?.version,...action});
  const changeMode=(variant:'classic'|'anime')=>{if(!host||locked)return;send({kind:'configure',variant,boardMode:variant==='classic'&&config.boardMode==='6x6'?'5x5':variant==='anime'&&!['5x5','6x6'].includes(config.boardMode)?'5x5':config.boardMode});};
  useEffect(()=>{if(stage!=='guide')setPreview(false);},[stage]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest'});},[room.messages.length,g.mobileRoomTab]);
  let title = anime ? '下一步：队长预览' : '下一步：开始对局';
  let description = !balanced ? '至少 4 名玩家，每队至少 2 人。邀请好友并完成分队。' : missing.length ? `请先指定${missing.map(t=>TEAM_LABELS[t]).join('、')}队长。` : anime ? '双方队长先浏览候选作品，确认后再开始 180 秒组牌。' : '队伍与设置已就位，由房主发起五秒开局。';
  let label = host ? anime ? '进入队长预览 →' : '开始游戏' : '等待房主开始';
  let action = () => anime ? send({kind:'prepare'}) : g.startGame();
  let disabled = !host || !rosterReady || g.connectionState!=='ready';
  if(stage==='guide') {
    title='下一步：双方队长确认';
    description=missing.length?'请先指定两队队长，再浏览候选作品。':myTeam?'先预览候选作品；双方确认后才开始服务端 180 秒计时。':'双方队长正在预览候选作品，确认后将进入限时组牌。';
    label=myTeam?(ready?'已确认，等待另一队':'确认就绪，开始组牌'):'等待队长确认';
    action=()=>send({kind:'ready'});disabled=!myTeam||!!ready||!rosterReady;
  } else if(stage==='sealed') {
    title='下一步：开始对局';description=offlineCaptains.length?`${offlineCaptains.map(t=>TEAM_LABELS[t]).join('、')}队长离线，已保留封存棋盘；等待原队长恢复后开局。`:'组牌已封存，等待房主发起五秒开局。';label=host?'开始五秒倒计时':'等待房主开局';action=g.startGame;disabled=!host||!!offlineCaptains.length;
  }
  if(room.countdown){title='即将开始对局';description='服务器倒计时结束后自动进入棋盘。';label='倒计时中';disabled=true;}
  const member = (p:PublicPlayer) => {
    const mine=p.id===self?.id;const isCaptain=!!p.team&&captain(p.team)===p.id;
    return <div className={`v2-member ${mine?'is-self':''}`} key={p.id} data-player-id={p.id} data-captain={isCaptain}>
      <div className="v2-member-main"><AvatarBadge avatarUrl={p.profile.avatarUrl} fallback={p.nickname} size="small"/><span><strong>{p.nickname}{mine?' · 你':''}</strong><small>{isCaptain?'队长':'队员'}{p.isHost?' · 房主':''}{!p.connected?' · 离线':''}</small></span></div>
      {mine&&!locked&&<div className="v2-self-controls"><select aria-label="我的队伍" value={p.team??''} onChange={e=>g.chooseTeam((e.target.value||null) as Team|null)}><option value="">待分队</option><option value="red">红队</option><option value="blue">蓝队</option></select><select aria-label="我的身份" disabled={!p.team} value={isCaptain?'spymaster':'operative'} onChange={e=>g.chooseRole(e.target.value as 'spymaster'|'operative')}><option value="operative">队员</option><option value="spymaster">队长</option></select></div>}
    </div>;
  };
  return <section className={`preparation-lobby lobby-v2 mobile-view-${g.mobileRoomTab}`}>
    <header className="v2-stage-header"><div><p className="eyebrow">LOBBY / 准备大厅</p><h1>好友入座，准备开局。</h1><p className="hint-text">房间 <strong className="room-code">{room.id}</strong> · 第 {room.roundNumber} 局 · {g.connectionState==='ready'?'已连接':'正在重新连接'}</p></div><div className="v2-stage-tools"><button onClick={()=>void g.copyLink()}>{g.copied?'已复制链接':'邀请好友 ↗'}</button>{host&&<button className="icon-button" aria-label="房间管理" onClick={()=>setManagement(true)}><Icon name="settings" size={17}/></button>}</div></header>
    <StartCountdown room={room}/>
    <div className="v2-lobby-grid">
      <section className="v2-panel v2-mode"><div className="v2-panel-heading"><div><p className="eyebrow">01 · PLAY MODE</p><h2>本局玩法</h2></div>{host&&<button disabled={locked} onClick={()=>setSettings(true)}>修改设置</button>}</div><div className="v2-mode-summary"><span className="v2-field-title">已选择玩法</span><h3>{anime?'动画组牌':'经典词牌'} · {config.boardMode.replace('x','×')}</h3><p>{anime?plan?.poolName:plan?.wordPackName??room.wordPackSummary.name} · {config.scoringMode==='classic'?'胜场制':'积分制'}</p></div><div className="v2-mode-tiles">{(['classic','anime'] as const).map(v=><button type="button" key={v} aria-pressed={anime===(v==='anime')} disabled={!host||locked} onClick={()=>changeMode(v)} className={anime===(v==='anime')?'active':''}><Icon name={v==='anime'?'book':'chat'}/><strong>{v==='anime'?'动画组牌':'经典词牌'}</strong><span>{v==='anime'?'挑选动画，由双方队长组牌':'熟悉的线索和猜词对战'}</span></button>)}</div><div className="v2-note"><strong>玩法提示</strong><p>{anime?'双方队长先预览候选动画，再进行 180 秒限时组牌。':'队长用一个词和数字给出线索，队员联想并找出己方词牌。'}</p></div><footer className="v2-panel-footer"><span>房主可在开始前修改</span><span>{stage==='guide'?'队长预览':stage==='sealed'?'已封存':'等待准备'}</span></footer></section>
      <section className="v2-panel v2-players"><div className="v2-panel-heading"><div><p className="eyebrow">02 · TEAMS</p><h2>队伍与成员</h2></div><span className="tag">{room.players.length} / {MAX_PLAYERS} 人</span></div><div className="v2-team-grid">{(['red','blue'] as const).map(t=><div className={`v2-team ${t}`} key={t}><div className="v2-team-heading"><strong>{TEAM_LABELS[t]}</strong><span>{room.players.filter(p=>p.team===t).length} 人</span></div>{room.players.filter(p=>p.team===t).map(member)}{!room.players.some(p=>p.team===t)&&<p className="hint-text">等待成员入座</p>}{host&&!locked&&<label className="v2-captain-picker">本局队长<select aria-label={`${TEAM_LABELS[t]}本局队长`} value={captain(t)??''} onChange={e=>send({kind:'nominate',team:t,targetId:e.target.value})}><option value="" disabled>请选择队长</option>{room.players.filter(p=>p.team===t).map(p=><option value={p.id} key={p.id}>{p.nickname}</option>)}</select></label>}</div>)}</div>
        <div className="v2-pending"><div className="v2-team-heading"><strong>待分队</strong><span>{room.players.filter(p=>!p.team).length} 人</span></div>{room.players.filter(p=>!p.team).map(member)}{room.players.every(p=>p.team)&&<p className="hint-text">当前没有待分队玩家</p>}</div>
        {host&&<div className="v2-shuffle"><p className="v2-field-title">房主分队操作</p><div><button disabled={locked||room.players.length<4||!!missing.length} onClick={()=>g.randomizeTeams('keep-captains')}>保留队长随机队员</button><button disabled={locked||room.players.length<4} onClick={()=>g.randomizeTeams('all')}>全员重新随机</button></div><p className="hint-text">可反复重抽。保留队长时，两队队长留在原队；全员重抽会重新指定队长。</p></div>}
        {!!room.spectators.length&&<details className="v2-spectators"><summary>旁观与排队 · {room.spectators.length} 人</summary>{room.spectators.map(s=><p key={s.id}>{s.nickname}{room.joinQueue.some(q=>q.spectatorId===s.id)?' · 已排队下一局':''}</p>)}</details>}
        {room.viewer?.participantType==='spectator'&&<button onClick={room.viewer.isQueuedForNextRound?g.cancelQueueJoin:g.queueForNextRound}>{room.viewer.isQueuedForNextRound?'取消排队':'排队下一局'}</button>}
      </section>
      <aside className="v2-panel v2-chat"><div className="v2-panel-heading"><div><p className="eyebrow">COMMUNITY</p><h2>房间聊天</h2></div><Icon name="chat"/></div><div className="v2-chat-messages" aria-live="polite">{!room.messages.some(m=>m.type==='chat')&&<div className="v2-chat-empty"><Icon name="chat" size={26}/><span>还没有消息</span></div>}{room.messages.filter(m=>m.type==='chat').map(m=><div key={m.id} className="v2-chat-message"><strong>{m.nickname}</strong><p>{m.text}</p></div>)}<div ref={chatEnd}/></div><form className="v2-chat-compose" onSubmit={e=>{e.preventDefault();g.sendChatMessage();}}><input aria-label="发送聊天消息" placeholder="发送消息…" maxLength={120} value={g.chatText} onChange={e=>g.setChatText(e.target.value)}/><button type="submit" className="primary-button" disabled={!g.chatText.trim()}>发送</button></form></aside>
      <section className="v2-panel v2-next-step" aria-label="下一步操作"><span className="v2-step-icon"><Icon name="arrow"/></span><div><strong>{title}</strong><p>{description}</p>{stage==='guide'&&myTeam&&<button className="v2-text-button" onClick={()=>setPreview(true)}>预览候选作品 →</button>}{host&&stage!=='planning'&&!room.countdown&&<button className="v2-text-button" onClick={()=>{if(window.confirm('取消本次准备并保留配置？'))send({kind:'cancel'});}}>取消本次准备</button>}</div><button className="primary-button" disabled={disabled} onClick={action}>{label}</button></section>
    </div>
    <PrivateReview room={room}/>
    {g.error&&<div className="error-text" role="alert">{g.error}<button aria-label="关闭提示" onClick={()=>g.setError('')}>×</button></div>}
    {settings&&!locked&&<Dialog title="本局设置" close={()=>setSettings(false)}><NextMatchPanel room={room} mode="settings" onConfigured={()=>setSettings(false)}/></Dialog>}
    {management&&host&&<Dialog title="房间管理" close={()=>setManagement(false)}><div className="v2-management"><label>转让房主<select aria-label="转让房主" value={g.transferHostTargetId} onChange={e=>g.setTransferHostTargetId(e.target.value)}>{g.hostTransferCandidates.map(p=><option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label><button disabled={!g.transferHostTargetId} onClick={g.transferHost}>转让社长</button><button className="danger-button" onClick={g.disbandRoom}>解散房间</button>{room.viewer?.canUseDebugFill&&!locked&&<button onClick={g.debugFillRoom}>补 3 个测试位</button>}</div></Dialog>}
    {preview&&stage==='guide'&&<Dialog title="队长预览" close={()=>setPreview(false)} wide><NextMatchPanel room={room} mode="preview"/></Dialog>}
  </section>;
}
