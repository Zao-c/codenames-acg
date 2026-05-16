import type { AccountType, ClientSession } from "@acg-codenames/shared";

const SESSION_KEY = "acg-codenames-session";
const IDENTITY_KEY = "acg-codenames-identity";
const RECENT_USERS_KEY = "acg-codenames-recent-users";

export interface LocalIdentity {
  mode: AccountType;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  userSessionToken?: string;
}

export function saveSession(session: ClientSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): ClientSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientSession;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function saveIdentity(identity: LocalIdentity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  if (identity.mode === "named") {
    const usernames = loadRecentUsernames();
    const next = [identity.username, ...usernames.filter((entry) => entry !== identity.username)].slice(0, 8);
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
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
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
  const raw = sessionStorage.getItem(RECOVERABLE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, RecoverableEntry>;
  } catch {
    return {};
  }
}

export function saveRecoverableSessions(records: Record<string, RecoverableEntry>): void {
  sessionStorage.setItem(RECOVERABLE_KEY, JSON.stringify(records));
}

export function removeRecoverableSession(roomId: string): void {
  const records = loadRecoverableSessions();
  delete records[roomId];
  saveRecoverableSessions(records);
}
