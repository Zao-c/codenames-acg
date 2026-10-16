import { useEffect, useState } from 'react';
import type { PrivateReplayView, PublicRoomState } from '@acg-codenames/shared';
import { getPrivateReplay, sharePrivatePrediction } from '../lib/api';
import { Dialog } from './UI';
import { GraphPicture } from './AssociationBoard';

function ReviewDialog({ matchId, close }: { matchId: string; close: () => void }) {
  const [data, setData] = useState<PrivateReplayView | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(-1);
  useEffect(() => { let active = true; getPrivateReplay(matchId).then(value => { if (active) setData(value); }, e => { if (active) setError(e.message); }); return () => { active = false; }; }, [matchId]);
  const snapshot = data?.snapshots?.[step];
  const graphs = snapshot?.teamGraphs ?? data?.teamGraphs;
  const intents = snapshot?.intents ?? data?.intents;
  return <Dialog title="房内私密复盘" close={close} wide>
    {error && <p role="alert">{error}</p>}{!data && !error && <p>正在验证成员身份…</p>}
    {data && <><p className="hint-text">仅本局授权成员可见。保存至 {new Date(data.expiresAt).toLocaleString()}；服务重启后内存复盘会失效。</p>
      {data.snapshots && <label>查看时间点<select value={step} onChange={e => setStep(Number(e.target.value))}><option value={-1}>最终思路</option>{data.snapshots.map((s, i) => <option key={s.sequence} value={i}>第 {s.sequence} 次翻牌前 · {data.board.find(c => c.id === s.cardId)?.word}</option>)}</select></label>}
      {graphs && (['red', 'blue'] as const).map(team => <section key={team}><h3>{team === 'red' ? '红队' : '蓝队'}关联板</h3>{Object.entries(graphs[team]).map(([scope, graph]) => <details key={scope} open><summary>{scope === 'match' ? '整局' : '线索关联'}</summary><GraphPicture graph={graph} cards={data.board}/></details>)}</section>)}
      {intents?.map((intent, i) => <section key={i}><h3>{intent.nickname} 的意图</h3>{Object.entries(intent.scopes).map(([scope, value]) => <details key={scope}><summary>{scope === 'match' ? '整局' : '线索计划'}</summary><GraphPicture graph={value.graph} cards={data.board}/>{value.locked && <><p>翻牌前已锁定的计划</p><GraphPicture graph={value.locked.graph} cards={data.board}/></>}</details>)}</section>)}
      {data.interference && <p>干扰来源：{data.interference.map(c => `${c.from === 'red' ? '红队' : '蓝队'} → ${c.team === 'red' ? '红队' : '蓝队'}：${data.board.find(b => b.anime?.id === c.workId)?.word ?? c.workId}`).join('；') || '无'}</p>}
      {data.predictionResult && <section><h3>我的预测</h3><p>冻结 {data.predictionResult.total} 张，正确 {data.predictionResult.correct} 张</p><button onClick={() => sharePrivatePrediction(matchId, !data.predictionShared).then(setData).catch(e => setError(e.message))}>{data.predictionShared ? '取消分享给本局成员' : '分享给本局成员'}</button></section>}
      {data.sharedPredictions?.map((p, i) => <details key={i}><summary>{p.nickname} 主动分享的预测：{p.result.correct}/{p.result.total}</summary>{Object.values(p.predictions).filter(v => v.choice).map(v => <p key={v.cardId}>{data.board.find(c => c.id === v.cardId)?.word}：{v.choice === 'red' ? '红队' : '蓝队'}{v.frozenAt === undefined ? '（未冻结，不计分）' : ''}</p>)}</details>)}
    </>}
  </Dialog>;
}

export function PrivateReview({ room }: { room: PublicRoomState }) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const history = (room.replayHistory ?? []).filter(h => h.privateAvailable);
  if (!history.length) return null;
  return <div className="private-review-entry"><details><summary>历局私密复盘</summary><p className="hint-text">仅正常完赛且拥有本局身份凭证时可查看；公开基础回放不受影响。</p>{history.map(h => <button key={h.matchId} onClick={() => setMatchId(h.matchId)}>第 {h.roundNumber} 局 · 私密复盘</button>)}</details>{matchId && <ReviewDialog key={matchId} matchId={matchId} close={() => setMatchId(null)}/>}</div>;
}
