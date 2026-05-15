import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import { useGame } from "./context/GameContext";
import { AppNav, MobileNav } from "./components/AppNav";
import { HomePage } from "./routes/HomePage";
import { LoginPage } from "./routes/LoginPage";
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

  if (room) return <RoomPage />;

  return (
    <div className="invite-panel">
      <h2>你被邀请加入房间</h2>
      <p className="room-code" style={{ fontSize: 28 }}>{code}</p>
      <p className="hint-text">
        {effectiveIdentity
          ? `以 ${effectiveIdentity.nickname} 的身份加入`
          : "请先登录"}
      </p>
      <button className="primary-button" disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(code, false)}>
        {connectionState === "connecting" ? "连接中..." : "加入房间"}
      </button>
      <button disabled={!effectiveIdentity} onClick={() => joinSpecificRoom(code, true)} style={{ marginLeft: 8 }}>
        旁观
      </button>
      <br />
      <button onClick={() => navigate("/")} style={{ marginTop: 12 }}>返回大厅</button>
    </div>
  );
}

function RoomGuard() {
  const { room } = useGame();
  if (room) return <RoomPage />;
  return <JoinRoomFromLink />;
}

export default function App() {
  const { room, effectiveIdentity, setRoomCode } = useGame();
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

  return (
    <div className="app-shell">
      <main className={`page ${location.pathname.startsWith("/room/") ? "page-room" : "page-main"}`}>
        <AppNav />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
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
