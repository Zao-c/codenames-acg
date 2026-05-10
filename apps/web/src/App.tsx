import { useEffect, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import { useGame } from "./context/GameContext";
import { AppNav, MobileNav } from "./components/AppNav";
import { HomePage } from "./routes/HomePage";
import { CreateRoomPage } from "./routes/CreateRoomPage";
import { PacksPage } from "./routes/PacksPage";
import { ProfilePage } from "./routes/ProfilePage";
import { RoomPage } from "./routes/RoomPage";

function JoinRoomFromLink() {
  const { roomId } = useParams<{ roomId: string }>();
  const { effectiveIdentity, room, connectionState, setRoomCode, joinSpecificRoom } = useGame();
  const navigate = useNavigate();
  const code = roomId ?? "";

  useEffect(() => { if (code) setRoomCode(code); }, [code]);

  const canJoin = useMemo(() => {
    if (!code) return false;
    const summaries = room; // room summaries already available via useGame
    return true;
  }, [code, room]);

  if (room) return <RoomPage />;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Invite</p>
          <h2>你被邀请加入密令房</h2>
        </div>
        <span className="soft-chip">{code}</span>
      </div>
      <p className="hint-text">
        {effectiveIdentity
          ? `以 ${effectiveIdentity.nickname} 的身份加入`
          : "先登录或输入昵称再加入"}
      </p>
      <div className="toolbar-inline compact-stack">
        <button
          className="primary-button"
          disabled={!effectiveIdentity}
          onClick={() => joinSpecificRoom(code, false)}
        >
          {connectionState === "connecting" ? "连接中..." : "加入此房间"}
        </button>
        <button
          disabled={!effectiveIdentity}
          onClick={() => joinSpecificRoom(code, true)}
        >
          旁观
        </button>
        <button onClick={() => navigate("/")}>返回首页</button>
      </div>
    </section>
  );
}

function RoomGuard() {
  const { room } = useGame();
  const { roomId } = useParams<{ roomId: string }>();

  if (room) return <RoomPage />;
  return <JoinRoomFromLink />;
}

export default function App() {
  const { room, setRoomCode } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (room?.id && location.pathname !== `/room/${room.id}`) {
      navigate(`/room/${room.id}`, { replace: true });
    }
  }, [room?.id]);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(location.search).get("room");
    if (codeFromUrl) {
      navigate(`/room/${codeFromUrl.toUpperCase()}`, { replace: true });
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, []);

  const inRoom = Boolean(room) && location.pathname.startsWith("/room/");

  return (
    <div className="app-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />
      <main className="page">
        <AppNav />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreateRoomPage />} />
          <Route path="/packs" element={<PacksPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/room/:roomId" element={<RoomGuard />} />
        </Routes>
      </main>
      <MobileNav />
    </div>
  );
}
