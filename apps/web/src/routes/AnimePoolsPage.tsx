import { AnimeDiscovery } from '../components/AnimeDiscovery';
import { privateIdentityKey } from '../lib/private-identity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AnimeWork, CommunityPool, CommunityPoolPage, CommunityPoolSummary, PoolModerationItem } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { deleteCommunityPool, copyCommunityPool, favoriteCommunityPool, getAnimeCatalog, getCommunityPool, getPoolModeration, listCommunityPools, moderateCommunityPool, reportCommunityPool, saveCommunityPool } from '../lib/api';
import { Dialog } from '../components/UI';
import { Cover, Preview } from '../components/AnimeBoard';
import { PrivateIdentityTools } from '../components/PrivateIdentityTools';
import '../community.css';

function Moderation({ close }: { close: () => void }) {
  const [key, setKey] = useState(''), [items, setItems] = useState<PoolModerationItem[]>([]), [error, setError] = useState('');
  const [id, setId] = useState(''), [reason, setReason] = useState(''), [hidden, setHidden] = useState(true), [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); setError(''); try { setItems((await getPoolModeration(key)).items); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Dialog title="作品池社区管理" close={close} wide><p className="hint-text">使用服务端配置的管理员凭证处理举报；凭证只保留在本次窗口中。</p>
    <form onSubmit={e => { e.preventDefault(); void load(); }}><label>管理员凭证<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label><button disabled={busy || !key}>读取待处理举报</button></form>
    {error && <p role="alert">{error}</p>}
    {items.map(item => <details key={item.pool.id}><summary>{item.pool.name} · {item.pool.deleted ? '已删除 · 审计保留' : item.pool.hidden ? '已隐藏' : '公开'} · {item.reports.length} 条举报</summary><p>{item.pool.description}</p>{item.reports.map((r, i) => <p key={i}>{r.reason} · {new Date(r.createdAt).toLocaleString()}</p>)}{item.history.map((h, i) => <p key={`h${i}`}>{h.hidden ? '隐藏' : '恢复'}：{h.reason}</p>)}<button disabled={item.pool.deleted} onClick={() => { setId(item.pool.id); setHidden(!item.pool.hidden); }}>处理此作品池</button></details>)}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await moderateCommunityPool(id, key, hidden, reason); setReason(''); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>作品池 ID<input required value={id} onChange={e => setId(e.target.value)}/></label><label>处理理由<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><label className="community-check"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)}/>隐藏作品池（取消勾选为恢复）</label><button disabled={busy || !key}>保存处理结果</button>
    </form>
  </Dialog>;
}

