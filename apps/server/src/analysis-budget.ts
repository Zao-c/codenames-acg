import type { Room } from '@acg-codenames/shared';

/** Reserve future snapshot space while accepting edits; guessing never fails because a graph is full. */
export function ensureAnalysisBudget(room: Room): void {
  const state = room.privateMatch;
  if (!state) return;
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const retained = bytes(state);
  const editable = bytes({ ...state, snapshots: [] });
  const graphs = bytes({ teamGraphs: state.teamGraphs, intents: state.intents });
  const predictions = bytes(state.predictions);
  const remaining = room.board.filter(c => !c.revealed).length;
  // Including all scopes is conservative: an actual flip only copies match + current clue.
  const projected = retained + graphs * remaining + predictions * 2 + 65_536;
  if (editable > 2_000_000 || projected > 8_000_000) throw new Error('本局私有数据已达容量上限，请减少图谱内容后重试');
}
