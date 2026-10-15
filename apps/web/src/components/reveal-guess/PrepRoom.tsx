import { useState, useEffect, useCallback } from "react";
import type { PublicRoomState, PublicRevealGuessState, ImagePackEntry } from "@acg-codenames/shared";
import type { RevealGuessActions } from "./useRevealGuessActions";
import type { GameContextType } from "../../context/GameContext";

type PrepTab = "my-gallery" | "public-gallery" | "local-upload";

interface PrepRoomProps {
  room: PublicRoomState;
  rg: PublicRevealGuessState | undefined;
  actions: RevealGuessActions;
  g: GameContextType;
  isJudge: boolean;
  compressImage: (file: File) => Promise<string>;
  setError: (v: string) => void;
}

function GalleryThumbs({ entries }: { entries: ImagePackEntry[] }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());

  if (entries.length === 0) {
    return (
      <div className="rg-gallery-thumbs">
        <div className="rg-gallery-thumbs-placeholder">暂无</div>
      </div>
    );
  }

  const show = entries.slice(0, 5);

  return (
    <div className="rg-gallery-thumbs">
      {show.map((e, i) =>
        failed.has(i) ? (
          <div key={i} className="rg-gallery-thumbs-placeholder"></div>
        ) : (
          <img
            key={i}
            src={e.url}
            alt={e.label || `图${i + 1}`}
            onError={() => setFailed((prev) => new Set(prev).add(i))}
          />
        )
      )}
    </div>
  );
}

