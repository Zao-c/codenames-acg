import { useState } from 'react';
import { useGame } from '../context/GameContext';
import { copyText } from '../lib/clipboard';
import { privateIdentityKey, restorePrivateIdentity } from '../lib/private-identity';

export function PrivateIdentityTools({ restored }: { restored?: () => void }) {
  const { room } = useGame();
  const [key, setKey] = useState(''), [status, setStatus] = useState('');
  return <details className="community-identity"><summary>备份或恢复我的身份</summary>
    <p className="hint-text">作品池、收藏和私密复盘通过本机身份凭证识别。昵称只是署名；换设备时可恢复同一凭证。凭证应由你自己保管。</p>
    <button onClick={async () => { setStatus(await copyText(privateIdentityKey()) ? '身份凭证已复制，请保存到自己的安全位置。' : '复制失败，请使用下载备份。'); }}>复制身份凭证</button>
    <button onClick={() => { const url = URL.createObjectURL(new Blob([privateIdentityKey()], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = '词牌结社-身份凭证.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>下载身份备份</button>
    <form onSubmit={e => { e.preventDefault(); try { restorePrivateIdentity(key); setKey(''); setStatus('身份已恢复，已切换到对应的作品池与收藏。'); restored?.(); } catch (error) { setStatus((error as Error).message); } }}>
      <label>恢复身份凭证<input type="password" autoComplete="off" maxLength={64} value={key} onChange={e => setKey(e.target.value)} placeholder="粘贴你保存的 64 位凭证"/></label>
      <p className="hint-text">恢复会替换本机当前身份，请先备份当前凭证。{room ? '离开房间后可恢复。' : ''}</p>
      <button disabled={!!room || !key.trim()}>恢复并切换身份</button>
    </form><p role="status">{status}</p>
  </details>;
}
