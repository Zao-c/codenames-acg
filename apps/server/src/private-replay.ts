import { evaluatePredictions, type MatchPrivateState, type Room, type PrivateReplayView, type IntentReview, type CaptainIntent } from '@acg-codenames/shared';
import { REPLAY_TTL_SECONDS } from './store.js';

interface Archive {
  matchId: string; replayId: string; expiresAt: number; endReason: Room['endReason'];
  state: MatchPrivateState; board: Room['board']; interference: NonNullable<Room['draftReview']>['interference'];
  spectatorNames: Record<string, string>;
}

/** Separate from the public replay store. No private payload is saved in GameReplay. */
export class PrivateReplayStore {
  private readonly archives = new Map<string, Archive>();
  replayId(matchId?: string): string | undefined { this.prune(); return matchId ? this.archives.get(matchId)?.replayId : undefined; }
  save(room: Room, replayId: string): void {
    const state = room.privateMatch;
    if (!state || state.matchId !== room.matchId || room.phase !== 'finished') return;
    this.prune();
    if (this.archives.has(state.matchId)) return;
    this.archives.set(state.matchId, structuredClone({ matchId: state.matchId, replayId, expiresAt: Date.now() + REPLAY_TTL_SECONDS * 1000,
      endReason: room.endReason, state, board: room.board, interference: room.draftReview?.interference ?? [],
      spectatorNames: Object.fromEntries(room.spectators.map(s => [room.participantPrincipals?.[s.id] ?? '', s.nickname])),
    }));
  }
  share(matchId: string, principal: string, shared: boolean): void {
    const archive = this.require(matchId);
    if (archive.endReason !== 'normal' || !archive.state.predictions[principal]) throw new Error('没有可分享的预测');
    archive.state.predictionShares[principal] = shared;
  }
  get(matchId: string, principal: string): PrivateReplayView {
    const archive = this.require(matchId);
    const { state, board } = archive;
    const member = Object.values(state.members).some(m => m.principalId === principal);
    const own = state.predictions[principal];
    if (archive.endReason !== 'normal' || (!member && !own)) throw new Error('私密复盘不存在、未开放或无权访问');
    const intents = (items: Record<string, Record<string, CaptainIntent>>): IntentReview[] => Object.entries(items).flatMap(([id, scopes]) => {
      const owner = Object.values(state.members).find(m => m.principalId === id);
      return owner ? [{ nickname: owner.nickname, team: owner.team, scopes }] : [];
    });
    // Construct every output field explicitly. Never return raw Archive/state/principal keys.
    return structuredClone({
      matchId, replayId: archive.replayId, expiresAt: archive.expiresAt,
      board: board.map(c => ({ id: c.id, wordId: c.wordId, word: c.word, anime: c.anime, role: c.role, revealed: c.revealed, revealedBy: c.revealedBy })),
      teamGraphs: member ? state.teamGraphs : undefined,
      intents: member ? intents(state.intents) : undefined,
      snapshots: member ? state.snapshots.map(s => ({ sequence: s.sequence, cardId: s.cardId, clueId: s.clueId, serverAt: s.serverAt, teamGraphs: s.teamGraphs, intents: intents(s.intents) })) : undefined,
      interference: member ? archive.interference : undefined,
      myPredictions: own, predictionResult: own ? evaluatePredictions(board, own) : undefined, predictionShared: state.predictionShares[principal] ?? false,
      sharedPredictions: member ? Object.entries(state.predictions).filter(([id]) => state.predictionShares[id]).map(([id, predictions]) => ({ nickname: archive.spectatorNames[id] ?? '观众', predictions, result: evaluatePredictions(board, predictions) })) : undefined,
    });
  }
  private require(id: string): Archive {
    this.prune();
    const archive = this.archives.get(id);
    if (!archive) throw new Error('私密复盘不存在、未开放或无权访问');
    return archive;
  }
  private prune(): void {
    for (const [id, archive] of this.archives) if (archive.expiresAt <= Date.now()) this.archives.delete(id);
  }
}
