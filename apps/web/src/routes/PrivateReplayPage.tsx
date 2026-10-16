import { useNavigate, useParams } from 'react-router-dom';
import { ReviewDialog } from '../components/PrivateReview';
import { PrivateIdentityTools } from '../components/PrivateIdentityTools';
import { useState } from 'react';

export function PrivateReplayPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true), [revision, setRevision] = useState(0);
  return <section className="panel"><h1>房内私密复盘</h1><p className="hint-text">在原设备打开，或恢复你自己的身份凭证。链接本身不授予查看权限。</p><PrivateIdentityTools restored={() => { setRevision(v => v + 1); setOpen(true); }}/><button onClick={() => setOpen(true)}>打开复盘</button><button onClick={() => navigate('/')}>返回大厅</button>{open && matchId && <ReviewDialog key={`${matchId}:${revision}`} matchId={matchId} close={() => setOpen(false)}/>}</section>;
}
