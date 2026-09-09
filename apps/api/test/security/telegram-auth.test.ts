import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SecurityStore } from '../../src/services/security/store';
import {
  TelegramAuthenticationError,
  verifyTelegramInitData,
} from '../../src/services/security/telegram-auth';

class MemorySecurityStore implements SecurityStore {
  readonly values = new Map<string, number>();
  shouldFail = false;

  async claimOnce(key: string): Promise<boolean> {
    if (this.shouldFail) throw new Error('redis unavailable');
    if (this.values.has(key)) return false;
    this.values.set(key, 1);
    return true;
  }
  async getNumber(key: string) { return this.values.get(key) ?? 0; }
  async incrementWithTtl(key: string) {
    const value = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, value);
    return value;
  }
  async delete(key: string) { this.values.delete(key); }
  async ttl() { return 60; }
}

const BOT_TOKEN = '123456:test-token';
const NOW_SECONDS = 1_800_000_000;

const signedInitData = (
  overrides: Record<string, string> = {},
  signingToken = BOT_TOKEN,
) => {
  const params = new URLSearchParams({
    auth_date: String(NOW_SECONDS),
    query_id: 'AAEAAAE',
    user: JSON.stringify({
      id: 42,
      first_name: 'Ada',
      last_name: 'Nwosu',
      username: 'ada',
    }),
    ...overrides,
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData')
    .update(signingToken)
    .digest();
  params.set(
    'hash',
    createHmac('sha256', secret).update(dataCheckString).digest('hex'),
  );
  return params.toString();
};

const verify = (initData: string, store = new MemorySecurityStore()) =>
  verifyTelegramInitData(initData, {
    botToken: BOT_TOKEN,
    maxAgeSeconds: 300,
    store,
    now: new Date(NOW_SECONDS * 1000),
  });

describe('Telegram Mini App authentication', () => {
  it('accepts a current, correctly signed identity', async () => {
    await expect(verify(signedInitData())).resolves.toEqual({
      id: '42',
      firstName: 'Ada',
      lastName: 'Nwosu',
      username: 'ada',
    });
  });

  it('includes Telegram\'s signature field in bot-token HMAC validation', async () => {
    await expect(verify(signedInitData({
      signature: 'telegram-ed25519-signature',
    }))).resolves.toMatchObject({ id: '42' });
  });

  it.each([
    ['', 'required'],
    ['auth_date=not-a-date&hash=nope', 'malformed'],
    [signedInitData({}, 'wrong-token'), 'invalid'],
    [signedInitData({ auth_date: String(NOW_SECONDS - 301) }), 'expired'],
  ])('rejects missing, malformed, tampered, or expired data', async (data, message) => {
    await expect(verify(data)).rejects.toThrow(message);
  });

  it('rejects replay of the same signed payload', async () => {
    const store = new MemorySecurityStore();
    const data = signedInitData();
    await verify(data, store);
    await expect(verify(data, store)).rejects.toThrow('already been used');
  });

  it('allows repeated read verification without consuming the later mutation claim', async () => {
    const store = new MemorySecurityStore();
    const data = signedInitData();
    const options = {
      botToken: BOT_TOKEN,
      maxAgeSeconds: 300,
      store,
      now: new Date(NOW_SECONDS * 1000),
      claimReplay: false,
    };
    await verifyTelegramInitData(data, options);
    await verifyTelegramInitData(data, options);
    await expect(verify(data, store)).resolves.toMatchObject({ id: '42' });
  });

  it('fails closed when replay storage is unavailable', async () => {
    const store = new MemorySecurityStore();
    store.shouldFail = true;
    await expect(verify(signedInitData(), store)).rejects.toMatchObject<Partial<TelegramAuthenticationError>>({
      status: 503,
    });
  });
});
