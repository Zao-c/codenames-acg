import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import type { SavedImagePack, PublicImagePack, PublicImagePackSummary, ImagePackEntry } from "@acg-codenames/shared";

function ThumbnailPuzzle({ entries, maxThumbs = 4 }: { entries: ImagePackEntry[]; maxThumbs?: number }) {
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());

  if (entries.length === 0) {
    return (
      <div className="image-pack-thumbs-placeholder">
        <span>暂无图片</span>
      </div>
    );
  }

  const show = entries.slice(0, maxThumbs);
  const gridCols = show.length <= 2 ? 1 : 2;
  const gridRows = show.length === 1 ? 1 : 2;

  return (
    <div
      className="image-pack-thumbs"
      style={{
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gridTemplateRows: `repeat(${gridRows}, 1fr)`,
      }}
    >
      {show.map((e, i) => {
        if (failedSet.has(i)) {
          return (
            <div
              key={i}
              style={{
                background: "rgba(148,163,184,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          );
        }
        return (
          <img
            key={i}
            src={e.url}
            alt={e.label || `图 ${i + 1}`}
            onError={() => setFailedSet((prev) => new Set(prev).add(i))}
          />
        );
      })}
    </div>
  );
}

function ImageEntryGrid({ entries }: { entries: ImagePackEntry[] }) {
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());

  return (
    <div className="image-entry-grid">
      {entries.map((e, i) => (
        <div className="image-entry-tile" key={i}>
          {failedSet.has(i) ? (
            <div className="image-entry-placeholder">加载失败</div>
          ) : (
            <img
              src={e.url}
              alt={e.label || `图 ${i + 1}`}
              onError={() => setFailedSet((prev) => new Set(prev).add(i))}
            />
          )}
          {e.label && <span className="image-entry-label">{e.label}</span>}
        </div>
      ))}
    </div>
  );
}

async function processFilesToImages(
  files: FileList | File[]
): Promise<{ url: string; label: string; error?: string }[]> {
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const results: { url: string; label: string; error?: string }[] = [];

  const list = Array.from(files);

  for (const file of list) {
    if (file.size > MAX_FILE_SIZE) {
      results.push({ url: "", label: file.name.replace(/\.[^.]+$/, ""), error: `图片 "${file.name}" 超过 10MB 限制` });
      continue;
    }

    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("图片加载失败"));
        img.src = dataUrl;
      });

      const MAX = 640;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
        else { w = Math.round(w * (MAX / h)); h = MAX; }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.6));
      const finalUrl = blob
        ? await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob); })
        : dataUrl;

      results.push({ url: finalUrl, label: file.name.replace(/\.[^.]+$/, "") });
    } catch {
      results.push({ url: "", label: file.name.replace(/\.[^.]+$/, ""), error: `图片 "${file.name}" 加载失败` });
    }
  }

  return results;
}

