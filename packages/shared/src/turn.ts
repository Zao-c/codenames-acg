import type { Room } from './types.js';

/** Stable identifier for the clue/team/round phase; board changes within one clue keep the same key. */
export function roomTurnKey(room: Pick<Room, 'roundNumber' | 'currentTeam' | 'clue' | 'phase'>): string {
  return `${room.roundNumber}:${room.currentTeam}:${room.clue?.id ?? 'none'}:${room.phase}`;
}
