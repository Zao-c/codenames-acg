import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, useParams } from "react-router-dom";
import { useGame } from "./context/GameContext";
import { AppNav, MobileNav } from "./components/AppNav";
import { HomePage } from "./routes/HomePage";
import { LoginPage } from "./routes/LoginPage";
import { CreateRoomPage } from "./routes/CreateRoomPage";
import { PacksPage } from "./routes/PacksPage";
import { ImagePacksPage } from "./routes/ImagePacksPage";
import { ProfilePage } from "./routes/ProfilePage";
import { ReplayPage } from "./routes/ReplayPage";
import { RoomPage } from "./routes/RoomPage";
import { AnimePoolsPage } from './routes/AnimePoolsPage';
import { PrivateReplayPage } from './routes/PrivateReplayPage';

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
    const params = new URLSearchParams(location.search);
    const codeFromUrl = params.get("room");
    const replayFromUrl = params.get("replay");
    if (codeFromUrl) {
      navigate(`/room/${codeFromUrl.trim().toUpperCase()}`, { replace: true });
      setRoomCode(codeFromUrl.trim().toUpperCase());
      return;
    }
    if (replayFromUrl) {
      navigate(`/replay/${replayFromUrl.trim()}`, { replace: true });
      return;
    }
  }, []);

  const sectionInfo: Record<string,[string,string]> = {
    '/create':['创建你的房间','选择词牌对局或揭幕猜番，邀请同好一起开局。'],
    '/packs':['文字题库','收藏熟悉的词，也留一点意料之外。'],
    '/gallery':['动画图库','管理图片与答案，为下一场揭幕准备素材。'],
    '/profile':['我的结社档案','记录共同经历的对局、默契与高光。']
  };
  const info=sectionInfo[location.pathname];
  return (
    <div className="app-shell">
      <main className={`page ${location.pathname.startsWith("/room/") ? "page-room" : "page-main"}`}>
        <AppNav />
        {info && <header className="page-intro"><p className="eyebrow">词牌结社 / {info[0]}</p><h1>{info[0]}</h1><p>{info[1]}</p></header>}
        <div className={`route-content ${location.pathname.startsWith('/replay/')?'route-replay':''}`}><Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create" element={<CreateRoomPage />} />
          <Route path="/packs" element={<PacksPage />} />
          <Route path="/gallery" element={<ImagePacksPage />} />
          <Route path="/anime-pools" element={<AnimePoolsPage />} />
          <Route path="/private-replay/:matchId" element={<PrivateReplayPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/replay/:replayId" element={<ReplayPage />} />
          <Route path="/room/:roomId" element={<RoomGuard />} />
        </Routes></div>
      </main>
      <MobileNav />
    </div>
  );
}