export function AnimePoolsPage() {
  const { effectiveIdentity, room } = useGame();
  const navigate = useNavigate();const [params]=useSearchParams();const identityKey=privateIdentityKey();
  const [works, setWorks] = useState<AnimeWork[]>([]), [data, setData] = useState<CommunityPoolPage | null>(null);
  const [scope, setScope] = useState('public'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [deleting,setDeleting] = useState<CommunityPoolSummary|null>(null), [deleteBusy,setDeleteBusy] = useState(false), [deleteError,setDeleteError] = useState('');
  const deleteLock = useRef(false);
  const [editor, setEditor] = useState<CommunityPool | 'new' | null>('new'), [selected, setSelected] = useState<CommunityPool | null>(null);
  const [report, setReport] = useState<CommunityPoolSummary | null>(null), [reportReason, setReportReason] = useState(''), [admin, setAdmin] = useState(false);
  const reload = useCallback(async () => { const current = ++generation.current; setLoading(true); setError(''); try { const value = await listCommunityPools(scope, search, page); if (current === generation.current) setData(value); } catch (e) { if (current === generation.current) setError((e as Error).message); } finally { if (current === generation.current) setLoading(false); } }, [scope, search, page]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { getAnimeCatalog().then(value => setWorks(value.works)).catch(e => setError(e.message)); }, []);
  useEffect(()=>{setData(null);setSelected(null);setEditor('new');void reload();},[identityKey]);
  useEffect(()=>{let live=true;const id=params.get('pool');if(id)getCommunityPool(id).then(value=>{if(live&&privateIdentityKey()===identityKey)setSelected(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[params,identityKey]);
  const act = async (action: () => Promise<unknown>, success: string) => { setError(''); try { await action(); setNotice(success); await reload(); } catch (e) { setError((e as Error).message); } };
  const detail = async (pool: CommunityPoolSummary, edit = false) => { setError('');const key=privateIdentityKey(); try { const value = await getCommunityPool(pool.id);if(privateIdentityKey()!==key)return; edit ? setEditor(value) : setSelected(value); } catch (e) { if(privateIdentityKey()===key)setError((e as Error).message); } };
  return <div className="community-page"><header className="community-heading"><div><p className="eyebrow">词牌结社 / 动画作品池</p><h1>{editor?'发现动画，自由组池':scope==='mine'?'我的作品池':scope==='favorites'?'我的收藏':'同好题库广场'}</h1><p className="hint-text">把熟悉的作品留在一起，为下一场对局准备灵感。</p></div>{!editor&&<button className="primary-button" disabled={!data?.enabled || !works.length} onClick={() => setEditor('new')}>创建作品池</button>}</header>
    <div className="discovery-top-tabs" role="group" aria-label="作品池范围"><button aria-pressed={!!editor} onClick={()=>setEditor('new')}>动画发现</button>{[['public', '公开广场'], ['mine', '我的作品池'], ['favorites', '我的收藏']].map(([value, label]) => <button key={value} aria-pressed={!editor && scope === value} onClick={() => { setEditor(null);setScope(value); setPage(1); }}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!editor&&<><form className="community-search" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><label>搜索作品池<input maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="名称、介绍或作者署名"/></label><button>搜索</button></form>
    {data && !data.enabled && <p className="hint-text">社区发布暂未开放，已有作品池可继续查看。</p>}
    {loading && <p role="status">正在读取作品池…</p>}{!loading && data && !data.items.length && <p className="empty-text">{scope === 'mine' ? '还没有保存到此身份的作品池，可以新建或复制公开作品池。' : '暂无匹配的作品池。'}</p>}
    <div className="community-pool-grid">{data?.items.map(pool => <article className="community-pool-card" key={pool.id}><div className="community-pool-meta"><span>{pool.author}</span><span>{pool.hidden ? '管理员已隐藏' : pool.isPublic ? '公开' : '私人'}</span></div><h2>{pool.name}</h2><button className="community-pool-covers" aria-label={`查看 ${pool.name} 的作品`} onClick={() => void detail(pool)}>{pool.previewWorkIds.map(id => { const work = works.find(w => w.id === id); return work ? <Cover key={id} work={work}/> : null; })}</button><p>{pool.description || '作者还没有填写介绍。'}</p><p className="hint-text">{pool.workCount} 部作品 · {pool.seriesCount} 个系列 · {pool.seriesCount >= 36 ? '支持 6×6' : pool.seriesCount >= 25 ? '支持 5×5' : '待补充作品'}</p><div className="anime-toolbar"><button onClick={() => void detail(pool)}>查看作品</button>{pool.canEdit && <><button disabled={!data.enabled} onClick={() => void detail(pool, true)}>编辑</button><button className="danger-button" onClick={() => {setDeleting(pool);setDeleteError('');}}>删除</button></>}{!pool.hidden && <><button disabled={!data.enabled} onClick={() => void act(() => copyCommunityPool(pool.id), '已复制为你的私人作品池，可在“我的作品池”编辑。')}>复制到我的作品池</button><button disabled={!data.enabled} aria-pressed={pool.favorited} onClick={() => void act(() => favoriteCommunityPool(pool.id, !pool.favorited), pool.favorited ? '已取消收藏。' : '已收藏。')}>{pool.favorited ? '取消收藏' : '收藏'}</button></>}{pool.isPublic && !pool.hidden && <button onClick={() => { setReport(pool); setReportReason(''); }}>举报</button>}</div></article>)}</div>
    {data && data.total > 20 && <nav className="anime-toolbar" aria-label="作品池分页"><button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} / {Math.ceil(data.total / 20)} 页</span><button disabled={page * 20 >= data.total || loading} onClick={() => setPage(p => p + 1)}>下一页</button></nav>}
    </>}
    {editor && <AnimeDiscovery key={`${identityKey}:${editor==='new'?'new':editor.id+':'+editor.revision}`} pool={editor==='new'?undefined:editor} works={works} author={effectiveIdentity?.nickname??'同好'} onWorks={values=>setWorks(previous=>[...new Map([...previous,...values].map(w=>[w.id,w])).values()])} saved={value=>{setEditor(value);setNotice('作品池已保存。');void reload();}} reloaded={setEditor}/>}
    <PrivateIdentityTools restored={() => { setSelected(null); setEditor(null); void reload(); }}/><button onClick={() => setAdmin(true)}>社区管理</button>
    {selected && <Dialog title={selected.name} close={() => setSelected(null)} wide><p>{selected.description}</p><p className="hint-text">作品池 ID：{selected.id}</p><button disabled={selected.hidden || selected.seriesCount < 25} onClick={() => { localStorage.setItem('cipai-selected-community-pool', selected.id); if (room) navigate(`/room/${room.id}`); else navigate('/?create=1&variant=anime'); }}>带回房间选择</button><p className="hint-text">返回后由房主选择此池，点击“保存并更新候选池”才会生效；进行中的牌局保持原样。</p><div className="community-work-grid">{works.filter(w => selected.workIds.includes(w.id)).map(w => <article key={w.id}><div className="community-cover"><Cover work={w}/></div><span>{w.title}</span><a href={`https://bgm.tv/subject/${w.id}`} target="_blank" rel="noopener noreferrer">Bangumi</a></article>)}</div></Dialog>}
    {deleting && <Dialog title="删除作品池" close={() => {if(!deleteBusy)setDeleting(null);}}><p>确定删除「{deleting.name}」吗？{deleting.isPublic?'此公开作品池将从广场移除，其他人的收藏会一并清理。':''}</p><p className="hint-text">正在进行的对局及回放保留原作品快照，Bangumi 目录保持可用。删除后立即释放作品池额度。</p>{deleteError&&<p role="alert">{deleteError}</p>}<div className="anime-toolbar"><button disabled={deleteBusy} onClick={()=>setDeleting(null)}>取消</button><button className="danger-button" disabled={deleteBusy} onClick={async()=>{
      if(deleteLock.current)return;deleteLock.current=true;setDeleteBusy(true);setDeleteError('');const key=privateIdentityKey();
      try{await deleteCommunityPool(deleting.id);if(privateIdentityKey()!==key)return;
        localStorage.removeItem(`cipai.pool-draft:${key}:${deleting.id}`);
        if(localStorage.getItem('cipai-selected-community-pool')===deleting.id)localStorage.removeItem('cipai-selected-community-pool');
        if(selected?.id===deleting.id)setSelected(null);if(editor!=='new'&&editor?.id===deleting.id)setEditor(null);
        setDeleting(null);setNotice(`已删除「${deleting.name}」，作品池额度已释放。`);await reload();
      }catch(e){if(privateIdentityKey()===key)setDeleteError((e as Error).message);}finally{deleteLock.current=false;setDeleteBusy(false);}
    }}>{deleteBusy?'删除中…':'确认删除'}</button></div></Dialog>}
    {report && <Dialog title="举报作品池" close={() => setReport(null)}><form onSubmit={async e => { e.preventDefault(); try { await reportCommunityPool(report.id, reportReason); setReport(null); setNotice('举报已提交。'); } catch (e) { setError((e as Error).message); } }}><p>{report.name}</p>{error && <p role="alert">{error}</p>}<label>举报原因<textarea required maxLength={500} value={reportReason} onChange={e => setReportReason(e.target.value)}/></label><button>提交举报</button></form></Dialog>}
    {admin && <Moderation close={() => { setAdmin(false); void reload(); }}/>}
  </div>;
}
