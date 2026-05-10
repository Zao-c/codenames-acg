import { useGame } from "../context/GameContext";
import { wordPackSummaries } from "@acg-codenames/shared";

export function CreateRoomPage() {
  const {
    effectiveIdentity, createBoardMode, setCreateBoardMode,
    packSource, setPackSource,
    selectedBuiltinPackId, setSelectedBuiltinPackId,
    selectedAccountPackId, setSelectedAccountPackId,
    selectedPublicPackId, setSelectedPublicPackId,
    accountPacks, publicPacks, namedAccount,
    selectedAccountPack, selectedPublicPack,
    createRoom, makePublicPackKey, error, setError, boardModes,
    chooseAccountPackForCreate
  } = useGame();

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">Create room</p>
            <h2>创建房间</h2>
          </div>
          <span className="soft-chip">{createBoardMode}</span>
        </div>
        <div className="settings-block">
          <strong>棋盘模式</strong>
          <div className="selection-grid">
            {boardModes.map((mode) => (
              <button key={mode} className={createBoardMode === mode ? "selected" : ""} onClick={() => setCreateBoardMode(mode)}>{mode}</button>
            ))}
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
            <select value={selectedBuiltinPackId} onChange={(e) => setSelectedBuiltinPackId(e.target.value)}>
              {wordPackSummaries.map((pack) => (
                <option key={pack.id} value={pack.id}>{pack.name} ({pack.entryCount})</option>
              ))}
            </select>
          ) : packSource === "account" ? (
            <select value={selectedAccountPackId} onChange={(e) => setSelectedAccountPackId(e.target.value)}>
              <option value="">选择我的题库</option>
              {accountPacks.map((pack) => (
                <option key={pack.id} value={pack.id}>{pack.name} ({pack.entries.length})</option>
              ))}
            </select>
          ) : (
            <select value={selectedPublicPackId} onChange={(e) => setSelectedPublicPackId(e.target.value)}>
              <option value="">选择公共题库</option>
              {publicPacks.map((pack) => (
                <option key={makePublicPackKey(pack)} value={makePublicPackKey(pack)}>{pack.name} ({pack.entries.length}) / {pack.ownerUsername}</option>
              ))}
            </select>
          )}
          {packSource === "account" ? (
            selectedAccountPack ? (
              <p className="hint-text">当前开房将使用：<strong>{selectedAccountPack.name}</strong></p>
            ) : (
              <p className="hint-text">请先从"我的题库"里选择一个题库用于开房。</p>
            )
          ) : packSource === "public" ? (
            selectedPublicPack ? (
              <p className="hint-text">当前开房将使用：<strong>{selectedPublicPack.name}</strong> / {selectedPublicPack.ownerUsername}</p>
            ) : (
              <p className="hint-text">请选择一个公开题库；没有时可以先在"我的题库"公开自己的题库。</p>
            )
          ) : null}
        </div>
        <button
          className="primary-button"
          onClick={createRoom}
          disabled={!effectiveIdentity || (packSource === "account" && !selectedAccountPack) || (packSource === "public" && !selectedPublicPack)}
        >
          创建房间
        </button>
      </section>

      {accountPacks.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">My packs</p>
              <h2>我的题库</h2>
            </div>
            <span className="soft-chip">{accountPacks.length} 个</span>
          </div>
          <div className="pack-library">
            {accountPacks.map((pack) => (
              <div className={`pack-card ${selectedAccountPackId === pack.id ? "pack-card-active" : ""}`} key={pack.id}>
                <div>
                  <strong>{pack.name}</strong>
                  <p className="pack-card-meta">{pack.entries.length} 个词 / {pack.isPublic ? "已公开" : "仅自己可用"}</p>
                </div>
                <div className="pack-card-actions">
                  <button onClick={() => { chooseAccountPackForCreate(pack.id); }}>选择并创建房间</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {publicPacks.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">Public packs</p>
              <h2>公共题库</h2>
            </div>
            <span className="soft-chip">{publicPacks.length} 个</span>
          </div>
          <div className="pack-library">
            {publicPacks.slice(0, 8).map((pack) => (
              <div className={`pack-card ${selectedPublicPackId === makePublicPackKey(pack) ? "pack-card-active" : ""}`} key={makePublicPackKey(pack)}>
                <div>
                  <strong>{pack.name}</strong>
                  <p className="pack-card-meta">{pack.entries.length} 个词 / {pack.ownerUsername}</p>
                </div>
                <div className="pack-card-actions">
                  <button onClick={() => { setSelectedPublicPackId(makePublicPackKey(pack)); setPackSource("public"); }}>选择并创建房间</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
