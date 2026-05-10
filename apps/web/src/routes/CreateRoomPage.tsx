import { useGame } from "../context/GameContext";
import { wordPackSummaries, type ScoringMode } from "@acg-codenames/shared";

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
    chooseAccountPackForCreate,
    scoringMode, setScoringMode
  } = useGame();

  const scoringModes: { value: ScoringMode; label: string; hint: string }[] = [
    { value: "classic", label: "经典", hint: "胜利队伍 +1" },
    { value: "scoring", label: "积分", hint: "每次猜词计分" },
  ];

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>创建房间</h2>
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
          {selectedAccountPack && packSource === "account" ? (
            <p className="hint-text">当前题库：<strong>{selectedAccountPack.name}</strong></p>
          ) : selectedPublicPack && packSource === "public" ? (
            <p className="hint-text">当前题库：<strong>{selectedPublicPack.name}</strong></p>
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

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
