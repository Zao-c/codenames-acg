import crypto from 'node:crypto';

/** A random device credential proves possession, never ownership of a legacy nickname. */
export function principalFromKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('私人身份凭证无效，请刷新页面后重试');
  return crypto.createHash('sha256').update('cipai-private-v1:').update(value).digest('hex');
}
