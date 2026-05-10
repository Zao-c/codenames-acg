import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useGame } from "./context/GameContext";
import { AppNav, MobileNav } from "./components/AppNav";
import { HomePage } from "./routes/HomePage";
import { CreateRoomPage } from "./routes/CreateRoomPage";
import { PacksPage } from "./routes/PacksPage";
import { ProfilePage } from "./routes/ProfilePage";
import { RoomPage } from "./routes/RoomPage";

function RoomGuard() {
  const { room } = useGame();
  if (!room) return <Navigate to="/" replace />;
  return <RoomPage />;
}

export default function App() {
  const { room, error, setRoomCode } = useGame();
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
        {error ? <p className="error-text">{error}</p> : null}
      </main>
      <MobileNav />
    </div>
  );
}
