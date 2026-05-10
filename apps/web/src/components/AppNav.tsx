import { useNavigate, useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function AppNav() {
  const { effectiveIdentity, room } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  const inRoom = Boolean(room);
  const isActive = (path: string) => location.pathname === path ? "selected" : "";

  const navLinks = [
    { path: "/", label: "首页", icon: "🏠" },
    { path: "/create", label: "开房", icon: "🃏" },
    { path: "/packs", label: "题库", icon: "📚" },
    { path: "/profile", label: "我的", icon: "👤" },
  ];

  return (
    <nav className="app-nav">
      <div className="nav-brand" onClick={() => navigate("/")} role="button" tabIndex={0}>
        🃏 行动代号
      </div>
      <div className="nav-links">
        {navLinks.map((link) => (
          <button key={link.path} className={isActive(link.path)} onClick={() => navigate(link.path)}>
            <span className="nav-icon">{link.icon}</span>
            <span className="nav-label">{link.label}</span>
          </button>
        ))}
      </div>
      {effectiveIdentity ? (
        <div className="nav-identity">
          <span className="soft-chip">{effectiveIdentity.nickname}</span>
        </div>
      ) : null}
    </nav>
  );
}

export function MobileNav() {
  const { room } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  const inRoom = Boolean(room);

  if (inRoom) {
    const tabs = [
      { path: "", label: "棋盘", icon: "🎯" },
      { path: "", label: "玩家", icon: "👥" },
      { path: "", label: "聊天", icon: "💬" },
    ];
    return (
      <nav className="mobile-nav">
        {tabs.map((tab) => (
          <button key={tab.label} className="mobile-nav-tab">
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    );
  }

  const navLinks = [
    { path: "/", label: "首页", icon: "🏠" },
    { path: "/create", label: "开房", icon: "🃏" },
    { path: "/packs", label: "题库", icon: "📚" },
    { path: "/profile", label: "我的", icon: "👤" },
  ];

  return (
    <nav className="mobile-nav">
      {navLinks.map((link) => (
        <button
          key={link.path}
          className={`mobile-nav-tab ${location.pathname === link.path ? "selected" : ""}`}
          onClick={() => navigate(link.path)}
        >
          <span>{link.icon}</span>
          <span>{link.label}</span>
        </button>
      ))}
    </nav>
  );
}
