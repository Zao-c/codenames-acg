import { useEffect, useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, TEAM_LABELS, draftQuota, wordPackSummaries, type AnimePool, type AnimeWork, type BoardMode, type PlanAction, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
import { Cover, Preview } from './AnimeBoard';
export { AnimeBoard } from './AnimeBoard';
import { Dialog } from './UI';
import { DraftWorkspace } from './DraftWorkspace';
import type { DropAction } from './DraftTile';
import { getPublicWordPackDetail, getCommunityPool, listCommunityPools } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { PrivateReview } from './PrivateReview';
import type { CommunityPoolSummary } from '@acg-codenames/shared';
import { useCommunityEnabled } from '../lib/use-community';
import { useGame, parseCustomWordFile, autoExportCandidatePack } from '../context/GameContext';

export function useServerTime(room: PublicRoomState) {
  const offset = useRef(room.serverNow - Date.now());
  const [time, setTime] = useState(Date.now() + offset.current);
  useEffect(() => { offset.current = room.serverNow - Date.now(); }, [room.serverNow]);
  useEffect(() => { const timer = window.setInterval(() => setTime(Date.now() + offset.current), 200); return () => clearInterval(timer); }, []);
  return time;
}
export function StartCountdown({ room }: { room: PublicRoomState }) {
  const time = useServerTime(room);
  const { socket } = useGame();
  if (!room.countdown) return null;
  return <div className="start-countdown" role="status">即将开局 · {Math.max(0, Math.ceil((room.countdown.startsAt - time) / 1000))} 秒
    {room.viewer?.isHost && <button onClick={() => socket.emit('return_to_lobby', { roomId: room.id })}>取消开始</button>}
  </div>;
}
export function NextMatchPanel({ room, mode = 'full', onConfigured, embedded=false }: { room: PublicRoomState; mode?: 'full'|'settings'|'preview'; onConfigured?: () => void; embedded?:boolean }) {
  const navigate = useNavigate();
  const communityEnabled = useCommunityEnabled();
  const { socket, effectiveIdentity, accountPacks, publicPacks } = useGame();
  const plan = room.nextPlan;
  const time = useServerTime(room);
  const [open, setOpen] = useState(room.phase !== 'playing');
  useEffect(() => { if (room.phase === 'playing') setOpen(false); }, [room.matchId]);
  useEffect(() => { if (room.phase === 'lobby') setOpen(true); }, [room.phase, plan?.stage]);
  const [catalog, setCatalog] = useState<AnimeWork[]>([]);
  const [pools, setPools] = useState<AnimePool[]>([]);
  const [variant, setVariant] = useState<'classic'|'anime'>(plan?.variant ?? 'classic');
  const [score, setScore] = useState<import('@acg-codenames/shared').ScoringMode>(plan?.settings.scoringMode ?? room.settings.scoringMode);
  const [size, setSize] = useState<BoardMode>(plan?.settings.boardMode ?? room.settings.boardMode);
  const [poolId, setPoolId] = useState(plan?.sourcePool ? `community:${plan.sourcePool.id}` : plan?.variant === 'anime' ? 'current' : 'all');
  const [poolName, setPoolName] = useState('我的动画题库');
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);
  const [typeFilter,setTypeFilter]=useState('all');
  const [claimFilter,setClaimFilter]=useState('all');
  const [preview, setPreview] = useState<AnimeWork | null>(null);
  const [interfere, setInterfere] = useState<AnimeWork | null>(null);
  const [replacement, setReplacement] = useState<number>();
  const [replaceConfirm,setReplaceConfirm]=useState<{work:AnimeWork;old:number}|null>(null);
  const [replaceCandidate,setReplaceCandidate]=useState<AnimeWork|null>(null);
  const [error, setError] = useState('');
  const [configuring,setConfiguring]=useState(false),[configNotice,setConfigNotice]=useState('');
  const configureLock=useRef(false);
  const [savedPools, setSavedPools] = useState<AnimePool[]>([]);
  const [communityPools, setCommunityPools] = useState<CommunityPoolSummary[]>([]);
  const [wordPackId, setWordPackId] = useState('');
  const [uploadedPack,setUploadedPack] = useState<{name:string;entries:string[]}>();
  const [advanced,setAdvanced] = useState(() => {
    const settings = plan?.settings ?? room.settings;
    return {timerMode:settings.timerMode??'unlimited',timerClueSeconds:settings.timerClueSeconds??90,timerGuessSeconds:settings.timerGuessSeconds??90,flipMode:settings.flipMode??'word-color'};
  });
  const storageKey = `anime-pools:${effectiveIdentity?.nickname ?? 'guest'}`;
  useEffect(() => { try { setSavedPools(JSON.parse(localStorage.getItem(storageKey) ?? '[]')); } catch {} }, [storageKey]);
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SERVER_URL || ''}/api/anime/catalog`).then(r => r.json()).then(data => { setCatalog(data.works ?? []); setPools(data.pools ?? []); }).catch(() => setError('目录读取失败，请稍后重试。已准备的候选池仍可使用。'));
  }, []);
  const refreshCommunity = async () => {
    try {
      const pages = await Promise.all([listCommunityPools('public'), listCommunityPools('mine'), listCommunityPools('favorites')]);
      const items = new Map(pages.flatMap(p => p.items).filter(p => !p.hidden).map(p => [p.id, p]));
      const remembered = localStorage.getItem('cipai-selected-community-pool');
      if (remembered) {
        try { const selected = await getCommunityPool(remembered); if (!selected.hidden) { items.set(selected.id, selected); setPoolId(`community:${selected.id}`);setVariant('anime');setConfigNotice('此池待选择保存；由房主点击保存后才会更新候选池。'); } } catch { localStorage.removeItem('cipai-selected-community-pool');setPoolId('');setError('带回的作品池已失效，请重新选择作品池。'); }
      }
      if(plan?.sourcePool&&!items.has(plan.sourcePool.id)){
        try{const source=await getCommunityPool(plan.sourcePool.id);if(source.hidden)throw new Error('已隐藏');items.set(source.id,source);}
        catch{if(poolId===`community:${plan.sourcePool.id}`){setPoolId('');setError('原作品池已失效，请重新选择。已封存的当前局不受影响。');}}
      }
      setCommunityPools([...items.values()]);
    } catch { /* Older servers can keep the existing local/quarterly pool workflow. */ }
  };
  useEffect(() => { if (room.viewer?.isHost) void refreshCommunity(); }, [room.viewer?.isHost]);
  const send = (action: Omit<PlanAction,'roomId'|'version'>) => socket.emit('plan_action', { roomId: room.id, version: plan?.version, ...action });
  const team = plan?.myTeam;
  const claims = plan?.captainView?.claims ?? {};
  const locked = plan?.stage === 'draft' || plan?.stage === 'sealed';
  const draft = plan?.stage === 'draft';
  const remaining = Math.max(0,Math.ceil(((plan?.endsAt ?? time)-time)/1000));
  const own = Object.entries(claims).filter(([,c]) => c.team === team && c.kind === 'manual').map(([id]) => Number(id));
  const quota = plan && team ? draftQuota(BOARD_MODE_CONFIG[plan.settings.boardMode].size, plan.startingTeam, team) : undefined;
  const list = plan?.candidates ?? [];
  const visible = list.filter(w => (!onlyBookmarks || plan?.myBookmarks?.includes(w.id)) && (typeFilter==='all'||w.type===typeFilter) && (claimFilter==='all'||(claimFilter==='own'?claims[w.id]?.team===team:claims[w.id]&&claims[w.id].team!==team)) && `${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const confirmed=(event:'plan_action'|'update_room_settings',payload:PlanAction|import('@acg-codenames/shared').UpdateRoomSettingsPayload)=>new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('保存未确认，请刷新当前状态后重试')),8000);
    const reply=(result:{ok:boolean;message?:string})=>{clearTimeout(timer);result.ok?resolve():reject(new Error(result.message));};
    if(event==='plan_action')socket.emit(event,payload as PlanAction,reply);else socket.emit(event,payload as import('@acg-codenames/shared').UpdateRoomSettingsPayload,reply);
  });
  const configure = async () => {
    if(configureLock.current)return;
    if(variant==='anime'&&!poolId){setError('请选择可用的作品池');return;}
    configureLock.current=true;setConfiguring(true);setError('');setConfigNotice('正在保存配置…');
    try{
    let community: import('@acg-codenames/shared').CommunityPool | undefined;
    if (variant === 'anime' && poolId.startsWith('community:')) {
      try { community = await getCommunityPool(poolId.slice(10)); if (community.hidden) throw new Error('作品池已被隐藏，请重新选择'); }
      catch (e) { throw new Error(`作品池不可用，请重新选择：${(e as Error).message}`); }
    }
    const pool = [...pools,...savedPools].find(p => p.id === poolId);
    const selected = poolId === 'custom' ? customIds : pool?.workIds;
    const personal = accountPacks.find(p => `mine:${p.id}` === wordPackId);
    let selectedPack: {name:string;entries:string[]} | undefined = wordPackId === 'upload' ? uploadedPack : personal;
    if (wordPackId.startsWith('public:')) { try { selectedPack = await getPublicWordPackDetail(wordPackId.slice(7)); } catch { throw new Error('公共词库加载失败'); } }
    if (!room.animeEnabled && !plan && variant === 'classic') {
      await confirmed('update_room_settings',{roomId:room.id,boardMode:size,scoringMode:score,...advanced,builtinWordPackId:wordPackId.startsWith('builtin:')?wordPackId.slice(8):undefined,customWordPack:selectedPack?{name:selectedPack.name,entries:selectedPack.entries}:undefined});
      onConfigured?.(); return;
    }
    await confirmed('plan_action',{ roomId:room.id,version:plan?.version,kind:'configure', variant, boardMode:size, scoringMode:score, ...(mode==='settings'&&variant==='classic'?advanced:{}), poolIds:selected, poolName:poolId === 'custom' ? poolName : pool?.name, communityPoolId: community?.id, communityPoolRevision: community?.revision, builtinWordPackId: wordPackId.startsWith('builtin:') ? wordPackId.slice(8) : undefined, customWordPack: selectedPack ? { name:selectedPack.name, entries:selectedPack.entries } : undefined });
    setConfigNotice('配置已由服务器保存，候选池已更新。');
    onConfigured?.();
    }catch(e){setConfigNotice('');setError((e as Error).message);}finally{configureLock.current=false;setConfiguring(false);}
  };
  const take = (id: number) => { send({ kind:'take', workId:id, replaceId: replacement }); if (replacement !== undefined) setReplacement(undefined); };
  const dropWork = (w: AnimeWork, action: DropAction, replaceId?:number) => {
    if (!team || !draft) return;
    const claim = claims[w.id];
    if (action === 'take') { if (claim?.kind !== 'interference' && claim?.team !== team) {if(replacement!==undefined)setReplaceConfirm({work:w,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(w);else take(w.id);} }
    else if (action === 'release') { if (claim?.team === team && claim.kind === 'manual') send({ kind:'release', workId:w.id }); }
    else if (action === 'interfere') { if (!claim && remaining > 20) setInterfere(w); }
    else if (action === 'replace' && replaceId && claims[replaceId]?.team===team && claims[replaceId]?.kind==='manual')setReplaceConfirm({work:w,old:replaceId});
  };
  const controls = plan && <>
        <div className="anime-toolbar">{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}{room.phase === 'lobby' ? '本局队长' : '下局队长'} <select aria-label={`${TEAM_LABELS[t]}${room.phase === 'lobby' ? '本局队长' : '下局队长'}`} value={plan.captains[t] ?? ''} disabled={!room.viewer?.isHost && team !== t} onChange={e => send({kind:locked ? 'transfer':'nominate',team:t,targetId:e.target.value})}><option value="">请选择</option>{room.players.filter(p => p.team === t).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</div>
        {room.viewer?.participantType === 'player' && !team && (['red','blue'] as const).map(t => !plan.captains[t] && room.players.some(p => p.id === room.viewer?.participantId && p.team === t) && <button key={t} onClick={() => send({kind:'nominate',team:t,targetId:room.viewer!.participantId!})}>认领{TEAM_LABELS[t]}下局队长</button>)}
        {(plan.variant === 'anime' || room.phase === 'finished') && room.phase !== 'playing' && room.viewer?.isHost && !locked && <button className="primary-button" onClick={() => send({kind:'prepare'})}>{plan.variant==='anime'?'进入队长预览':'进入下一局准备'}</button>}
        {plan.stage === 'guide' && team && <div className="anime-guide"><p>先浏览真实候选池，私人书签仅自己可见。双方确认后开始 180 秒组牌。</p><button className="primary-button" disabled={plan.captainView?.ready[team]} onClick={() => send({kind:'ready'})}>准备好了 / 跳过引导</button><p>红队 {plan.captainView?.ready.red ? '已确认':'浏览中'} · 蓝队 {plan.captainView?.ready.blue ? '已确认':'浏览中'}</p></div>}
        
        {draft && team && <><div className="anime-toolbar"><strong>{TEAM_LABELS[team]}手选 {own.length} / {quota?.manual}</strong><button disabled={plan.captainView?.done[team]} onClick={() => send({kind:'done'})}>手选完成，剩余随机补齐</button></div>
          <p className="hint-text">拖入阵容领取，拖回候选池撤回；覆盖己方牌或点「更换这张」更换作品。</p>
        </>}
        {plan.stage === 'sealed' && room.phase === 'lobby' && room.viewer?.isHost && !room.countdown && <button className="primary-button" onClick={() => socket.emit('start_game',{roomId:room.id})}>开始五秒倒计时</button>}
        {plan.stage === 'sealed' && <p className="draft-sealed">准备已封存，等待房主五秒开局。</p>}
        {room.viewer?.isHost && plan.stage !== 'planning' && !room.countdown && <button onClick={() => { if (window.confirm('取消本次准备并保留配置？')) send({kind:'cancel'}); }}>取消本次准备</button>}
  </>;
  const content = <div className="next-plan-content">
      {mode !== 'preview' && room.viewer?.isHost && !locked && !room.countdown && <details className="anime-config" open={mode === 'settings' || !plan || (room.phase !== 'playing' && plan.stage === 'planning')}>
        <summary>配置{room.phase === 'playing' ? '下一局' : '本次准备'}</summary>
        <div className="anime-toolbar"><label>玩法 <select aria-label="玩法" value={variant} onChange={e => { setVariant(e.target.value as 'classic'|'anime'); setSize('5x5'); }}><option value="classic">经典词牌</option><option value="anime">动画组牌</option></select></label>
          <label>棋盘 <select aria-label="棋盘" value={size} onChange={e => setSize(e.target.value as BoardMode)}>{(variant === 'anime' ? ['5x5','6x6'] : ['5x5','7x7','9x9']).map(s => <option key={s}>{s}</option>)}</select></label>
          <label>计分 <select aria-label="下一局计分" value={score === 'gamble' ? 'scoring' : score} onChange={e => setScore(e.target.value as typeof score)}><option value="classic">胜场制</option><option value="scoring">积分制</option></select></label>
        </div>
        {variant === 'classic' ? <><label>文字题库 <select value={wordPackId} onChange={e => setWordPackId(e.target.value)}><option value="">沿用上次</option>{wordPackSummaries.map(p => <option key={p.id} value={`builtin:${p.id}`}>{p.name}</option>)}{accountPacks.map(p => <option key={p.id} value={`mine:${p.id}`}>{p.name}</option>)}{publicPacks.map(p => <option key={p.publicId} value={`public:${p.publicId}`}>{p.name} · {p.ownerUsername}</option>)}{uploadedPack&&<option value="upload">上传：{uploadedPack.name}</option>}</select></label>{mode==='settings'&&<label>上传文字题库<input type="file" accept=".txt,.json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=await parseCustomWordFile(file);setUploadedPack(data.kind==='candidate'?autoExportCandidatePack(data.pack):data.pack);setWordPackId('upload');setError('');}catch(error){setError((error as Error).message);}}}/></label>}</> : <>
          <label>动画作品池 <select aria-label="动画作品池" value={poolId} onChange={e => {setPoolId(e.target.value);setError('');}}> {!poolId&&<option value="">作品池失效，请重新选择</option>}{plan?.variant === 'anime' && <option value="current">沿用：{plan.poolName}</option>}{[...pools,...savedPools].map(p => <option key={p.id} value={p.id}>{p.name}（{p.workIds.length} 部）</option>)}{communityPools.map(p => <option key={`community:${p.id}`} value={`community:${p.id}`}>社区 · {p.name}（{p.workCount} 部）</option>)}<option value="custom">自定义作品池</option></select></label>
          {(communityEnabled || !!communityPools.length) && <div className="anime-toolbar"><button onClick={() => navigate('/anime-pools')}>浏览动画题库广场</button><button onClick={() => void refreshCommunity()}>刷新社区作品池</button></div>}
          {poolId === 'custom' && <div className="anime-pool-editor"><input aria-label="动画题库名称" value={poolName} onChange={e => setPoolName(e.target.value)} /><input aria-label="搜索目录" placeholder="搜索作品，勾选加入题库" value={query} onChange={e => setQuery(e.target.value)} />
            <p>已选 {customIds.length} 部 / {new Set(catalog.filter(w => customIds.includes(w.id)).map(w => w.seriesId)).size} 个系列</p>
            <div className="anime-pool-list">{catalog.filter(w => `${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(w => <label key={w.id}><input type="checkbox" checked={customIds.includes(w.id)} onChange={() => setCustomIds(ids => ids.includes(w.id) ? ids.filter(id => id !== w.id) : [...ids,w.id])} />{w.fullTitle}</label>)}</div>
            <button onClick={() => { const next = [...savedPools,{id:`custom-${Date.now()}`,name:poolName,workIds:customIds}]; setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); }}>保存到我的动画题库</button>
          </div>}
          {savedPools.some(p => p.id === poolId) && <><button onClick={() => { const p = savedPools.find(p => p.id === poolId)!; setCustomIds(p.workIds); setPoolName(p.name); setPoolId('custom'); }}>编辑此题库</button><button onClick={() => { const next = savedPools.filter(p => p.id !== poolId); setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); setPoolId('all'); }}>删除此题库</button></>}
        </>}
        {mode==='settings'&&variant==='classic'&&<details className="v2-advanced"><summary>经典进阶设置</summary><label>回合计时<select aria-label="经典回合计时" value={advanced.timerMode} onChange={e=>setAdvanced(v=>({...v,timerMode:e.target.value as 'timed'|'unlimited'}))}><option value="unlimited">不限时</option><option value="timed">限时</option></select></label>{advanced.timerMode==='timed'&&(['timerClueSeconds','timerGuessSeconds'] as const).map((k,i)=><label key={k}>{i?'猜词时间':'提示时间'}<select value={advanced[k]} onChange={e=>setAdvanced(v=>({...v,[k]:Number(e.target.value)}))}>{[60,90,120].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label>)}<label>翻牌显示<select aria-label="经典翻牌显示" value={advanced.flipMode} onChange={e=>setAdvanced(v=>({...v,flipMode:e.target.value as 'word-color'|'color-only'}))}><option value="word-color">词语与阵营</option><option value="color-only">仅阵营颜色</option></select></label></details>}
        <button className="primary-button" disabled={configuring} onClick={configure}>{configuring?'保存中…':mode === 'settings' ? '保存设置' : '保存配置并更新候选池'}</button>{configNotice&&<p role="status" className="hint-text">{configNotice}</p>}
      </details>}
      {mode !== 'settings' && plan && <>
        <DraftWorkspace plan={plan} team={team} time={time} remaining={remaining} controls={mode === 'preview' ? null : controls} works={visible} query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter} claimFilter={claimFilter} setClaimFilter={setClaimFilter} onlyBookmarks={onlyBookmarks} setOnlyBookmarks={setOnlyBookmarks}
          onDrop={dropWork} onPreview={setPreview} replacement={replacement} onChooseReplacement={setReplacement} onBookmark={team ? w=>send({kind:'bookmark',workId:w.id}) : undefined}/>
      </>}
      {error && <p className="error-text" role="alert">{error}</p>}
    {room.phase === 'playing' && room.viewer?.isHost && plan && <details><summary>当前局队长交接</summary>{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}<select aria-label={`${TEAM_LABELS[t]}当前队长交接`} value="" onChange={e => send({kind:'transfer',team:t,targetId:e.target.value})}><option value="">选择接任队员</option>{room.players.filter(p => p.team === t && p.role !== 'spymaster').map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</details>}
    {!!room.replayHistory?.length && <nav className="anime-toolbar" aria-label="历局回放">{room.replayHistory.map(h => <a key={h.replayId} href={`/replay/${h.replayId}`} target="_blank" rel="noreferrer">第 {h.roundNumber} 局回放</a>)}</nav>}
    {room.interferenceReview && <p>本局干扰记录：{room.interferenceReview.map(c => `${TEAM_LABELS[c.from]} → ${TEAM_LABELS[c.team]}：${room.board.find(b => b.anime?.id === c.workId)?.word ?? c.workId}`).join('；') || '无干扰'}</p>}

    </div>;
  if (mode === 'settings') return <div className="lobby-config-form">{content}<p className="hint-text">胜场制：赢一局记一胜。积分制：猜对加分，失误扣分。</p></div>;
  return <section className={`panel next-match-panel ${room.phase==='playing'?'next-plan-during-game':''} ${plan?.variant==='anime'?'has-anime-plan':''}`}>
    {mode === 'full' && room.phase === 'lobby' && <PrivateReview room={room}/>}
    {mode === 'full' && !embedded && <div className="panel-heading"><div><p className="eyebrow">{room.phase==='playing'?'下一局 · 独立准备':'准备工作区'}</p><h2>{room.phase==='playing'?'下一局计划':'玩法与组牌'}</h2></div><button onClick={()=>setOpen(!open)}>{open?'收起准备':'查看准备'}</button></div>}
    {!plan && !room.viewer?.isHost && <div className="plan-readonly"><strong>经典词牌 · {room.settings.boardMode}</strong><p>{room.wordPackSummary.name}</p><p className="hint-text">社长正在配置玩法。选择队伍与席位后，等待社长开局。</p></div>}
    {plan && room.phase!=='playing' && <p className="hint-text">{plan.variant==='anime'?'动画组牌':'经典词牌'} · {plan.settings.boardMode} · {plan.poolName} · {TEAM_LABELS[plan.startingTeam]}先手</p>}
    {open && (!embedded && room.phase==='playing'?<Dialog title="下一局计划" close={()=>setOpen(false)} wide>{content}</Dialog>:content)}
    {preview && <Preview work={preview} close={() => setPreview(null)}>{team && draft && (() => { const c = claims[preview.id];
      if (c?.kind === 'interference') return <p className="hint-text">这是{c.from === team ? '本方投放给对方' : '对方投放给本方'}的干扰牌，占用接收方的随机补位，不占手选额度，不能撤回或抢夺。</p>;
      if (c?.team === team) return <div className="anime-toolbar"><button onClick={() => { send({kind:'release',workId:preview.id}); setPreview(null); }}>撤回这张</button></div>;
      if (c) return <div className="anime-toolbar"><button className="primary-button" onClick={() => {if(replacement!==undefined)setReplaceConfirm({work:preview,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(preview);else take(preview.id);setPreview(null);}}>{replacement!==undefined?'抢夺并更换':own.length>=(quota?.manual??0)?'更换作品':'抢夺这张'}</button></div>;
      return <div className="anime-toolbar"><button className="primary-button" onClick={() => {if(replacement!==undefined)setReplaceConfirm({work:preview,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(preview);else take(preview.id);setPreview(null);}}>{replacement!==undefined?'用这张更换':own.length>=(quota?.manual??0)?'更换作品':'领取这张'}</button>{remaining > 20 && <button onClick={() => { setInterfere(preview); setPreview(null); }}>投放为干扰牌</button>}</div>;
    })()}</Preview>}
    {replaceCandidate&&<Dialog title="选择要更换的作品" close={()=>setReplaceCandidate(null)}><p>手选已满。选择一张己方手选牌，用《{replaceCandidate.title}》更换。</p>{own.map(id=><button key={id} onClick={()=>{setReplaceConfirm({work:replaceCandidate,old:id});setReplaceCandidate(null);}}>{list.find(w=>w.id===id)?.title}</button>)}</Dialog>}
    {replaceConfirm&&<Dialog title="更换作品" close={()=>setReplaceConfirm(null)}><p>将《{list.find(w=>w.id===replaceConfirm.old)?.title}》更换为《{replaceConfirm.work.title}》？</p><p className="hint-text">更换失败时保留原牌；抢夺仍受保护期和最后 20 秒限制。</p><button className="primary-button" onClick={()=>{send({kind:'take',workId:replaceConfirm.work.id,replaceId:replaceConfirm.old});setReplaceConfirm(null);setReplacement(undefined);}}>确认更换</button><button onClick={()=>setReplaceConfirm(null)}>取消</button></Dialog>}
    {interfere && team && <Dialog title="投放干扰牌" close={() => setInterfere(null)}>
      <div className="anime-confirm"><p>将《{interfere.title}》作为干扰牌投放给{TEAM_LABELS[team === 'red' ? 'blue' : 'red']}？双方队长可见，普通队员和观众不可见。它占用对方的随机补位，不占手选额度；每队每局限一张，再次投放会替换原牌，投放后不可撤回，最后 20 秒禁止更改。</p>
        <button className="primary-button" onClick={() => { send({kind:'interfere',workId:interfere.id}); setInterfere(null); }}>确认投放</button>
        <button onClick={() => setInterfere(null)}>取消</button></div>
    </Dialog>}
  </section>;
}
