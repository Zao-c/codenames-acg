import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";

export function ProfilePage() {
  const {
    effectiveIdentity, namedAccount, guestNicknameInput, setGuestNicknameInput,
    namedUsernameInput, setNamedUsernameInput, recentUsers,
    handleNamedLogin, continueAsGuest, handleAvatarUpload, logoutNamedUser, error
  } = useGame();
  const navigate = useNavigate();

  return (
    <>
      {namedAccount ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="micro-label">Profile</p>
              <h2>个人资料</h2>
            </div>
            <span className="soft-chip">用户名账户</span>
          </div>
          <div className="account-summary">
            <AvatarBadge avatarUrl={namedAccount.avatarUrl} fallback={namedAccount.username} size="large" />
            <div className="account-stats">
              <strong>{namedAccount.username}</strong>
              <p>总场次 {namedAccount.stats.gamesPlayed} · 胜率 {namedAccount.stats.gamesPlayed > 0 ? Math.round((namedAccount.stats.wins / namedAccount.stats.gamesPlayed) * 100) : 0}%</p>
              <p>🏆 胜 {namedAccount.stats.wins} / 💀 负 {namedAccount.stats.losses} / 🏠 主持 {namedAccount.stats.roomsHosted} 次</p>
            </div>
          </div>
          <div className="upload-field">
            <span>上传头像图片</span>
            <input type="file" accept="image/*" onChange={(e) => { void handleAvatarUpload(e.target.files?.[0] ?? null); }} />
          </div>
          <button onClick={() => { logoutNamedUser(); navigate("/"); }}>退出用户名账户</button>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="micro-label">Login</p>
            <h2>{namedAccount ? "切换账户" : "登录"}</h2>
          </div>
          <span className="soft-chip">{effectiveIdentity ? `${effectiveIdentity.nickname}（${effectiveIdentity.mode === "named" ? "账户" : "游客"}）` : "未登录"}</span>
        </div>

        <div className="settings-block">
          <strong>用户名登录</strong>
          <div className="toolbar-inline compact-stack">
            <label className="field">
              <span>用户名</span>
              <input value={namedUsernameInput} onChange={(e) => setNamedUsernameInput(e.target.value)} maxLength={24} placeholder="例如：Miku厨" />
            </label>
            <button className="primary-button" onClick={() => { void handleNamedLogin(); }}>登录</button>
          </div>
          {recentUsers.length > 0 ? (
            <div className="chip-wrap">
              {recentUsers.map((username) => (
                <button key={username} className="chip-button" onClick={() => { void handleNamedLogin(username); }}>{username}</button>
              ))}
            </div>
          ) : null}
          <p className="hint-text">当前版本只有用户名，不做密码校验。</p>
        </div>

        <div className="settings-block">
          <strong>游客模式</strong>
          <div className="toolbar-inline compact-stack">
            <label className="field">
              <span>游客昵称</span>
              <input value={guestNicknameInput} onChange={(e) => setGuestNicknameInput(e.target.value)} maxLength={12} placeholder="例如：小夜" />
            </label>
            <button className="primary-button" onClick={continueAsGuest}>游客进入</button>
          </div>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
