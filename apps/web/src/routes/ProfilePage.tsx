import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";

export function ProfilePage() {
  const {
    effectiveIdentity, namedAccount,
    handleAvatarUpload, logoutNamedUser, error
  } = useGame();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!effectiveIdentity) {
    return (
      <section className="panel profile-panel">
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
        <div className="profile-card">
          <AvatarBadge
            avatarUrl={effectiveIdentity.avatarUrl}
            fallback={effectiveIdentity.nickname}
            size="large"
          />
          <div className="profile-card-body">
            <strong className="profile-card-name">{effectiveIdentity.nickname}</strong>
            <span className="soft-chip">
              {effectiveIdentity.mode === "named" ? "用户名账户" : "游客模式"}
            </span>
          </div>
        </div>

        {namedAccount ? (
          <div className="profile-stats-grid">
            <div className="profile-stat">
              <strong>{namedAccount.stats.gamesPlayed}</strong>
              <span>总场次</span>
            </div>
            <div className="profile-stat">
              <strong>{namedAccount.stats.wins}</strong>
              <span>胜场</span>
            </div>
            <div className="profile-stat">
              <strong>{namedAccount.stats.roomsHosted}</strong>
              <span>主持</span>
            </div>
            <div className="profile-stat">
              <strong>{namedAccount.stats.gamesPlayed > 0 ? Math.round((namedAccount.stats.wins / namedAccount.stats.gamesPlayed) * 100) : 0}%</strong>
              <span>胜率</span>
            </div>
          </div>
        ) : null}

        <div className="profile-actions">
          <div className="profile-actions-group">
            <button className="primary-button" onClick={() => navigate("/packs")}>我的题库</button>
            {namedAccount ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => { void handleAvatarUpload(e.target.files?.[0] ?? null); }}
                />
                <button onClick={() => fileRef.current?.click()}>更换头像</button>
              </>
            ) : null}
          </div>
          <div className="profile-actions-group">
            <button onClick={() => { logoutNamedUser(); navigate("/login?switch=1"); }}>切换账户</button>
            {namedAccount ? (
              <button onClick={() => { logoutNamedUser(); navigate("/login?switch=1"); }}>退出登录</button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
