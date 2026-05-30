import { useState } from "react";
import { useGame } from "../context/GameContext";
import { wordPackSummaries, type ScoringMode, type TimerMode, type FlipMode, type BoardMode, type GameMode } from "@acg-codenames/shared";

const NEUTRAL_COUNT_OPTIONS: Record<BoardMode, number[]> = {
  "5x5": [3, 5, 7, 9, 11],
  "7x7": [7, 9, 11, 13, 15, 17, 19],
  "9x9": [15, 19, 21, 25]
};

function getNeutralOptions(mode: BoardMode): number[] {
  return NEUTRAL_COUNT_OPTIONS[mode] ?? [];
}

export function CreateRoomPage() {
  const {
    effectiveIdentity, createBoardMode, setCreateBoardMode,
    packSource, setPackSource,
    selectedBuiltinPackId, setSelectedBuiltinPackId,
    selectedAccountPackId, setSelectedAccountPackId,
    selectedPublicPackId, setSelectedPublicPackId,
    accountPacks, publicPacks, namedAccount,
    selectedAccountPack, selectedPublicPack,
    createRoom, createRevealGuessRoom, makePublicPackKey, error, setError, boardModes,
    chooseAccountPackForCreate,
    scoringMode, setScoringMode,
    createTimerMode, setCreateTimerMode,
    createTimerClueSeconds, setCreateTimerClueSeconds,
    createTimerGuessSeconds, setCreateTimerGuessSeconds,
    createNeutralCount, setCreateNeutralCount,
    createFlipMode, setCreateFlipMode
  } = useGame();

  const [gameMode, setGameMode] = useState<GameMode>("codenames");
  const [rgImageUrl, setRgImageUrl] = useState("");
  const [rgAnswer, setRgAnswer] = useState("");
  const [rgAliases, setRgAliases] = useState("");
  const [rgHints, setRgHints] = useState("");
  const [rgPuzzleCount, setRgPuzzleCount] = useState(3);
  const [rgPreviewUrl, setRgPreviewUrl] = useState<string | null>(null);
  const [showRgAdvanced, setShowRgAdvanced] = useState(false);

  const scoringModes: { value: ScoringMode; label: string; hint: string }[] = [
    { value: "classic", label: "经典", hint: "胜利队伍 +1" },
    { value: "scoring", label: "积分", hint: "每次猜词计分" },
  ];
  const timerModes: { value: TimerMode; label: string }[] = [
    { value: "unlimited", label: "不限时" },
    { value: "timed", label: "限时" },
  ];
  const flipModes: { value: FlipMode; label: string; hint: string }[] = [
    { value: "word-color", label: "显示词+颜色", hint: "翻牌后显示原词和阵营颜色" },
    { value: "color-only", label: "仅显示颜色", hint: "翻牌后隐藏词语，仅显示阵营颜色" },
  ];

  const currentPackName: string =
    packSource === "builtin" ? (wordPackSummaries.find((p) => p.id === selectedBuiltinPackId)?.name ?? "") :
    packSource === "account" ? (selectedAccountPack?.name ?? "") :
    selectedPublicPack?.name ?? "";
  const currentPackCount: number | null =
    packSource === "builtin" ? (wordPackSummaries.find((p) => p.id === selectedBuiltinPackId)?.entryCount ?? null) :
    packSource === "account" ? (selectedAccountPack?.entries.length ?? null) :
    selectedPublicPack?.entryCount ?? null;
  const currentPackOwner: string =
    packSource === "public" ? (selectedPublicPack?.ownerUsername ?? "") : "";

  const handleCreate = () => {
    if (!effectiveIdentity) return;
    if (gameMode === "reveal-guess") {
      if (!rgImageUrl.trim() && !rgAnswer.trim()) {
        setError("请至少填写图片 URL 或上传图片");
        return;
      }
      setError("");
      const aliases = rgAliases.split("\n").map(s => s.trim()).filter(Boolean);
      const hints = rgHints.split("\n").map(s => s.trim()).filter(Boolean);
      createRevealGuessRoom({ puzzleCount: rgPuzzleCount, timerEnabled: false });
      return;
    }
    createRoom();
  };

  async function handleRgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("不支持的图片格式，仅支持 PNG / JPEG / WebP");
      return;
    }
    setError("");
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
      const MAX = 1280;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * (MAX / w)); w = MAX; }
        else { w = Math.round(w * (MAX / h)); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.85));
      if (blob) {
        const compressed = await new Promise<string>(resolve => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(blob);
        });
        setRgImageUrl(compressed);
        setRgPreviewUrl(compressed);
      } else {
        setRgImageUrl(dataUrl);
        setRgPreviewUrl(dataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片处理失败");
    }
    e.target.value = "";
  }

  return (
    <>
      <section className="panel create-room-panel">
        <div className="panel-heading">
          <h2>创建房间</h2>
          <span className="soft-chip">{createBoardMode}</span>
        </div>

        <div className="settings-block">
          <strong>游戏模式</strong>
          <div className="selection-grid">
            <button className={gameMode === "codenames" ? "selected" : ""} onClick={() => setGameMode("codenames")}>词牌模式</button>
            <button className={gameMode === "reveal-guess" ? "selected" : ""} onClick={() => setGameMode("reveal-guess")}>揭幕猜番</button>
          </div>
        </div>

        {gameMode === "codenames" ? (
          <>
            <div className="settings-block">
              <strong>棋盘模式</strong>
              <div className="selection-grid">
                {boardModes.map((mode) => (
                  <button key={mode} className={createBoardMode === mode ? "selected" : ""} onClick={() => setCreateBoardMode(mode)}>{mode}</button>
                ))}
              </div>
            </div>
            <div className="settings-block">
              <strong>得分模式</strong>
              <div className="selection-grid">
                {scoringModes.map((mode) => (
                  <button key={mode.value} className={scoringMode === mode.value ? "selected" : ""} onClick={() => setScoringMode(mode.value)}>{mode.label}</button>
                ))}
              </div>
              <p className="hint-text" style={{ marginTop: 6 }}>
                {scoringModes.find(m => m.value === scoringMode)?.hint}
              </p>
            </div>
            <div className="settings-block">
              <strong>时间限制</strong>
              <div className="selection-grid">
                {timerModes.map((tm) => (
                  <button key={tm.value} className={createTimerMode === tm.value ? "selected" : ""} onClick={() => setCreateTimerMode(tm.value)}>{tm.label}</button>
                ))}
              </div>
              {createTimerMode === "timed" ? (
                <div className="settings-row" style={{ marginTop: 10 }}>
                  <div className="settings-block">
                    <strong>提示时间（秒）</strong>
                    <select value={createTimerClueSeconds} onChange={(e) => setCreateTimerClueSeconds(Number(e.target.value))}>
                      {[60, 90, 120].map(v => <option key={v} value={v}>{v} 秒</option>)}
                    </select>
                  </div>
                  <div className="settings-block">
                    <strong>猜词时间（秒）</strong>
                    <select value={createTimerGuessSeconds} onChange={(e) => setCreateTimerGuessSeconds(Number(e.target.value))}>
                      {[60, 90, 120].map(v => <option key={v} value={v}>{v} 秒</option>)}
                    </select>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="settings-row">
              <div className="settings-block">
                <strong>翻牌模式</strong>
                <div className="selection-grid">
                  {flipModes.map((fm) => (
                    <button key={fm.value} className={createFlipMode === fm.value ? "selected" : ""} onClick={() => setCreateFlipMode(fm.value)}>{fm.label}</button>
                  ))}
                </div>
                <p className="hint-text" style={{ marginTop: 6 }}>
                  {flipModes.find(m => m.value === createFlipMode)?.hint}
                </p>
              </div>
              <div className="settings-block">
                <strong>中立词数（0=使用默认）</strong>
                <select value={createNeutralCount} onChange={(e) => setCreateNeutralCount(Number(e.target.value))}>
                  <option value={0}>使用默认</option>
                  {getNeutralOptions(createBoardMode).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="settings-block">
              <strong>题库来源</strong>
              <div className="selection-grid">
                <button className={packSource === "builtin" ? "selected" : ""} onClick={() => setPackSource("builtin")}>内置</button>
                <button className={packSource === "account" ? "selected" : ""} disabled={!namedAccount} onClick={() => setPackSource("account")}>我的题库</button>
                <button className={packSource === "public" ? "selected" : ""} onClick={() => setPackSource("public")}>公共题库</button>
              </div>

              {packSource === "builtin" ? (
                <div className="pack-select-list" style={{ marginTop: 10 }}>
                  {wordPackSummaries.map((pack) => (
                    <button key={pack.id} className={`pack-select-row ${selectedBuiltinPackId === pack.id ? "pack-select-row-active" : ""}`} onClick={() => setSelectedBuiltinPackId(pack.id)}>
                      <span className="pack-select-name">{pack.name}</span>
                      <span className="pack-select-meta">{pack.entryCount} 个词</span>
                      <span className="pack-select-action">{selectedBuiltinPackId === pack.id ? "✓ 已选中" : "选择此题库"}</span>
                    </button>
                  ))}
                </div>
              ) : packSource === "account" ? (
                <div className="pack-select-list" style={{ marginTop: 10 }}>
                  {accountPacks.length === 0 ? <p className="empty-text">还没有个人题库。</p> : null}
                  {accountPacks.map((pack) => (
                    <button key={pack.id} className={`pack-select-row ${selectedAccountPackId === pack.id ? "pack-select-row-active" : ""}`} onClick={() => setSelectedAccountPackId(pack.id)}>
                      <span className="pack-select-name">{pack.name}</span>
                      <span className="pack-select-meta">{pack.entries.length} 个词</span>
                      <span className="pack-select-action">{selectedAccountPackId === pack.id ? "✓ 已选中" : "选择此题库"}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="pack-select-list" style={{ marginTop: 10 }}>
                  {publicPacks.length === 0 ? <p className="empty-text">还没有公共题库。</p> : null}
                  {publicPacks.map((pack) => {
                    const key = makePublicPackKey(pack);
                    return (
                      <button key={key} className={`pack-select-row ${selectedPublicPackId === key ? "pack-select-row-active" : ""}`} onClick={() => setSelectedPublicPackId(key)}>
                        <span className="pack-select-name">{pack.name}</span>
                        <span className="pack-select-meta">{pack.entryCount} 个词 / {pack.ownerUsername}</span>
                        <span className="pack-select-action">{selectedPublicPackId === key ? "✓ 已选中" : "选择此题库"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {currentPackName ? (
              <div className="current-pack-card">
                <span className="micro-label">当前使用</span>
                <strong className="current-pack-name">{currentPackName}</strong>
                <span className="current-pack-meta">
                  {currentPackCount !== null ? `${currentPackCount} 个词` : ""}
                  {currentPackOwner ? ` / ${currentPackOwner}` : ""}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rg-create-card" style={{ marginBottom: 14, padding: 14, background: "var(--rg-accent-light)", borderRadius: 12, border: "1px solid rgba(99,102,241,0.15)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>🎴 揭幕猜番</div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                上传动画截图，用 9×9 白幕遮住。玩家自由翻牌，裁判判定答案。
              </p>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>可选准备第一题，进房间后也能添加更多题目。</p>
            <div className="settings-block" style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 12, background: "var(--surface-soft)" }}>
              <label className="file-upload-btn" style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "var(--rg-accent-light)", color: "var(--rg-accent-text)" }}>
                上传图片
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleRgFileChange} style={{ display: "none" }} />
              </label>
              {rgPreviewUrl && (
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <img src={rgPreviewUrl} alt="预览" style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, border: "1px solid var(--border)" }} />
                </div>
              )}
              <input value={rgImageUrl} onChange={e => { setRgImageUrl(e.target.value); setRgPreviewUrl(null); }} placeholder="或粘贴图片 URL" style={{ width: "100%", marginTop: 8, fontSize: 12 }} />
            </div>
            <div className="settings-block">
              <strong>标准答案</strong>
              <input value={rgAnswer} onChange={(e) => setRgAnswer(e.target.value)} placeholder="例如：新世纪福音战士" style={{ width: "100%" }} />
            </div>
            <div className="settings-block">
              <strong>题目数量</strong>
              <select value={rgPuzzleCount} onChange={(e) => setRgPuzzleCount(Number(e.target.value))}>
                {[1, 2, 3, 5, 10].map(v => <option key={v} value={v}>{v} 题</option>)}
              </select>
            </div>
            <button
              onClick={() => setShowRgAdvanced(!showRgAdvanced)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", padding: 0, marginBottom: 8 }}
            >
              高级设置（别名、提示）{showRgAdvanced ? " ▴" : " ▾"}
            </button>
            {showRgAdvanced && (
              <>
                <div className="settings-block">
                  <strong>可接受别名，每行一个</strong>
                  <textarea value={rgAliases} onChange={(e) => setRgAliases(e.target.value)} placeholder="EVA&#10;Evangelion" rows={2} style={{ width: "100%" }} />
                </div>
                <div className="settings-block">
                  <strong>提示，每行一个</strong>
                  <textarea value={rgHints} onChange={(e) => setRgHints(e.target.value)} placeholder="经典机甲番&#10;庵野秀明" rows={2} style={{ width: "100%" }} />
                </div>
              </>
            )}
          </>
        )}

        <button
          className="primary-button"
          onClick={handleCreate}
          disabled={!effectiveIdentity || (gameMode === "codenames" && ((packSource === "account" && !selectedAccountPack) || (packSource === "public" && !selectedPublicPack)))}
        >
          {gameMode === "reveal-guess" ? "创建揭幕房间" : "创建房间"}
        </button>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
