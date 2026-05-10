import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import {
  MAX_AVATAR_DATA_URL_LENGTH,
  MAX_USERNAME_LENGTH,
  MAX_WORD_PACK_NAME_LENGTH,
  MIN_CUSTOM_WORD_PACK_ENTRIES,
  type NamedUserAccount,
  type NamedUserLoginResponse,
  type PublicWordPack,
  type SavedWordPack,
  type UpdateNamedUserPayload,
  type UserProfile,
  type UserStats
} from "@acg-codenames/shared";
import type { UserStore } from "./types.js";

interface UserDatabase {
  users: Record<string, NamedUserAccount>;
}

function now(): number {
  return Date.now();
}

function normalizeUsername(username: string): string {
  const value = username.trim();
  if (!value) {
    throw new Error("用户名不能为空");
  }
  if (value.length > MAX_USERNAME_LENGTH) {
    throw new Error(`用户名不能超过 ${MAX_USERNAME_LENGTH} 个字`);
  }
  return value;
}

function userKey(username: string): string {
  return normalizeUsername(username).toLocaleLowerCase();
}

function normalizeAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) {
    return null;
  }
  const value = avatarUrl.trim();
  if (!value) {
    return null;
  }
  if (!value.startsWith("data:image/")) {
    throw new Error("头像格式无效");
  }
  if (value.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error("头像图片过大");
  }
  return value;
}

function normalizeWordPack(pack: SavedWordPack): SavedWordPack {
  const name = pack.name.trim();
  if (!name) {
    throw new Error("题库名称不能为空");
  }
  if (name.length > MAX_WORD_PACK_NAME_LENGTH) {
    throw new Error(`题库名称不能超过 ${MAX_WORD_PACK_NAME_LENGTH} 个字`);
  }

  const entries = Array.from(
    new Set(
      pack.entries
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );

  if (entries.length < MIN_CUSTOM_WORD_PACK_ENTRIES) {
    throw new Error(`自定义题库至少需要 ${MIN_CUSTOM_WORD_PACK_ENTRIES} 个词条`);
  }

  const timestamp = typeof pack.updatedAt === "number" ? pack.updatedAt : now();
  const isPublic = pack.isPublic === true;
  return {
    id: pack.id.trim() || `pack-${Math.random().toString(36).slice(2, 10)}`,
    name,
    description: pack.description?.trim() || undefined,
    entries,
    sourceFranchises: Array.isArray(pack.sourceFranchises)
      ? Array.from(new Set(pack.sourceFranchises.map((entry) => entry.trim()).filter(Boolean)))
      : undefined,
    difficultyRange:
      Array.isArray(pack.difficultyRange) && pack.difficultyRange.length === 2
        ? [Number(pack.difficultyRange[0]), Number(pack.difficultyRange[1])] as [number, number]
        : undefined,
    isPublic,
    publishedAt: isPublic ? (typeof pack.publishedAt === "number" ? pack.publishedAt : timestamp) : undefined,
    createdAt: typeof pack.createdAt === "number" ? pack.createdAt : timestamp,
    updatedAt: timestamp
  };
}

function emptyStats(): UserStats {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    roomsHosted: 0
  };
}

