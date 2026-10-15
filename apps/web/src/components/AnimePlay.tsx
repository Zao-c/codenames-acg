import { useEffect, useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, TEAM_LABELS, draftQuota, wordPackSummaries, type AnimePool, type AnimeWork, type BoardMode, type PlanAction, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
import { Cover, Preview } from './AnimeBoard';
export { AnimeBoard } from './AnimeBoard';
import { Dialog } from './UI';
import { DraftWorkspace } from './DraftWorkspace';
import type { DropAction } from './DraftTile';
import { getPublicWordPackDetail } from '../lib/api';
import { useGame } from '../context/GameContext';

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
export function NextMatchPanel({ room }: { room: PublicRoomState }) {
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
  const [size, setSize] = useState<BoardMode>(plan?.settings.boardMode ?? '5x5');
  const [poolId, setPoolId] = useState('all');
  const [poolName, setPoolName] = useState('我的动画题库');
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);
  const [typeFilter,setTypeFilter]=useState('all');
  const [claimFilter,setClaimFilter]=useState('all');
  const [preview, setPreview] = useState<AnimeWork | null>(null);
  const [interfere, setInterfere] = useState<AnimeWork | null>(null);
  const [replacement, setReplacement] = useState<number>();
  const [error, setError] = useState('');
  const [savedPools, setSavedPools] = useState<AnimePool[]>([]);
  const [wordPackId, setWordPackId] = useState('');
  const storageKey = `anime-pools:${effectiveIdentity?.nickname ?? 'guest'}`;
  useEffect(() => { try { setSavedPools(JSON.parse(localStorage.getItem(storageKey) ?? '[]')); } catch {} }, [storageKey]);
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SERVER_URL || ''}/api/anime/catalog`).then(r => r.json()).then(data => { setCatalog(data.works ?? []); setPools(data.pools ?? []); }).catch(() => setError('目录读取失败，请稍后重试。已准备的候选池仍可使用。'));
  }, []);
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
  const configure = async () => {
    const pool = [...pools,...savedPools].find(p => p.id === poolId);
    const selected = poolId === 'custom' ? customIds : pool?.workIds;
    const personal = accountPacks.find(p => `mine:${p.id}` === wordPackId);
    let selectedPack = personal;
    if (wordPackId.startsWith('public:')) { try { selectedPack = await getPublicWordPackDetail(wordPackId.slice(7)); } catch { setError('公共词库加载失败'); return; } }
    send({ kind:'configure', variant, boardMode:size, scoringMode:score, poolIds:selected, poolName:poolId === 'custom' ? poolName : pool?.name, builtinWordPackId: wordPackId.startsWith('builtin:') ? wordPackId.slice(8) : undefined, customWordPack: selectedPack ? { name:selectedPack.name, entries:selectedPack.entries } : undefined });
  };
  const take = (id: number) => { send({ kind:'take', workId:id, replaceId: replacement }); if (replacement !== undefined) setReplacement(undefined); };
  const dropWork = (w: AnimeWork, action: DropAction) => {
    if (!team || !draft) return;
    const claim = claims[w.id];
    if (action === 'take') { if (claim?.kind !== 'interference' && claim?.team !== team) take(w.id); }
    else if (action === 'release') { if (claim?.team === team && claim.kind === 'manual') send({ kind:'release', workId:w.id }); }
    else if (action === 'interfere') { if (!claim && remaining > 20) setInterfere(w); }
  };
  const controls = plan && <>
        <div className="anime-toolbar">{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}下局队长 <select aria-label={`${TEAM_LABELS[t]}下局队长`} value={plan.captains[t] ?? ''} disabled={!room.viewer?.isHost && team !== t} onChange={e => send({kind:locked ? 'transfer':'nominate',team:t,targetId:e.target.value})}><option value="">请选择</option>{room.players.filter(p => p.team === t).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</div>
        {room.viewer?.participantType === 'player' && !team && (['red','blue'] as const).map(t => !plan.captains[t] && room.players.some(p => p.id === room.viewer?.participantId && p.team === t) && <button key={t} onClick={() => send({kind:'nominate',team:t,targetId:room.viewer!.participantId!})}>认领{TEAM_LABELS[t]}下局队长</button>)}
        {plan.variant === 'anime' && room.phase !== 'playing' && room.viewer?.isHost && !locked && <button className="primary-button" onClick={() => send({kind:'prepare'})}>进入无时限准备</button>}
        {plan.stage === 'guide' && team && <div className="anime-guide"><p>先浏览真实候选池，私人书签仅自己可见。双方确认后开始 180 秒组牌。</p><button className="primary-button" disabled={plan.captainView?.ready[team]} onClick={() => send({kind:'ready'})}>准备好了 / 跳过引导</button><p>红队 {plan.captainView?.ready.red ? '已确认':'浏览中'} · 蓝队 {plan.captainView?.ready.blue ? '已确认':'浏览中'}</p></div>}
        
        {draft && team && <><div className="anime-toolbar"><strong>{TEAM_LABELS[team]}手选 {own.length} / {quota?.manual}</strong><label>替换 <select aria-label="替换己方牌" value={replacement ?? ''} onChange={e => setReplacement(e.target.value ? Number(e.target.value):undefined)}><option value="">不替换</option>{own.map(id => <option key={id} value={id}>{list.find(w => w.id === id)?.title}</option>)}</select></label><button disabled={plan.captainView?.done[team]} onClick={() => send({kind:'done'})}>手选完成，剩余随机补齐</button></div>
          <p className="hint-text">单击作品可预览，并可在预览中领取 / 撤回 / 抢夺 / 投放干扰；也可以直接拖动：拖到右侧阵容区领取或抢夺，拖到干扰槽投放干扰（需再次确认），拖回候选池撤回。</p>
        </>}
        {plan.stage === 'sealed' && room.phase === 'lobby' && room.viewer?.isHost && !room.countdown && <button className="primary-button" onClick={() => socket.emit('start_game',{roomId:room.id})}>开始五秒倒计时</button>}
        {plan.stage === 'sealed' && <p className="draft-sealed">准备已封存，等待房主五秒开局。</p>}
        {room.viewer?.isHost && !room.countdown && <button onClick={() => { if (window.confirm('取消本次准备并保留配置？')) send({kind:'cancel'}); }}>取消本次准备</button>}
  </>;
  const content = <div className="next-plan-content">
      {room.viewer?.isHost && !locked && !room.countdown && <details className="anime-config" open={!plan || (room.phase !== 'playing' && plan.stage === 'planning')}>
        <summary>配置{room.phase === 'playing' ? '下一局' : '本次准备'}</summary>
        <div className="anime-toolbar"><label>玩法 <select aria-label="玩法" value={variant} onChange={e => { setVariant(e.target.value as 'classic'|'anime'); setSize('5x5'); }}><option value="classic">经典词牌</option><option value="anime">动画组牌</option></select></label>
          <label>棋盘 <select aria-label="棋盘" value={size} onChange={e => setSize(e.target.value as BoardMode)}>{(variant === 'anime' ? ['5x5','6x6'] : ['5x5','7x7','9x9']).map(s => <option key={s}>{s}</option>)}</select></label>
          <label>计分 <select aria-label="下一局计分" value={score} onChange={e => setScore(e.target.value as typeof score)}><option value="classic">经典胜场</option><option value="scoring">积分</option><option value="gamble">原有赌博计分</option></select></label>
        </div>
        {variant === 'classic' ? <label>文字题库 <select value={wordPackId} onChange={e => setWordPackId(e.target.value)}><option value="">沿用上次</option>{wordPackSummaries.map(p => <option key={p.id} value={`builtin:${p.id}`}>{p.name}</option>)}{accountPacks.map(p => <option key={p.id} value={`mine:${p.id}`}>{p.name}</option>)}{publicPacks.map(p => <option key={p.publicId} value={`public:${p.publicId}`}>{p.name} · {p.ownerUsername}</option>)}</select></label> : <>
          <label>动画作品池 <select aria-label="动画作品池" value={poolId} onChange={e => setPoolId(e.target.value)}>{[...pools,...savedPools].map(p => <option key={p.id} value={p.id}>{p.name}（{p.workIds.length} 部）</option>)}<option value="custom">自定义作品池</option></select></label>
          {poolId === 'custom' && <div className="anime-pool-editor"><input aria-label="动画题库名称" value={poolName} onChange={e => setPoolName(e.target.value)} /><input aria-label="搜索目录" placeholder="搜索作品，勾选加入题库" value={query} onChange={e => setQuery(e.target.value)} />
            <p>已选 {customIds.length} 部 / {new Set(catalog.filter(w => customIds.includes(w.id)).map(w => w.seriesId)).size} 个系列</p>
            <div className="anime-pool-list">{catalog.filter(w => `${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(w => <label key={w.id}><input type="checkbox" checked={customIds.includes(w.id)} onChange={() => setCustomIds(ids => ids.includes(w.id) ? ids.filter(id => id !== w.id) : [...ids,w.id])} />{w.fullTitle}</label>)}</div>
            <button onClick={() => { const next = [...savedPools,{id:`custom-${Date.now()}`,name:poolName,workIds:customIds}]; setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); }}>保存到我的动画题库</button>
          </div>}
          {savedPools.some(p => p.id === poolId) && <><button onClick={() => { const p = savedPools.find(p => p.id === poolId)!; setCustomIds(p.workIds); setPoolName(p.name); setPoolId('custom'); }}>编辑此题库</button><button onClick={() => { const next = savedPools.filter(p => p.id !== poolId); setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); setPoolId('all'); }}>删除此题库</button></>}
        </>}
        <button className="primary-button" onClick={configure}>保存配置并更新候选池</button>
      </details>}
      {plan && <>
        <DraftWorkspace plan={plan} team={team} time={time} remaining={remaining} controls={controls} works={visible} query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter} claimFilter={claimFilter} setClaimFilter={setClaimFilter} onlyBookmarks={onlyBookmarks} setOnlyBookmarks={setOnlyBookmarks}
          onDrop={dropWork} onPreview={setPreview} onBookmark={team ? w=>send({kind:'bookmark',workId:w.id}) : undefined}/>
      </>}
      {error && <p className="error-text" role="alert">{error}</p>}
    {room.phase === 'playing' && room.viewer?.isHost && plan && <details><summary>当前局队长交接</summary>{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}<select aria-label={`${TEAM_LABELS[t]}当前队长交接`} value="" onChange={e => send({kind:'transfer',team:t,targetId:e.target.value})}><option value="">选择接任队员</option>{room.players.filter(p => p.team === t && p.role !== 'spymaster').map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</details>}
    {!!room.replayHistory?.length && <nav className="anime-toolbar" aria-label="历局回放">{room.replayHistory.map(h => <a key={h.replayId} href={`/replay/${h.replayId}`} target="_blank" rel="noreferrer">第 {h.roundNumber} 局回放</a>)}</nav>}
    {room.interferenceReview && <p>本局干扰记录：{room.interferenceReview.map(c => `${TEAM_LABELS[c.from]} → ${TEAM_LABELS[c.team]}：${room.board.find(b => b.anime?.id === c.workId)?.word ?? c.workId}`).join('；') || '无干扰'}</p>}

    </div>;
  return <section className={`panel next-match-panel ${room.phase==='playing'?'next-plan-during-game':''} ${plan?.variant==='anime'?'has-anime-plan':''}`}>
    <div className="panel-heading"><div><p className="eyebrow">{room.phase==='playing'?'下一局 · 独立准备':'准备工作区'}</p><h2>{room.phase==='playing'?'下一局计划':'玩法与组牌'}</h2></div><button onClick={()=>setOpen(!open)}>{open?'收起准备':'查看准备'}</button></div>
    {!plan && !room.viewer?.isHost && <div className="plan-readonly"><strong>经典词牌 · {room.settings.boardMode}</strong><p>{room.wordPackSummary.name}</p><p className="hint-text">社长正在配置玩法。选择队伍与席位后，等待社长开局。</p></div>}
    {plan && room.phase!=='playing' && <p className="hint-text">{plan.variant==='anime'?'动画组牌':'经典词牌'} · {plan.settings.boardMode} · {plan.poolName} · {TEAM_LABELS[plan.startingTeam]}先手</p>}
    {open && (room.phase==='playing'?<Dialog title="下一局计划" close={()=>setOpen(false)} wide>{content}</Dialog>:content)}
    {preview && <Preview work={preview} close={() => setPreview(null)}>{team && draft && (() => { const c = claims[preview.id];
      if (c?.kind === 'interference') return <p className="hint-text">这是本方投放的干扰牌，不能撤回或抢夺。</p>;
      if (c?.team === team) return <div className="anime-toolbar"><button onClick={() => { send({kind:'release',workId:preview.id}); setPreview(null); }}>撤回这张</button></div>;
      if (c) return <div className="anime-toolbar"><button className="primary-button" onClick={() => { take(preview.id); setPreview(null); }}>抢夺这张</button></div>;
      return <div className="anime-toolbar"><button className="primary-button" onClick={() => { take(preview.id); setPreview(null); }}>领取这张</button>{remaining > 20 && <button onClick={() => { setInterfere(preview); setPreview(null); }}>投放为干扰牌</button>}</div>;
    })()}</Preview>}
    {interfere && team && <Dialog title="投放干扰牌" close={() => setInterfere(null)}>
      <div className="anime-confirm"><p>将《{interfere.title}》伪装为{TEAM_LABELS[team === 'red' ? 'blue' : 'red']}的手选牌？对方队长会在候选池中看到它属于{TEAM_LABELS[team === 'red' ? 'blue' : 'red']}；每队每局限一张，再次投放会替换原牌，投放后不可撤回，最后 20 秒禁止更改。</p>
        <button className="primary-button" onClick={() => { send({kind:'interfere',workId:interfere.id}); setInterfere(null); }}>确认投放</button>
        <button onClick={() => setInterfere(null)}>取消</button></div>
    </Dialog>}
  </section>;
}
