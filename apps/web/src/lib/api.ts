import type { GameReplay, NamedUserAccount, NamedUserLoginResponse, PublicImagePack, PublicImagePackSummary, PublicWordPack, PublicWordPackSummary, UpdateNamedUserPayload, UsernameLoginPayload } from "@acg-codenames/shared";

const API_BASE = import.meta.env.VITE_SERVER_URL || "";
import { ScopedResource } from './resource-cache';
import { privateIdentityKey } from './private-identity';
import type { CommunityPool, CommunityPoolInput, CommunityPoolPage, PoolModerationItem, AnimeWork } from '@acg-codenames/shared';

export function getFeatures(): Promise<{ animeCommunity: boolean }> { return request('/api/features'); }
type AnimeCatalog = {works:AnimeWork[];pools?:import('@acg-codenames/shared').AnimePool[]};
const catalogCache = new ScopedResource<AnimeCatalog>();
const homeCache = new ScopedResource<{works:Pick<AnimeWork,'id'|'title'|'fullTitle'|'cover'>[]}>();
export function getAnimeCatalog(): Promise<AnimeCatalog> { const key=privateIdentityKey(); return catalogCache.get(key,()=>request('/api/anime/catalog',{headers:{'x-private-key':key},cache:'no-cache'},30000)); }
export function getHomeCovers() { return homeCache.get('public',()=>request<{works:Pick<AnimeWork,'id'|'title'|'fullTitle'|'cover'>[]}>('/api/anime/home-covers')); }
async function catalogMutation<T>(operation:Promise<T>) { const value=await operation;catalogCache.clear();return value; }
export function getPlanPool(roomId:string,planId:string,version:number):Promise<{planId:string;version:number;works:AnimeWork[]}>{return request(`/api/rooms/${encodeURIComponent(roomId)}/plan-pool?${new URLSearchParams({planId,version:String(version)})}`,{headers:communityHeaders()});}
export function getPlanPoolPreview(roomId:string,planId:string,version:number):Promise<{planId:string;version:number;works:AnimeWork[]}>{return request(`/api/rooms/${encodeURIComponent(roomId)}/plan-pool?${new URLSearchParams({planId,version:String(version),preview:'1'})}`,{headers:communityHeaders()});}
export function listManualWorks(scope: 'mine'|'public' = 'mine', q = '', page = 1): Promise<import('@acg-codenames/shared').ManualAnimePage> {
  return request(`/api/anime/manual?${new URLSearchParams({ scope, q, page: String(page) })}`, { headers: communityHeaders() });
}
export function createManualWork(input: import('@acg-codenames/shared').ManualAnimeInput): Promise<AnimeWork> {
  return catalogMutation(request('/api/anime/manual', { method: 'POST', headers: communityHeaders(), body: JSON.stringify(input) }, 30000));
}
export function updateManualWork(id: number, input: import('@acg-codenames/shared').ManualAnimeInput): Promise<AnimeWork> {
  return catalogMutation(request(`/api/anime/manual/${id}`, { method: 'PUT', headers: communityHeaders(), body: JSON.stringify(input) }, 30000));
}
export function deleteManualWork(id: number): Promise<{ ok: boolean }> {
  return catalogMutation(request(`/api/anime/manual/${id}`, { method: 'DELETE', headers: communityHeaders() }));
}
export function resolveAnimeAssetUrl(src: string): string {
  if (!src || /^https?:|^data:|^blob:/.test(src)) return src;
  return `${API_BASE}${src}`;
}
export function discoverAnime(query:import('@acg-codenames/shared').AnimeDiscoveryQuery):Promise<import('@acg-codenames/shared').AnimeDiscoveryResult>{return catalogMutation(request('/api/anime/discovery/search',{method:'POST',headers:communityHeaders(),body:JSON.stringify(query)},30000));}
export function importAnime(input:string):Promise<AnimeWork>{return catalogMutation(request('/api/anime/discovery/import',{method:'POST',headers:communityHeaders(),body:JSON.stringify({input})},30000));}
const communityHeaders = () => ({ 'content-type': 'application/json', 'x-private-key': privateIdentityKey() });
export function listCommunityPools(scope = 'public', q = '', page = 1): Promise<CommunityPoolPage> {
  return request(`/api/anime-pools?${new URLSearchParams({ scope, q, page: String(page) })}`, { headers: communityHeaders() });
}
export function getCommunityPool(id: string): Promise<CommunityPool> { return request(`/api/anime-pools/${encodeURIComponent(id)}`, { headers: communityHeaders() }); }
export function saveCommunityPool(input: CommunityPoolInput, id?: string): Promise<CommunityPool> { return catalogMutation(request(`/api/anime-pools${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', headers: communityHeaders(), body: JSON.stringify(input) })); }
export function deleteCommunityPool(id: string): Promise<{ ok: boolean }> { return request(`/api/anime-pools/${encodeURIComponent(id)}`, { method: 'DELETE', headers: communityHeaders() }); }
export function copyCommunityPool(id: string): Promise<CommunityPool> { return catalogMutation(request(`/api/anime-pools/${encodeURIComponent(id)}/copy`, { method: 'POST', headers: communityHeaders(), body: '{}' })); }
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

async function request<T>(path: string, init?: RequestInit, timeoutMs=10000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "content-type": "application/json"
      },
      signal: controller.signal,
      ...init
    });

    let parsed = true;
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      parsed = false;
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    if (!parsed || payload === null || typeof payload !== "object") {
      // A 2xx response with an unreadable body must never be treated as an empty success:
      // callers persist identity/accounts from it, which corrupted local state in production.
      throw new Error("服务器响应异常，请重试");
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
