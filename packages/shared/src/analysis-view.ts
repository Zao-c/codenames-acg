import type { AnalysisPermissions, PrivatePrediction, PredictionResult } from './analysis.js';
import type { Room, ViewerIdentity } from './types.js';

export function analysisPermissions(room: Room, viewer: ViewerIdentity): AnalysisPermissions | undefined {
  const state = room.privateMatch;
  const id = viewer.participantId;
  if (!state || state.matchId !== room.matchId || !id) return;
  const participant = viewer.participantType === 'player'
    ? room.players.find(p => p.id === id) : viewer.participantType === 'spectator' ? room.spectators.find(p => p.id === id) : undefined;
  const principal = room.participantPrincipals?.[id];
  if (!participant || !principal) return;
  const player = room.players.find(p => p.id === id);
  const member = state.members[id];
  const memberMatches = member?.principalId === principal;
  const active = room.phase === 'playing' && participant.connected;
  const captain = !!player && player.role === 'spymaster' && memberMatches && player.team === member.team;
  const exposed = state.exposedPrincipals.includes(principal) || viewer.revealAll === true || viewer.isDebugController === true;
  const operative = !!player && player.role === 'operative' && memberMatches && player.team === member.team && !exposed;
  return {
    matchId: state.matchId,
    canReadTeamGraph: active && (captain || operative),
    canEditTeamGraph: active && operative,
    canEditIntent: active && captain,
    canPredict: state.predictionsEnabled && active && viewer.participantType === 'spectator' && !exposed && !Object.values(state.members).some(m => m.principalId === principal),
    canReview: room.phase === 'finished' && room.endReason === 'normal' && Object.values(state.members).some(m => m.principalId === principal),
    teamGraphs: active && (captain || operative) && player?.team ? state.teamGraphs[player.team] : undefined,
    myIntents: state.intents[principal],
    myPredictions: state.predictions[principal],
    predictionResult: room.phase === 'finished' && room.endReason === 'normal' && state.predictions[principal] ? evaluatePredictions(room.board, state.predictions[principal]) : undefined,
    predictionShared: state.predictionShares[principal] ?? false,
  };
}

export function evaluatePredictions(board: Room['board'], predictions: Record<string, PrivatePrediction>): PredictionResult {
  const frozen = Object.values(predictions).filter(p => p.choice && p.frozenAt !== undefined && board.some(c => c.id === p.cardId && c.revealed));
  return { total: frozen.length, correct: frozen.filter(p => board.find(c => c.id === p.cardId)?.role === p.choice).length };
}
