import { AnimeDiscovery } from '../components/AnimeDiscovery';
import { privateIdentityKey } from '../lib/private-identity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { animeWorkLink, type AnimeWork, type CommunityPool, type CommunityPoolPage, type CommunityPoolSummary, type PoolModerationItem } from '@acg-codenames/shared';
import { useGame } from '../context/GameContext';
import { deleteCommunityPool, copyCommunityPool, favoriteCommunityPool, getAnimeCatalog, getCommunityPool, getPoolModeration, listCommunityPools, moderateCommunityPool, reportCommunityPool, saveCommunityPool } from '../lib/api';
import { Dialog } from '../components/UI';
import { Cover, Preview } from '../components/AnimeBoard';
import '../community.css';

const ADMIN_SESSION_KEY = 'cipai.anime-admin';

function Moderation({ close, onAuthorized }: { close: () => void; onAuthorized: () => void }) {
  const [key, setKey] = useState(''), [items, setItems] = useState<PoolModerationItem[]>([]), [error, setError] = useState('');
  const [id, setId] = useState(''), [reason, setReason] = useState(''), [hidden, setHidden] = useState(true), [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError('');
    try {
      setItems((await getPoolModeration(key)).items);
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, '1'); } catch { /* session storage is optional */ }
      onAuthorized();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog title="作品池社区管理" close={close} wide><p className="hint-text">使用服务端配置的管理员凭证处理举报；凭证只保留在本次窗口中。普通用户看不到此入口，服务端仍逐次鉴权。</p>
    <form onSubmit={e => { e.preventDefault(); void load(); }}><label>管理员凭证<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label><button disabled={busy || !key}>读取待处理举报</button></form>
    {error && <p role="alert" className="error-text">{error}</p>}
    {items.map(item => <details key={item.pool.id} className="moderation-item"><summary>{item.pool.name} · {item.pool.deleted ? '已删除 · 审计保留' : item.pool.hidden ? '已隐藏' : '公开'} · {item.reports.length} 条举报</summary><p>{item.pool.description}</p>{item.reports.map((r, i) => <p key={i}>{r.reason} · {new Date(r.createdAt).toLocaleString()}</p>)}{item.history.map((h, i) => <p key={`h${i}`}>{h.hidden ? '隐藏' : '恢复'}：{h.reason}</p>)}<button disabled={item.pool.deleted} onClick={() => { setId(item.pool.id); setHidden(!item.pool.hidden); }}>处理此作品池</button></details>)}
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await moderateCommunityPool(id, key, hidden, reason); setReason(''); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>作品池 ID<input required value={id} onChange={e => setId(e.target.value)} /></label><label>处理理由<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><label className="community-check"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />隐藏作品池（取消勾选为恢复）</label><button disabled={busy || !key}>保存处理结果</button>
    </form>
  </Dialog>;
}

