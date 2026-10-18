import type { AccountType, ClientSession } from "@acg-codenames/shared";
import { privateIdentityKey } from './private-identity';

const SESSION_KEY = "acg-codenames-session";
const IDENTITY_KEY = "acg-codenames-identity";
const RECENT_USERS_KEY = "acg-codenames-recent-users";
function scoped(key:string):string {
  const identity=loadIdentity();
  return `${key}:${JSON.stringify([identity?.mode,identity?.username||identity?.nickname,privateIdentityKey()])}`;
}

export interface LocalIdentity {
  mode: AccountType;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  userSessionToken?: string;
}

export function saveSession(session: ClientSession): void {
  localStorage.setItem(scoped(SESSION_KEY), JSON.stringify(session));
}

export function loadSession(): ClientSession | null {
  const raw = localStorage.getItem(scoped(SESSION_KEY));
  if (!raw) return null;
  try {
    const value=JSON.parse(raw) as ClientSession;
    return value&&typeof value.roomId==='string'&&typeof value.sessionToken==='string'&&typeof value.participantId==='string'?value:null;
  } catch {
    localStorage.removeItem(scoped(SESSION_KEY));
    return null;
  }
}

export function clearSession(roomId?: string): void {
  if (!roomId || loadSession()?.roomId === roomId) localStorage.removeItem(scoped(SESSION_KEY));
}

export function saveIdentity(identity: LocalIdentity): void {
  if (identity.mode === "named" && (typeof identity.username !== "string" || !identity.username.trim())) {
    // Never persist a named identity without a usable username: it would break auto re-login on every load.
    return;
  }
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  if (identity.mode === "named") {
    const usernames = loadRecentUsernames();
    const next = [identity.username, ...usernames.filter((entry) => typeof entry === "string" && entry !== identity.username)].slice(0, 8);
    localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(next));
  }
}

export function loadIdentity(): LocalIdentity | null {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as LocalIdentity;
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}

export function loadRecentUsernames(): string[] {
  const raw = localStorage.getItem(RECENT_USERS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
  } catch {
    return [];
  }
}

const RECOVERABLE_KEY = "acg-codenames-recoverable-sessions";

export interface RecoverableEntry {
  sessionToken: string;
  participantType?: string;
  savedAt: number;
}

export function loadRecoverableSessions(): Record<string, RecoverableEntry> {
  const raw = localStorage.getItem(scoped(RECOVERABLE_KEY));
  if (!raw) return {};
  try {
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry):entry is [string,RecoverableEntry]=>!!entry[1]&&typeof entry[1]==='object'&&typeof (entry[1] as RecoverableEntry).sessionToken==='string'&&typeof (entry[1] as RecoverableEntry).savedAt==='number'));
  } catch {
    return {};
  }
}

export function saveRecoverableSessions(records: Record<string, RecoverableEntry>): void {
  localStorage.setItem(scoped(RECOVERABLE_KEY), JSON.stringify(records));
}

export function removeRecoverableSession(roomId: string): void {
  const records = loadRecoverableSessions();
  delete records[roomId];
  saveRecoverableSessions(records);
}

// An authoritative invalidation is scoped to this identity AND this room. A
// storage event reaches other tabs; ordinary disconnects never call this.
export function roomInvalidationKey(): string {
  return scoped('acg-codenames-invalid-room');
}

export function invalidateRoomSession(roomId: string): void {
  removeRecoverableSession(roomId);
  clearSession(roomId);
  localStorage.setItem(roomInvalidationKey(), JSON.stringify({ roomId, at: Date.now() }));
}
