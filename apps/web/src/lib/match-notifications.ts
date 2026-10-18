import { MatchEventLedger } from '@acg-codenames/shared';

export interface NotificationScope { roomId: string; matchId: string; roundNumber: number; latestTurn: number }
export interface ScopedNotification { id: string; roomId?: string; matchId?: string; roundNumber?: number; roundIndex?: number }
/** Reject old rooms/matches and retries; late earlier turns may enter history, never the toast queue. */
export class MatchNotifications {
  private ledger = new MatchEventLedger();
  receive(kind: string, event: ScopedNotification, scope: NotificationScope | null) {
    if (!scope || event.roomId !== scope.roomId || event.matchId !== scope.matchId || event.roundNumber !== scope.roundNumber) return null;
    if (!this.ledger.claim(scope.roomId, scope.matchId, `${kind}:${event.id}`)) return null;
    return { toast: (event.roundIndex ?? 0) >= scope.latestTurn };
  }
}
