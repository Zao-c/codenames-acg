import type { NamedUserAccount, NamedUserLoginResponse, PublicWordPack, UpdateNamedUserPayload, UsernameLoginPayload } from "@acg-codenames/shared";

const API_BASE = import.meta.env.VITE_SERVER_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "content-type": "application/json"
    },
    signal: controller.signal,
    ...init
  });
  clearTimeout(timeout);

  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `${response.status} ${response.statusText}`);
  }
  return payload as T;
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

export function listPublicWordPacks(): Promise<PublicWordPack[]> {
  return request<PublicWordPack[]>("/api/public-word-packs");
}