export function ImagePacksPage() {
  const g = useGame();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"mine" | "public" | "upload">("mine");
  const [search, setSearch] = useState("");
  const [modalPack, setModalPack] = useState<SavedImagePack | PublicImagePackSummary | null>(null);

  const [editingPack, setEditingPack] = useState<SavedImagePack | null>(null);
  const [editName, setEditName] = useState("");
  const [editEntriesText, setEditEntriesText] = useState("");

  const [upName, setUpName] = useState("");
  const [upImages, setUpImages] = useState<{ url: string; label: string }[]>([]);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filter = useCallback(
    (name: string) => name.toLowerCase().includes(search.toLowerCase()),
    [search]
  );

  const parseEntries = useCallback(
    (text: string): { url: string; label: string }[] => {
      return text
        .split("\n")
        .map((line) => {
          const m = line.match(/^(\S+)\s+(.*)$/);
          return m ? { url: m[1], label: m[2] } : { url: line.trim(), label: "" };
        })
        .filter((e) => e.url);
    },
    []
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setUploadError("");

      const results = await processFilesToImages(files);

      const errors = results.filter((r) => r.error).map((r) => r.error!).join("；");
      const success = results.filter((r) => !r.error);

      if (success.length > 0) {
        setUpImages((prev) => [...prev, ...success]);
      }
      if (errors) {
        setUploadError(errors);
      }

      e.target.value = "";
    },
    []
  );

  const handlePasteUrls = useCallback(() => {
    const text = editEntriesText.trim();
    if (!text) return;
    const parsed = parseEntries(text);
    if (parsed.length > 0) {
      setUpImages((prev) => [...prev, ...parsed]);
      setEditEntriesText("");
    }
  }, [editEntriesText, parseEntries]);

  const handleCreateImagePack = useCallback(() => {
    if (!upName.trim() || upImages.length === 0) return;
    g.addAccountImagePack(upName.trim(), upImages);
    setUpName("");
    setUpImages([]);
    setTab("mine");
  }, [upName, upImages, g]);

  const handleEditSave = useCallback(() => {
    if (!editingPack || !editName.trim()) return;
    const parsed = parseEntries(editEntriesText);
    g.editAccountImagePack(editingPack.id, editName.trim(), parsed);
    setEditingPack(null);
    setModalPack(null);
  }, [editingPack, editName, editEntriesText, g, parseEntries]);

  const hasEntries = (p: SavedImagePack | PublicImagePackSummary): p is SavedImagePack => {
    return "entries" in p && Array.isArray((p as SavedImagePack).entries);
  };

  const isMine = tab === "mine";
  const packs = isMine ? g.accountImagePacks : g.publicImagePacks;
  const title = isMine ? "我的图库" : "公共图库";

  return (
    <>
      <section className="panel packs-tabs-panel">
        <div className="panel-heading">
          <h2>图库</h2>
        </div>
        <div className="selection-grid" style={{ marginBottom: 16 }}>
          <button
            className={tab === "mine" ? "selected" : ""}
            onClick={() => { setTab("mine"); setSearch(""); }}
          >
            我的图库
          </button>
          <button
            className={tab === "public" ? "selected" : ""}
            onClick={() => { setTab("public"); setSearch(""); }}
          >
            公共图库
          </button>
          <button
            className={tab === "upload" ? "selected" : ""}
            onClick={() => setTab("upload")}
          >
            上传
          </button>
        </div>

        {tab !== "upload" && (
          <div className="pack-search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索图库..."
            />
          </div>
        )}
      </section>

      {tab === "upload" ? (
        <section className="panel upload-panel">
          <div className="panel-heading">
            <h2>{editingPack ? `编辑：${editingPack.name}` : "上传"}</h2>
          </div>

          {!g.namedAccount ? (
            <div style={{ padding: 24, textAlign: "center", background: "var(--surface-soft)", borderRadius: 12 }}>
              <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>创建图库需要登录账号。</p>
              <a href="/login" style={{ color: "var(--accent-text)", fontWeight: 600 }}>前往登录</a>
            </div>
          ) : (
            <div className="upload-form">
              <label className="field">
                <span>图库名称</span>
                <input
                  value={upName}
                  onChange={(e) => setUpName(e.target.value)}
                  placeholder="例如：经典 ACG 场景"
                />
              </label>

              {g.error && <p className="error-text">{g.error}</p>}
              {uploadError && <p className="error-text">{uploadError}</p>}

              {upImages.length > 0 && (
                <div className="upload-image-list">
                  {upImages.map((img, i) => (
                    <div className="upload-image-item" key={i}>
                      <img
                        src={img.url}
                        alt={img.label}
                        className="upload-image-thumb"
                        onError={(ev) => {
                          const el = ev.target as HTMLImageElement;
                          el.style.display = "none";
                          const placeholder = document.createElement("div");
                          placeholder.className = "upload-image-thumb-placeholder";
                          placeholder.innerHTML = "<span>加载失败</span>";
                          el.parentElement?.insertBefore(placeholder, el);
                        }}
                      />
                      <input
                        value={img.label}
                        onChange={(e) => {
                          setUpImages((prev) =>
                            prev.map((item, j) =>
                              j === i ? { ...item, label: e.target.value } : item
                            )
                          );
                        }}
                        placeholder="图片标签"
                      />
                      <button
                        className="upload-image-del"
                        onClick={() =>
                          setUpImages((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="toolbar-inline">
                <label className="primary-button" style={{ cursor: "pointer", padding: "10px 20px", fontSize: 14 }}>
                  上传图片（可多选）
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />
                </label>
              </div>

              <label className="field">
                <span>或手动粘贴 URL（每行：URL + 空格 + 描述）</span>
                <textarea
                  value={editEntriesText}
                  onChange={(e) => setEditEntriesText(e.target.value)}
                  placeholder="https://example.com/image.jpg 描述文字"
                  rows={3}
                />
              </label>

              {editEntriesText.trim() && (
                <button onClick={handlePasteUrls} style={{ alignSelf: "flex-start" }}>
                  添加 URL 图片
                </button>
              )}

              <div className="toolbar-inline upload-actions">
                <button
                  className="primary-button"
                  onClick={handleCreateImagePack}
                  disabled={!upName.trim() || upImages.length === 0}
                >
                  创建图库
                </button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  需要图库名称和至少 1 张图片
                </span>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="panel pack-list-panel">
          <div className="panel-heading">
            <h2>{title}</h2>
            <span className="soft-chip">{packs.length} 个</span>
          </div>

          {!g.namedAccount ? (
            <p className="hint-text">请先在「我的」页面登录账号后再使用图库功能。</p>
          ) : packs.length === 0 ? (
            <p className="empty-text">
              {isMine ? "还没有图库，切换到「上传」页签创建第一个图库。" : "暂无公开图库。"}
            </p>
          ) : (
            <div className="pack-list image-pack-list">
              {packs.filter((p) => filter(p.name)).map((pack) => {
                const entries = hasEntries(pack) ? pack.entries : [];
                return (
                  <div className="pack-row image-pack-row" key={"publicId" in pack ? pack.publicId : pack.id}>
                    <ThumbnailPuzzle entries={entries} />

                    <div className="pack-row-info">
                      <strong>{pack.name}</strong>
                      <div className="pack-row-meta">
                        {hasEntries(pack) ? pack.entries.length : pack.entryCount} 张图
                        {"isPublic" in pack && pack.isPublic !== undefined ? (
                          <span style={{ marginLeft: 8 }}>
                            {pack.isPublic ? "公开" : "仅自己可用"}
                          </span>
                        ) : (
                          <span style={{ marginLeft: 8 }}>公开</span>
                        )}
                        {!("entries" in pack) && "ownerUsername" in pack ? (
                          <span style={{ marginLeft: 8 }}>/ {pack.ownerUsername}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="pack-row-actions">
                      {isMine ? (
                        <>
                          <button className="primary-button" onClick={() => navigate("/create")}>用于开房</button>
                          <details className="pack-action-menu">
                            <summary aria-label={`更多操作：${pack.name}`}>更多</summary>
                            <div className="pack-action-menu-list">
                              <button onClick={() => setModalPack(pack as SavedImagePack)}>详情</button>
                              <button onClick={() => {
                                setEditingPack(pack as SavedImagePack);
                                setEditName((pack as SavedImagePack).name);
                                setEditEntriesText((pack as SavedImagePack).entries.map(e => `${e.url} ${e.label}`).join("\n"));
                                setTab("upload");
                              }}>编辑</button>
                              <button onClick={() => g.toggleAccountImagePackPublic((pack as SavedImagePack).id)}>
                                {(pack as SavedImagePack).isPublic ? "取消公开" : "设为公开"}
                              </button>
                              <button className="danger-button" onClick={() => {
                                if (confirm("确定删除这个图库？")) g.removeAccountImagePack((pack as SavedImagePack).id);
                              }}>删除</button>
                            </div>
                          </details>
                        </>
                      ) : (
                        <>
                          <button className="primary-button" onClick={() => navigate("/create")}>用于开房</button>
                          <button onClick={async () => {
                            const full = await g.fetchPublicImagePackDetail((pack as PublicImagePackSummary).publicId);
                            if (full) setModalPack(full);
                          }}>详情</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {g.error && tab !== "upload" ? (
        <p className="error-text">{g.error}</p>
      ) : null}

      {/* Detail Modal */}
      {modalPack && !editingPack && (
        <div
          className="pack-modal-overlay"
          onClick={() => setModalPack(null)}
        >
          <div className="pack-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modalPack.name}</h3>
            <p className="hint-text">
              {hasEntries(modalPack)
                ? `${(modalPack as SavedImagePack).entries.length} 张图`
                : `${(modalPack as PublicImagePackSummary).entryCount} 张图`}
              {"ownerUsername" in modalPack
                ? ` / ${(modalPack as PublicImagePackSummary).ownerUsername}`
                : ""}
            </p>

            {hasEntries(modalPack) && (modalPack as SavedImagePack).entries.length > 0 ? (
              <ImageEntryGrid entries={(modalPack as SavedImagePack).entries} />
            ) : null}

            <div className="pack-modal-actions">
              <button className="primary-button" onClick={() => setModalPack(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
