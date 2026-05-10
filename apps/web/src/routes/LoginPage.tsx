import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function LoginPage() {
  const {
    namedUsernameInput, setNamedUsernameInput,
    recentUsers, handleNamedLogin, continueAsGuest,
    guestNicknameInput, setGuestNicknameInput, error
  } = useGame();
  const navigate = useNavigate();
  const location = useLocation();
  const isSwitching = new URLSearchParams(location.search).get("switch") === "1";
  const [mode, setMode] = useState<"named" | "guest">("named");

  return (
    <div className="login-page">
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>词牌结社</h1>
        <p className="eyebrow" style={{ marginTop: 6 }}>ACG 猜词推理派对</p>
        {isSwitching ? <p className="hint-text" style={{ marginTop: 8 }}>更换身份后需要重新加入房间</p> : null}
      </div>

      <div className="login-card">
        <div className="selection-grid">
          <button className={mode === "named" ? "selected" : ""} onClick={() => setMode("named")}>用户名</button>
          <button className={mode === "guest" ? "selected" : ""} onClick={() => setMode("guest")}>游客</button>
        </div>

        {mode === "named" ? (
          <>
            <label className="field">
              <span>用户名</span>
              <input
                value={namedUsernameInput}
                onChange={(e) => setNamedUsernameInput(e.target.value)}
                maxLength={24}
                placeholder="输入用户名"
                onKeyDown={(e) => { if (e.key === "Enter") { void handleNamedLogin(); } }}
              />
            </label>
            {recentUsers.length > 0 ? (
              <div className="recent-users-row">
                {recentUsers.map((u) => (
                  <button key={u} className="chip-button" onClick={() => { void handleNamedLogin(u); }}>{u}</button>
                ))}
              </div>
            ) : null}
            <button className="primary-button" onClick={() => { void handleNamedLogin(); }} disabled={!namedUsernameInput.trim()}>
              进入结社
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>昵称</span>
              <input
                value={guestNicknameInput}
                onChange={(e) => setGuestNicknameInput(e.target.value)}
                maxLength={12}
                placeholder="输入昵称直接开玩"
                onKeyDown={(e) => { if (e.key === "Enter") { continueAsGuest(); } }}
              />
            </label>
            <button className="primary-button" onClick={continueAsGuest} disabled={!guestNicknameInput.trim()}>
              快速进入
            </button>
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        <p className="login-footer">当前版本仅用用户名保存头像、题库和战绩，无需密码。</p>
      </div>
    </div>
  );
}
