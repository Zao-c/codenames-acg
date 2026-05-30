import { useState, useCallback, useMemo } from "react";
import { useGame } from "../context/GameContext";
import type { SavedImagePack, PublicImagePackSummary, ImagePackEntry } from "@acg-codenames/shared";

export function ImagePacksPage() {
  const g = useGame();
  const navigate = (typeof window !== "undefined" ? () => () => {} : () => {});
  const [tab, setTab] = useState<"mine" | "public" | "upload">("mine");
  const [detailModal, setDetailModal] = useState<{ pack: SavedImagePack | PublicImagePackSummary; isPublic: boolean } | null>(null);
  const [editName, setEditName] = useState("");
  const [editEntries, setEditEntries] = useState("");

  // Upload
  const [upName, setUpName] = useState("");
  const [upEntryText, setUpEntryText] = useState("");
  const [upImages, setUpImages] = useState<{ url: string; label: string }[]>([]);

  const parseEntries = useCallback((text: string): { url: string; label: string }[] => {
    return text.split("\n").map(line => {
      const m = line.match(/^(\S+)\s+(.*)$/);
      return m ? { url: m[1], label: m[2] } : { url: line.trim(), label: "" };
    }).filter(e => e.url);
  }, []);

  return (
    <section className="panel" style={{ maxWidth: 700, margin: "0 auto", padding: 16 }}>
      <h2 style={{ marginBottom: 12 }}>图库</h2>
      {g.error ? <p className="error-text" style={{ marginBottom: 8 }}>{g.error}</p> : null}
      {!g.namedAccount ? (
        <div style={{ padding: 16, textAlign: "center", background: "#fffbeb", borderRadius: 8, marginBottom: 12 }}>
          <p style={{ margin: "0 0 4px", color: "#92400e" }}>请先在「我的」页面登录账号后再使用图库功能。</p>
        </div>
      ) : null}

      <div className="selection-grid" style={{ marginBottom: 14 }}>
        <button className={tab === "mine" ? "selected" : ""} onClick={() => setTab("mine")}>我的图库</button>
        <button className={tab === "public" ? "selected" : ""} onClick={() => setTab("public")}>公共图库</button>
        <button className={tab === "upload" ? "selected" : ""} onClick={() => setTab("upload")}>上传</button>
      </div>

      {/* Mine */}
      {tab === "mine" && (
        <div>
          {g.accountImagePacks.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>还没有图库，切换到「上传」页签创建第一个图库。</p>
          ) : (
            g.accountImagePacks.map(pack => (
              <div key={pack.id} className="pack-select-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>{pack.name}</strong>
                  <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 13 }}>{pack.entries.length} 张图</span>
                  {pack.isPublic ? <span className="rg-chip rg-chip-green" style={{ marginLeft: 6 }}>公开</span> : null}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="rg-btn-sm" onClick={() => {
                    setEditName(pack.name);
                    setEditEntries(pack.entries.map(e => `${e.url} ${e.label}`).join("\n"));
                    setDetailModal({ pack, isPublic: false });
                  }}>编辑</button>
                  <button className="rg-btn-sm" onClick={() => g.toggleAccountImagePackPublic(pack.id)}>
                    {pack.isPublic ? "取消公开" : "设为公开"}
                  </button>
                  <button className="rg-btn-sm" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => { if (confirm("确定删除？")) g.removeAccountImagePack(pack.id); }}>
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Public */}
      {tab === "public" && (
        <div>
          {g.publicImagePacks.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>暂无公开图库。</p>
          ) : (
            g.publicImagePacks.map(p => (
              <div key={p.publicId} className="pack-select-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>{p.name}</strong>
                  <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 13 }}>{p.entryCount} 张图</span>
                  <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>/ {p.ownerUsername}</span>
                </span>
                <button className="rg-btn-sm" onClick={async () => {
                  const full = await g.fetchPublicImagePackDetail(p.publicId);
                  if (full) setDetailModal({ pack: full, isPublic: true });
                }}>详情</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Upload */}
      {tab === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {!g.namedAccount ? (
            <div style={{ padding: 24, textAlign: "center", background: "var(--surface-soft)", borderRadius: 8 }}>
              <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>创建图库需要登录账号。</p>
              <a href="/login" style={{ color: "var(--accent-text)", fontWeight: 600 }}>前往登录</a>
            </div>
          ) : (
          <>
          <input value={upName} onChange={e => setUpName(e.target.value)} placeholder="图库名称" style={{ width: "100%" }} />

          <label className="file-upload-btn" style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "var(--accent-soft, #eef2ff)", color: "var(--accent-text, #1d4ed8)", width: "fit-content" }}>
            上传图片（可多选）
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={async (e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              const newImages: { url: string; label: string }[] = [];
              for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                  const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.readAsDataURL(file);
                  });
                  const img = new Image();
                  await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error(""));
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
                  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.6));
                  const finalUrl = blob
                    ? await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob); })
                    : dataUrl;
                  newImages.push({ url: finalUrl, label: file.name.replace(/\.[^.]+$/, "") });
                } catch { /* skip broken */ }
              }
              setUpImages(prev => [...prev, ...newImages]);
              e.target.value = "";
            }} style={{ display: "none" }} />
          </label>

          {/* Preview uploaded images */}
          {upImages.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, maxHeight: 160, overflow: "auto" }}>
              {upImages.map((img, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={img.url} alt={img.label} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                    onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }} />
                  <button onClick={() => setUpImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 20, height: 20, fontSize: 12, cursor: "pointer", lineHeight: 1 }}>×</button>
                  <span style={{ fontSize: 10, display: "block", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{img.label}</span>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={upEntryText}
            onChange={e => setUpEntryText(e.target.value)}
            placeholder="或手动粘贴 URL，每行：URL + 空格 + 描述"
            rows={3}
            style={{ width: "100%" }}
          />
          <button className="primary-button" onClick={() => {
            if (!upName.trim()) return;
            const textEntries = parseEntries(upEntryText);
            const all = [...upImages, ...textEntries];
            g.addAccountImagePack(upName.trim(), all);
            setUpName(""); setUpEntryText(""); setUpImages([]);
            setTab("mine");
          }} disabled={!upName.trim() || (upImages.length === 0 && !upEntryText.trim())}>创建图库</button>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            点击「上传图片」选择本地文件，自动压缩为 WebP。也可手动粘贴 URL。
          </p>
          </>
          )}
        </div>
      )}

      {/* Detail / Edit Modal */}
      {detailModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setDetailModal(null)}>
          <div style={{
            background: "var(--surface)", borderRadius: 12, padding: 16, maxWidth: 500, width: "90%",
            maxHeight: "80vh", overflow: "auto",
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{detailModal.pack.name}</h3>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>{"entries" in detailModal.pack ? detailModal.pack.entries.length : detailModal.pack.entryCount} 张图</p>
            {"entries" in detailModal.pack ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {detailModal.pack.entries.map((e: ImagePackEntry, i: number) => (
                  <div key={i} style={{ textAlign: "center" }}>
                    <img src={e.url} alt={e.label || `图 ${i + 1}`}
                      style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                      onError={(ev) => { (ev.target as HTMLImageElement).style.display = "none"; }} />
                    {e.label && <span style={{ fontSize: 10, display: "block" }}>{e.label}</span>}
                  </div>
                ))}
              </div>
            ) : null}

            {!detailModal.isPublic && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>编辑</strong>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="名称" style={{ width: "100%" }} />
                <textarea value={editEntries} onChange={e => setEditEntries(e.target.value)} rows={5} style={{ width: "100%" }}
                  placeholder="URL + 空格 + 描述，每行一个" />
                <button className="primary-button" onClick={() => {
                  if (!(detailModal.pack as SavedImagePack).id) return;
                  g.editAccountImagePack((detailModal.pack as SavedImagePack).id, editName, parseEntries(editEntries));
                  setDetailModal(null);
                }}>保存</button>
              </div>
            )}

            <button onClick={() => setDetailModal(null)} style={{ marginTop: 8 }}>关闭</button>
          </div>
        </div>
      )}
    </section>
  );
}
