import { useState } from "react";
import { useGame } from "../context/GameContext";
import { CandidateReview } from "../lib/CandidateReview";
import type { SavedWordPack, PublicWordPack } from "@acg-codenames/shared";

export function PacksPage() {
  const {
    namedAccount, accountPacks,
    savedPackName, setSavedPackName,
    savedPackEntries, setSavedPackEntries,
    publicPacks, error, setError,
    addAccountPack, importAccountPack, removeAccountPack, toggleAccountPackPublic,
    candidatePack, setCandidatePack,
    updateCandidateEntry, bulkSetVisibleEntries, exportCandidateAsPlayable,
    setPackSource, setSelectedPublicPackId, setSelectedAccountPackId, chooseAccountPackForCreate,
    makePublicPackKey
  } = useGame();
  const [tab, setTab] = useState<"mine" | "public" | "import">("mine");
  const [search, setSearch] = useState("");
  const [modalPack, setModalPack] = useState<SavedWordPack | PublicWordPack | null>(null);

  const filter = (name: string) => name.toLowerCase().includes(search.toLowerCase());

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
          <h2>题库</h2>
        </div>
        <div className="selection-grid" style={{ marginBottom: 16 }}>
          <button className={tab === "mine" ? "selected" : ""} onClick={() => { setTab("mine"); setSearch(""); }}>我的题库</button>
          <button className={tab === "public" ? "selected" : ""} onClick={() => { setTab("public"); setSearch(""); }}>公共题库</button>
          <button className={tab === "import" ? "selected" : ""} onClick={() => setTab("import")}>上传</button>
        </div>

        {tab !== "import" ? (
          <div className="pack-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索题库..."
            />
          </div>
        ) : null}
      </section>

      {tab === "mine" ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>我的题库</h2>
            <span className="soft-chip">{accountPacks.length} 个</span>
          </div>
          {namedAccount ? (
            accountPacks.length === 0 ? (
              <p className="empty-text">还没有个人题库，来「上传」页导入吧。</p>
            ) : (
              <div className="pack-list">
                {accountPacks.filter(p => filter(p.name)).map((pack) => (
                  <div className="pack-row" key={pack.id}>
                    <div className="pack-row-info">
                      <strong>{pack.name}</strong>
                      <div className="pack-row-meta">{pack.entries.length} 个词 / {pack.isPublic ? "已公开" : "仅自己可用"}</div>
                    </div>
                    <div className="pack-row-actions">
                      <button onClick={() => { chooseAccountPackForCreate(pack.id); }}>用于开房</button>
                      <button onClick={() => setModalPack(pack)}>详情</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="hint-text">先使用用户名登录，再管理你的自定义词牌。</p>
          )}
        </section>
      ) : tab === "public" ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>公共题库</h2>
            <span className="soft-chip">{publicPacks.length} 个</span>
          </div>
          {publicPacks.length === 0 ? (
            <p className="empty-text">还没有公开题库。</p>
          ) : (
            <div className="pack-list">
              {publicPacks.filter(p => filter(p.name)).map((pack) => (
                <div className="pack-row" key={makePublicPackKey(pack)}>
                  <div className="pack-row-info">
                    <strong>{pack.name}</strong>
                    <div className="pack-row-meta">{pack.entries.length} 个词 / {pack.ownerUsername}</div>
                  </div>
                  <div className="pack-row-actions">
                    <button onClick={() => { setSelectedPublicPackId(makePublicPackKey(pack)); setPackSource("public"); }}>用于开房</button>
                    <button onClick={() => setModalPack(pack)}>预览</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>上传 / 导入</h2>
          </div>
          {namedAccount ? (
            <>
              <input value={savedPackName} onChange={(e) => setSavedPackName(e.target.value)} placeholder="题库名称" style={{ marginBottom: 10 }} />
              <textarea value={savedPackEntries} onChange={(e) => setSavedPackEntries(e.target.value)} placeholder="每行一个词，至少 25 行" style={{ marginBottom: 10, minHeight: 120 }} />
              <div className="toolbar-inline compact-stack">
                <button className="primary-button" onClick={() => { void addAccountPack(); }}>保存题库</button>
                <input type="file" accept=".txt,.json" onChange={(e) => { void importAccountPack(e.target.files?.[0] ?? null); }} />
              </div>
            </>
          ) : (
            <p className="hint-text">先使用用户名登录，再上传自定义题库。</p>
          )}
        </section>
      )}

      {modalPack ? (
        <div className="pack-modal-overlay" onClick={() => setModalPack(null)}>
          <div className="pack-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modalPack.name}</h3>
            <p className="hint-text">{(modalPack as SavedWordPack).entries?.length ?? (modalPack as PublicWordPack).entries?.length ?? 0} 个词</p>
            {"entries" in modalPack && Array.isArray(modalPack.entries) ? (
              <div className="pack-modal-words">
                {(modalPack.entries as string[]).slice(0, 50).map((w, i) => (
                  <span key={i} className="pack-modal-word">{w}</span>
                ))}
                {modalPack.entries.length > 50 ? <span className="pack-modal-word">等共 {modalPack.entries.length} 个词...</span> : null}
              </div>
            ) : null}
            <div className="pack-modal-actions">
              <button className="primary-button" onClick={() => { setModalPack(null); }}>关闭</button>
              {"entries" in modalPack && "isPublic" in modalPack ? (
                <>
                  <button onClick={() => { void toggleAccountPackPublic((modalPack as SavedWordPack).id); setModalPack(null); }}>
                    {(modalPack as SavedWordPack).isPublic ? "取消公开" : "公开题库"}
                  </button>
                  <button className="danger-button" onClick={() => { void removeAccountPack((modalPack as SavedWordPack).id); setModalPack(null); }}>删除</button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
