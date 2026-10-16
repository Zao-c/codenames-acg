import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AnimeWork, CommunityPool, CommunityPoolPage, CommunityPoolSummary, PoolModerationItem } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { copyCommunityPool, favoriteCommunityPool, getAnimeCatalog, getCommunityPool, getPoolModeration, listCommunityPools, moderateCommunityPool, reportCommunityPool, saveCommunityPool } from '../lib/api';
import { Dialog } from '../components/UI';
import { Cover, Preview } from '../components/AnimeBoard';
import { PrivateIdentityTools } from '../components/PrivateIdentityTools';
import '../community.css';

function PoolEditor({ pool, works, author, close, saved }: { pool?: CommunityPool; works: AnimeWork[]; author: string; close: () => void; saved: () => void }) {
  const [name, setName] = useState(pool?.name ?? ''), [description, setDescription] = useState(pool?.description ?? ''), [signature, setSignature] = useState(pool?.author ?? author);
  const [ids, setIds] = useState(new Set(pool?.workIds ?? [])), [isPublic, setPublic] = useState(pool?.isPublic ?? false);
  const [query, setQuery] = useState(''), [onlySelected, setSelected] = useState(false), [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<AnimeWork | null>(null);
  const [legacy] = useState<Array<{ name: string; workIds: number[] }>>(() => { try { const values = JSON.parse(localStorage.getItem(`anime-pools:${author}`) ?? '[]'); return Array.isArray(values) ? values.filter(v => typeof v?.name === 'string' && Array.isArray(v?.workIds)) : []; } catch { return []; } });
  const visible = useMemo(() => works.filter(w => (!onlySelected || ids.has(w.id)) && `${w.fullTitle} ${w.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [works, query, ids, onlySelected]);
  const series = new Set(works.filter(w => ids.has(w.id)).map(w => w.seriesId)).size;
  const save = async () => {
    setBusy(true); setError('');
    try { await saveCommunityPool({ name, description, author: signature, workIds: [...ids], isPublic, expectedRevision: pool?.revision }, pool?.id); saved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog title={pool ? '编辑动画作品池' : '创建动画作品池'} close={close} wide>
    {error && <p role="alert">{error}</p>}
    <form className="pool-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="pool-editor-fields"><label>作品池名称<input required maxLength={64} value={name} onChange={e => setName(e.target.value)}/></label><label>作者署名<input required maxLength={24} value={signature} onChange={e => setSignature(e.target.value)}/></label></div>
      <label>介绍<textarea maxLength={500} value={description} onChange={e => setDescription(e.target.value)}/></label>
      <label className="community-check"><input type="checkbox" checked={isPublic} onChange={e => setPublic(e.target.checked)}/>发布到公开广场</label>
      {pool?.hidden && <p className="hint-text">此池已被管理员隐藏。修改内容后仍保持隐藏状态，需管理员复核。</p>}
      {!pool && !!legacy.length && <label>从本机原作品池导入<select defaultValue="" onChange={e => { const value = legacy[Number(e.target.value)]; if (value) { setName(value.name); setIds(new Set(value.workIds)); } }}><option value="" disabled>选择要导入的作品池</option>{legacy.map((v, i) => <option key={i} value={i}>{v.name}（{v.workIds.length} 部）</option>)}</select></label>}
      <div className="anime-toolbar"><label>搜索作品<input value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }}/></label><label className="community-check"><input type="checkbox" checked={onlySelected} onChange={e => { setSelected(e.target.checked); setLimit(60); }}/>只看已选</label></div>
      <p className="hint-text" role="status">已选 {ids.size} 部 · {series} 个不同系列 · {series >= 36 ? '支持 5×5 / 6×6' : series >= 25 ? '支持 5×5，6×6 还需更多系列' : '开局至少需要 25 个不同系列，可先保存草稿'}</p>
      <div className="community-work-grid">{visible.slice(0, limit).map(w => <article key={w.id}><button type="button" className="community-cover" aria-label={`预览 ${w.title}`} onClick={() => setPreview(w)}><Cover work={w}/></button><label><input type="checkbox" checked={ids.has(w.id)} onChange={e => setIds(previous => { const next = new Set(previous); e.target.checked ? next.add(w.id) : next.delete(w.id); return next; })}/>{w.title}</label></article>)}</div>
      {visible.length > limit && <button type="button" onClick={() => setLimit(v => v + 60)}>显示更多作品</button>}
      <button className="primary-button" disabled={busy || !works.length}>{busy ? '保存中…' : '保存作品池'}</button>
    </form>{preview && <Preview work={preview} close={() => setPreview(null)}/>}
  </Dialog>;
}

function Moderation({ close }: { close: () => void }) {
  const [key, setKey] = useState(''), [items, setItems] = useState<PoolModerationItem[]>([]), [error, setError] = useState('');
  const [id, setId] = useState(''), [reason, setReason] = useState(''), [hidden, setHidden] = useState(true), [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); setError(''); try { setItems((await getPoolModeration(key)).items); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Dialog title="作品池社区管理" close={close} wide><p className="hint-text">使用服务端配置的管理员凭证处理举报；凭证只保留在本次窗口中。</p>
    <form onSubmit={e => { e.preventDefault(); void load(); }}><label>管理员凭证<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label><button disabled={busy || !key}>读取待处理举报</button></form>
    {error && <p role="alert">{error}</p>}
    {items.map(item => <details key={item.pool.id}><summary>{item.pool.name} · {item.pool.hidden ? '已隐藏' : '公开'} · {item.reports.length} 条举报</summary><p>{item.pool.description}</p>{item.reports.map((r, i) => <p key={i}>{r.reason} · {new Date(r.createdAt).toLocaleString()}</p>)}{item.history.map((h, i) => <p key={`h${i}`}>{h.hidden ? '隐藏' : '恢复'}：{h.reason}</p>)}<button onClick={() => { setId(item.pool.id); setHidden(!item.pool.hidden); }}>处理此作品池</button></details>)}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await moderateCommunityPool(id, key, hidden, reason); setReason(''); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>作品池 ID<input required value={id} onChange={e => setId(e.target.value)}/></label><label>处理理由<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><label className="community-check"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)}/>隐藏作品池（取消勾选为恢复）</label><button disabled={busy || !key}>保存处理结果</button>
    </form>
  </Dialog>;
}

export function AnimePoolsPage() {
  const { effectiveIdentity, room } = useGame();
  const navigate = useNavigate();
  const [works, setWorks] = useState<AnimeWork[]>([]), [data, setData] = useState<CommunityPoolPage | null>(null);
  const [scope, setScope] = useState('public'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [editor, setEditor] = useState<CommunityPool | 'new' | null>(null), [selected, setSelected] = useState<CommunityPool | null>(null);
  const [report, setReport] = useState<CommunityPoolSummary | null>(null), [reportReason, setReportReason] = useState(''), [admin, setAdmin] = useState(false);
  const reload = useCallback(async () => { const current = ++generation.current; setLoading(true); setError(''); try { const value = await listCommunityPools(scope, search, page); if (current === generation.current) setData(value); } catch (e) { if (current === generation.current) setError((e as Error).message); } finally { if (current === generation.current) setLoading(false); } }, [scope, search, page]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { getAnimeCatalog().then(value => setWorks(value.works)).catch(e => setError(e.message)); }, []);
  const act = async (action: () => Promise<unknown>, success: string) => { setError(''); try { await action(); setNotice(success); await reload(); } catch (e) { setError((e as Error).message); } };
  const detail = async (pool: CommunityPoolSummary, edit = false) => { setError(''); try { const value = await getCommunityPool(pool.id); edit ? setEditor(value) : setSelected(value); } catch (e) { setError((e as Error).message); } };
  return <div className="community-page"><header className="community-heading"><div><p className="eyebrow">词牌结社 / 动画作品池</p><h1>同好题库广场</h1><p className="hint-text">把熟悉的作品留在一起，为下一场对局准备灵感。</p></div><button className="primary-button" disabled={!data?.enabled || !works.length} onClick={() => setEditor('new')}>创建作品池</button></header>
    <div className="anime-toolbar" role="group" aria-label="作品池范围">{[['public', '公开广场'], ['mine', '我的作品池'], ['favorites', '我的收藏']].map(([value, label]) => <button key={value} aria-pressed={scope === value} onClick={() => { setScope(value); setPage(1); }}>{label}</button>)}<button onClick={() => navigate('/packs')}>文字题库</button><button onClick={() => navigate('/gallery')}>图片图库</button></div>
    <form className="community-search" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><label>搜索作品池<input maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="名称、介绍或作者署名"/></label><button>搜索</button></form>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{data && !data.enabled && <p className="hint-text">社区发布暂未开放，已有作品池可继续查看。</p>}
    {loading && <p role="status">正在读取作品池…</p>}{!loading && data && !data.items.length && <p className="empty-text">{scope === 'mine' ? '还没有保存到此身份的作品池，可以新建或复制公开作品池。' : '暂无匹配的作品池。'}</p>}
    <div className="community-pool-grid">{data?.items.map(pool => <article className="community-pool-card" key={pool.id}><div className="community-pool-meta"><span>{pool.author}</span><span>{pool.hidden ? '管理员已隐藏' : pool.isPublic ? '公开' : '私人'}</span></div><h2>{pool.name}</h2><button className="community-pool-covers" aria-label={`查看 ${pool.name} 的作品`} onClick={() => void detail(pool)}>{pool.previewWorkIds.map(id => { const work = works.find(w => w.id === id); return work ? <Cover key={id} work={work}/> : null; })}</button><p>{pool.description || '作者还没有填写介绍。'}</p><p className="hint-text">{pool.workCount} 部作品 · {pool.seriesCount} 个系列 · {pool.seriesCount >= 36 ? '支持 6×6' : pool.seriesCount >= 25 ? '支持 5×5' : '待补充作品'}</p><div className="anime-toolbar"><button onClick={() => void detail(pool)}>查看作品</button>{pool.canEdit && <button disabled={!data.enabled} onClick={() => void detail(pool, true)}>编辑</button>}{!pool.hidden && <><button disabled={!data.enabled} onClick={() => void act(() => copyCommunityPool(pool.id), '已复制为你的私人作品池，可在“我的作品池”编辑。')}>复制到我的作品池</button><button disabled={!data.enabled} aria-pressed={pool.favorited} onClick={() => void act(() => favoriteCommunityPool(pool.id, !pool.favorited), pool.favorited ? '已取消收藏。' : '已收藏。')}>{pool.favorited ? '取消收藏' : '收藏'}</button></>}{pool.isPublic && !pool.hidden && <button onClick={() => { setReport(pool); setReportReason(''); }}>举报</button>}</div></article>)}</div>
    {data && data.total > 20 && <nav className="anime-toolbar" aria-label="作品池分页"><button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} / {Math.ceil(data.total / 20)} 页</span><button disabled={page * 20 >= data.total || loading} onClick={() => setPage(p => p + 1)}>下一页</button></nav>}
    <PrivateIdentityTools restored={() => { setSelected(null); setEditor(null); void reload(); }}/><button onClick={() => setAdmin(true)}>社区管理</button>
    {editor && <PoolEditor pool={editor === 'new' ? undefined : editor} works={works} author={effectiveIdentity?.nickname ?? '同好'} close={() => setEditor(null)} saved={() => { setEditor(null); setNotice('作品池已保存。'); void reload(); }}/>}
    {selected && <Dialog title={selected.name} close={() => setSelected(null)} wide><p>{selected.description}</p><p className="hint-text">作品池 ID：{selected.id}</p><button disabled={selected.hidden || selected.seriesCount < 25} onClick={() => { localStorage.setItem('cipai-selected-community-pool', selected.id); if (room) navigate(`/room/${room.id}`); else { setNotice('已记住作品池，创建或进入房间后可在下一局配置中使用。'); setSelected(null); } }}>用于下一局配置</button><div className="community-work-grid">{works.filter(w => selected.workIds.includes(w.id)).map(w => <article key={w.id}><div className="community-cover"><Cover work={w}/></div><span>{w.title}</span><a href={`https://bgm.tv/subject/${w.id}`} target="_blank" rel="noopener noreferrer">Bangumi</a></article>)}</div></Dialog>}
    {report && <Dialog title="举报作品池" close={() => setReport(null)}><form onSubmit={async e => { e.preventDefault(); try { await reportCommunityPool(report.id, reportReason); setReport(null); setNotice('举报已提交。'); } catch (e) { setError((e as Error).message); } }}><p>{report.name}</p>{error && <p role="alert">{error}</p>}<label>举报原因<textarea required maxLength={500} value={reportReason} onChange={e => setReportReason(e.target.value)}/></label><button>提交举报</button></form></Dialog>}
    {admin && <Moderation close={() => { setAdmin(false); void reload(); }}/>}
  </div>;
}
