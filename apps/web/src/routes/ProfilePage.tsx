import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";

export function ProfilePage() {
  const {
    effectiveIdentity, namedAccount,
    handleAvatarUpload, logoutNamedUser, error
  } = useGame();
  const navigate = useNavigate();

  if (!effectiveIdentity) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h2>个人资料</h2>
        </div>
        <p className="hint-text">你尚未登录。</p>
        <button className="primary-button" onClick={() => navigate("/login")} style={{ marginTop: 12 }}>前往登录</button>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>当前身份</h2>
        </div>
        <div className="profile-identity">
          <AvatarBadge
            avatarUrl={effectiveIdentity.avatarUrl}
            fallback={effectiveIdentity.nickname}
            size="large"
          />
          <div className="profile-stats">
            <strong>{effectiveIdentity.nickname}</strong>
            {effectiveIdentity.mode === "named" ? (
              <span>用户名账户</span>
            ) : (
              <span>游客模式</span>
            )}
          </div>
        </div>

        {namedAccount ? (
          <>
            <div className="profile-stats" style={{ marginBottom: 16 }}>
              <p>总场次 {namedAccount.stats.gamesPlayed} · 胜 {namedAccount.stats.wins} / 负 {namedAccount.stats.losses}</p>
              <p>主持 {namedAccount.stats.roomsHosted} 次 · 胜率 {namedAccount.stats.gamesPlayed > 0 ? Math.round((namedAccount.stats.wins / namedAccount.stats.gamesPlayed) * 100) : 0}%</p>
            </div>
            <div className="upload-field">
              <span>上传头像</span>
              <input type="file" accept="image/*" onChange={(e) => { void handleAvatarUpload(e.target.files?.[0] ?? null); }} />
            </div>
          </>
        ) : null}

        <div className="profile-actions">
          <button className="primary-button" onClick={() => navigate("/packs")}>我的题库</button>
          <button onClick={() => navigate("/login")}>切换账户</button>
          {namedAccount ? (
            <button className="danger-button" onClick={() => { logoutNamedUser(); navigate("/"); }}>退出登录</button>
          ) : null}
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
