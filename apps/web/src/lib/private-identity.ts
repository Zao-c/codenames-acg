const KEY = 'cipai.private-identity.v1';
const SCOPES = 'cipai.private-identity.scopes.v1';

export function activatePrivateIdentity(owner: string): void {
  const previousOwner = localStorage.getItem(`${SCOPES}:active`);
  let scopes:Record<string,string>={};try{const parsed=JSON.parse(localStorage.getItem(SCOPES)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))scopes=Object.fromEntries(Object.entries(parsed).filter((entry):entry is [string,string]=>typeof entry[1]==='string'&&/^[a-f0-9]{64}$/.test(entry[1])));}catch{};
  if (previousOwner) scopes[previousOwner] = privateIdentityKey();
  if (!previousOwner || previousOwner === owner) scopes[owner] = privateIdentityKey();
  else {
    localStorage.removeItem(KEY);
    if (scopes[owner]) localStorage.setItem(KEY,scopes[owner]);
    else scopes[owner] = privateIdentityKey();
  }
  localStorage.setItem(SCOPES,JSON.stringify(scopes));
  localStorage.setItem(`${SCOPES}:active`,owner);
}

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
  window.dispatchEvent(new Event('private-identity-changed'));
}
