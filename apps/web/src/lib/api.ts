import type { GameReplay, NamedUserAccount, NamedUserLoginResponse, PublicImagePack, PublicImagePackSummary, PublicWordPack, PublicWordPackSummary, UpdateNamedUserPayload, UsernameLoginPayload } from "@acg-codenames/shared";

const API_BASE = import.meta.env.VITE_SERVER_URL || "";

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
