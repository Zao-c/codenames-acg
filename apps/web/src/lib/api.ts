import type { GameReplay, NamedUserAccount, NamedUserLoginResponse, PublicImagePack, PublicImagePackSummary, PublicWordPack, PublicWordPackSummary, UpdateNamedUserPayload, UsernameLoginPayload } from "@acg-codenames/shared";

const API_BASE = import.meta.env.VITE_SERVER_URL || "";
import { privateIdentityKey } from './private-identity';
import type { CommunityPool, CommunityPoolInput, CommunityPoolPage, PoolModerationItem, AnimeWork } from '@acg-codenames/shared';

export function getFeatures(): Promise<{ animeCommunity: boolean }> { return request('/api/features'); }
export function getAnimeCatalog(): Promise<{ works: AnimeWork[] }> { return request('/api/anime/catalog'); }
const communityHeaders = () => ({ 'content-type': 'application/json', 'x-private-key': privateIdentityKey() });
export function listCommunityPools(scope = 'public', q = '', page = 1): Promise<CommunityPoolPage> {
  return request(`/api/anime-pools?${new URLSearchParams({ scope, q, page: String(page) })}`, { headers: communityHeaders() });
}
export function getCommunityPool(id: string): Promise<CommunityPool> { return request(`/api/anime-pools/${encodeURIComponent(id)}`, { headers: communityHeaders() }); }
export function saveCommunityPool(input: CommunityPoolInput, id?: string): Promise<CommunityPool> { return request(`/api/anime-pools${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', headers: communityHeaders(), body: JSON.stringify(input) }); }
export function copyCommunityPool(id: string): Promise<CommunityPool> { return request(`/api/anime-pools/${encodeURIComponent(id)}/copy`, { method: 'POST', headers: communityHeaders(), body: '{}' }); }
export function favoriteCommunityPool(id: string, value: boolean): Promise<{ ok: boolean }> { return request(`/api/anime-pools/${encodeURIComponent(id)}/favorite`, { method: 'PUT', headers: communityHeaders(), body: JSON.stringify({ value }) }); }
export function reportCommunityPool(id: string, reason: string): Promise<{ ok: boolean }> { return request(`/api/anime-pools/${encodeURIComponent(id)}/report`, { method: 'POST', headers: communityHeaders(), body: JSON.stringify({ reason }) }); }
export function getPoolModeration(key: string): Promise<{ items: PoolModerationItem[] }> { return request('/api/anime-pools/moderation', { headers: { 'x-anime-admin-key': key } }); }
export function moderateCommunityPool(id: string, key: string, hidden: boolean, reason: string): Promise<{ ok: boolean }> { return request(`/api/anime-pools/${encodeURIComponent(id)}/moderation`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-anime-admin-key': key }, body: JSON.stringify({ hidden, reason }) }); }

export function getPrivateReplay(matchId: string): Promise<import('@acg-codenames/shared').PrivateReplayView> {
  return request(`/api/private-replays/${encodeURIComponent(matchId)}`, { headers: { 'x-private-key': privateIdentityKey() } });
}
export function sharePrivatePrediction(matchId: string, shared: boolean): Promise<import('@acg-codenames/shared').PrivateReplayView> {
  return request(`/api/private-replays/${encodeURIComponent(matchId)}/share`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-private-key': privateIdentityKey() }, body: JSON.stringify({ shared }) });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "content-type": "application/json"
      },
      signal: controller.signal,
      ...init
    });

    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? `${response.status} ${response.statusText}`);
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function loginNamedUser(payload: UsernameLoginPayload): Promise<NamedUserLoginResponse> {
  return request<NamedUserLoginResponse>("/api/users/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateNamedUser(username: string, sessionToken: string, payload: UpdateNamedUserPayload): Promise<NamedUserAccount> {
  return request<NamedUserAccount>(`/api/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-user-session-token": sessionToken
    },
    body: JSON.stringify(payload)
  });
}

export function listPublicWordPacks(): Promise<PublicWordPackSummary[]> {
  return request<PublicWordPackSummary[]>("/api/public-word-packs");
}

export function getPublicWordPackDetail(publicId: string): Promise<PublicWordPack> {
  return request<PublicWordPack>(`/api/public-word-packs/${encodeURIComponent(publicId)}`);
}

export function listPublicImagePacks(): Promise<PublicImagePackSummary[]> {
  return request<PublicImagePackSummary[]>("/api/public-image-packs");
}

export function getPublicImagePackDetail(publicId: string): Promise<PublicImagePack> {
  return request<PublicImagePack>(`/api/public-image-packs/${encodeURIComponent(publicId)}`);
}

export function fetchReplay(replayId: string): Promise<GameReplay> {
  return request<GameReplay>(`/api/replays/${encodeURIComponent(replayId)}`);
}

export function logoutNamedUser(username: string, sessionToken: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/users/logout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-session-token": sessionToken,
      "x-username": username
    }
  });
}
