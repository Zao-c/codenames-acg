import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";
import type { UserStats } from "@acg-codenames/shared";

type AchievementItem = {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
};

function computeCurrentTitle(stats: UserStats | null): string {
  if (!stats || stats.gamesPlayed === 0) return "尚未解锁";
  const winRate = stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;
  if (winRate >= 0.7 && stats.gamesPlayed >= 5) return "稳健队长";
  if (stats.gamesPlayed >= 10) return "结社常客";
  if (stats.roomsHosted >= 5) return "主场之王";
  if (stats.wins >= 3) return "胜场猎手";
  return "新人社员";
}

function computeAchievements(stats: UserStats | null): AchievementItem[] {
  const winRate = stats && stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;
  return [
    {
      id: "oracle",
      title: "神谕队长",
      description: "单回合提示全中且无误伤",
      unlocked: stats ? stats.wins >= 3 : false
    },
    {
      id: "regular",
      title: "结社常客",
      description: "累计参与 10 场对局",
      unlocked: stats ? stats.gamesPlayed >= 10 : false
    },
    {
      id: "host",
      title: "主场之王",
      description: "累计主持 5 场房间",
      unlocked: stats ? stats.roomsHosted >= 5 : false
    },
    {
      id: "steady",
      title: "稳健队员",
      description: "胜率 ≥ 50% 且至少 3 场",
      unlocked: stats ? winRate >= 0.5 && stats.gamesPlayed >= 3 : false
    },
    {
      id: "veteran",
      title: "百战勇士",
      description: "累计参与 20 场对局",
      unlocked: stats ? stats.gamesPlayed >= 20 : false
    },
    {
      id: "rising",
      title: "初露锋芒",
      description: "完成第 1 场对局",
      unlocked: stats ? stats.gamesPlayed >= 1 : false
    }
  ];
}

function computeRecentPerformance(stats: UserStats | null): string[] {
  if (!stats || stats.gamesPlayed === 0) return [];
  const lines: string[] = [];
  const winRate = Math.round((stats.wins / stats.gamesPlayed) * 100);
  lines.push(`近 ${stats.gamesPlayed} 场胜率 ${winRate}%`);
  if (stats.roomsHosted > 0) lines.push(`主持了 ${stats.roomsHosted} 间密令房`);
  if (stats.wins > 0 && stats.gamesPlayed - stats.wins > 0) {
    lines.push(`胜 ${stats.wins} 场 · 负 ${stats.gamesPlayed - stats.wins} 场`);
  }
  return lines;
}

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

  const stats = namedAccount?.stats ?? null;
  const currentTitle = computeCurrentTitle(stats);
  const achievements = computeAchievements(stats);
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const recentLines = computeRecentPerformance(stats);

  return (
    <>
      <section className="panel profile-panel">
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
          <div className="profile-title-badge">
            <span className="profile-title-label">当前称号</span>
            <span className="profile-title-value">{currentTitle}</span>
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
          <button onClick={() => { logoutNamedUser(); navigate("/login?switch=1"); }}>切换账户</button>
          {namedAccount ? (
            <button onClick={() => { logoutNamedUser(); navigate("/login?switch=1"); }}>退出登录</button>
          ) : null}
        </div>
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading">
          <h2>成就</h2>
          <span className="soft-chip">{unlockedCount} / {achievements.length}</span>
        </div>
        <div className="achievement-grid">
          {achievements.map((ach) => (
            <div key={ach.id} className={`achievement-card${ach.unlocked ? "" : " locked"}`}>
              <span className="achievement-icon">{ach.unlocked ? "🏆" : "🔒"}</span>
              <div className="achievement-body">
                <strong className="achievement-title">{ach.title}</strong>
                <span className="achievement-desc">{ach.description}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading">
          <h2>默契搭档</h2>
        </div>
        {stats && stats.gamesPlayed > 0 ? (
          <div className="partner-card">
            <div className="partner-card-body">
              <strong className="partner-card-title">暂无数据</strong>
              <span className="partner-card-desc">多玩几局，系统就会显示你的最佳搭档</span>
            </div>
          </div>
        ) : (
          <p className="empty-text">还没有默契搭档，多玩几局就会出现。</p>
        )}
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading">
          <h2>最近表现</h2>
        </div>
        {recentLines.length > 0 ? (
          <div className="recent-grid">
            {recentLines.map((line, i) => (
              <div key={i} className="recent-stat">
                <span>{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">暂无最近表现，去开一局留下战绩吧。</p>
        )}
        {namedAccount ? (
          <p className="panel-subtle" style={{ marginTop: 12 }}>
            加入于 {new Date(namedAccount.createdAt).toLocaleDateString("zh-CN")}
          </p>
        ) : null}
      </section>

      {error ? <p className="error-text">{error}</p> : null}
    </>
  );
}
