import { useState } from 'react';
import type { PublicRoomState } from '@acg-codenames/shared';
import { getSocket } from '../lib/socket';
import { Dialog } from './UI';
import { useGame } from '../context/GameContext';

export function SpectatorPredictions({ room }: { room: PublicRoomState }) {
  const [open, setOpen] = useState(false);
  const { error } = useGame();
  const view = room.analysis;
  if (!view || (!view.canPredict && !view.myPredictions)) return null;
  return <><button onClick={() => setOpen(true)}>我的预测</button>{open && <Dialog title="我的预测" close={() => setOpen(false)}>
    <p className="hint-text">只有你能看到。翻牌前可改选红或蓝；翻牌时冻结，正常完赛后评价。中立与刺客计预测错误，未翻牌不计入。</p>
    {error && <p role="alert">{error}</p>}
    {view.predictionResult && <p>已冻结 {view.predictionResult.total} 张 · 猜对 {view.predictionResult.correct} 张</p>}
    {room.endReason === 'forfeit' && <p>本局认输结束，不评价预测。</p>}
    <div className="association-list">{room.board.map(card => { const prediction = view.myPredictions?.[card.id]; return <label key={card.id}>{card.word}{prediction?.frozenAt !== undefined ? ' · 已冻结' : ''}
      <select aria-label={`预测 ${card.word}`} disabled={!view.canPredict || card.revealed || prediction?.frozenAt !== undefined} value={prediction?.choice ?? ''} onChange={e => getSocket().emit('prediction_action', { roomId: room.id, matchId: view.matchId, requestId: crypto.getRandomValues(new Uint32Array(4)).join('-'), kind: e.target.value ? 'set' : 'clear', cardId: card.id, choice: e.target.value === 'red' ? 'red' : 'blue', expectedRevision: prediction?.revision ?? 0 })}>
        <option value="">未预测</option><option value="red">红队</option><option value="blue">蓝队</option>
      </select></label>; })}</div>
    {view.predictionResult && <button onClick={() => getSocket().emit('prediction_action', { roomId: room.id, matchId: view.matchId, requestId: crypto.getRandomValues(new Uint32Array(4)).join('-'), kind: 'share', shared: !view.predictionShared })}>{view.predictionShared ? '取消分享给本局成员' : '分享给本局成员'}</button>}
  </Dialog>}</>;
}
