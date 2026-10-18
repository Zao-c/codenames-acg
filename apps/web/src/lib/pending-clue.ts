import { roomTurnKey, type ActionReply, type PublicRoomState, type Team } from '@acg-codenames/shared';

export interface PendingClue {
  requestId: string;
  roomId: string;
  matchId?: string;
  roundNumber: number;
  turnVersion: string;
  roomVersion: number;
  team: Team;
  giverPlayerId: string;
  recordCount: number;
  word: string;
  count: number;
  draftRevision: number;
  status: 'sending' | 'syncing';
  timer?: ReturnType<typeof setTimeout>;
}
type Event = 'pending' | 'syncing' | 'accepted' | 'rejected' | 'invalidated';

/** A single owner for the request, including its timeout and late callbacks.
 * Unknown delivery stays locked until ACK/state resolves it: a new requestId
 * must never retry an action whose outcome is still unknown.
 */
export class ClueRequestLifecycle {
  pending: PendingClue | null = null;
  constructor(private notify: (event: Event, request: PendingClue, message?: string) => void) {}

  start(request: Omit<PendingClue, 'timer' | 'status'>): boolean {
    if (this.pending) return false;
    const pending: PendingClue = { ...request, status: 'sending' };
    this.pending = pending;
    this.arm(pending);
    this.notify('pending', pending);
    return true;
  }

  retry(): PendingClue | null {
    const request = this.pending;
    if (!request || request.status !== 'syncing') return null;
    request.status = 'sending';
    this.arm(request);
    this.notify('pending', request);
    return request;
  }

  private arm(pending: PendingClue): void {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      pending.timer = undefined;
      pending.status = 'syncing';
      this.notify('syncing', pending);
    }, 9000);
  }

  acknowledge(requestId: string, result: ActionReply | undefined): void {
    const request = this.pending;
    if (!request || request.requestId !== requestId) return;
    if (!result || (result.roomId && result.roomId !== request.roomId)) return;
    if (result.ok && result.roomVersion !== undefined && result.roomVersion < request.roomVersion) return;
    this.finish(result.ok ? 'accepted' : 'rejected', result.message);
  }

  observe(room: PublicRoomState): void {
    const request = this.pending;
    if (!request) return;
    if (room.id !== request.roomId || room.matchId !== request.matchId || room.roundNumber !== request.roundNumber) {
      this.cancel();
      return;
    }
    // Ignore an old snapshot; neither a late room packet nor matching words
    // from another turn/player may settle this request.
    if (room.updatedAt < request.roomVersion) return;
    const clue = room.clue;
    const record = room.clueRecords?.[request.recordCount];
    const confirmed = room.phase === 'playing' && room.currentTeam === request.team &&
      clue?.id && clue.team === request.team && clue.giverPlayerId === request.giverPlayerId &&
      clue.word === request.word && clue.count === request.count &&
      room.clueRecords?.length === request.recordCount + 1 && record?.clueId === clue.id &&
      record.giverPlayerId === request.giverPlayerId && record.word === request.word && record.count === request.count;
    if (confirmed) this.finish('accepted');
    else if (roomTurnKey(room) !== request.turnVersion || room.phase !== 'playing' ||
      (room.clueRecords?.length ?? 0) !== request.recordCount) this.cancel();
  }

  cancel(): void { if (this.pending) this.finish('invalidated'); }

  private finish(event: 'accepted' | 'rejected' | 'invalidated', message?: string): void {
    const request = this.pending;
    if (!request) return;
    clearTimeout(request.timer);
    this.pending = null;
    this.notify(event, request, message);
  }
}
