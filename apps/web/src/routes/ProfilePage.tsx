import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import { AvatarBadge } from "../components/AvatarBadge";
import { PrivateIdentityTools } from "../components/PrivateIdentityTools";
import { Dialog } from "../components/UI";
import { privateIdentityKey } from "../lib/private-identity";
import { defaultTitle, isTitleUnlocked, unlockedTitles, type UserStats } from "@acg-codenames/shared";

function winRate(stats: UserStats | null | undefined): number {
  return stats && stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;
}

export function ProfilePage() {
  const {
    effectiveIdentity, namedAccount,
    handleAvatarUpload, logoutNamedUser, updateTitle, error
  } = useGame();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [titleDialog, setTitleDialog] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [localTitle, setLocalTitle] = useState<string | null>(null);

  const identityKey = effectiveIdentity ? `${effectiveIdentity.mode}:${effectiveIdentity.username || effectiveIdentity.nickname}` : "";
  useEffect(() => {
    try { setLocalTitle(localStorage.getItem(`cipai.title:${privateIdentityKey()}`)); } catch { setLocalTitle(null); }
  }, [identityKey]);

  if (!effectiveIdentity) {
    return (
      <section className="panel profile-panel">
        <div className="panel-heading"><h2>个人资料</h2></div>
        <p className="hint-text">你尚未登录。</p>
        <button className="primary-button" onClick={() => navigate("/login")} style={{ marginTop: 12 }}>前往登录</button>
      </section>
    );
  }

  const stats = namedAccount?.stats ?? null;
  const titles = unlockedTitles(stats);
  const storedTitle = namedAccount?.title ?? localTitle;
  const equippedTitle = storedTitle && isTitleUnlocked(stats, storedTitle) ? storedTitle : defaultTitle(stats);
  const canChooseTitle = titles.length > 1;
  const modeLabel = effectiveIdentity.mode === "named" ? "用户名账户" : "游客模式";

  async function equip(title: string) {
    if (!isTitleUnlocked(stats, title)) { setTitleError("该称号尚未解锁"); return; }
    setTitleBusy(true); setTitleError("");
    try {
      await updateTitle(title);
      setLocalTitle(title);
      setTitleDialog(false);
    } catch (e) {
      setTitleError((e as Error).message);
    } finally {
      setTitleBusy(false);
    }
  }

  return (
    <>
      <section className="panel profile-panel">
        <div className="profile-card">
          <AvatarBadge avatarUrl={effectiveIdentity.avatarUrl} fallback={effectiveIdentity.nickname} size="large" />
          <div className="profile-card-body">
            <strong className="profile-card-name">{effectiveIdentity.nickname}</strong>
            <span className="soft-chip">{modeLabel}</span>
            <span className="profile-equipped">当前称号 · <b>{equippedTitle}</b></span>
          </div>
          <div className="profile-card-actions">
            <button onClick={() => { setTitleError(""); setTitleDialog(true); }}>更换称号</button>
          </div>
        </div>

        {namedAccount ? (
          <div className="profile-stats-grid">
            <div className="profile-stat"><strong>{namedAccount.stats.gamesPlayed}</strong><span>总场次</span></div>
            <div className="profile-stat"><strong>{namedAccount.stats.wins}</strong><span>胜场</span></div>
            <div className="profile-stat"><strong>{winRate(namedAccount.stats)}%</strong><span>生涯胜率</span></div>
            <div className="profile-stat"><strong>{namedAccount.stats.roomsHosted}</strong><span>主持房间</span></div>
          </div>
        ) : (
          <p className="hint-text profile-guest-note">游客模式不记录跨设备战绩。登录用户名账户后可保存生涯数据与称号。</p>
        )}
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading"><h2>称号与成就</h2><span className="soft-chip">{titles.length} / 7 已解锁</span></div>
        <div className="achievement-grid">
          {unlockedTitles(stats).map((entry, index) => (
            <div key={entry.id} className={`achievement-card${index === 0 ? " featured" : ""}`}>
              <span className="achievement-icon">{entry.title === equippedTitle ? "★" : "🏆"}</span>
              <div className="achievement-body">
                <strong className="achievement-title">{entry.title}</strong>
                <span className="achievement-desc">{entry.description} · 已解锁</span>
              </div>
              {entry.title === equippedTitle ? <span className="soft-chip">佩戴中</span> : <button onClick={() => void equip(entry.title)} disabled={titleBusy}>佩戴</button>}
            </div>
          ))}
        </div>
        {!namedAccount && <p className="hint-text">游客只能使用“新人社员”；登录后按真实战绩解锁其余称号。</p>}
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading"><h2>生涯概览</h2></div>
        {stats && stats.gamesPlayed > 0 ? (
          <div className="recent-grid">
            <div className="recent-stat"><strong>{stats.gamesPlayed} 场 · {stats.wins} 胜</strong><span>以下为生涯累计数据，不是“最近十场”。</span></div>
            <div className="recent-stat"><strong>{stats.roomsHosted} 间房间</strong><span>主持数据归入生涯统计，不影响称号解锁优先级。</span></div>
            <div className="recent-stat"><strong>{stats.losses} 场未胜</strong><span>仅统计已正常结算的对局；终止或弃权不计为胜场。</span></div>
          </div>
        ) : (
          <p className="empty-text">还没有生涯战绩，去开一局留下记录吧。</p>
        )}
        {namedAccount ? <p className="panel-subtle" style={{ marginTop: 12 }}>加入于 {new Date(namedAccount.createdAt).toLocaleDateString("zh-CN")}</p> : null}
      </section>

      <section className="panel profile-panel profile-section">
        <div className="section-heading"><h2>我的内容</h2></div>
        <div className="profile-content-links">
          <button onClick={() => navigate("/packs")}>我的文字题库</button>
          <button onClick={() => navigate("/anime-pools")}>我的动画作品池</button>
          <button onClick={() => navigate("/anime-pools?scope=mine")}>我创建的牌库</button>
        </div>
      </section>

      <section className="panel profile-panel profile-section">
        <details className="profile-security" open>
          <summary>身份与安全</summary>
          <p className="hint-text">头像、身份备份与账户切换都放在这里，不出现在公共作品池广场。</p>
          <div className="profile-actions">
            {namedAccount ? <>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { void handleAvatarUpload(e.target.files?.[0] ?? null); }} />
              <button onClick={() => fileRef.current?.click()}>更换头像</button>
            </> : null}
            <button onClick={() => { logoutNamedUser(); navigate("/login?switch=1"); }}>切换账户</button>
            {namedAccount ? <button className="danger-button" onClick={() => { if (window.confirm("退出登录后将回到首页，游客身份仍可继续观战。继续？")) { logoutNamedUser(); navigate("/"); } }}>退出登录</button> : null}
          </div>
          <PrivateIdentityTools restored={() => navigate("/profile")} />
        </details>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      {titleDialog && <Dialog title="选择佩戴称号" close={() => setTitleDialog(false)}>
        <p className="hint-text">只能佩戴已解锁的称号；用户名账户的佩戴结果会保存到服务器，刷新后仍生效。</p>
        <div className="title-choice-list">
          {unlockedTitles(stats).map(entry => <button key={entry.id} className={entry.title === equippedTitle ? "selected" : ""} aria-pressed={entry.title === equippedTitle} disabled={titleBusy} onClick={() => void equip(entry.title)}><strong>{entry.title}</strong><small>{entry.description}</small>{entry.title === equippedTitle && <span className="soft-chip">当前</span>}</button>)}
        </div>
        {titleError && <p className="error-text" role="alert">{titleError}</p>}
        {canChooseTitle && <p className="hint-text">未解锁的称号不会出现在这里；即使伪造请求，服务端也会拒绝。</p>}
      </Dialog>}
    </>
  );
}
