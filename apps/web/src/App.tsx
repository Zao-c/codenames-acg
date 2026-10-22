import { useEffect, useRef } from "react";
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
  const { effectiveIdentity, room, connectionState, setRoomCode, joinSpecificRoom, error, joinError } = useGame();
  const navigate = useNavigate();
  const code = roomId ?? "";
  const location=useLocation();const attempted=useRef(false);
  useEffect(()=>{if(effectiveIdentity&&new URLSearchParams(location.search).has('join')&&!attempted.current){attempted.current=true;joinSpecificRoom(code,false);}},[effectiveIdentity?.nickname,code,location.search]);

  useEffect(() => { if (code) setRoomCode(code); }, [code]);

  if (room?.id === code) return <RoomPage />;

  return (
    <div className="invite-panel">
      <h2>你被邀请加入房间</h2>
      <p className="room-code" style={{ fontSize: 28 }}>{code}</p>
      <p className="hint-text">
        {effectiveIdentity
          ? `以 ${effectiveIdentity.nickname} 的身份加入`
          : "请先登录"}
      </p>
      {!effectiveIdentity&&<div className="invite-login"><button className="primary-button" onClick={()=>navigate(`/login?next=${encodeURIComponent(`/room/${code}?join=1`)}`)}>登录并加入</button><button onClick={()=>navigate(`/login?guest=1&next=${encodeURIComponent(`/room/${code}?join=1`)}`)}>游客进入</button></div>}
      {(joinError||error)&&<p role="alert" className="error-text">{joinError||error}</p>}
      <button className="primary-button" disabled={!effectiveIdentity || connectionState === "connecting"} onClick={() => joinSpecificRoom(code, false)}>
        {connectionState === "connecting" ? "连接中..." : "加入房间"}
      </button>
      <button disabled={!effectiveIdentity || connectionState === "connecting"} onClick={() => joinSpecificRoom(code, true)} style={{ marginLeft: 8 }}>
        旁观
      </button>
      <br />
      <button onClick={() => navigate("/")} style={{ marginTop: 12 }}>返回大厅</button>
    </div>
  );
}

function RoomGuard() {
  const { room } = useGame();
  const {roomId}=useParams();
  if (room?.id===roomId) return <RoomPage />;
  return <JoinRoomFromLink />;
}

export default function App() {
  const { room, effectiveIdentity, setRoomCode } = useGame();
  const navigate = useNavigate();
  const location = useLocation();

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

  const sectionInfo: Record<string,string> = {
    '/create':'创建房间',
    '/packs':'文字题库',
    '/gallery':'动画图库',
    '/profile':'我的结社档案'
  };
  const info=sectionInfo[location.pathname];
  return (
    <div className="app-shell">
      <main className={`page ${location.pathname.startsWith("/room/") ? "page-room" : "page-main"}`}>
        <AppNav />
        {info && <header className="page-intro"><h1>{info}</h1></header>}
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
