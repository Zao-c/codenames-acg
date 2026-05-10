import { useNavigate, useLocation } from "react-router-dom";
import { useGame } from "../context/GameContext";

export function AppNav() {
  const { effectiveIdentity, room, leaveRoom, copyLink, copied, focusMode, setFocusMode } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  const inRoom = Boolean(room) && location.pathname.startsWith("/room/");
  const isActive = (path: string) => location.pathname === path ? "selected" : "";

  if (inRoom) {
    return (
      <nav className="app-nav app-nav-room">
        <div className="nav-brand" onClick={() => navigate("/")} role="button" tabIndex={0}>
          🃏 词牌结社
        </div>
        <div className="nav-links">
          <button onClick={() => { void copyLink(); }}>{copied ? "已复制链接" : "复制邀请链接"}</button>
          <button onClick={() => { setFocusMode(!focusMode); }}>{focusMode ? "退出专注" : "专注模式"}</button>
          <button onClick={() => { if (window.confirm("确定要离开房间吗？")) { leaveRoom(); navigate("/"); } }}>离开房间</button>
        </div>
        {effectiveIdentity ? (
          <div className="nav-identity">
            <span className="soft-chip">{effectiveIdentity.nickname}</span>
          </div>
        ) : null}
      </nav>
    );
  }

  const navLinks = [
    { path: "/", label: "首页", icon: "🏠" },
    { path: "/create", label: "密令（开房）", icon: "🃏" },
    { path: "/packs", label: "档案（题库）", icon: "📚" },
    { path: "/profile", label: "我的", icon: "👤" },
  ];

  return (
    <nav className="app-nav">
      <div className="nav-brand" onClick={() => navigate("/")} role="button" tabIndex={0}>
        🃏 词牌结社
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
  const { room, focusMode, setFocusMode, setSideTab, sideTab, mobileRoomTab, setMobileRoomTab } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  const inRoom = Boolean(room) && location.pathname.startsWith("/room/");

  if (inRoom) {
    return (
      <nav className="mobile-nav">
        <button
          className={`mobile-nav-tab ${mobileRoomTab === "board" ? "selected" : ""}`}
          onClick={() => { setMobileRoomTab("board"); setFocusMode(false); }}
        >
          <span>🎯</span><span>棋盘</span>
        </button>
        <button
          className={`mobile-nav-tab ${mobileRoomTab === "players" ? "selected" : ""}`}
          onClick={() => { setMobileRoomTab("players"); setFocusMode(false); setSideTab("spectators"); }}
        >
          <span>👥</span><span>玩家</span>
        </button>
        <button
          className={`mobile-nav-tab ${mobileRoomTab === "chat" ? "selected" : ""}`}
          onClick={() => { setMobileRoomTab("chat"); setFocusMode(false); setSideTab("chat"); }}
        >
          <span>💬</span><span>聊天</span>
        </button>
      </nav>
    );
  }

  const navLinks = [
    { path: "/", label: "首页", icon: "🏠" },
    { path: "/create", label: "密令（开房）", icon: "🃏" },
    { path: "/packs", label: "档案（题库）", icon: "📚" },
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
