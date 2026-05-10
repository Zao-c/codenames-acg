import { useState } from "react";
import { useGame } from "../context/GameContext";
import { CandidateReview } from "../lib/CandidateReview";

export function PacksPage() {
  const {
    namedAccount, accountPacks,
    savedPackName, setSavedPackName,
    savedPackEntries, setSavedPackEntries,
    publicPacks, error, setError,
    addAccountPack, importAccountPack, removeAccountPack, toggleAccountPackPublic,
    candidatePack, setCandidatePack,
    updateCandidateEntry, bulkSetVisibleEntries, exportCandidateAsPlayable,
    createRoom, setPackSource, setSelectedPublicPackId, setSelectedAccountPackId, chooseAccountPackForCreate,
    makePublicPackKey
  } = useGame();
  const [tab, setTab] = useState<"mine" | "public" | "import">("mine");

  if (candidatePack) {
    return (
      <>
        {error ? <p className="error-text">{error}</p> : null}
        <CandidateReview
          pack={candidatePack}
          onClose={() => { setCandidatePack(null); setError(""); }}
          onUpdateEntry={updateCandidateEntry}
          onBulkSetVisible={bulkSetVisibleEntries}
          onExport={(filters) => { void exportCandidateAsPlayable(filters); }}
        />
      </>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">Packs</p>
            <h2>词牌档案库</h2>
          </div>
        </div>
        <div className="selection-grid">
          <button className={tab === "mine" ? "selected" : ""} onClick={() => setTab("mine")}>我的词牌库</button>
          <button className={tab === "public" ? "selected" : ""} onClick={() => setTab("public")}>公开档案库</button>
          <button className={tab === "import" ? "selected" : ""} onClick={() => setTab("import")}>上传 / 导入</button>
        </div>
      </section>

      {tab === "mine" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">My packs</p>
              <h2>我的词牌库</h2>
            </div>
            <span className="soft-chip">{accountPacks.length} 个</span>
          </div>
          {namedAccount ? (
            <div className="pack-library">
              {accountPacks.length === 0 ? <p className="empty-text">还没有个人词牌。</p> : null}
              {accountPacks.map((pack) => (
                <div className="pack-card" key={pack.id}>
                  <div>
                    <strong>{pack.name}</strong>
                    <p className="pack-card-meta">{pack.entries.length} 个词 / {pack.isPublic ? "已公开" : "仅自己可用"}</p>
                  </div>
                  <div className="pack-card-actions">
                    <button onClick={() => { chooseAccountPackForCreate(pack.id); }}>用于密令房</button>
                    <button onClick={() => { void toggleAccountPackPublic(pack.id); }}>{pack.isPublic ? "取消公开" : "公开"}</button>
                    <button onClick={() => { void removeAccountPack(pack.id); }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint-text">先使用用户名登录，再管理你的自定义词牌。</p>
          )}
        </section>
      ) : tab === "public" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">Public packs</p>
              <h2>公开档案库</h2>
            </div>
            <span className="soft-chip">{publicPacks.length} 个</span>
          </div>
          <div className="pack-library">
            {publicPacks.length === 0 ? <p className="empty-text">还没有公开档案。</p> : null}
            {publicPacks.map((pack) => (
              <div className="pack-card" key={makePublicPackKey(pack)}>
                <div>
                  <strong>{pack.name}</strong>
                  <p className="pack-card-meta">{pack.entries.length} 个词 / {pack.ownerUsername}</p>
                </div>
                <div className="pack-card-actions">
                  <button onClick={() => { setSelectedPublicPackId(makePublicPackKey(pack)); setPackSource("public"); }}>用于密令房</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">Import</p>
              <h2>上传 / 导入词牌</h2>
            </div>
          </div>
          {namedAccount ? (
            <>
              <input value={savedPackName} onChange={(e) => setSavedPackName(e.target.value)} placeholder="词牌名称" />
              <textarea value={savedPackEntries} onChange={(e) => setSavedPackEntries(e.target.value)} placeholder="每行一个词，至少 25 行" />
              <div className="toolbar-inline compact-stack">
                <button onClick={() => { void addAccountPack(); }}>保存词牌</button>
                <input type="file" accept=".txt,.json" onChange={(e) => { void importAccountPack(e.target.files?.[0] ?? null); }} />
              </div>
            </>
          ) : (
            <p className="hint-text">先使用用户名登录，再上传自定义词牌。</p>
          )}
        </section>
      )}

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
