import {planActionEnvelope} from '../lib/plan-action';
import { useNavigate } from 'react-router-dom';
import { MemberManagement, canManageMembers, useMemberManagement } from './MemberManagement';
import { RoomIdentity } from './RoomIdentity';
import { ChatMessages } from './Conversation';
import { useEffect, useState } from 'react';
import { MAX_PLAYERS, TEAM_LABELS, type PlanAction, type PublicPlayer, type PublicRoomState, type Team } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { AvatarBadge } from './AvatarBadge';
import { PrivateReview } from './PrivateReview';
import { Dialog, Icon } from './UI';
import { NextMatchPanel, StartCountdown } from './AnimePlay';
import { RoomSettingsDialog } from './RoomSettingsDialog';

/** Preparation is a single workspace. All decisions use the current server snapshot. */
export function PreparationLobby({room}:{room:PublicRoomState}) {
  const g = useGame();
  const navigate=useNavigate();
  const [settings,setSettings] = useState(false);
  const [preview,setPreview] = useState(false);
  const [management,setManagement] = useState(false);
  const [teams,setTeams] = useState(false);
  const manage=useMemberManagement(room);
  const manageable=canManageMembers(room);
  const [dropTeam,setDropTeam]=useState<Team|'none'|null>(null);
  const dropProps=(team:Team|null)=>({
    onDragOver:(e:React.DragEvent)=>{if(manageable&&e.dataTransfer.types.includes('application/x-cipai-member')){e.preventDefault();e.dataTransfer.dropEffect='move';setDropTeam(team??'none');}},
    onDragLeave:()=>setDropTeam(null),
    onDrop:(e:React.DragEvent)=>{e.preventDefault();setDropTeam(null);if(!manageable)return;try{const item=JSON.parse(e.dataTransfer.getData('application/x-cipai-member'));if(item.roomId===room.id&&room.players.some(p=>p.id===item.id))manage(item.id,'team',{team});}catch{g.setError('成员拖放无效');}}
  });
  const plan = room.nextPlan;
  const stage = plan?.stage ?? 'planning';
  const host = room.viewer?.isHost;
  const locked = !!room.countdown || stage === 'sealed' || stage === 'draft' || stage==='interference';
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
  const send = (action:Omit<PlanAction,'roomId'|'version'>) => g.socket.emit('plan_action',planActionEnvelope(room,action));
  useEffect(()=>{if(stage!=='guide')setPreview(false);},[stage]);
  useEffect(()=>{g.setSideTab('chat');},[]);
  let title = anime ? '下一步：队长预览' : '下一步：开始对局';
  let description = !balanced ? '至少 4 名玩家，每队至少 2 人。邀请好友并完成分队。' : missing.length ? `请先指定${missing.map(t=>TEAM_LABELS[t]).join('、')}队长。` : anime ? `双方队长先浏览候选作品，确认后再开始 ${config.animeDraft?.selectionSeconds??180} 秒组牌。` : '队伍与设置已就位，由房主发起五秒开局。';
  let label = host ? anime ? '进入队长预览 →' : '开始游戏' : '等待房主开始';
  let action = () => anime ? send({kind:'prepare'}) : g.startGame();
  let disabled = !host || !rosterReady || g.connectionState!=='ready';
  if(anime&&stage==='planning'&&plan?.poolSummary&&plan.poolSummary.available<plan.poolSummary.required){disabled=true;description=`当前可用 ${plan.poolSummary.available} / 需要 ${plan.poolSummary.required} 个系列。请更换作品池，或在设置中确认重置轮换历史。`;}
  if(stage==='guide') {
    title='下一步：双方队长确认';
    description=missing.length?'请先指定两队队长，再浏览候选作品。':myTeam?`先预览候选作品；双方确认后才开始服务端 ${config.animeDraft?.selectionSeconds??180} 秒计时。`:'双方队长正在预览候选作品，确认后将进入限时组牌。';
    label=myTeam?(ready?'已确认，等待另一队':'确认就绪，开始组牌'):'等待队长确认';
    action=()=>send({kind:'ready'});disabled=!myTeam||!!ready||!rosterReady;
  } else if(stage==='sealed') {
    title='下一步：开始对局';description=offlineCaptains.length?`${offlineCaptains.map(t=>TEAM_LABELS[t]).join('、')}队长离线，已保留封存棋盘；等待原队长恢复后开局。`:`组牌已封存，等待房主发起五秒开局。${plan?.randomSwapCompleted?'已完成随机互换。':''}`;label=host?'开始五秒倒计时':'等待房主开局';action=g.startGame;disabled=!host||!!offlineCaptains.length;
  }
  if(room.countdown){title='即将开始对局';description='服务器倒计时结束后自动进入棋盘。';label='倒计时中';disabled=true;}
  const member = (p:PublicPlayer) => {
    const mine=p.id===self?.id;const isCaptain=!!p.team&&captain(p.team)===p.id;
    return <div className={`v2-member ${mine?'is-self':''}`} key={p.id} data-player-id={p.id} data-captain={isCaptain} draggable={manageable} onDragStart={e=>{e.dataTransfer.setData('application/x-cipai-member',JSON.stringify({roomId:room.id,id:p.id}));e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>setDropTeam(null)}>
      <div className="v2-member-main"><AvatarBadge avatarUrl={p.profile.avatarUrl} fallback={p.nickname} size="small"/><span><strong>{p.nickname}{mine?' · 你':''}</strong><small>{isCaptain?'队长':'队员'}{p.isHost?' · 房主':''}{!p.connected?' · 离线':''}</small></span></div>
      <MemberManagement room={room} targetId={p.id}/>
    </div>;
  };
  return <section className={`preparation-lobby lobby-v2 mobile-view-${g.mobileRoomTab}`}>
    <header className="v2-stage-header"><div><h1>准备大厅</h1><p className="hint-text">房间 <strong className="room-code">{room.id}</strong> · 第 {room.roundNumber} 局 · {g.connectionState==='ready'?'已连接':'正在重新连接'}</p></div><div className="v2-stage-tools"><button onClick={()=>{if(window.confirm('确定退出房间？你将离开席位，已开始的组牌准备会取消。')){g.leaveRoom();navigate('/');}}}>退出房间</button><button onClick={()=>void g.copyLink()}>{g.copied?'已复制链接':'邀请好友 ↗'}</button>{host&&<button className="room-management-trigger" aria-label="房间管理" onClick={()=>setManagement(true)}><Icon name="users" size={17}/>房间管理</button>}</div></header>
    <RoomIdentity room={room}/>
    <StartCountdown room={room}/>
    <div className="v2-lobby-grid">
      <section className="v2-panel v2-mode"><div className="v2-panel-heading"><div><h2>本局玩法</h2></div>{host&&<button disabled={locked} onClick={()=>setSettings(true)}>修改设置</button>}</div><div className="v2-mode-summary"><h3>{anime?'动画组牌':'经典词牌'} · {config.boardMode.replace('x','×')}</h3></div>
        <dl className="lobby-rule-summary"><div><dt>{anime?'作品池':'文字题库'}</dt><dd>{anime?plan?.poolName:plan?.wordPackName??room.wordPackSummary.name}{anime&&plan?.poolSummary&&<small>{plan.poolSummary.source} 部 · {plan.poolSummary.available} 个可用系列</small>}</dd></div><div><dt>计分方式</dt><dd>{config.scoringMode==='classic'?'胜场制':'积分制'}</dd></div>{anime?<><div><dt>选牌时长</dt><dd>{config.animeDraft?.selectionSeconds??180} 秒</dd></div><div><dt>随机互换</dt><dd>{config.animeRandomSwap?'开启':'关闭'}</dd></div><div><dt>历局作品轮换</dt><dd>{config.animeSeriesRotation?'开启':'关闭'}</dd></div><div><dt>干扰方式</dt><dd>{config.animeDraft?`独立阶段 · ${config.animeDraft.interferenceSeconds===null?'不限时':`${config.animeDraft.interferenceSeconds} 秒`}`:'选牌期间 · 每队一张'}</dd></div></>:<><div><dt>回合计时</dt><dd>{config.timerMode==='timed'?`提示 ${config.timerClueSeconds} 秒 / 猜词 ${config.timerGuessSeconds} 秒`:'不限时'}</dd></div><div><dt>翻牌显示</dt><dd>{config.flipMode==='color-only'?'仅阵营颜色':'词语与阵营'}</dd></div></>}</dl>
        </section>
      <section className="v2-panel v2-players"><div className="v2-panel-heading"><div><h2>队伍与成员</h2></div><span className="tag">{room.players.length} / {MAX_PLAYERS} 人</span></div><div className="v2-team-grid">{(['red','blue'] as const).map(t=><div className={`v2-team ${t} ${dropTeam===t?'host-drop-target':''}`} key={t} {...dropProps(t)}><div className="v2-team-heading"><strong>{TEAM_LABELS[t]}</strong><span>{room.players.filter(p=>p.team===t).length} 人</span></div>{room.players.filter(p=>p.team===t).map(member)}{!room.players.some(p=>p.team===t)&&<p className="hint-text">等待成员入座</p>}</div>)}</div>
        <section className="v2-seat-tools" aria-label="我的席位"><h3>我的席位</h3>      {self&&!locked&&<div className="v2-self-controls"><select aria-label="我的队伍" value={self.team??''} onChange={e=>g.chooseTeam((e.target.value||null) as Team|null)}><option value="">待分队</option><option value="red">红队</option><option value="blue">蓝队</option></select><select aria-label="我的身份" disabled={!self.team} value={!!self.team&&captain(self.team)===self.id?'spymaster':'operative'} onChange={e=>g.chooseRole(e.target.value as 'spymaster'|'operative')}><option value="operative">队员</option><option value="spymaster">队长</option></select></div>}{!self&&<p className="hint-text">旁观者 · 只读与聊天</p>}{self&&locked&&<p className="hint-text">本局席位已锁定，等待下一局可调整。</p>}</section>

        <div className={`v2-pending ${dropTeam==='none'?'host-drop-target':''}`} {...dropProps(null)}><div className="v2-team-heading"><strong>待分队</strong><span>{room.players.filter(p=>!p.team).length} 人</span></div>{room.players.filter(p=>!p.team).map(member)}{room.players.every(p=>p.team)&&<p className="hint-text">当前没有待分队玩家</p>}</div>
        {host&&<button className="v2-more-management" onClick={()=>setTeams(true)}><Icon name="users" size={16}/>分队与队长管理</button>}
        {!!room.spectators.length&&<details className="v2-spectators"><summary>旁观与排队 · {room.spectators.length} 人</summary>{room.spectators.map(s=><div className="v2-member" key={s.id}><span>{s.nickname}{!s.connected?' · 离线':''}{room.joinQueue.some(q=>q.spectatorId===s.id)?' · 已排队下一局':''}</span><MemberManagement room={room} targetId={s.id}/></div>)}</details>}
        {room.viewer?.participantType==='spectator'&&<div className="spectator-seat-actions"><p className="hint-text">旁观者 · 可聊天和观看公共信息</p>{room.viewer.isQueuedForNextRound?<button onClick={g.cancelQueueJoin}>取消排队</button>:room.viewer.canQueueForNextRound?<button onClick={g.queueForNextRound}>排队下一局</button>:!locked&&!room.viewer.canQueueForNextRound&&!room.countdown&&room.players.length<MAX_PLAYERS?<button onClick={()=>g.joinSpecificRoom(room.id,false)}>加入玩家席</button>:<p className="hint-text">{room.players.length>=MAX_PLAYERS?'玩家席已满，请等待空位。':'本局席位已锁定，请等待下一局。'}</p>}</div>}
      </section>
      <aside className="v2-panel v2-chat"><div className="v2-panel-heading"><div><p className="eyebrow">COMMUNITY</p><h2>房间聊天</h2></div><Icon name="chat"/></div><div className="v2-chat-messages" ref={g.chatListRef} onScroll={g.handleChatScroll}>{!room.messages.some(m=>m.type==='chat')&&<div className="v2-chat-empty"><Icon name="chat" size={26}/><span>还没有消息</span></div>}<ChatMessages messages={room.messages.filter(m=>m.type==='chat')} selfId={room.viewer?.participantId??undefined}/></div>{g.chatUnread>0&&<button className="jump-button" onClick={g.scrollChatToBottom}>↓ {g.chatUnread} 条新消息</button>}<form className="v2-chat-compose" onSubmit={e=>{e.preventDefault();g.sendChatMessage();}}><input disabled={g.chatPending} aria-label="发送聊天消息" placeholder="发送消息…" maxLength={120} value={g.chatText} onChange={e=>g.setChatText(e.target.value)}/><button type="submit" className="primary-button" disabled={g.chatPending||!g.chatText.trim()}>{g.chatPending?'发送中…':g.chatError?'重试':'发送'}</button></form>{g.chatError&&<p role="alert" className="error-text">{g.chatError}</p>}</aside>
      <section className="v2-panel v2-next-step" aria-label="下一步操作"><div className="v2-panel-heading"><div><h2>下一步</h2></div><span className="tag">{host?'房主视角':myTeam?'队长视角':'成员视角'}</span></div><div className="lobby-stage-summary"><strong>{title.replace(/^下一步：/, '')}</strong>{(g.connectionState!=='ready'||!balanced||!!missing.length||(anime&&stage==='planning'&&plan?.poolSummary&&plan.poolSummary.available<plan.poolSummary.required)||offlineCaptains.length>0)&&<p role="status">{description}</p>}</div>
        
        <div className="lobby-secondary-actions">{stage==='guide'&&myTeam&&<button className="v2-text-button" onClick={()=>setPreview(true)}>预览候选作品 →</button>}{host&&stage!=='planning'&&!room.countdown&&<button className="v2-text-button" onClick={()=>{if(window.confirm('取消本次准备并保留配置？'))send({kind:'cancel'});}}>取消本次准备</button>}</div><button className="primary-button" disabled={disabled} onClick={action}>{label}</button></section>
    </div>
    <PrivateReview room={room}/>
    {g.error&&<div className="error-text" role="alert">{g.error}<button aria-label="关闭提示" onClick={()=>g.setError('')}>×</button></div>}
    {settings&&host&&!locked&&<RoomSettingsDialog key={`${room.id}:${room.viewer?.participantId}`} room={room} close={()=>setSettings(false)}/>}
    {teams&&host&&<Dialog title="分队与队长管理" className="team-management-dialog" close={()=>setTeams(false)} wide>
      
      <section className="team-management-section"><h3>本局队长</h3>{!locked?<div className="team-captain-grid">{(['red','blue'] as const).map(t=><label key={t} className={`team-${t}`}>{TEAM_LABELS[t]}队长<select aria-label={`${TEAM_LABELS[t]}本局队长`} value={captain(t)??''} onChange={e=>send({kind:'nominate',team:t,targetId:e.target.value})}><option value="" disabled>请选择队长</option>{room.players.filter(p=>p.team===t).map(p=><option value={p.id} key={p.id}>{p.nickname}</option>)}</select></label>)}</div>:<p className="hint-text">本局席位已锁定，先取消本次准备再调整。</p>}</section>
      <section className="team-management-section v2-shuffle"><h3>随机分队</h3>{!manageable&&<p className="hint-text">成员管理已锁定；先取消本次准备再调整。</p>}<div><button disabled={locked||room.players.length<4||!!missing.length} onClick={()=>g.randomizeTeams('keep-captains')}>保留队长随机队员</button><button disabled={locked||room.players.length<4} onClick={()=>g.randomizeTeams('all')}>全员重新随机</button></div></section>
      {g.error&&<p role="alert" className="error-text">{g.error}</p>}<div className="settings-actions"><button className="primary-button" onClick={()=>setTeams(false)}>关闭</button></div>
    </Dialog>}
    {management&&host&&<Dialog title="房间管理" close={()=>setManagement(false)}><div className="v2-management"><label>转让房主<select aria-label="转让房主" value={g.transferHostTargetId} onChange={e=>g.setTransferHostTargetId(e.target.value)}>{g.hostTransferCandidates.map(p=><option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label><button disabled={!g.transferHostTargetId} onClick={g.transferHost}>转让房主</button><button className="danger-button" onClick={g.disbandRoom}>解散房间</button>{room.viewer?.canUseDebugFill&&!locked&&<button onClick={g.debugFillRoom}>补 3 个测试位</button>}</div></Dialog>}
    {preview&&stage==='guide'&&<Dialog title="队长预览" close={()=>setPreview(false)} wide><NextMatchPanel room={room} mode="preview"/></Dialog>}
  </section>;
}
