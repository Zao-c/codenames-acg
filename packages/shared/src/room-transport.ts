import type { PublicRoomState } from './types.js';
import type { PublicNextPlan } from './anime.js';

export type RoomSnapshot = PublicRoomState & { transportRevision?: number };
export type RoomDelta = {
  roomId: string; baseRevision: number; revision: number;
  changes: Partial<PublicRoomState>; removed: (keyof PublicRoomState)[];
  plan?: { changes: Partial<PublicNextPlan>; removed: (keyof PublicNextPlan)[] };
};
const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'transportRevision']);
type Fields = Map<string, string>;
function signatures(object: object) { return new Map(Object.entries(object).filter(([, value]) => value !== undefined).map(([key, value]) => [key, JSON.stringify(value)])); }
function diff(object: object, previous: Fields) {
  const now = signatures(object), changes: Record<string, unknown> = {}, removed: string[] = [];
  for (const [key, value] of now) if (previous.get(key) !== value) changes[key] = (object as Record<string, unknown>)[key];
  for (const key of previous.keys()) if (!now.has(key)) removed.push(key);
  return { now, changes, removed };
}
/** Each connection stores signatures of its own sanitized view. Never diffs the private room. */
export class RoomTransport {
  private roomId?: string;
  private revision = 0;
  private fields: Fields = new Map();
  private plan: Fields = new Map();
  next(state: PublicRoomState, full = false): { snapshot?: RoomSnapshot; delta?: RoomDelta } {
    const { nextPlan, ...root } = state;
    const fields = diff(root, this.fields), plan = diff(nextPlan ?? {}, this.plan);
    const wasPlan = this.plan.size > 0;
    const snapshot = full || this.roomId !== state.id || this.revision === 0;
    const baseRevision = this.revision++;
    this.roomId = state.id; this.fields = fields.now; this.plan = plan.now;
    if (snapshot) return { snapshot: { ...state, transportRevision: this.revision } };
    const delta: RoomDelta = { roomId: state.id, baseRevision, revision: this.revision, changes: fields.changes, removed: fields.removed as (keyof PublicRoomState)[] };
    if (!nextPlan && wasPlan) delta.removed.push('nextPlan');
    else if (nextPlan && !wasPlan) delta.changes.nextPlan = nextPlan;
    else if (nextPlan && (Object.keys(plan.changes).length || plan.removed.length)) delta.plan = { changes: plan.changes, removed: plan.removed as (keyof PublicNextPlan)[] };
    return { delta };
  }
}
/** A missed/out-of-order delta must cause a full resync, never a half-applied state. */
export function applyRoomDelta(current: RoomSnapshot | null, delta: RoomDelta): RoomSnapshot | null {
  if (!current || current.id !== delta.roomId || current.transportRevision !== delta.baseRevision || delta.revision !== delta.baseRevision + 1) return null;
  const safe = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.has(key)));
  const next = { ...current, ...safe(delta.changes), transportRevision: delta.revision } as RoomSnapshot;
  for (const key of delta.removed) if (!forbidden.has(key)) delete (next as unknown as Record<string, unknown>)[key];
  if (delta.plan) {
    if (!current.nextPlan) return null;
    next.nextPlan = { ...current.nextPlan, ...safe(delta.plan.changes) };
    for (const key of delta.plan.removed) if (!forbidden.has(key)) delete (next.nextPlan as unknown as Record<string, unknown>)[key];
  }
  return next.id === current.id ? next : null;
}
