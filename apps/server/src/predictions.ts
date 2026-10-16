import { analysisPermissions, type ParticipantType, type Room } from '@acg-codenames/shared';
import { ensureAnalysisBudget } from './analysis-budget.js';

export function editPrediction(room: Room, participantId: string, participantType: ParticipantType, input: unknown, time: number): void {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 2048) throw new Error('预测参数无效');
  const action = input as Record<string, unknown>;
  const state = room.privateMatch;
  const principal = room.participantPrincipals?.[participantId];
  const view = analysisPermissions(room, { participantId, participantType });
  if (!state?.predictionsEnabled || !view || !principal || state.matchId !== action.matchId) throw new Error('当前局不支持预测');
  if (typeof action.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(action.requestId)) throw new Error('预测请求标识无效');
  if (state.requests[principal]?.includes(action.requestId)) return;
  if (action.kind === 'share') {
    if (room.phase !== 'finished' || room.endReason !== 'normal' || !state.predictions[principal] || typeof action.shared !== 'boolean') throw new Error('正常完赛后才能分享自己的预测');
    state.predictionShares[principal] = action.shared;
  } else {
    if (!view.canPredict) throw new Error('只有未接触本局秘密的观众可以预测');
    const card = room.board.find(c => c.id === action.cardId);
    if (!card || card.revealed) throw new Error('只能预测本局未翻开的作品');
    const entries = state.predictions[principal] ??= {};
    const old = entries[card.id];
    if (old?.frozenAt !== undefined) throw new Error('该预测已经冻结');
    if (!Number.isSafeInteger(action.expectedRevision) || (old?.revision ?? 0) !== action.expectedRevision) throw new Error('预测已更新，请重试');
    if (action.kind === 'set' && (action.choice === 'red' || action.choice === 'blue')) {
      entries[card.id] = { cardId: card.id, choice: action.choice, revision: (old?.revision ?? 0) + 1, updatedAt: time };
    } else if (action.kind === 'clear') {
      entries[card.id] = { cardId: card.id, revision: (old?.revision ?? 0) + 1, updatedAt: time };
    } else throw new Error('预测只能选择红或蓝');
  }
  const rate = state.rates[principal];
  if (rate && time - rate.at < 1000 && rate.count >= 5) throw new Error('操作过快，请稍后重试');
  state.rates[principal] = rate && time - rate.at < 1000 ? { ...rate, count: rate.count + 1 } : { at: time, count: 1 };
  state.requests[principal] = [...(state.requests[principal] ?? []), action.requestId].slice(-256);
  ensureAnalysisBudget(room);
}