function defaultUser(username: string): NamedUserAccount {
  const timestamp = now();
  return {
    username,
    avatarUrl: null,
    customWordPacks: [],
    stats: emptyStats(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeSavedPacks(packs: SavedWordPack[] | undefined): SavedWordPack[] | undefined {
  if (!packs) {
    return undefined;
  }
  return packs.map(normalizeWordPack);
}

export class JsonUserStore implements UserStore {
  private readonly filePath: string;
  private users = new Map<string, NamedUserAccount>();
  private readonly sessions = new Map<string, { userKey: string; expiresAt: number }>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  private static readonly SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async login(username: string): Promise<NamedUserLoginResponse> {
    await this.ensureLoaded();
    const normalized = normalizeUsername(username);
    const account = this.getOrCreateUser(normalized);
    return this.withSession(account);
  }

  private getOrCreateUser(username: string): NamedUserAccount {
    const key = userKey(username);
    const existing = this.users.get(key);
    if (existing) return existing;
    const created = defaultUser(username);
    this.users.set(key, created);
    return created;
  }

  async get(username: string): Promise<NamedUserAccount | null> {
    await this.ensureLoaded();
    return this.users.get(userKey(username)) ?? null;
  }

  getPublicProfile(account: NamedUserAccount): Omit<NamedUserAccount, "customWordPacks"> & { customWordPacks: Pick<SavedWordPack, "id" | "name" | "description" | "entries" | "isPublic">[] } {
    return {
      username: account.username,
      avatarUrl: account.avatarUrl,
      customWordPacks: account.customWordPacks.map((pack) => ({ id: pack.id, name: pack.name, description: pack.description, entries: pack.entries.slice(0, 3), isPublic: pack.isPublic })),
      stats: account.stats,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  async update(username: string, payload: UpdateNamedUserPayload): Promise<NamedUserAccount> {
    await this.ensureLoaded();
    const normalized = normalizeUsername(username);
    const key = userKey(normalized);
    const current = this.users.get(key);
    if (!current) {
      throw new Error("用户不存在，请先登录");
    }
    const updated: NamedUserAccount = {
      ...current,
      avatarUrl: payload.avatarUrl === undefined ? current.avatarUrl : normalizeAvatarUrl(payload.avatarUrl),
      customWordPacks: normalizeSavedPacks(payload.customWordPacks) ?? current.customWordPacks,
      updatedAt: now()
    };
    this.users.set(key, updated);
    await this.persist();
    return updated;
  }

  async verifySession(username: string, sessionToken: string): Promise<boolean> {
    await this.ensureLoaded();
    this.pruneExpiredSessions();
    const entry = this.sessions.get(sessionToken);
    if (!entry || entry.userKey !== userKey(username)) return false;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionToken);
      return false;
    }
    return true;
  }

  async listPublicWordPacks(): Promise<PublicWordPack[]> {
    await this.ensureLoaded();
    return Array.from(this.users.values())
      .flatMap((user) =>
        user.customWordPacks
          .filter((pack) => pack.isPublic === true)
          .map((pack) => ({
            ...pack,
            publicId: `${user.username}:${pack.id}`,
            ownerUsername: user.username,
            ownerAvatarUrl: user.avatarUrl
          }))
      )
      .sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
  }

  async resolveProfile(profile?: Partial<UserProfile>, sessionToken?: string): Promise<UserProfile> {
    const accountType = profile?.accountType ?? (profile?.username ? "named" : "guest");
    if (accountType === "named" && profile?.username) {
      const username = normalizeUsername(profile.username);
      if (sessionToken) {
        const verified = await this.verifySession(username, sessionToken);
        if (!verified) throw new Error("用户登录已失效，请重新登录");
      } else {
        throw new Error("named 账户必须提供登录凭证");
      }
      const account = this.getOrCreateUser(username);
      return {
        accountType: "named",
        username: account.username,
        avatarUrl: account.avatarUrl
      };
    }

    return {
      accountType: "guest",
      username: null,
      avatarUrl: normalizeAvatarUrl(profile?.avatarUrl)
    };
  }

  async noteRoomHosted(username: string | null | undefined): Promise<void> {
    if (!username) return;
    await this.ensureLoaded();
    const account = this.getOrCreateUser(normalizeUsername(username));
    this.users.set(userKey(account.username), {
      ...account,
      stats: {
        ...account.stats,
        roomsHosted: account.stats.roomsHosted + 1
      },
      updatedAt: now()
    });
    await this.persist();
  }

  async recordRoundResult(players: Array<{ isBot?: boolean; team: "red" | "blue" | null; profile: UserProfile }>, winner: "red" | "blue"): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const player of players) {
      if (player.isBot || player.profile.accountType !== "named" || !player.profile.username || !player.team) {
        continue;
      }

      const account = this.getOrCreateUser(normalizeUsername(player.profile.username));
      const didWin = player.team === winner;
      this.users.set(userKey(account.username), {
        ...account,
        stats: {
          ...account.stats,
          gamesPlayed: account.stats.gamesPlayed + 1,
          wins: account.stats.wins + (didWin ? 1 : 0),
          losses: account.stats.losses + (didWin ? 0 : 1)
        },
        updatedAt: now()
      });
      changed = true;
    }

    if (changed) {
      await this.persist();
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;
    try {
      await this.tryLoadFile(this.filePath);
    } catch {
      console.warn("Failed to load users from primary file, trying backup...");
      try {
        await this.tryLoadFile(`${this.filePath}.bak`);
      } catch {
        // 无法恢复，从零开始
      }
    }
  }

  private async tryLoadFile(filePath: string): Promise<void> {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UserDatabase;
    for (const account of Object.values(parsed.users ?? {})) {
      this.users.set(userKey(account.username), {
        ...defaultUser(account.username),
        ...account,
        avatarUrl: normalizeAvatarUrl(account.avatarUrl),
        customWordPacks: (account.customWordPacks ?? []).map(normalizeWordPack)
      });
    }
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const payload: UserDatabase = {
        users: Object.fromEntries(this.users.entries())
      };
      const content = JSON.stringify(payload, null, 2);
      await fs.writeFile(this.filePath, content, "utf8");
      await fs.writeFile(`${this.filePath}.bak`, content, "utf8");
    });
    await this.writeChain;
  }

  private withSession(account: NamedUserAccount): NamedUserLoginResponse {
    const sessionToken = crypto.randomUUID();
    this.sessions.set(sessionToken, { userKey: userKey(account.username), expiresAt: Date.now() + JsonUserStore.SESSION_TTL_MS });
    return { ...account, sessionToken };
  }

  private pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [token, entry] of this.sessions.entries()) {
      if (now > entry.expiresAt) this.sessions.delete(token);
    }
  }
}