export function AnimePoolsPage() {
  const { effectiveIdentity, room } = useGame();
  const navigate = useNavigate(); const [params] = useSearchParams(); const identityKey = privateIdentityKey();
  const [works, setWorks] = useState<AnimeWork[]>([]), [data, setData] = useState<CommunityPoolPage | null>(null);
  const [scope, setScope] = useState('public'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [deleting, setDeleting] = useState<CommunityPoolSummary | null>(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState('');
  const deleteLock = useRef(false);
  const [editor, setEditor] = useState<CommunityPool | 'new' | null>(null), [selected, setSelected] = useState<CommunityPool | null>(null);
  const [preview, setPreview] = useState<AnimeWork | null>(null);
  const [report, setReport] = useState<CommunityPoolSummary | null>(null), [reportReason, setReportReason] = useState('');
  const [admin, setAdmin] = useState(false);
  const [adminEnabled, setAdminEnabled] = useState(() => params.get('admin') === '1' || (() => { try { return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1'; } catch { return false; } })());
  const [busyPool, setBusyPool] = useState('');
  const reload = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError('');
    try { const value = await listCommunityPools(scope, search, page); if (current === generation.current) setData(value); }
    catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { if (current === generation.current) setLoading(false); }
  }, [scope, search, page]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { getAnimeCatalog().then(value => setWorks(value.works)).catch(e => setError(e.message)); }, []);
  useEffect(() => { setData(null); setSelected(null); setEditor(null); void reload(); }, [identityKey]);
  useEffect(() => {
    let live = true; const id = params.get('pool');
    if (id) getCommunityPool(id).then(value => { if (live && privateIdentityKey() === identityKey) setSelected(value); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [params, identityKey]);
  const workMap = useMemo(() => new Map(works.map(work => [work.id, work])), [works]);
  const act = async (id: string, action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice(''); setBusyPool(id);
    try { await action(); setNotice(success); await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyPool(''); }
  };
  const detail = async (pool: CommunityPoolSummary, edit = false) => {
    setError(''); const key = privateIdentityKey();
    try { const value = await getCommunityPool(pool.id); if (privateIdentityKey() !== key) return; edit ? setEditor(value) : setSelected(value); }
    catch (e) { if (privateIdentityKey() === key) setError((e as Error).message); }
  };
  const activePool = editor === 'new' ? null : editor;

  return <div className="community-page">
    <header className="community-heading">
      <div><p className="eyebrow">ANIME COLLECTIONS</p><h1>{activePool ? '发现动画，自由组池' : scope === 'mine' ? '我的作品池' : scope === 'favorites' ? '我的收藏' : '动画作品池'}</h1><p className="hint-text">把熟悉的作品留在一起，为下一场对局准备灵感。</p></div>
      <div className="anime-toolbar">
        {adminEnabled && <button onClick={() => setAdmin(true)}>社区管理</button>}
        {!editor && <button className="primary-button" disabled={!data?.enabled || !works.length} onClick={() => setEditor('new')}>＋ 创建作品池</button>}
      </div>
    </header>
    <div className="discovery-top-tabs" role="group" aria-label="作品池范围">
      <button aria-pressed={!!editor} onClick={() => setEditor('new')}>动画发现与手动新增</button>
      {[['public', '公开广场'], ['mine', '我的作品池'], ['favorites', '我的收藏']].map(([value, label]) => <button key={value} aria-pressed={!editor && scope === value} onClick={() => { setEditor(null); setScope(value); setPage(1); }}>{label}</button>)}
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {notice && <p role="status" className="community-notice">{notice}</p>}
    {!editor && <>
      <div className="community-toolbar">
        <form className="community-search" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}>
          <label>搜索作品池<input maxLength={100} value={query} onChange={e => setQuery(e.target.value)} placeholder="名称、介绍或作者署名" /></label>
          <button>搜索</button>
        </form>
        <span className="hint-text">{loading ? '正在读取作品池…' : data ? `共 ${data.total} 个作品池` : ''}</span>
      </div>
      {data && !data.enabled && <p className="hint-text">社区发布暂未开放，已有作品池可继续查看。</p>}
      {!loading && data && !data.items.length && <div className="community-empty"><strong>{scope === 'mine' ? '还没有保存到此身份的作品池' : '暂无匹配的作品池'}</strong><p>{scope === 'mine' ? '可以新建，或从公开广场复制一个作品池。' : '试试其他关键词，或切换到“我的作品池”。'}</p></div>}
      <div className="community-pool-grid">
        {data?.items.map(pool => {
          const covers = pool.previewWorkIds.map(id => workMap.get(id)).filter((work): work is AnimeWork => !!work);
          return <article className="community-pool-card" key={pool.id} data-pool-id={pool.id}>
            <button className="community-cover-strip" aria-label={`查看 ${pool.name} 的作品`} onClick={() => void detail(pool)}>
              {covers.length ? covers.map((work, index) => <span key={work.id} className={`cover-slot slot-${index}`}><Cover work={work} /></span>) : <span className="cover-slot empty-cover">暂无封面</span>}
            </button>
            <div className="community-pool-head">
              <div><h2>{pool.name}</h2><p className="community-pool-byline">{pool.author}{pool.canEdit ? ' · 我创建的' : pool.favorited ? ' · 已收藏' : ''}</p></div>
              <details className="pool-more">
                <summary aria-label="更多操作">···</summary>
                <div className="pool-more-menu">
                  {pool.canEdit ? <>
                    <button disabled={!data?.enabled} onClick={() => void detail(pool, true)}>编辑作品池</button>
                    <button disabled={!data?.enabled} onClick={() => void act(pool.id, () => copyCommunityPool(pool.id), '已复制独立选片清单；Bangumi 与公共自建作品资料仍引用共享目录，原作者更新会同步。')}>复制副本</button>
                    <button className="danger-button" onClick={() => { setDeleting(pool); setDeleteError(''); }}>删除作品池</button>
                  </> : <>
                    {!pool.hidden && <button disabled={!data?.enabled} aria-pressed={pool.favorited} onClick={() => void act(pool.id, () => favoriteCommunityPool(pool.id, !pool.favorited), pool.favorited ? '已取消收藏。' : '已收藏。')}>{pool.favorited ? '取消收藏' : '收藏'}</button>}
                    <button disabled={!data?.enabled} onClick={() => void act(pool.id, () => copyCommunityPool(pool.id), '已复制独立选片清单，可在“我的作品池”编辑；公共作品资料仍引用共享目录。')}>复制到我的作品池</button>
                    {pool.isPublic && !pool.hidden && <button onClick={() => { setReport(pool); setReportReason(''); }}>举报</button>}
                  </>}
                </div>
              </details>
            </div>
            {pool.description && <p className="community-pool-desc">{pool.description}</p>}
            <p className="community-pool-meta"><span>{pool.workCount} 部作品 · {pool.seriesCount} 个系列</span><span className={`pool-support ${pool.seriesCount >= 36 ? 'ready-6' : pool.seriesCount >= 25 ? 'ready-5' : ''}`}>{pool.hidden ? '管理员已隐藏' : pool.seriesCount >= 36 ? '支持 6×6' : pool.seriesCount >= 25 ? '支持 5×5' : '待补充系列'}</span></p>
            <div className="community-pool-actions">
              <button className="primary-button" disabled={busyPool === pool.id} onClick={() => void detail(pool)}>查看作品池</button>
              <button disabled={pool.hidden || pool.seriesCount < 25} onClick={() => { try { localStorage.setItem(`cipai-selected-community-pool:${identityKey}:${room?.id ?? ''}`, pool.id); } catch {} if (room) navigate(`/room/${room.id}`); else navigate('/?create=1&variant=anime'); }}>用于房间</button>
            </div>
          </article>;
        })}
      </div>
      {data && data.total > 20 && <nav className="anime-toolbar community-pagination" aria-label="作品池分页"><button disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} / {Math.ceil(data.total / 20)} 页</span><button disabled={page * 20 >= data.total || loading} onClick={() => setPage(p => p + 1)}>下一页</button></nav>}
      <p className="note">卡片只突出作品封面与主要入口。编辑、删除、举报等动作收进「···」；所有操作仍由服务端按身份鉴权。复制作品池复制的是独立选片清单，作品元数据仍引用共享目录。</p>
    </>}
    {editor && <AnimeDiscovery key={`${identityKey}:${editor === 'new' ? 'new' : `${editor.id}:${editor.revision}`}`} pool={activePool ?? undefined} works={works} author={effectiveIdentity?.nickname ?? '同好'} onWorks={values => setWorks(previous => [...new Map([...previous, ...values].map(w => [w.id, w])).values()])} saved={value => { setEditor(value); setNotice('作品池已保存。'); void reload(); }} reloaded={setEditor} />}
    {selected && <Dialog title={selected.name} close={() => setSelected(null)} wide>
      {selected.description && <p>{selected.description}</p>}
      <p className="hint-text">{selected.workCount} 部作品 · {selected.seriesCount} 个系列 · 作品池 ID：{selected.id}</p>
      <div className="anime-toolbar"><button disabled={selected.hidden || selected.seriesCount < 25} onClick={() => { try { localStorage.setItem(`cipai-selected-community-pool:${identityKey}:${room?.id ?? ''}`, selected.id); } catch {} if (room) navigate(`/room/${room.id}`); else navigate('/?create=1&variant=anime'); }}>带回房间选择</button>{selected.canEdit && <button onClick={() => { setEditor(selected); setSelected(null); }}>编辑</button>}</div>
      <p className="hint-text">返回后由房主选择此池，点击“保存配置并更新候选池”才会生效；进行中的牌局保持原样。复制此池只复制独立选片清单，Bangumi 与公共自建作品的资料仍引用共享目录。</p>
      <div className="community-work-grid">{selected.workIds.map(id => workMap.get(id)).filter((work): work is AnimeWork => !!work).map(work => <article key={work.id}><button className="community-cover" aria-label={`预览 ${work.title}`} onClick={() => setPreview(work)}><Cover work={work} /></button><span>{work.title}</span>{animeWorkLink(work) ? <a href={animeWorkLink(work)!} target="_blank" rel="noopener noreferrer">Bangumi</a> : <em className="manual-tag">自建</em>}</article>)}</div>
    </Dialog>}
    {preview && <Preview work={preview} close={() => setPreview(null)} />}
    {deleting && <Dialog title="删除作品池" close={() => { if (!deleteBusy) setDeleting(null); }}>
      <p>确定删除「{deleting.name}」吗？{deleting.isPublic ? '此公开作品池将从广场移除，其他人的收藏会一并清理。' : ''}</p>
      <p className="hint-text">正在进行的对局及回放保留原作品快照，Bangumi 目录与已复制的作品池不受影响。删除后立即释放作品池额度。</p>
      {deleteError && <p role="alert" className="error-text">{deleteError}</p>}
      <div className="anime-toolbar"><button disabled={deleteBusy} onClick={() => setDeleting(null)}>取消</button><button className="danger-button" disabled={deleteBusy} onClick={async () => {
        if (deleteLock.current) return; deleteLock.current = true; setDeleteBusy(true); setDeleteError(''); const key = privateIdentityKey();
        try {
          await deleteCommunityPool(deleting.id); if (privateIdentityKey() !== key) return;
          localStorage.removeItem(`cipai.pool-draft:${key}:${deleting.id}`);
          for (const storageKey of Object.keys(localStorage)) if (storageKey.startsWith('cipai-selected-community-pool') && localStorage.getItem(storageKey) === deleting.id) localStorage.removeItem(storageKey);
          if (selected?.id === deleting.id) setSelected(null); if (activePool?.id === deleting.id) setEditor(null);
          setDeleting(null); setNotice(`已删除「${deleting.name}」，作品池额度已释放。`); await reload();
        } catch (e) { if (privateIdentityKey() === key) setDeleteError((e as Error).message); } finally { deleteLock.current = false; setDeleteBusy(false); }
      }}>{deleteBusy ? '删除中…' : '确认删除'}</button></div>
    </Dialog>}
    {report && <Dialog title="举报作品池" close={() => setReport(null)}><form onSubmit={async e => { e.preventDefault(); try { await reportCommunityPool(report.id, reportReason); setReport(null); setNotice('举报已提交。'); } catch (e) { setError((e as Error).message); } }}><p>{report.name}</p>{error && <p role="alert" className="error-text">{error}</p>}<label>举报原因<textarea required maxLength={500} value={reportReason} onChange={e => setReportReason(e.target.value)} /></label><button>提交举报</button></form></Dialog>}
    {admin && <Moderation close={() => { setAdmin(false); void reload(); }} onAuthorized={() => setAdminEnabled(true)} />}
  </div>;
}
