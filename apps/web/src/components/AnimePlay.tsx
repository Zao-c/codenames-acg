import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_MODE_CONFIG, TEAM_LABELS, draftQuota, wordPackSummaries, type AnimePool, type AnimeWork, type BoardMode, type PlanAction, type PublicCard, type PublicRoomState } from '@acg-codenames/shared';
import { Cover, Preview } from './AnimeBoard';
export { AnimeBoard } from './AnimeBoard';
import { Dialog } from './UI';
import { DraftWorkspace } from './DraftWorkspace';
import type { DropAction } from './DraftTile';
import { getAnimeCatalog, getPlanPool, getPublicWordPackDetail, getCommunityPool, listCommunityPools } from '../lib/api';
import { privateIdentityKey } from '../lib/private-identity';
import { useNavigate } from 'react-router-dom';
import type { CommunityPoolSummary } from '@acg-codenames/shared';
import { useCommunityEnabled } from '../lib/use-community';
import { useGame, parseCustomWordFile, autoExportCandidatePack } from '../context/GameContext';
import { ConfigurationError, configurationMatches, confirmConfiguration, type Configuration } from '../lib/room-configuration';

export function useServerTime(room: PublicRoomState) {
  const offset = useRef(room.serverNow - Date.now());
  const [time, setTime] = useState(Date.now() + offset.current);
  useEffect(() => { offset.current = room.serverNow - Date.now(); }, [room.serverNow]);
  useEffect(() => { const timer = window.setInterval(() => setTime(Date.now() + offset.current), 1000); return () => clearInterval(timer); }, []);
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
export function NextMatchPanel({ room, mode = 'full', onConfigured, embedded=false, onCancel, onEditStateChange }: { room: PublicRoomState; mode?: 'full'|'settings'|'preview'; onConfigured?: () => void; embedded?:boolean; onCancel?:()=>void; onEditStateChange?:(state:{dirty:boolean;busy:boolean})=>void }) {
  const navigate = useNavigate();
  const communityEnabled = useCommunityEnabled();
  const { socket, effectiveIdentity, accountPacks, publicPacks, room:activeRoom } = useGame();
  const latest=useRef(room);latest.current=room;
  const openingRoom=useRef(room);
  const activeId=useRef(activeRoom?.id);activeId.current=activeRoom?.id;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const pendingConfig=useRef<{base:PublicRoomState;payload:Configuration}|undefined>(undefined);
  const [uncertain,setUncertain]=useState(false);
  const plan = room.nextPlan;
  const time = useServerTime(room);
  const [open, setOpen] = useState(room.phase !== 'playing');
  useEffect(() => { if (room.phase === 'playing') setOpen(false); }, [room.matchId]);
  useEffect(() => { if (room.phase === 'lobby') setOpen(true); }, [room.phase, plan?.stage]);
  const [catalog, setCatalog] = useState<AnimeWork[]>([]);
  const [pools, setPools] = useState<AnimePool[]>([]);
  const [catalogState,setCatalogState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [catalogRetry,setCatalogRetry]=useState(0);
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
  const [poolPreview,setPoolPreview]=useState(false);
  const [previewWorks,setPreviewWorks]=useState<AnimeWork[]>([]),[previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState('');
  useEffect(()=>{
    if(!poolPreview||!plan)return;
    let live=true;setPreviewBusy(true);setPreviewError('');setPreviewWorks([]);
    getPlanPool(room.id,plan.id,plan.version).then(value=>{if(live)setPreviewWorks(value.works);}).catch(error=>{if(live)setPreviewError(error.message);}).finally(()=>{if(live)setPreviewBusy(false);});
    return()=>{live=false;};
  },[poolPreview,room.id,plan?.id,plan?.version]);
  const [randomSwap,setRandomSwap]=useState(plan?.variant==='anime'?plan.settings.animeRandomSwap===true:true);
  const [seriesRotation,setSeriesRotation]=useState(plan?.variant==='anime'?plan.settings.animeSeriesRotation===true:true);
  const [poolDialog,setPoolDialog]=useState(false);
  const [poolScope,setPoolScope]=useState<'public'|'mine'|'favorites'>('public');
  const [poolSearch,setPoolSearch]=useState(''),[poolSearchApplied,setPoolSearchApplied]=useState('');
  const [poolPage,setPoolPage]=useState(1),[poolTotal,setPoolTotal]=useState(0),[poolBusy,setPoolBusy]=useState(false);
  const [poolChoices,setPoolChoices]=useState<CommunityPoolSummary[]>([]);
  const bringBackKey=`cipai-selected-community-pool:${privateIdentityKey()}:${room.id}`;
  const [wordPackId, setWordPackId] = useState('');
  const [uploadedPack,setUploadedPack] = useState<{name:string;entries:string[]}>();
  const [advanced,setAdvanced] = useState(() => {
    const settings = plan?.settings ?? room.settings;
    return {timerMode:settings.timerMode??'unlimited',timerClueSeconds:settings.timerClueSeconds??90,timerGuessSeconds:settings.timerGuessSeconds??90,flipMode:settings.flipMode??'word-color'};
  });
  const signature=JSON.stringify({variant,size,score,...(variant==='anime'?{poolId,randomSwap,seriesRotation,...(poolId==='custom'?{poolName,customIds}: {})}:{wordPackId,uploadedPack,...advanced})});
  const originalSignature=useRef(signature);
  const dirty=signature!==originalSignature.current;
  useEffect(()=>{onEditStateChange?.({dirty,busy:configuring});},[dirty,configuring,onEditStateChange]);
  const [customPage,setCustomPage]=useState(1),[previewPage,setPreviewPage]=useState(1),[previewQuery,setPreviewQuery]=useState('');
  useEffect(()=>{setCustomPage(1);},[query]);
  const poolPageSize=60;
  const customMatches=useMemo(()=>catalog.filter(w=>`${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())),[catalog,query]);
  const previewMatches=useMemo(()=>previewWorks.filter(w=>`${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(previewQuery.toLowerCase())),[previewWorks,previewQuery]);
  const storageKey = `anime-pools:${effectiveIdentity?.nickname ?? 'guest'}`;
  const sourceSeriesCounts=useMemo(()=>{
    const byId=new Map(catalog.map(w=>[w.id,w.seriesId]));
    return new Map([...pools,...savedPools].map(pool=>[pool.id,new Set(pool.workIds.map(id=>byId.get(id)).filter(Boolean)).size]));
  },[catalog,pools,savedPools]);
  useEffect(() => { try { setSavedPools(JSON.parse(localStorage.getItem(storageKey) ?? '[]')); } catch {} }, [storageKey]);
  const needsCatalog = room.viewer?.isHost && (mode==='settings'||(mode==='full'&&open&&(!plan||plan.stage==='planning'||room.phase==='finished')));
  const catalogOwner = privateIdentityKey();
  useEffect(() => {
    if (!needsCatalog) return;
    let live=true;setCatalogState('loading');
    getAnimeCatalog().then(data=>{if(live){setCatalog(data.works);setPools(data.pools??[]);setCatalogState('ready');}}).catch(()=>{if(live){setCatalogState('error');setError('目录读取失败，请稍后重试。已准备的候选池仍可使用。');}});
    return()=>{live=false;};
  }, [needsCatalog,catalogOwner,catalogRetry]);
  const refreshCommunity = async () => {
    try {
      const pages = await Promise.all([listCommunityPools('public'), listCommunityPools('mine'), listCommunityPools('favorites')]);
      const items = new Map(pages.flatMap(p => p.items).filter(p => !p.hidden).map(p => [p.id, p]));
      const emptyRoomKey = `cipai-selected-community-pool:${privateIdentityKey()}:`;
      const remembered = localStorage.getItem(bringBackKey) ?? localStorage.getItem(emptyRoomKey) ?? localStorage.getItem('cipai-selected-community-pool');
      if (remembered) {
        try {
          const selected = await getCommunityPool(remembered);
          if (!selected.hidden) {
            items.set(selected.id, selected);
            setPoolId(`community:${selected.id}`);setVariant('anime');
            setConfigNotice(`「${selected.name}」尚未生效：请点击“保存配置并更新候选池”。`);
          }
        } catch {
          localStorage.removeItem(bringBackKey);localStorage.removeItem('cipai-selected-community-pool');
          setPoolId('');setError('带回的作品池已失效，请重新选择作品池。');
        }
      }
      if(plan?.sourcePool&&!items.has(plan.sourcePool.id)){
        try{const source=await getCommunityPool(plan.sourcePool.id);if(source.hidden)throw new Error('已隐藏');items.set(source.id,source);}
        catch{if(poolId===`community:${plan.sourcePool.id}`){setPoolId('');setError('原作品池已失效，请重新选择。已封存的当前局不受影响。');}}
      }
      setCommunityPools([...items.values()]);
    } catch { /* Older servers can keep the existing local/quarterly pool workflow. */ }
  };
  useEffect(() => { if (room.viewer?.isHost) void refreshCommunity(); }, [room.viewer?.isHost]);
  useEffect(() => {
    if(!poolDialog)return;
    let live=true;setPoolBusy(true);
    listCommunityPools(poolScope,poolSearchApplied,poolPage)
      .then(value=>{if(!live)return;setPoolChoices(value.items.filter(item=>!item.hidden));setPoolTotal(value.total);})
      .catch(error=>{if(live)setError((error as Error).message);})
      .finally(()=>{if(live)setPoolBusy(false);});
    return()=>{live=false;};
  },[poolDialog,poolScope,poolSearchApplied,poolPage]);
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
  const stillHere=()=>mounted.current&&activeId.current===room.id;
  const verifyPool=async(snapshot:PublicRoomState,payload:Configuration)=>{
    if('kind' in payload&&payload.variant==='anime'&&payload.poolIds&&snapshot.nextPlan){
      const result=await getPlanPool(snapshot.id,snapshot.nextPlan.id,snapshot.nextPlan.version);
      const wanted=new Set(payload.poolIds);
      if(result.works.length!==wanted.size||result.works.some(w=>!wanted.has(w.id)))throw new ConfigurationError('服务端作品池与草稿不一致，请核对后再保存');
    }
    if(!stillHere())throw new ConfigurationError('房间已切换，本次设置回执已忽略');
  };
  const confirmed=async(event:'plan_action'|'update_room_settings',payload:Configuration)=>{
    if(mode==='settings'){
      const previous=pendingConfig.current;
      const withoutVersion=(value:Configuration)=>JSON.stringify({...value,...('kind' in value?{version:undefined}:{})});
      const base=openingRoom.current;
      const attempt=previous&&withoutVersion(previous.payload)===withoutVersion(payload)?previous:{base,payload:{...payload,...('kind' in payload?{version:base.nextPlan?.version}:{})}};
      try{
        const snapshot=await confirmConfiguration({base:attempt.base,payload:attempt.payload,readRoom:()=>latest.current,active:stillHere,
          emit:reply=>{if(event==='plan_action')socket.emit(event,attempt.payload as PlanAction,reply);else socket.emit(event,attempt.payload as import('@acg-codenames/shared').UpdateRoomSettingsPayload,reply);},
          synchronize:()=>socket.emit('sync_room_state',{roomId:room.id}),onChecking:()=>setConfigNotice('核对服务端版本…请勿重复提交')});
        await verifyPool(snapshot,attempt.payload);if(!configurationMatches(attempt.base,latest.current,attempt.payload))throw new ConfigurationError('房间已有较新设置，草稿已保留，请核对最新状态');pendingConfig.current=undefined;setUncertain(false);return;
      }catch(error){if(error instanceof ConfigurationError&&(error.uncertain||latest.current.nextPlan?.version!==base.nextPlan?.version)){pendingConfig.current=attempt;setUncertain(true);}throw error;}
    }
    return new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('保存未确认，请刷新当前状态后重试')),8000);
    const reply=(result:{ok:boolean;message?:string})=>{clearTimeout(timer);result.ok?resolve():reject(new Error(result.message));};
    if(event==='plan_action')socket.emit(event,payload as PlanAction,reply);else socket.emit(event,payload as import('@acg-codenames/shared').UpdateRoomSettingsPayload,reply);
    });
  };
  const recheck=async()=>{
    const attempt=pendingConfig.current;if(!attempt||configuring)return;
    setConfiguring(true);setError('');setConfigNotice('核对服务端版本…');
    const seen=latest.current.serverNow;socket.emit('sync_room_state',{roomId:room.id});
    try{
      const end=Date.now()+3000;while(stillHere()&&latest.current.serverNow<=seen&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,40));
      if(!stillHere())return;
      if(configurationMatches(attempt.base,latest.current,attempt.payload)){await verifyPool(latest.current,attempt.payload);if(!configurationMatches(attempt.base,latest.current,attempt.payload))throw new Error('房间已有较新设置，请再次核对');pendingConfig.current=undefined;onConfigured?.();return;}
      if(latest.current.serverNow<=seen)throw new Error('连接尚未恢复，草稿已保留，可再次核对');
      if(latest.current.nextPlan?.version!==attempt.base.nextPlan?.version){pendingConfig.current=undefined;openingRoom.current=latest.current;}
      setUncertain(false);setConfigNotice('已读取当前服务器设置，尚未确认此草稿。请核对后重试保存；不会自动重复提交。');
    }catch(error){if(stillHere())setError((error as Error).message);}finally{if(stillHere())setConfiguring(false);}
  };
  const configure = async () => {
    if(configureLock.current)return;
    if(mode==='settings'&&!dirty){onConfigured?.();return;}
    if(mode==='settings'&&uncertain){void recheck();return;}
    if(!socket.connected){setError('连接尚未恢复，草稿已保留。请恢复连接后保存。');return;}
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
      if(stillHere())onConfigured?.(); return;
    }
    await confirmed('plan_action',{ roomId:room.id,version:plan?.version,kind:'configure', variant, animeRandomSwap:randomSwap, animeSeriesRotation:seriesRotation, boardMode:size, scoringMode:score, ...(mode==='settings'&&variant==='classic'?advanced:{}), poolIds:selected, poolName:poolId === 'custom' ? poolName : pool?.name, communityPoolId: community?.id, communityPoolRevision: community?.revision, builtinWordPackId: wordPackId.startsWith('builtin:') ? wordPackId.slice(8) : undefined, customWordPack: selectedPack ? { name:selectedPack.name, entries:selectedPack.entries } : undefined });
    if(community)localStorage.removeItem(bringBackKey);
    localStorage.removeItem(`cipai-selected-community-pool:${privateIdentityKey()}:`);
    localStorage.removeItem('cipai-selected-community-pool');
    if(stillHere()){setConfigNotice('已保存，服务端版本和设置已核对。');onConfigured?.();}
    }catch(e){if(stillHere()){setConfigNotice('');setError((e as Error).message);}}finally{configureLock.current=false;if(stillHere())setConfiguring(false);}
  };
  const take = (id: number) => { send({ kind:'take', workId:id, replaceId: replacement }); if (replacement !== undefined) setReplacement(undefined); };
  const dropWork = (w: AnimeWork, action: DropAction, replaceId?:number) => {
    if (!team || !draft) return;
    const claim = claims[w.id];
    if ((action==='take'||action==='replace')&&claim&&(claim.kind==='interference'||claim.team===team||remaining<=20||time<claim.protectedUntil)){setError(remaining<=20?'最后 20 秒不能抢夺':'该牌处于保护期或不可抢夺');return;}
    if (action === 'take') { if (claim?.kind !== 'interference' && claim?.team !== team) {if(replacement!==undefined)setReplaceConfirm({work:w,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(w);else take(w.id);} }
    else if (action === 'release') { if (claim?.team === team && claim.kind === 'manual') send({ kind:'release', workId:w.id }); }
    else if (action === 'interfere') { if (!claim && remaining > 20) setInterfere(w); }
    else if (action === 'replace' && replaceId && claims[replaceId]?.team===team && claims[replaceId]?.kind==='manual')setReplaceConfirm({work:w,old:replaceId});
  };
  const controls = plan && <>
        <details className="captain-management"><summary>队长管理</summary><div className="anime-toolbar">{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}{room.phase === 'lobby' ? '本局队长' : '下局队长'} <select aria-label={`${TEAM_LABELS[t]}${room.phase === 'lobby' ? '本局队长' : '下局队长'}`} value={plan.captains[t] ?? ''} disabled={!room.viewer?.isHost && team !== t} onChange={e => send({kind:locked ? 'transfer':'nominate',team:t,targetId:e.target.value})}><option value="">请选择</option>{room.players.filter(p => p.team === t).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</div></details>
        {room.viewer?.participantType === 'player' && !team && (['red','blue'] as const).map(t => !plan.captains[t] && room.players.some(p => p.id === room.viewer?.participantId && p.team === t) && <button key={t} onClick={() => send({kind:'nominate',team:t,targetId:room.viewer!.participantId!})}>认领{TEAM_LABELS[t]}下局队长</button>)}
        {(plan.variant === 'anime' || room.phase === 'finished') && room.phase !== 'playing' && room.viewer?.isHost && !locked && <button className="primary-button" onClick={() => send({kind:'prepare'})}>{plan.variant==='anime'?'进入队长预览':'进入下一局准备'}</button>}
        {plan.stage === 'guide' && team && <div className="anime-guide"><p>先浏览真实候选池，私人书签仅自己可见。双方确认后开始 180 秒组牌。</p><button className="primary-button" disabled={plan.captainView?.ready[team]} onClick={() => send({kind:'ready'})}>准备好了 / 跳过引导</button><p>红队 {plan.captainView?.ready.red ? '已确认':'浏览中'} · 蓝队 {plan.captainView?.ready.blue ? '已确认':'浏览中'}</p></div>}
        
        {draft && team && <><div className="anime-toolbar"><strong>{TEAM_LABELS[team]}手选 {own.length} / {quota?.manual}</strong><button disabled={plan.captainView?.done[team]} onClick={() => send({kind:'done'})}>手选完成，剩余随机补齐</button></div>
          <p className="hint-text">拖入阵容领取，拖回候选池撤回；拖到己方已选牌上可确认替换。</p>
        </>}
        {plan.stage === 'sealed' && room.phase === 'lobby' && room.viewer?.isHost && !room.countdown && <button className="primary-button" onClick={() => socket.emit('start_game',{roomId:room.id})}>开始五秒倒计时</button>}
        {plan.stage === 'sealed' && <p className="draft-sealed">准备已封存，等待房主五秒开局。{plan.randomSwapCompleted?'已完成随机互换。':''}</p>}
        {room.viewer?.isHost && plan.stage !== 'planning' && !room.countdown && <button onClick={() => { if (window.confirm('取消本次准备并保留配置？')) send({kind:'cancel'}); }}>取消本次准备</button>}
  </>;
  const content = <div className="next-plan-content">
      {mode !== 'preview' && room.viewer?.isHost && !locked && !room.countdown && <details className="anime-config" open={mode === 'settings' || !plan || (room.phase !== 'playing' && plan.stage === 'planning')}>
        <summary>配置{room.phase === 'playing' ? '下一局' : '本次准备'}</summary>
        <div className="anime-toolbar"><label>玩法 <select aria-label="玩法" value={variant} onChange={e => { setVariant(e.target.value as 'classic'|'anime'); if(e.target.value==='anime'&&plan?.variant!=='anime'){setRandomSwap(true);setSeriesRotation(true);} setSize('5x5'); }}><option value="classic">经典词牌</option><option value="anime">动画组牌</option></select></label>
          <label>棋盘 <select aria-label="棋盘" value={size} onChange={e => setSize(e.target.value as BoardMode)}>{(variant === 'anime' ? ['5x5','6x6'] : ['5x5','7x7','9x9']).map(s => <option key={s}>{s}</option>)}</select></label>
          <label>计分 <select aria-label="下一局计分" value={score === 'gamble' ? 'scoring' : score} onChange={e => setScore(e.target.value as typeof score)}><option value="classic">胜场制</option><option value="scoring">积分制</option></select></label>
        </div>
        {variant==='anime'&&<div className="anime-option-flags"><label><input type="checkbox" checked={randomSwap} onChange={e=>setRandomSwap(e.target.checked)}/>随机互换 A · 封存时双方各一张</label><label><input type="checkbox" checked={seriesRotation} onChange={e=>setSeriesRotation(e.target.checked)}/>历局作品轮换 · 排除已玩系列</label></div>}
        {variant === 'classic' ? <><label>文字题库 <select value={wordPackId} onChange={e => setWordPackId(e.target.value)}><option value="">沿用上次</option>{wordPackSummaries.map(p => <option key={p.id} value={`builtin:${p.id}`}>{p.name}</option>)}{accountPacks.map(p => <option key={p.id} value={`mine:${p.id}`}>{p.name}</option>)}{publicPacks.map(p => <option key={p.publicId} value={`public:${p.publicId}`}>{p.name} · {p.ownerUsername}</option>)}{uploadedPack&&<option value="upload">上传：{uploadedPack.name}</option>}</select></label>{mode==='settings'&&<label>上传文字题库<input type="file" accept=".txt,.json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=await parseCustomWordFile(file);setUploadedPack(data.kind==='candidate'?autoExportCandidatePack(data.pack):data.pack);setWordPackId('upload');setError('');}catch(error){setError((error as Error).message);}}}/></label>}</> : <>
          <label>动画作品池 <select aria-label="动画作品池" aria-busy={catalogState==='loading'} disabled={catalogState==='loading'} value={poolId} onChange={e => {setPoolId(e.target.value);setError('');}}> {!poolId&&<option value="">作品池失效，请重新选择</option>}{plan?.variant === 'anime' && <option value="current">沿用：{plan.poolName}</option>}{[...pools,...savedPools].map(p => <option key={p.id} value={p.id}>{p.name}（{p.workIds.length} 部{(sourceSeriesCounts.get(p.id)??0)<BOARD_MODE_CONFIG[size].size?' · 系列不足，建议合并年份':''}）</option>)}{communityPools.map(p => <option key={`community:${p.id}`} value={`community:${p.id}`}>社区 · {p.name}（{p.workCount} 部）</option>)}<option value="custom">自定义作品池</option></select></label>
          {catalogState==='loading'&&<p className="hint-text" role="status">正在读取作品目录…</p>}{catalogState==='error'&&<button onClick={()=>{setError('');setCatalogRetry(n=>n+1);}}>重试读取目录</button>}
          {(communityEnabled || !!communityPools.length) && <div className="anime-toolbar"><button onClick={() => {setPoolDialog(true);setPoolPage(1);}}>搜索全部作品池…</button>{mode!=='settings'&&<button onClick={() => navigate('/anime-pools')}>浏览动画题库广场</button>}<button onClick={() => void refreshCommunity()}>更新社区列表</button></div>}
          {poolId === 'custom' && <div className="anime-pool-editor"><input aria-label="动画题库名称" value={poolName} onChange={e => setPoolName(e.target.value)} /><input aria-label="搜索目录" placeholder="搜索作品，勾选加入题库" value={query} onChange={e => setQuery(e.target.value)} />
            <p>已选 {customIds.length} 部 / {new Set(catalog.filter(w => customIds.includes(w.id)).map(w => w.seriesId)).size} 个系列</p>
            <div className="anime-pool-list">{customMatches.slice((customPage-1)*poolPageSize,customPage*poolPageSize).map(w => <label key={w.id}><input type="checkbox" checked={customIds.includes(w.id)} onChange={() => setCustomIds(ids => ids.includes(w.id) ? ids.filter(id => id !== w.id) : [...ids,w.id])} />{w.fullTitle}</label>)}</div><nav className="anime-toolbar" aria-label="目录分页"><button disabled={customPage<=1} onClick={()=>setCustomPage(p=>p-1)}>上一页</button><span>{customPage} / {Math.max(1,Math.ceil(customMatches.length/poolPageSize))} · {customMatches.length} 部</span><button disabled={customPage*poolPageSize>=customMatches.length} onClick={()=>setCustomPage(p=>p+1)}>下一页</button></nav>
            <button onClick={() => { const next = [...savedPools,{id:`custom-${Date.now()}`,name:poolName,workIds:customIds}]; setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); }}>保存到我的动画题库</button>
          </div>}
          {savedPools.some(p => p.id === poolId) && <><button onClick={() => { const p = savedPools.find(p => p.id === poolId)!; setCustomIds(p.workIds); setPoolName(p.name); setPoolId('custom'); }}>编辑此题库</button><button onClick={() => { const next = savedPools.filter(p => p.id !== poolId); setSavedPools(next); localStorage.setItem(storageKey,JSON.stringify(next)); setPoolId('all'); }}>删除此题库</button></>}
        </>}
        {mode==='settings'&&variant==='classic'&&<details className="v2-advanced"><summary>经典进阶设置</summary><label>回合计时<select aria-label="经典回合计时" value={advanced.timerMode} onChange={e=>setAdvanced(v=>({...v,timerMode:e.target.value as 'timed'|'unlimited'}))}><option value="unlimited">不限时</option><option value="timed">限时</option></select></label>{advanced.timerMode==='timed'&&(['timerClueSeconds','timerGuessSeconds'] as const).map((k,i)=><label key={k}>{i?'猜词时间':'提示时间'}<select value={advanced[k]} onChange={e=>setAdvanced(v=>({...v,[k]:Number(e.target.value)}))}>{[60,90,120].map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label>)}<label>翻牌显示<select aria-label="经典翻牌显示" value={advanced.flipMode} onChange={e=>setAdvanced(v=>({...v,flipMode:e.target.value as 'word-color'|'color-only'}))}><option value="word-color">词语与阵营</option><option value="color-only">仅阵营颜色</option></select></label></details>}
        {mode==='settings'&&variant==='anime'&&<p className="hint-text">选牌时长：180 秒；干扰牌仍在选牌期间投放。独立干扰阶段与新时长未启用。</p>}
        <div className="settings-actions">{mode==='settings'&&<button disabled={configuring} onClick={onCancel}>取消</button>}<button className="primary-button" disabled={configuring||(mode!=='settings'||dirty)&&needsCatalog&&catalogState==='loading'} onClick={configure}>{configuring?'保存中／核对服务端版本…':mode==='settings'?uncertain?'核对最新状态':dirty?'保存并返回准备大厅':'返回准备大厅':'保存配置并更新候选池'}</button></div>{configNotice&&<p role="status" className="hint-text">{configNotice}</p>}
      </details>}
      {plan?.variant==='anime'&&room.viewer?.isHost&&<div className="pool-current-summary"><strong>{plan.poolName}</strong><p>作品 {plan.poolSummary?.source} · 系列 {plan.poolSummary?.series} · 历局排除 {plan.poolSummary?.excluded} · 当前可用 {plan.poolSummary?.available} / 需要 {plan.poolSummary?.required}</p><button onClick={()=>setPoolPreview(true)}>查看当前作品池</button>{plan.stage==='planning'&&room.phase!=='playing'&&<button onClick={()=>{if(window.confirm('重置本房间已玩系列记录？下一局可能再次出现之前玩过的作品；原作品池不会被删除。'))send({kind:'reset-series-history'});}}>重置本房间轮换历史</button>}</div>}
      {mode !== 'settings' && plan && <>
        <DraftWorkspace plan={plan} team={team} time={time} remaining={remaining} controls={mode === 'preview' ? null : controls} works={visible} query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter} claimFilter={claimFilter} setClaimFilter={setClaimFilter} onlyBookmarks={onlyBookmarks} setOnlyBookmarks={setOnlyBookmarks}
          onDrop={dropWork} onPreview={setPreview} replacement={replacement} onChooseReplacement={setReplacement} onBookmark={team ? w=>send({kind:'bookmark',workId:w.id}) : undefined}/>
      </>}
      {error && <p className="error-text" role="alert">{error}</p>}
    {room.phase === 'playing' && room.viewer?.isHost && plan && <details><summary>当前局队长交接</summary>{(['red','blue'] as const).map(t => <label key={t}>{TEAM_LABELS[t]}<select aria-label={`${TEAM_LABELS[t]}当前队长交接`} value="" onChange={e => send({kind:'transfer',team:t,targetId:e.target.value})}><option value="">选择接任队员</option>{room.players.filter(p => p.team === t && p.role !== 'spymaster').map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select></label>)}</details>}

    {room.interferenceReview && <p>本局干扰记录：{room.interferenceReview.map(c => `${TEAM_LABELS[c.from]} → ${TEAM_LABELS[c.team]}：${room.board.find(b => b.anime?.id === c.workId)?.word ?? c.workId}`).join('；') || '无干扰'}</p>}

    </div>;
  const overlay = <>
    {poolPreview&&plan&&<Dialog title={`当前作品池 · ${plan.poolName}`} close={()=>setPoolPreview(false)} wide><p>{plan.poolSummary?.source} 部作品 · {plan.poolSummary?.series} 个系列 · 可用 {plan.poolSummary?.available} / 需要 {plan.poolSummary?.required}</p><label>搜索当前作品池<input value={previewQuery} onChange={e=>{setPreviewQuery(e.target.value);setPreviewPage(1);}}/></label><div className="current-pool-grid">{previewBusy&&<p role="status">正在读取作品池…</p>}{previewError&&<p role="alert">{previewError}</p>}{previewMatches.slice((previewPage-1)*poolPageSize,previewPage*poolPageSize).map(w=><article key={w.id}><Cover work={w}/><span>{w.title}</span></article>)}</div><nav className="anime-toolbar" aria-label="当前作品池分页"><button disabled={previewPage<=1} onClick={()=>setPreviewPage(p=>p-1)}>上一页</button><span>{previewPage} / {Math.max(1,Math.ceil(previewMatches.length/poolPageSize))} · {previewMatches.length} 部</span><button disabled={previewPage*poolPageSize>=previewMatches.length} onClick={()=>setPreviewPage(p=>p+1)}>下一页</button></nav></Dialog>}
    {preview && <Preview work={preview} close={() => setPreview(null)}>{team && draft && (() => { const c = claims[preview.id];
      if (c?.kind === 'interference') return <p className="hint-text">这是{c.from === team ? '本方投放给对方' : '对方投放给本方'}的干扰牌，占用接收方的随机补位，不占手选额度，不能撤回或抢夺。</p>;
      if (c?.team === team) return <div className="anime-toolbar"><button onClick={() => { send({kind:'release',workId:preview.id}); setPreview(null); }}>撤回这张</button></div>;
      if(c&&(remaining<=20||time<c.protectedUntil))return <p className="hint-text">{remaining<=20?'最后 20 秒不能抢夺':`保护期剩余 ${Math.ceil((c.protectedUntil-time)/1000)} 秒`}</p>;
      if (c) return <div className="anime-toolbar"><button className="primary-button" onClick={() => {if(replacement!==undefined)setReplaceConfirm({work:preview,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(preview);else take(preview.id);setPreview(null);}}>{replacement!==undefined?'抢夺并更换':own.length>=(quota?.manual??0)?'更换作品':'抢夺这张'}</button></div>;
      return <div className="anime-toolbar"><button className="primary-button" onClick={() => {if(replacement!==undefined)setReplaceConfirm({work:preview,old:replacement});else if(own.length>=(quota?.manual??0))setReplaceCandidate(preview);else take(preview.id);setPreview(null);}}>{replacement!==undefined?'用这张更换':own.length>=(quota?.manual??0)?'更换作品':'领取这张'}</button>{remaining > 20 && <button onClick={() => { setInterfere(preview); setPreview(null); }}>投放为干扰牌</button>}</div>;
    })()}</Preview>}
    {replaceCandidate&&<Dialog title="选择要更换的作品" close={()=>setReplaceCandidate(null)}><p>手选已满。选择一张己方手选牌，用《{replaceCandidate.title}》更换。</p>{own.map(id=><button key={id} onClick={()=>{setReplaceConfirm({work:replaceCandidate,old:id});setReplaceCandidate(null);}}>{list.find(w=>w.id===id)?.title}</button>)}</Dialog>}
    {replaceConfirm&&<Dialog title="更换作品" close={()=>setReplaceConfirm(null)}><p>将《{list.find(w=>w.id===replaceConfirm.old)?.title}》更换为《{replaceConfirm.work.title}》？</p><p className="hint-text">更换失败时保留原牌；抢夺仍受保护期和最后 20 秒限制。</p><button className="primary-button" onClick={()=>{send({kind:'take',workId:replaceConfirm.work.id,replaceId:replaceConfirm.old});setReplaceConfirm(null);setReplacement(undefined);}}>确认更换</button><button onClick={()=>setReplaceConfirm(null)}>取消</button></Dialog>}
    {interfere && team && <Dialog title="投放干扰牌" close={() => setInterfere(null)}>
      <div className="anime-confirm"><p>将《{interfere.title}》投给{TEAM_LABELS[team === 'red' ? 'blue' : 'red']}作为干扰牌？<br/>仅双方队长可见；确认后不可撤回。</p>
      <details className="interference-rules"><summary>规则说明</summary><p>每队每局一张，再次投放替换原牌；占接收方随机补位，不占手选额度；最后 20 秒不可更改。普通队员和旁观者不可见。</p></details>
        <button className="primary-button" onClick={() => { send({kind:'interfere',workId:interfere.id}); setInterfere(null); }}>确认投放</button>
        <button onClick={() => setInterfere(null)}>取消</button></div>
    </Dialog>}
    {poolDialog&&<Dialog title="选择动画作品池" close={()=>setPoolDialog(false)} wide>
      <div className="pool-picker">
        <div className="anime-toolbar" role="group" aria-label="作品池范围">{(['public','mine','favorites'] as const).map((value,i)=><button key={value} aria-pressed={poolScope===value} className={poolScope===value?'primary-button':''} onClick={()=>{setPoolScope(value);setPoolPage(1);}}>{['公开广场','我的作品池','我的收藏'][i]}</button>)}</div>
        <form className="community-search" onSubmit={e=>{e.preventDefault();setPoolSearchApplied(poolSearch);setPoolPage(1);}}><label>搜索作品池<input maxLength={100} value={poolSearch} onChange={e=>setPoolSearch(e.target.value)} placeholder="名称、介绍或作者"/></label><button>搜索</button></form>
        {poolBusy?<p role="status">正在读取…</p>:poolChoices.length?<div className="pool-picker-list">{poolChoices.map(item=><article key={item.id} className={poolId===`community:${item.id}`?'selected':''}><div><strong>{item.name}</strong><small>{item.workCount} 部 · {item.seriesCount} 个系列 · {item.author}{item.hidden?' · 已隐藏':''}</small>{item.description&&<p>{item.description}</p>}</div><button className="primary-button" disabled={item.hidden||item.seriesCount<BOARD_MODE_CONFIG[size].size} onClick={()=>{setPoolId(`community:${item.id}`);setVariant('anime');setCommunityPools(previous=>previous.some(p=>p.id===item.id)?previous:[item,...previous]);setConfigNotice(`已选择「${item.name}」，点击“保存配置并更新候选池”后生效。`);setPoolDialog(false);}}>{item.seriesCount<BOARD_MODE_CONFIG[size].size?`系列不足 ${BOARD_MODE_CONFIG[size].size}`:'选择'}</button></article>)}</div>:<p className="empty-text">没有找到作品池。可切换范围或清空搜索词。</p>}
        {poolTotal>20&&<nav className="anime-toolbar" aria-label="作品池分页"><button disabled={poolPage<=1||poolBusy} onClick={()=>setPoolPage(p=>p-1)}>上一页</button><span>第 {poolPage} / {Math.ceil(poolTotal/20)} 页 · 共 {poolTotal} 个</span><button disabled={poolPage*20>=poolTotal||poolBusy} onClick={()=>setPoolPage(p=>p+1)}>下一页</button></nav>}
      </div>
    </Dialog>}
  </>;
  if (mode === 'settings') return <div className="lobby-config-form"><fieldset disabled={configuring} className="settings-fields">{content}</fieldset><p className="hint-text">胜场制：赢一局记一胜。积分制：猜对加分，失误扣分。</p>{overlay}</div>;
  return <section className={`panel next-match-panel ${room.phase==='playing'?'next-plan-during-game':''} ${plan?.variant==='anime'?'has-anime-plan':''}`}>

    {mode === 'full' && !embedded && <div className="panel-heading"><div><p className="eyebrow">{room.phase==='playing'?'下一局 · 独立准备':'准备工作区'}</p><h2>{room.phase==='playing'?'下一局计划':'玩法与组牌'}</h2></div><button onClick={()=>setOpen(!open)}>{open?'收起准备':'查看准备'}</button></div>}
    {!plan && !room.viewer?.isHost && <div className="plan-readonly"><strong>经典词牌 · {room.settings.boardMode}</strong><p>{room.wordPackSummary.name}</p><p className="hint-text">社长正在配置玩法。选择队伍与席位后，等待社长开局。</p></div>}
    {plan && room.phase!=='playing' && <p className="hint-text">{plan.variant==='anime'?'动画组牌':'经典词牌'} · {plan.settings.boardMode} · {plan.poolName} · {TEAM_LABELS[plan.startingTeam]}先手</p>}
    {open && (!embedded && room.phase==='playing'?<Dialog title="下一局计划" close={()=>setOpen(false)} wide>{content}</Dialog>:content)}
    {overlay}
  </section>;
}