export function PrepRoom({ room, rg, actions, g, isJudge, compressImage, setError }: PrepRoomProps) {
  const [tab, setTab] = useState<PrepTab>("my-gallery");

  const [selectedGalleryId, setSelectedGalleryId] = useState<string>("");
  const [galleryEntries, setGalleryEntries] = useState<ImagePackEntry[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  const [uploadImage, setUploadImage] = useState("");
  const [uploadAnswer, setUploadAnswer] = useState("");
  const [uploadAliases, setUploadAliases] = useState("");
  const [uploadHints, setUploadHints] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editAnswer, setEditAnswer] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [editHints, setEditHints] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");

  const puzzles = rg?.puzzleList ?? [];

  const selectedMyPack = tab === "my-gallery" && selectedGalleryId
    ? g.accountImagePacks.find((p) => p.id === selectedGalleryId) ?? null
    : null;

  const selectedPublicSummary = tab === "public-gallery" && selectedGalleryId
    ? g.publicImagePacks.find((p) => p.publicId === selectedGalleryId) ?? null
    : null;

  useEffect(() => {
    if (!selectedGalleryId) {
      setGalleryEntries([]);
      return;
    }
    if (tab === "my-gallery") {
      const pack = g.accountImagePacks.find((p) => p.id === selectedGalleryId);
      setGalleryEntries(pack?.entries ?? []);
    } else if (tab === "public-gallery") {
      let cancelled = false;
      setGalleryLoading(true);
      g.fetchPublicImagePackDetail(selectedGalleryId).then((full) => {
        if (!cancelled) {
          setGalleryEntries(full?.entries ?? []);
          setGalleryLoading(false);
        }
      });
      return () => { cancelled = true; };
    } else {
      setGalleryEntries([]);
    }
  }, [selectedGalleryId, tab, g]);

  useEffect(() => {
    setSelectedGalleryId("");
    setGalleryEntries([]);
  }, [tab]);

  const startEdit = (index: number) => {
    const p = puzzles[index];
    if (!p) return;
    setEditingIndex(index);
    setEditAnswer("");
    setEditAliases("");
    setEditHints("");
    setEditImageUrl(p.imageUrl || "");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
  };

  const saveEdit = (index: number) => {
    const data: { imageUrl?: string; answer?: string; aliases?: string[]; hints?: string[] } = {};
    if (editImageUrl) data.imageUrl = editImageUrl;
    if (editAnswer.trim()) data.answer = editAnswer.trim();
    if (editAliases.trim()) data.aliases = editAliases.split("\n").map((s) => s.trim()).filter(Boolean);
    if (editHints.trim()) data.hints = editHints.split("\n").map((s) => s.trim()).filter(Boolean);
    actions.updatePuzzle(index, data);
    setEditingIndex(null);
  };

  const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImage(file);
      setEditImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片处理失败");
    }
    e.target.value = "";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("不支持的图片格式");
      return;
    }
    try {
      const url = await compressImage(file);
      setUploadImage(url);
      setPreviewUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片处理失败");
    }
    e.target.value = "";
  };

  const handleLocalUpload = () => {
    if (!uploadImage) return;
    const aliases = uploadAliases.split("\n").map((s) => s.trim()).filter(Boolean);
    const hints = uploadHints.split("\n").map((s) => s.trim()).filter(Boolean);
    actions.addPuzzle(uploadImage, uploadAnswer || "未命名", aliases, hints);
    setUploadImage("");
    setUploadAnswer("");
    setUploadAliases("");
    setUploadHints("");
    setPreviewUrl(null);
  };

  const handleAddGallery = useCallback(async () => {
    if (!selectedGalleryId) return;
    const pack = g.accountImagePacks.find((p) => p.id === selectedGalleryId);
    if (pack && pack.entries.length > 0) {
      const items = pack.entries.map((e) => ({
        imageUrl: e.url,
        answer: e.label || "未命名",
        aliases: [] as string[],
        hints: [] as string[],
      }));
      actions.addPuzzles(items);
      return;
    }
    const publicPack = g.publicImagePacks.find((p) => p.publicId === selectedGalleryId);
    if (publicPack) {
      const full = await g.fetchPublicImagePackDetail(publicPack.publicId);
      if (full && full.entries.length > 0) {
        const items = full.entries.map((e) => ({
          imageUrl: e.url,
          answer: e.label || "未命名",
          aliases: [] as string[],
          hints: [] as string[],
        }));
        actions.addPuzzles(items);
      }
    }
  }, [selectedGalleryId, g, actions]);

  const galleryInfo = selectedMyPack
    ? {
        name: selectedMyPack.name,
        count: selectedMyPack.entries.length,
        status: selectedMyPack.isPublic ? "公开" : "仅自己可用",
      }
    : selectedPublicSummary
    ? {
        name: selectedPublicSummary.name,
        count: selectedPublicSummary.entryCount,
        status: `公开 / ${selectedPublicSummary.ownerUsername}`,
      }
    : null;

  return (
    <div className="rg-prep-layout">
      {/* ═══════ Left: Source ═══════ */}
      <div className="rg-prep-left">
        <div className="rg-card">
          <div className="rg-card-title">题目来源</div>
          <div className="selection-grid" style={{ marginBottom: 12 }}>
            <button
              className={tab === "my-gallery" ? "selected" : ""}
              onClick={() => setTab("my-gallery")}
            >
              我的图库
            </button>
            <button
              className={tab === "public-gallery" ? "selected" : ""}
              onClick={() => setTab("public-gallery")}
            >
              公共图库
            </button>
            <button
              className={tab === "local-upload" ? "selected" : ""}
              onClick={() => setTab("local-upload")}
            >
              本地上传
            </button>
          </div>

          {/* My Gallery */}
          {tab === "my-gallery" && (
            <div>
              {!g.namedAccount ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>登录后可使用我的图库</p>
              ) : g.accountImagePacks.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  还没有图库，请先去图库页创建，或使用本地上传。
                </p>
              ) : (
                <>
                  <select
                    className="rg-gallery-select"
                    value={selectedGalleryId}
                    onChange={(e) => setSelectedGalleryId(e.target.value)}
                  >
                    <option value="">选择图库...</option>
                    {g.accountImagePacks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.entries.length} 张)
                      </option>
                    ))}
                  </select>

                  {galleryInfo && (
                    <div className="rg-gallery-info">
                      <GalleryThumbs entries={galleryEntries} />
                      <div className="rg-gallery-info-meta">
                        <strong>{galleryInfo.name}</strong>
                        <div>
                          {galleryInfo.count} 张图 · {galleryInfo.status}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <button
                className="primary-button"
                onClick={handleAddGallery}
                disabled={!selectedGalleryId}
                style={{ width: "100%", marginTop: 10 }}
              >
                加入本局题目
              </button>
            </div>
          )}

          {/* Public Gallery */}
          {tab === "public-gallery" && (
            <div>
              {g.publicImagePacks.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>暂无公开图库</p>
              ) : (
                <>
                  <select
                    className="rg-gallery-select"
                    value={selectedGalleryId}
                    onChange={(e) => setSelectedGalleryId(e.target.value)}
                  >
                    <option value="">选择图库...</option>
                    {g.publicImagePacks.map((p) => (
                      <option key={p.publicId} value={p.publicId}>
                        {p.name} ({p.entryCount} 张) / {p.ownerUsername}
                      </option>
                    ))}
                  </select>

                  {galleryLoading ? (
                    <div className="rg-gallery-info">
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>加载中...</span>
                    </div>
                  ) : galleryInfo ? (
                    <div className="rg-gallery-info">
                      <GalleryThumbs entries={galleryEntries} />
                      <div className="rg-gallery-info-meta">
                        <strong>{galleryInfo.name}</strong>
                        <div>
                          {galleryInfo.count} 张图 · {galleryInfo.status}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <button
                className="primary-button"
                onClick={handleAddGallery}
                disabled={!selectedGalleryId}
                style={{ width: "100%", marginTop: 10 }}
              >
                加入本局题目
              </button>
            </div>
          )}

          {/* Local Upload */}
          {tab === "local-upload" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label
                className="primary-button"
                style={{
                  cursor: "pointer",
                  padding: "10px 20px",
                  fontSize: 14,
                  textAlign: "center",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                {previewUrl ? "更换图片" : "上传图片"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                />
              </label>

              {(previewUrl || uploadImage) && (
                <img
                  src={previewUrl || uploadImage}
                  alt="预览"
                  style={{
                    width: "100%",
                    maxHeight: 160,
                    objectFit: "contain",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                  onError={(ev) => {
                    (ev.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}

              <input
                value={uploadImage}
                onChange={(e) => {
                  setUploadImage(e.target.value);
                  setPreviewUrl(null);
                }}
                placeholder="或粘贴图片 URL"
                style={{ fontSize: 12 }}
              />

              <div>
                <strong style={{ fontSize: 12 }}>标准答案</strong>
                <input
                  value={uploadAnswer}
                  onChange={(e) => setUploadAnswer(e.target.value)}
                  placeholder="例如：新世纪福音战士"
                  style={{ width: "100%", marginTop: 2, fontSize: 12 }}
                />
              </div>

              <div>
                <strong style={{ fontSize: 12 }}>可接受别名（每行一个）</strong>
                <textarea
                  value={uploadAliases}
                  onChange={(e) => setUploadAliases(e.target.value)}
                  placeholder="EVA&#10;Evangelion"
                  rows={2}
                  style={{ width: "100%", marginTop: 2, fontSize: 12 }}
                />
              </div>

              <div>
                <strong style={{ fontSize: 12 }}>提示（每行一个）</strong>
                <textarea
                  value={uploadHints}
                  onChange={(e) => setUploadHints(e.target.value)}
                  placeholder="经典机甲番&#10;庵野秀明"
                  rows={2}
                  style={{ width: "100%", marginTop: 2, fontSize: 12 }}
                />
              </div>

              <button
                className="primary-button"
                onClick={handleLocalUpload}
                disabled={!uploadImage}
                style={{ width: "100%" }}
              >
                加入本局题目
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ═══════ Right: Game Queue ═══════ */}
      <div className="rg-prep-right">
        <div className="rg-card">
          <div className="rg-card-title">
            本局题目 · {rg?.puzzleCount ?? 0} 题
          </div>

          {puzzles.length > 0 ? (
            <div className="rg-puzzle-queue">
              {puzzles.map((pz, i) => (
                <div key={pz.index}>
                  <div
                    className={`rg-puzzle-item${editingIndex === i ? " editing" : ""}`}
                  >
                    {pz.imageUrl ? (
                      <img
                        src={pz.imageUrl}
                        alt=""
                        className="rg-puzzle-thumb"
                        onError={(ev) => {
                          const el = ev.target as HTMLImageElement;
                          const placeholder = document.createElement("div");
                          placeholder.className = "rg-puzzle-thumb-placeholder";
                          placeholder.textContent = "错误";
                          el.parentElement?.insertBefore(placeholder, el);
                          el.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="rg-puzzle-thumb-placeholder">无图</div>
                    )}

                    <div className="rg-puzzle-info">
                      <strong>第 {i + 1} 题</strong>
                      <div className="rg-puzzle-meta">
                        {isJudge ? (
                          <>
                            <span>{pz.hasAnswer ? "已填答案" : "未填答案"}</span>
                            {pz.aliasCount > 0 && <span>{pz.aliasCount} 别名</span>}
                            {pz.hintCount > 0 && <span>{pz.hintCount} 提示</span>}
                          </>
                        ) : (
                          <span>已准备</span>
                        )}
                      </div>
                    </div>

                    {isJudge && editingIndex !== i && (
                      <div className="rg-puzzle-actions">
                        <button className="rg-btn-xs" onClick={() => startEdit(i)}>
                          编辑
                        </button>
                        <button
                          className="rg-btn-xs"
                          disabled={i === 0}
                          onClick={() => actions.reorderPuzzle(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          className="rg-btn-xs"
                          disabled={i === puzzles.length - 1}
                          onClick={() => actions.reorderPuzzle(i, i + 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="rg-btn-xs"
                          style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                          onClick={() => {
                            if (confirm(`确定删除第 ${i + 1} 题？`)) actions.removePuzzle(i);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>

                  {editingIndex === i && (
                    <div className="rg-puzzle-edit-form">
                      <div className="rg-puzzle-edit-row">
                        <strong>图片 URL</strong>
                        <input
                          value={editImageUrl}
                          onChange={(e) => setEditImageUrl(e.target.value)}
                          placeholder="data:image/... 或 https://..."
                        />
                        <label
                          className="rg-btn-xs"
                          style={{
                            cursor: "pointer",
                            background: "var(--rg-accent-light)",
                            color: "var(--rg-accent-text)",
                          }}
                        >
                          换图
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleEditFileChange}
                            style={{ display: "none" }}
                          />
                        </label>
                      </div>
                      <div className="rg-puzzle-edit-row">
                        <strong>标准答案</strong>
                        <input
                          value={editAnswer}
                          onChange={(e) => setEditAnswer(e.target.value)}
                          placeholder="例如：新世纪福音战士"
                        />
                      </div>
                      <div>
                        <strong style={{ fontSize: 11 }}>别名（每行一个）</strong>
                        <textarea
                          value={editAliases}
                          onChange={(e) => setEditAliases(e.target.value)}
                          rows={1}
                          style={{ width: "100%", fontSize: 12, marginTop: 2 }}
                        />
                      </div>
                      <div>
                        <strong style={{ fontSize: 11 }}>提示（每行一个）</strong>
                        <textarea
                          value={editHints}
                          onChange={(e) => setEditHints(e.target.value)}
                          rows={1}
                          style={{ width: "100%", fontSize: 12, marginTop: 2 }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="primary-button"
                          style={{ fontSize: 12, padding: "4px 14px" }}
                          onClick={() => saveEdit(i)}
                        >
                          保存
                        </button>
                        <button className="rg-btn-sm" onClick={cancelEdit}>
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rg-puzzle-empty">
              <span>📋</span>
              还没有本局题目
              <br />
              请从左侧图库加入或上传图片
            </div>
          )}

          <div className="rg-start-section">
            <button
              className="primary-button"
              onClick={actions.startGame}
              disabled={(rg?.puzzleCount ?? 0) === 0}
            >
              ▶ 开始揭幕
            </button>
            {(rg?.puzzleCount ?? 0) === 0 ? (
              <p
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 6,
                  marginBottom: 0,
                }}
              >
                至少添加 1 道题目
              </p>
            ) : null}
          </div>
        </div>

        {/* Judge Transfer */}
        <div className="rg-card">
          <div className="rg-card-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 13 }}>
              裁判：
              <strong>
                {room.players.find((p) => p.id === (room.judgePlayerId || room.hostPlayerId))?.nickname}
              </strong>
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                aria-label="转让裁判"
                onChange={(e) => {
                  if (e.target.value) {
                    actions.transferJudge(e.target.value);
                    e.target.value = "";
                  }
                }}
                style={{ fontSize: 12 }}
              >
                <option value="">转让给...</option>
                {room.players
                  .filter(
                    (p) =>
                      !p.isBot && p.id !== (room.judgePlayerId || room.hostPlayerId)
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nickname}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
