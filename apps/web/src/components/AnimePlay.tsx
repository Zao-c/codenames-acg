import { useEffect, useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, TEAM_LABELS, draftQuota, wordPackSummaries, type AnimePool, type AnimeWork, type BoardMode, type PlanAction, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
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
function Cover({ work }: { work: AnimeWork }) {
  const [failed, setFailed] = useState(false);
  return !failed && work.cover ? <img src={work.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="anime-cover-fallback">{work.title}</span>;
}
function Preview({ work, close, children }: { work: AnimeWork; close: () => void; children?: React.ReactNode }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="anime-modal-backdrop" onClick={close}><section className="anime-modal" role="dialog" aria-modal="true" aria-label={work.fullTitle} onClick={e => e.stopPropagation()}>
    <button ref={closeButton} className="anime-modal-close" onClick={close}>关闭预览</button>
    <Cover work={work} /><h2>{work.fullTitle}</h2><p>{work.type} · {work.airDate}</p><p>{work.aliases.join(' / ')}</p>
    <a href={`https://bgm.tv/subject/${work.id}`} target="_blank" rel="noreferrer">Bangumi 作品详情</a>{children}
  </section></div>;
}
export function AnimeBoard({ room }: { room: PublicRoomState }) {
  const { guessCard } = useGame();
  const [text, setText] = useState(() => localStorage.getItem('anime-text-view') === '1');
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<PublicCard | null>(null);
  const [confirm, setConfirm] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = room.board.find(card => card.id === preview?.id);
  const cols = BOARD_MODE_CONFIG[room.settings.boardMode].columns;
  return <section className="panel anime-board-panel">
    <div className="anime-toolbar"><strong>封面棋盘 · {room.settings.boardMode}</strong>
      <button onClick={() => { setText(!text); localStorage.setItem('anime-text-view', text ? '0':'1'); }}>{text ? '封面显示' : '纯文字显示'}</button>
      <button aria-label="缩小棋盘" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1,z-.25))}>−</button>
      <button aria-label="放大棋盘" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2,z+.25))}>＋</button>
      <button onClick={() => { setZoom(1); scroll.current?.scrollTo(0,0); }}>重置视图</button>
    </div><p className="hint-text">点卡片查看作品；猜牌需要再次确认。放大后可滑动浏览。</p>
    <div className="anime-board-scroll" ref={scroll}><div className="anime-board" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, width: `${zoom*100}%` }}>
      {room.board.map(card => <button key={card.id} className={`anime-board-card role-${card.role ?? 'hidden'} ${card.revealed ? 'is-revealed':''}`} aria-label={`${card.word}${card.revealed ? ' 已翻开':''}`} onClick={() => { setPreview(card); setConfirm(false); }}>
        {!text && card.anime && <Cover work={card.anime} />}<span>{card.word}</span>{card.role && <b>{card.role === 'red' ? '红' : card.role === 'blue' ? '蓝' : card.role === 'neutral' ? '中立' : '刺客'}</b>}
      </button>)}
    </div></div>
    {preview?.anime && <Preview work={preview.anime} close={() => setPreview(null)}>
      {room.viewer?.canGuess && selected && !selected.revealed && <div className="anime-confirm">
        {confirm ? <><p>确认猜「{preview.word}」？</p><button className="primary-button" onClick={() => { guessCard(preview.id); setPreview(null); }}>确认猜牌</button><button onClick={() => setConfirm(false)}>再想一下</button></> : <button className="primary-button" onClick={() => setConfirm(true)}>猜牌</button>}
      </div>}
    </Preview>}
  </section>;
}

