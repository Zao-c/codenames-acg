const KEY = 'cipai.private-identity.v1';

/** Independent from display names and legacy username-only login. Never put in URLs. */
export function privateIdentityKey(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(KEY, value);
  return value;
}

export function restorePrivateIdentity(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value.trim())) throw new Error('请输入完整的 64 位身份凭证');
  localStorage.setItem(KEY, value.trim());
}
