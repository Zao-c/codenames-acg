import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { CandidateReview } from "../lib/CandidateReview";
import type { SavedWordPack, PublicWordPack, PublicWordPackSummary } from "@acg-codenames/shared";

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
    makePublicPackKey, fetchPublicPackDetail
  } = useGame();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"mine" | "public" | "import">("mine");
  const [search, setSearch] = useState("");
  const [modalPack, setModalPack] = useState<SavedWordPack | PublicWordPackSummary | null>(null);
  const [editingPack, setEditingPack] = useState<SavedWordPack | null>(null);

  const filter = (name: string) => name.toLowerCase().includes(search.toLowerCase());

  const copyEntries = useCallback((entries: string[]) => {
    navigator.clipboard.writeText(entries.join("\n")).then(() => {
      alert(`已复制 ${entries.length} 个词条到剪贴板`);
    }).catch(() => {});
  }, []);

  const downloadFile = useCallback((name: string, content: string, ext: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const duplicatePack = useCallback((pack: SavedWordPack) => {
    setSavedPackName(pack.name + " (副本)");
    setSavedPackEntries(pack.entries.join("\n"));
    setTab("import");
    setModalPack(null);
  }, [setSavedPackName, setSavedPackEntries]);

  const handleSaveEdit = useCallback(() => {
    if (!editingPack || !savedPackEntries.trim()) return;
    const entries = savedPackEntries.split(/[\n,]/).map((e) => e.trim()).filter(Boolean);
    if (entries.length < 1) return;
    importAccountPack(new File([entries.join("\n")], editingPack.name + ".txt", { type: "text/plain" }));
    removeAccountPack(editingPack.id);
    setEditingPack(null);
  }, [editingPack, savedPackEntries, importAccountPack, removeAccountPack]);

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
      <section className="panel packs-tabs-panel">
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
        <section className="panel pack-list-panel">
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
                      <button onClick={() => { navigate(`/create`); chooseAccountPackForCreate(pack.id); }}>用于开房</button>
                      <button onClick={() => setModalPack(pack)}>详情</button>
                      <button onClick={() => { setEditingPack(pack); setSavedPackName(pack.name); setSavedPackEntries(pack.entries.join("\n")); setTab("import"); }}>编辑</button>
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
        <section className="panel pack-list-panel">
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
                    <div className="pack-row-meta">{pack.entryCount} 个词 / {pack.ownerUsername}</div>
                  </div>
                  <div className="pack-row-actions">
                    <button onClick={() => { navigate(`/create`); setSelectedPublicPackId(makePublicPackKey(pack)); setPackSource("public"); }}>用于开房</button>
                    <button onClick={() => {
                      const publicId = makePublicPackKey(pack);
                      fetchPublicPackDetail(publicId).then((full) => {
                        if (full) setModalPack({ ...pack, entries: full.entries } as unknown as SavedWordPack);
                      });
                    }}>预览</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel upload-panel">
          <div className="panel-heading">
            <h2>{editingPack ? `编辑：${editingPack.name}` : "上传 / 导入"}</h2>
          </div>
          {namedAccount ? (
            <div className="upload-form">
              <label className="field">
                <span>题库名称</span>
                <input value={savedPackName} onChange={(e) => setSavedPackName(e.target.value)} placeholder="例如：克洛斯贝尔的轨迹" />
              </label>
              <label className="field">
                <span>词条</span>
                <textarea value={savedPackEntries} onChange={(e) => setSavedPackEntries(e.target.value)} placeholder="每行一个词，至少 25 行" />
              </label>
              <div className="toolbar-inline upload-actions">
                {editingPack ? (
                  <>
                    <button className="primary-button" onClick={handleSaveEdit}>保存修改</button>
                    <button onClick={() => { setEditingPack(null); setSavedPackName(""); setSavedPackEntries(""); }}>取消编辑</button>
                  </>
                ) : (
                  <>
                    <button className="primary-button" onClick={() => { void addAccountPack(); }}>保存题库</button>
                    <input type="file" accept=".txt,.json" onChange={(e) => { void importAccountPack(e.target.files?.[0] ?? null); }} />
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="hint-text">先使用用户名登录，再上传自定义题库。</p>
          )}
        </section>
      )}

      {modalPack ? (
        <div className="pack-modal-overlay" onClick={() => setModalPack(null)}>
          <div className="pack-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modalPack.name}</h3>
            <p className="hint-text">
              {"entries" in modalPack && Array.isArray((modalPack as SavedWordPack).entries)
                ? `${(modalPack as SavedWordPack).entries.length} 个词`
                : `${(modalPack as PublicWordPackSummary).entryCount} 个词`}
              {"ownerUsername" in modalPack ? ` / ${(modalPack as PublicWordPackSummary).ownerUsername}` : ""}
            </p>
            {"entries" in modalPack && Array.isArray((modalPack as SavedWordPack).entries) ? (
              <div className="pack-modal-words">
                {((modalPack as SavedWordPack).entries).slice(0, 80).map((w, i) => (
                  <span key={i} className="pack-modal-word">{w}</span>
                ))}
                {(modalPack as SavedWordPack).entries.length > 80 ? <span className="pack-modal-word">等共 {(modalPack as SavedWordPack).entries.length} 个词...</span> : null}
              </div>
            ) : null}
            <div className="pack-modal-actions">
              <button className="primary-button" onClick={() => setModalPack(null)}>关闭</button>
              {"entries" in modalPack && Array.isArray((modalPack as SavedWordPack).entries) ? (
                <>
                  <button onClick={() => copyEntries((modalPack as SavedWordPack).entries)}>复制全部</button>
                  <button onClick={() => downloadFile(modalPack.name, ((modalPack as SavedWordPack).entries).join("\n"), "txt", "text/plain")}>导出 TXT</button>
                  <button onClick={() => downloadFile(modalPack.name, JSON.stringify({ name: modalPack.name, entries: (modalPack as SavedWordPack).entries }, null, 2), "json", "application/json")}>导出 JSON</button>
                  {"isPublic" in modalPack ? (
                    <>
                      <button onClick={() => duplicatePack(modalPack as SavedWordPack)}>另存副本</button>
                      <button onClick={() => { void toggleAccountPackPublic((modalPack as SavedWordPack).id); setModalPack(null); }}>
                        {(modalPack as SavedWordPack).isPublic ? "取消公开" : "公开题库"}
                      </button>
                      <button className="danger-button" onClick={() => { void removeAccountPack((modalPack as SavedWordPack).id); setModalPack(null); }}>删除</button>
                    </>
                  ) : null}
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
