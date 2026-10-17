import { copyText } from '../lib/clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimeDiscoveryQuery, AnimeDiscoveryResult, AnimeWork, CommunityPool, ManualAnimeInput } from '@acg-codenames/shared';
import { animeWorkKey } from '@acg-codenames/shared';
import { createManualWork, deleteManualWork, discoverAnime, getCommunityPool, importAnime, listManualWorks, saveCommunityPool, updateManualWork } from '../lib/api';
import { privateIdentityKey } from '../lib/private-identity';
import { useGame } from '../context/GameContext';
import { useNavigate } from 'react-router-dom';
import { Cover, Preview } from './AnimeBoard';
import { Dialog } from './UI';
import '../discovery.css';

const tagChoices=['校园','恋爱','科幻','悬疑','日常','冒险','奇幻','运动','音乐','机战','治愈','战斗'];
const defaults:AnimeDiscoveryQuery={q:'',tags:[],tagMode:'all',sort:'match',source:'bangumi',offset:0};
export function AnimeDiscovery({pool,works,author,onWorks,saved,reloaded}:{pool?:CommunityPool;works:AnimeWork[];author:string;onWorks:(works:AnimeWork[])=>void;saved:(pool:CommunityPool)=>void;reloaded:(pool:CommunityPool)=>void}) {
  const g=useGame(),navigate=useNavigate(),owner=privateIdentityKey();
  const draftKey=`cipai.pool-draft:${owner}:${pool?.id??'new'}`;
  const [initial]=useState(()=>{
    try{
      const v=JSON.parse(localStorage.getItem(draftKey)||'null');
      if(!v||v.baseRevision!==pool?.revision||!Array.isArray(v.ids)||v.ids.length>2500||!v.ids.every(Number.isSafeInteger))return null;
      if(pool){
        const same=v.name===pool.name&&v.description===pool.description&&v.signature===pool.author&&v.isPublic===pool.isPublic&&JSON.stringify(v.ids)===JSON.stringify(pool.workIds);
        return same?null:v;
      }
      return (v.name||v.description||v.ids.length||v.isPublic)?v:null;
    }catch{return null;}
  });
  const [name,setName]=useState(initial?.name??pool?.name??''),[description,setDescription]=useState(initial?.description??pool?.description??''),[signature,setSignature]=useState(initial?.signature??pool?.author??author);
  const [ids,setIds]=useState<number[]>(initial?.ids??pool?.workIds??[]),[isPublic,setPublic]=useState(initial?.isPublic??pool?.isPublic??false);
  const [undo,setUndo]=useState<number[][]>([]),[query,setQuery]=useState<AnimeDiscoveryQuery>(defaults),[applied,setApplied]=useState<AnimeDiscoveryQuery>(defaults);
  const [result,setResult]=useState<AnimeDiscoveryResult|null>(null),[results,setResults]=useState<AnimeWork[]>([]),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(initial?'已恢复此身份未保存的编辑。':''),[tab,setTab]=useState('catalog'),[onlySelected,setOnlySelected]=useState(false);
  const [preview,setPreview]=useState<AnimeWork|null>(null),[importing,setImporting]=useState(false),[input,setInput]=useState(''),[importBusy,setImportBusy]=useState(false),[customTag,setCustomTag]=useState('');
  const [previewList,setList]=useState(false);
  const [manualWorks,setManualWorks]=useState<AnimeWork[]>([]),[manualBusy,setManualBusy]=useState(false);
  const [manualForm,setManualForm]=useState<{mode:'create'|'edit';work?:AnimeWork}|null>(null);
  const [manualName,setManualName]=useState(''),[manualAliases,setManualAliases]=useState(''),[manualAirDate,setManualAirDate]=useState(''),[manualType,setManualType]=useState<AnimeWork['type']>('TV'),[manualTags,setManualTags]=useState('');
  const [manualCover,setManualCover]=useState<string|undefined>(undefined),[manualCoverName,setManualCoverName]=useState('');
  const [manualError,setManualError]=useState('');
  const generation=useRef(0),identity=useRef(owner);identity.current=owner;
  const map=useMemo(()=>new Map([...works,...results,...manualWorks].map(w=>[w.id,w])),[works,results,manualWorks]);
  const selected=ids.map(id=>map.get(id)).filter((w):w is AnimeWork=>!!w);
  const series=new Set(selected.map(w=>w.seriesId)).size,missing=ids.length-selected.length;
  const dirty=!pool||name!==pool.name||description!==pool.description||signature!==pool.author||isPublic!==pool.isPublic||JSON.stringify(ids)!==JSON.stringify(pool.workIds);
  useEffect(()=>{
    const baseline=pool?{name:pool.name,description:pool.description,signature:pool.author,ids:pool.workIds,isPublic:pool.isPublic}:null;
    const same=!!baseline&&name===baseline.name&&description===baseline.description&&signature===baseline.signature&&isPublic===baseline.isPublic&&JSON.stringify(ids)===JSON.stringify(baseline.ids);
    const hasContent=!!name||!!description||ids.length>0||isPublic;
    try{
      if(pool?same:!hasContent)localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey,JSON.stringify({baseRevision:pool?.revision,name,description,signature,ids,isPublic}));
    }catch{/* storage may be unavailable in private mode */}
  },[draftKey,name,description,signature,ids,isPublic,pool?.revision]);
  useEffect(()=>{void search({...defaults,source:'cache'});void refreshManual();return()=>{generation.current++;};},[]);
  const refreshManual=async()=>{try{const value=await listManualWorks('mine','',1);if(identity.current===owner)setManualWorks(value.items);}catch{/* manual works are optional when the server flag is off */}};
  const search=async(q:AnimeDiscoveryQuery,append=false)=>{
    const version=++generation.current;setBusy(true);setError('');
    try{const value=q.source==='manual'?await manualDiscovery(q):await discoverAnime(q);if(version!==generation.current||identity.current!==owner)return;setResult(value);setApplied(q);setResults(previous=>append?[...new Map([...previous,...value.works].map(w=>[w.id,w])).values()]:value.works);onWorks(value.works);}
    catch(e){if(version===generation.current)setError((e as Error).message);}finally{if(version===generation.current)setBusy(false);}
  };
  const manualDiscovery=async(q:AnimeDiscoveryQuery):Promise<AnimeDiscoveryResult>=>{
    const value=await listManualWorks('mine',q.q??'',1);
    const keyword=(q.q??'').toLocaleLowerCase();
    const items=value.items.filter(w=>!keyword||`${w.title} ${w.fullTitle} ${w.aliases.join(' ')} ${w.tags?.join(' ')??''}`.toLocaleLowerCase().includes(keyword));
    return {works:items,total:items.length,nextOffset:null,source:'manual',notice:'仅显示你创建的自建作品；Bangumi 未收录的作品可在这里新建，并与 Bangumi 作品混用同一作品池。',updatedAt:Date.now(),missingMetadata:items.filter(w=>!w.cover).length};
  };
  const change=(next:number[])=>{setUndo(previous=>[ids,...previous].slice(0,10));setIds([...new Set(next)].slice(0,2500));};
  const toggle=(id:number)=>change(ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);
  const update=(key:keyof AnimeDiscoveryQuery,value:unknown)=>setQuery(previous=>({...previous,[key]:value}));
  const save=async():Promise<CommunityPool|undefined>=>{
    setSaving(true);setError('');const key=privateIdentityKey();
    try{if(missing)throw new Error(`有 ${missing} 部作品尚未读取，请刷新目录后保存`);const value=await saveCommunityPool({name,description,author:signature,workIds:ids,isPublic,expectedRevision:pool?.revision},pool?.id);if(privateIdentityKey()!==key)return;localStorage.removeItem(draftKey);setNotice(`已保存${value.isPublic?'并发布':'私人作品池'} · 版本 ${value.revision}`);saved(value);return value;}
    catch(e){setError((e as Error).message);}finally{setSaving(false);}
  };
  const usePool=async()=>{const value=dirty?await save():pool;if(!value)return;if(value.seriesCount<25){setError(`用于 5×5 还缺 ${25-value.seriesCount} 个不同系列，可继续保存草稿`);return;}localStorage.setItem('cipai-selected-community-pool',value.id);navigate(g.room?`/room/${g.room.id}`:'/?create=1&variant=anime');};
  const visible=onlySelected?selected:results;
  const flags=[query.yearFrom&&`${query.yearFrom} 年起`,query.yearTo&&`至 ${query.yearTo} 年`,query.quarter&&`第 ${query.quarter} 季`,query.type,...query.tags??[],query.minRating&&`≥${query.minRating}分`,query.minVotes&&`≥${query.minVotes}人`].filter(Boolean);
  function openManual(mode:'create'|'edit',work?:AnimeWork){
    setManualError('');setManualForm({mode,work});setManualName(work?.title??'');setManualAliases(work?.aliases.join(', ')??'');setManualAirDate(work?.airDate??'');setManualType(work?.type??'TV');setManualTags(work?.tags?.join(', ')??'');setManualCover(undefined);setManualCoverName('');
  }
  function pickCover(file?:File){
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){setManualError('封面仅支持 JPG / PNG / WebP');return;}
    if(file.size>4*1024*1024){setManualError('封面不能超过 4MB，请压缩后重试');return;}
    const reader=new FileReader();reader.onload=()=>{setManualCover(String(reader.result));setManualCoverName(file.name);setManualError('');};reader.onerror=()=>setManualError('封面读取失败');reader.readAsDataURL(file);
  }
  async function submitManual(event:React.FormEvent){
    event.preventDefault();if(!manualForm||manualBusy)return;
    setManualBusy(true);setManualError('');
    const input:ManualAnimeInput={
      title:manualName.trim(),
      aliases:manualAliases.split(/[\/,，]/).map(v=>v.trim()).filter(Boolean).slice(0,20),
      airDate:manualAirDate.trim(),type:manualType,
      tags:manualTags.split(/[,，]/).map(v=>v.trim()).filter(Boolean).slice(0,10),
      ...(manualCover?{coverDataUrl:manualCover}:{}),
      ...(manualForm.mode==='edit'&&manualForm.work?{expectedUpdatedAt:manualForm.work.updatedAt}:{}),
    };
    try{
      const work=manualForm.mode==='create'?await createManualWork(input):await updateManualWork(manualForm.work!.id,input);
      if(privateIdentityKey()!==owner)return;
      onWorks([work]);
      setManualWorks(previous=>manualForm.mode==='create'?[work,...previous]:previous.map(item=>item.id===work.id?work:item));
      setResults(previous=>[work,...previous.filter(item=>item.id!==work.id)]);
      if(manualForm.mode==='create')setIds(previous=>[...new Set([...previous,work.id])]);
      setManualForm(null);setNotice(manualForm.mode==='create'?`已创建《${work.title}》并加入当前作品池；保存作品池后才对房间生效。`:`已更新《${work.title}》。`);
    }catch(error){setManualError((error as Error).message);}finally{setManualBusy(false);}
  }
  async function removeManual(work:AnimeWork){
    if(!window.confirm(`删除自建作品《${work.title}》？已复制的公开作品池与历史复盘仍保留必要快照。`))return;
    try{await deleteManualWork(work.id);if(privateIdentityKey()!==owner)return;setManualWorks(previous=>previous.filter(item=>item.id!==work.id));setResults(previous=>previous.filter(item=>item.id!==work.id));setIds(previous=>previous.filter(id=>id!==work.id));setNotice(`已删除《${work.title}》。`);}
    catch(error){setError((error as Error).message);}
  }
  return <section className={`anime-discovery discovery-view-${tab}`}>
    <div className="discovery-mobile-tabs" role="group" aria-label="手机组池视图">{[['catalog','发现作品'],['filters','筛选条件'],['bag',`我的已选 ${ids.length}`]].map(([value,label])=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}</button>)}</div>
    {(error||notice)&&<div className="discovery-message">{error&&<p className="error-text" role="alert">{error}{error.includes('已更新')&&pool&&<button onClick={async()=>{if(window.confirm('重新读取服务器版本？当前本地修改将被替换。')){localStorage.removeItem(draftKey);reloaded(await getCommunityPool(pool.id));}}}>重新读取已存版本</button>}</p>}{notice&&<p role="status">{notice}</p>}</div>}
    <div className="discovery-layout">
      <aside className="discovery-filters discovery-panel"><div className="discovery-title"><h2>筛选作品</h2><button onClick={()=>{setQuery(defaults);setOnlySelected(false);void search({...defaults,source:'cache'});}}>重置</button></div>
        <div className="discovery-year"><label>开始年份<input aria-label="开始年份" type="number" min="1900" max="2100" placeholder="不限" value={query.yearFrom??''} onChange={e=>update('yearFrom',e.target.value?Number(e.target.value):undefined)}/></label><label>结束年份<input aria-label="结束年份" type="number" min="1900" max="2100" placeholder="不限" value={query.yearTo??''} onChange={e=>update('yearTo',e.target.value?Number(e.target.value):undefined)}/></label></div>
        <label>播出季度<select value={query.quarter??''} onChange={e=>update('quarter',e.target.value?Number(e.target.value):undefined)}><option value="">全部季度</option>{['冬 · 1–3 月','春 · 4–6 月','夏 · 7–9 月','秋 · 10–12 月'].map((v,i)=><option key={v} value={i+1}>{v}</option>)}</select></label>
        <h3>作品形式</h3><div className="discovery-chips">{['','TV','电影','OVA','ONA','未知'].map(type=><button key={type} aria-pressed={(query.type??'')===type} onClick={()=>update('type',type||undefined)}>{type||'全部'}</button>)}</div>
        <h3>题材标签 · 最多 4 个</h3><div className="discovery-chips">{[...new Set([...tagChoices,...query.tags??[]])].map(tag=><button key={tag} aria-pressed={query.tags?.includes(tag)} onClick={()=>{const values=query.tags??[];if(values.includes(tag))update('tags',values.filter(v=>v!==tag));else if(values.length<4)update('tags',[...values,tag]);else setError('最多组合 4 个标签');}}>{tag}</button>)}</div>
        <form className="discovery-tag-form" onSubmit={e=>{e.preventDefault();if(customTag.trim()&&(query.tags?.length??0)<4){update('tags',[...new Set([...query.tags??[],customTag.trim()])]);setCustomTag('');}}}><input aria-label="自定义标签" maxLength={30} value={customTag} onChange={e=>setCustomTag(e.target.value)} placeholder="输入其他标签"/><button>＋</button></form>
        <label>多标签组合<select value={query.tagMode} onChange={e=>update('tagMode',e.target.value)}><option value="all">同时满足所有标签（且）</option><option value="any">匹配任意标签（或）</option></select></label>
        <label>最低 Bangumi 评分<select value={query.minRating??0} onChange={e=>update('minRating',Number(e.target.value))}>{[0,6,7,8,9].map(v=><option key={v} value={v}>{v?`${v}.0 分以上`:'不限'}</option>)}</select></label>
        <label>最低评分人数<select value={query.minVotes??0} onChange={e=>update('minVotes',Number(e.target.value))}>{[0,100,1000,10000].map(v=><option key={v} value={v}>{v?`${v.toLocaleString()} 人以上`:'不限'}</option>)}</select></label>
        <label>查询范围<select value={query.source} onChange={e=>update('source',e.target.value)}><option value="bangumi">Bangumi 公开搜索</option><option value="cache">仅服务器缓存</option><option value="manual">我的自建作品</option></select></label>
        <label className="discovery-mobile-sort">结果排序<select value={query.sort} onChange={e=>update('sort',e.target.value)}><option value="match">匹配度</option><option value="score">评分优先</option><option value="heat">收藏热度</option><option value="recent">本页最新作品</option></select></label>
        <button className="primary-button discovery-full" disabled={busy} onClick={()=>{void search({...query,offset:0});setTab('catalog');}}>应用筛选</button><p className="hint-text">评分与标签来自 Bangumi，旧缓存未提供的数据不会当作 0 分。排除标签暂不开放。</p>
      </aside>
      <main className="discovery-results"><form className="discovery-search discovery-panel" onSubmit={e=>{e.preventDefault();void search({...query,offset:0});}}><input type="search" aria-label="搜索动画" maxLength={100} value={query.q} onChange={e=>update('q',e.target.value)} placeholder="搜索名称、别名或 Bangumi Subject ID"/><select aria-label="结果排序" value={query.sort} onChange={e=>{update('sort',e.target.value);void search({...query,sort:e.target.value as AnimeDiscoveryQuery['sort'],offset:0});}}><option value="match">匹配度</option><option value="score">评分优先</option><option value="heat">收藏热度</option><option value="recent">本页最新作品</option></select><button className="primary-button" disabled={busy}>搜索</button></form>
        <div className="discovery-results-meta"><span>{result?.source==='bangumi'?'Bangumi 实时搜索':result?.source==='manual'?'我的自建作品':'服务器缓存'} · 已显示 {visible.length} 部{result?` / 共 ${result.total} 部`:''}</span><div className="anime-toolbar"><button onClick={()=>setImporting(true)}>＋ 链接或 ID 导入</button><button className="primary-button" onClick={()=>openManual('create')}>＋ 手动新增动画</button></div></div>
        <div className="discovery-applied"><span>筛选：{flags.join(' · ')||'全部'}{JSON.stringify({...query,offset:0})!==JSON.stringify({...applied,offset:0})?' · 点击搜索或应用筛选生效':''}</span><label><input type="checkbox" checked={onlySelected} onChange={e=>setOnlySelected(e.target.checked)}/>只看已选</label></div>
        <p className="discovery-source-note" role="status">{busy?'正在查询作品…':result?.notice}{!!result?.missingMetadata&&` 本页 ${result.missingMetadata} 部元数据不完整。`}</p>
        <details className="discovery-source-mobile"><summary>{busy?'正在查询作品…':'数据来源与筛选范围'}</summary><p>{result?.notice}{!!result?.missingMetadata&&` 本页 ${result.missingMetadata} 部元数据不完整。`}</p></details>
        {result?.source==='manual'&&!!manualWorks.length&&<div className="discovery-manual-strip"><h3>我的自建作品</h3>{manualWorks.map(w=><article key={w.id} className={`manual-work ${ids.includes(w.id)?'selected':''}`}><Cover work={w}/><strong>{w.title}</strong><small>{w.aliases[0]??'自建作品'} · {w.airDate||'年份未填'}</small><div className="anime-toolbar"><button onClick={()=>toggle(w.id)}>{ids.includes(w.id)?'移出':'加入'}</button><button onClick={()=>openManual('edit',w)}>编辑</button><button className="danger-button" onClick={()=>void removeManual(w)}>删除</button></div></article>)}</div>}
        <div className="discovery-batch"><button disabled={!visible.length} onClick={()=>{change([...ids,...visible.map(w=>w.id)]);setNotice(`已批量加入本页 ${visible.length} 部，按条目 ID 去重`);}}>加入本页</button><button disabled={!visible.some(w=>ids.includes(w.id))} onClick={()=>change(ids.filter(id=>!visible.some(w=>w.id===id)))}>移除本页已选</button></div>
        {!busy&&!visible.length&&<div className="discovery-empty"><strong>没有找到符合条件的作品</strong><p>{result?.source==='manual'?'你还没有自建作品，或没有匹配关键词。':'Bangumi 未返回结果时，可以粘贴官方链接/ID 导入，或直接手动新建动画与封面。'}</p><div className="anime-toolbar"><button onClick={()=>setImporting(true)}>粘贴 Bangumi 链接 / ID</button><button className="primary-button" onClick={()=>openManual('create')}>手动新增动画</button>{result?.source!=='manual'&&<button onClick={()=>{update('source','manual');void search({...query,source:'manual',offset:0});}}>查看我的自建作品</button>}</div></div>}
        <div className="discovery-posters">{visible.map(w=><article key={w.id} data-work-id={w.id} className={`discovery-poster ${ids.includes(w.id)?'selected':''}`}><button className="discovery-art" aria-label={`预览 ${w.fullTitle}`} onClick={()=>setPreview(w)}><Cover work={w}/><span className="discovery-format">{w.type}</span></button><div className="discovery-poster-body"><h3 title={w.fullTitle}>{w.fullTitle}</h3><div className="discovery-poster-meta"><span>{w.airDate||'日期未知'}</span><span>{w.rating==null?'暂无评分':`★ ${w.rating.toFixed(1)}`}</span></div><p>{w.ratingCount==null?'评价人数未知':`${w.ratingCount.toLocaleString()} 人评价`}</p><div className="discovery-poster-actions"><button className={ids.includes(w.id)?'is-added':'primary-button'} aria-pressed={ids.includes(w.id)} onClick={()=>toggle(w.id)}>{ids.includes(w.id)?'✓ 已加入 · 移除':'＋ 加入牌库'}</button><button aria-label={`作品详情 ${w.id}`} onClick={()=>setPreview(w)}>ⓘ</button></div></div></article>)}</div>
        {!onlySelected&&result?.nextOffset!==null&&result&&<button className="discovery-load" disabled={busy} onClick={()=>void search({...applied,source:result.source,offset:result.nextOffset!},true)}>加载更多作品</button>}
      </main>
      <aside className="discovery-bag discovery-panel"><div className="discovery-title"><h2>我的动画作品池</h2><small>{pool?`版本 ${pool.revision}`:'草稿编辑中'}</small></div><label>作品池名称<input maxLength={64} value={name} onChange={e=>setName(e.target.value)}/></label><label>作品池介绍<textarea aria-label="作品池介绍" maxLength={500} value={description} onChange={e=>setDescription(e.target.value)} placeholder="留一句介绍，让同好知道这是怎样的牌库"/></label><label>作者署名<input maxLength={24} value={signature} onChange={e=>setSignature(e.target.value)}/></label>
        <div className="discovery-bag-count"><span>已加入作品<strong>{ids.length}</strong></span><p>{series} 个不同系列{missing?` · ${missing} 部尚未读取`:''}</p><progress max={36} value={series}/><p>{series<25?`5×5 还需 ${25-series} 个不同系列`:series<36?`已满足 5×5；6×6 还需 ${36-series} 个系列`:'已满足 5×5 / 6×6 的系列数要求'}</p></div>
        <div className="discovery-bag-tools"><button disabled={!undo.length} onClick={()=>{setIds(undo[0]);setUndo(undo.slice(1));}}>撤销选牌</button><button disabled={!ids.length} onClick={()=>change([])}>清空已选</button><button onClick={()=>setPreviewList(true)}>预览作品池</button></div>
        <div className="discovery-bag-list">{selected.map(w=><div key={w.id}><span>{w.fullTitle}</span><button aria-label={`移除 ${w.id}`} onClick={()=>toggle(w.id)}>×</button></div>)}{!ids.length&&<p className="discovery-empty">从作品墙点击“加入牌库”开始。</p>}</div>
        <div className="discovery-bag-foot">{pool?.hidden&&<p className="error-text">此池已被管理员隐藏，修改不会自动恢复公开，暂不能用于新局。</p>}<label><input type="checkbox" checked={isPublic} onChange={e=>setPublic(e.target.checked)}/>发布到同好题库广场</label><button className="primary-button" disabled={saving||!name.trim()||!signature.trim()} onClick={()=>void save()}>{saving?'保存中…':'保存作品池'}</button><button disabled={saving||!name.trim()||pool?.hidden} onClick={()=>void usePool()}>{g.room?'带回房间选择':'带去创建房间'}</button>{pool?.isPublic&&!pool.hidden&&<button onClick={async()=>{const ok=await copyText(`${location.origin}/anime-pools?pool=${pool.id}`);setNotice(ok?'分享链接已复制':'复制失败，可从地址栏复制作品池链接');}}>复制分享链接</button>}<p className="hint-text">可先保存不足数量的草稿。使用时仍由服务器校验候选、角色配额与池版本；带回后仍需房主选择并保存房间配置，保存不会自动开局。</p></div>
      </aside>
    </div>
    {preview&&<Preview work={preview} close={()=>setPreview(null)}><p>{preview.source==='bangumi'?'来源：Bangumi 公开 API':'来源：服务器历史 Bangumi 缓存'} · {preview.updatedAt?new Date(preview.updatedAt).toLocaleString():'更新时间未知'}</p><p>系列：{preview.seriesId}（{preview.seriesSource==='manual-override'?'人工合并':preview.seriesSource==='official-relation'?'官方关联':preview.seriesSource==='subject-id'?'暂按条目 ID，尚无已知系列关联':'历史系列映射'}）</p><p>{preview.tags?.join(' · ')||'标签数据不足'}</p><button onClick={()=>toggle(preview.id)}>{ids.includes(preview.id)?'移出牌库':'加入牌库'}</button></Preview>}
    {importing&&<Dialog title="通过 Bangumi 链接或 ID 添加" close={()=>setImporting(false)}><form onSubmit={async e=>{e.preventDefault();setImportBusy(true);setError('');try{const work=await importAnime(input);if(privateIdentityKey()!==owner)return;onWorks([work]);setResults(previous=>[work,...previous.filter(w=>w.id!==work.id)]);change([...ids,work.id]);setImporting(false);setNotice(`《${work.fullTitle}》已导入统一目录并加入当前草稿`);}catch(e){setError((e as Error).message);}finally{setImportBusy(false);}}}><label>条目链接或 ID<input autoFocus aria-label="条目链接或 ID" maxLength={300} value={input} onChange={e=>setInput(e.target.value)} placeholder="https://bgm.tv/subject/…"/></label><p className="hint-text">只接受公开非成人动画，服务器仅请求固定官方域名。无须 Bangumi 登录或 token。</p>{error&&<p role="alert">{error}</p>}<button className="primary-button" disabled={importBusy||!input.trim()}>{importBusy?'正在导入…':'解析并加入作品池'}</button></form></Dialog>}
    {manualForm&&<Dialog title={manualForm.mode==='create'?'手动新增动画':'编辑自建动画'} close={()=>setManualForm(null)}>
      <form className="manual-work-form" onSubmit={e=>void submitManual(e)}>
        <div className="manual-cover-picker">
          <label className="manual-cover-drop">{manualCover?<img src={manualCover} alt="封面预览"/>:<span>＋ 上传封面<br/><small>JPG / PNG / WebP · ≤4MB</small></span>}<input aria-label="上传动画封面" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>void pickCover(e.target.files?.[0])}/></label>
          {manualCoverName&&<small>{manualCoverName}</small>}
          {manualForm.work?.cover&&!manualCover&&<small>保留原封面</small>}
        </div>
        <div className="manual-fields">
          <label>作品名称 *<input required maxLength={100} value={manualName} onChange={e=>setManualName(e.target.value)} placeholder="例如：某部没有收录的原创短片"/></label>
          <label>别名 / 原名<input maxLength={100} value={manualAliases} onChange={e=>setManualAliases(e.target.value)} placeholder="多个别名用 / 或 , 分隔"/></label>
          <div className="manual-row"><label>首播年份<input maxLength={10} value={manualAirDate} onChange={e=>setManualAirDate(e.target.value)} placeholder="2026 或 2026-10-01"/></label><label>形式<select value={manualType} onChange={e=>setManualType(e.target.value as AnimeWork['type'])}>{['TV','OVA','ONA','电影','未知'].map(t=><option key={t}>{t}</option>)}</select></label></div>
          <label>标签<input maxLength={120} value={manualTags} onChange={e=>setManualTags(e.target.value)} placeholder="原创, 短片（最多 10 个）"/></label>
        </div>
        <p className="hint-text">自建作品使用独立的稳定 ID，不会伪造 Bangumi 编号。默认仅自己可见；只有你主动公开作品池时，封面与元数据才会按公开范围共享。请确认你拥有封面使用权。</p>
        {manualError&&<p role="alert" className="error-text">{manualError}</p>}
        <div className="anime-toolbar"><button type="button" onClick={()=>setManualForm(null)}>取消</button><button className="primary-button" disabled={manualBusy||!manualName.trim()}>{manualBusy?'保存中…':manualForm.mode==='create'?'创建并加入作品池':'保存修改'}</button></div>
      </form>
    </Dialog>}
    {previewList&&<Dialog title="作品池预览" close={()=>setPreviewList(false)} wide><h3>{name||'未命名作品池'} · {ids.length} 部 / {series} 系列</h3><div className="discovery-preview-list">{selected.map(w=><button key={w.id} onClick={()=>{setPreviewList(false);setPreview(w);}}>{w.fullTitle}</button>)}</div></Dialog>}
  </section>;
  function setPreviewList(value:boolean){setList(value);}
}