export function NextMatchPanel({ room }: { room: PublicRoomState }) {
  const { socket, effectiveIdentity, accountPacks, publicPacks } = useGame();
  const plan = room.nextPlan;
  const time = useServerTime(room);
  const [open, setOpen] = useState(room.phase !== 'playing');
  useEffect(() => { if (room.phase === 'playing') setOpen(false); }, [room.matchId]);
  const [catalog, setCatalog] = useState<AnimeWork[]>([]);
  const [pools, setPools] = useState<AnimePool[]>([]);
  const [variant, setVariant] = useState<'classic'|'anime'>(plan?.variant ?? 'anime');
  const [score, setScore] = useState<import('@acg-codenames/shared').ScoringMode>(plan?.settings.scoringMode ?? room.settings.scoringMode);
  const [size, setSize] = useState<BoardMode>(plan?.settings.boardMode ?? '5x5');
  const [poolId, setPoolId] = useState('all');
  const [poolName, setPoolName] = useState('我的动画题库');
  const [customIds, setCustomIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);
  const [preview, setPreview] = useState<AnimeWork | null>(null);
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
  const visible = list.filter(w => (!onlyBookmarks || plan?.myBookmarks?.includes(w.id)) && `${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const configure = async () => {
    const pool = [...pools,...savedPools].find(p => p.id === poolId);
    const selected = poolId === 'custom' ? customIds : pool?.workIds;
    const personal = accountPacks.find(p => `mine:${p.id}` === wordPackId);
    let selectedPack = personal;
    if (wordPackId.startsWith('public:')) { try { selectedPack = await getPublicWordPackDetail(wordPackId.slice(7)); } catch { setError('公共词库加载失败'); return; } }
    send({ kind:'configure', variant, boardMode:size, scoringMode:score, poolIds:selected, poolName:poolId === 'custom' ? poolName : pool?.name, builtinWordPackId: wordPackId.startsWith('builtin:') ? wordPackId.slice(8) : undefined, customWordPack: selectedPack ? { name:selectedPack.name, entries:selectedPack.entries } : undefined });
  };
  const take = (id: number) => send({ kind:'take', workId:id, replaceId: replacement });
  const clickWork = (w: AnimeWork) => {
    const claim = claims[w.id];
    if (!team || !draft || (claim && claim.team !== team) || claim?.kind === 'interference') { setPreview(w); return; }
    if (claim?.team === team) send({ kind:'release', workId:w.id }); else take(w.id);
  };
  return <section className="panel next-match-panel">
    <div className="panel-heading"><h2>{room.phase === 'playing' ? '下一局计划' : '玩法与组牌'}</h2><button onClick={() => setOpen(!open)}>{open ? '收起准备' : '查看准备'}</button></div>
    {plan && <p className="hint-text">{plan.variant === 'anime' ? '动画组牌' : '经典词牌'} · {plan.settings.boardMode} · {plan.poolName} · {TEAM_LABELS[plan.startingTeam]}先手</p>}
    {open && <>
      {room.viewer?.isHost && !locked && !room.countdown && <details className="anime-config" open={!plan}>
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
        <div className="anime-toolbar">{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}下局队长 <select aria-label={`${TEAM_LABELS[t]}下局队长`} value={plan.captains[t] ?? ''} disabled={!room.viewer?.isHost && team !== t} onChange={e => send({kind:locked ? 'transfer':'nominate',team:t,targetId:e.target.value})}><option value="">请选择</option>{room.players.filter(p => p.team === t).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</div>
        {room.viewer?.participantType === 'player' && !team && (['red','blue'] as const).map(t => !plan.captains[t] && room.players.some(p => p.id === room.viewer?.participantId && p.team === t) && <button key={t} onClick={() => send({kind:'nominate',team:t,targetId:room.viewer!.participantId!})}>认领{TEAM_LABELS[t]}下局队长</button>)}
        {room.phase !== 'playing' && room.viewer?.isHost && !locked && <button className="primary-button" onClick={() => send({kind:'prepare'})}>进入无时限准备</button>}
        {plan.stage === 'guide' && team && <div className="anime-guide"><p>先浏览真实候选池，私人书签仅自己可见。双方确认后开始 180 秒组牌。</p><button className="primary-button" disabled={plan.captainView?.ready[team]} onClick={() => send({kind:'ready'})}>准备好了 / 跳过引导</button><p>红队 {plan.captainView?.ready.red ? '已确认':'浏览中'} · 蓝队 {plan.captainView?.ready.blue ? '已确认':'浏览中'}</p></div>}
        {draft && <div className="draft-clock" role="timer">组牌剩余 {remaining} 秒{remaining <= 20 ? ' · 不可抢牌或更改干扰':''}</div>}
        {draft && team && <><div className="anime-toolbar"><strong>{TEAM_LABELS[team]}手选 {own.length} / {quota?.manual}</strong><label>替换 <select aria-label="替换己方牌" value={replacement ?? ''} onChange={e => setReplacement(e.target.value ? Number(e.target.value):undefined)}><option value="">不替换</option>{own.map(id => <option key={id} value={id}>{list.find(w => w.id === id)?.title}</option>)}</select></label><button disabled={plan.captainView?.done[team]} onClick={() => send({kind:'done'})}>手选完成，剩余随机补齐</button></div>
          <p className="hint-text">点空闲牌领取，点己方牌撤回；长按对方牌抢夺，长按空闲牌投放干扰。也可拖动或从详情按钮操作。</p>
          <div className="draft-drop-zones"><div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); take(Number(e.dataTransfer.getData('text/plain'))); }}>拖到己方领取 / 抢夺</div><div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); send({kind:'release',workId:Number(e.dataTransfer.getData('text/plain'))}); }}>拖回空闲区撤回</div></div>
        </>}
        {plan.stage === 'sealed' && room.phase === 'lobby' && room.viewer?.isHost && !room.countdown && <button className="primary-button" onClick={() => socket.emit('start_game',{roomId:room.id})}>开始五秒倒计时</button>}
        {plan.stage === 'sealed' && <p className="draft-sealed">准备已封存，等待房主五秒开局。</p>}
        {room.viewer?.isHost && !room.countdown && <button onClick={() => { if (window.confirm('取消本次准备并保留配置？')) send({kind:'cancel'}); }}>取消本次准备</button>}
        {plan.variant === 'anime' && <><div className="anime-toolbar"><input aria-label="搜索候选动画" placeholder="搜索候选动画" value={query} onChange={e => setQuery(e.target.value)} />{team && <label><input type="checkbox" checked={onlyBookmarks} onChange={e => setOnlyBookmarks(e.target.checked)} />只看私人书签</label>}<span>{visible.length} / {list.length} 部</span></div>
          <div className="draft-candidates">{visible.map(w => <DraftTile key={w.id} work={w} claim={claims[w.id]} time={time} bookmark={plan.myBookmarks?.includes(w.id)} canEdit={!!team && draft} onTap={() => clickWork(w)} onLong={() => { if (!team || !draft) return; if (!claims[w.id]) send({kind:'interfere',workId:w.id}); else if (claims[w.id].team !== team) take(w.id); }} onPreview={() => setPreview(w)} onBookmark={team ? () => send({kind:'bookmark',workId:w.id}) : undefined} />)}</div>
        </>}
      </>}
      {error && <p className="error-text">{error}</p>}
    </>}
    {room.phase === 'playing' && room.viewer?.isHost && plan && <details><summary>当前局队长交接</summary>{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}<select aria-label={`${TEAM_LABELS[t]}当前队长交接`} value="" onChange={e => send({kind:'transfer',team:t,targetId:e.target.value})}><option value="">选择接任队员</option>{room.players.filter(p => p.team === t && p.role !== 'spymaster').map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</details>}
    {!!room.replayHistory?.length && <nav className="anime-toolbar" aria-label="历局回放">{room.replayHistory.map(h => <a key={h.replayId} href={`/replay/${h.replayId}`} target="_blank" rel="noreferrer">第 {h.roundNumber} 局回放</a>)}</nav>}
    {room.interferenceReview && <p>本局干扰记录：{room.interferenceReview.map(c => `${TEAM_LABELS[c.from]} → ${TEAM_LABELS[c.team]}：${room.board.find(b => b.anime?.id === c.workId)?.word ?? c.workId}`).join('；') || '无干扰'}</p>}
    {preview && <Preview work={preview} close={() => setPreview(null)}>{team && draft && <div className="anime-toolbar"><button onClick={() => { take(preview.id); setPreview(null); }}>领取 / 抢夺</button><button onClick={() => { send({kind:'interfere',workId:preview.id}); setPreview(null); }}>投放为对方干扰牌</button></div>}</Preview>}
  </section>;
}
function DraftTile({ work, claim, time, bookmark, canEdit, onTap, onLong, onPreview, onBookmark }: { work: AnimeWork; claim?: import('@acg-codenames/shared').DraftClaim; time:number; bookmark?:boolean; canEdit:boolean; onTap:()=>void; onLong:()=>void; onPreview:()=>void; onBookmark?:()=>void }) {
  const press = useRef<{ timer:number; x:number; y:number; fired:boolean } | undefined>(undefined);
  const suppress = useRef(false);
  const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = undefined; };
  useEffect(() => cancel,[]);
  return <article className={`draft-tile role-${claim?.team ?? 'hidden'}`}>
    <button draggable={canEdit} onDragStart={e => { cancel(); suppress.current = true; e.dataTransfer.setData('text/plain',String(work.id)); }} onContextMenu={e => e.preventDefault()}
      onPointerDown={e => { suppress.current = false; if (!canEdit) return; press.current = {x:e.clientX,y:e.clientY,fired:false,timer:window.setTimeout(() => { suppress.current=true; onLong(); },550)}; }}
      onPointerMove={e => { if (press.current && Math.hypot(e.clientX-press.current.x,e.clientY-press.current.y)>10) { suppress.current=true; cancel(); } }} onPointerCancel={() => { suppress.current=true; cancel(); }} onPointerUp={cancel}
      onClick={() => { if (!suppress.current) onTap(); suppress.current=false; }} aria-label={work.title}>
      <Cover work={work}/><span>{work.title}</span>
      {claim && <small>{TEAM_LABELS[claim.team]}{claim.kind === 'interference' ? ' · 干扰' : ''}{claim.protectedUntil > time ? ` · 保护 ${Math.ceil((claim.protectedUntil-time)/1000)}s` : ''}</small>}
    </button><div><button onClick={onPreview}>详情</button>{onBookmark && <button aria-label={`${bookmark ? '取消':'添加'}书签 ${work.title}`} onClick={onBookmark}>{bookmark ? '★':'☆'}</button>}</div>
  </article>;
}
