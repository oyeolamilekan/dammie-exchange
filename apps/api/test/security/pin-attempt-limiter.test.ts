import { describe, expect, it } from 'vitest';
import { createPinAttemptLimiter } from '../../src/services/security/pin-attempts';
import type { SecurityStore } from '../../src/services/security/store';

class FakeStore implements SecurityStore {
  values = new Map<string, number>();
  remainingTtl = 60;
  fail = false;

  private check() { if (this.fail) throw new Error('redis unavailable'); }
  async claimOnce() { this.check(); return true; }
  async getNumber(key: string) { this.check(); return this.values.get(key) ?? 0; }
  async incrementWithTtl(key: string) {
    this.check();
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }
  async delete(key: string) { this.check(); this.values.delete(key); }
  async ttl() { this.check(); return this.remainingTtl; }
}

describe('PIN attempt limiter', () => {
  it('locks at the threshold and resets after success', async () => {
    const store = new FakeStore();
    const limiter = createPinAttemptLimiter({ store, maxAttempts: 3, windowSeconds: 60 });

    expect((await limiter.recordFailure('42', 'swap-1')).locked).toBe(false);
    expect((await limiter.recordFailure('42', 'swap-1')).locked).toBe(false);
    expect((await limiter.recordFailure('42', 'swap-1')).locked).toBe(true);
    expect(await limiter.getState('42', 'swap-1')).toMatchObject({
      attempts: 3,
      locked: true,
      retryAfterSeconds: 60,
    });

    await limiter.reset('42', 'swap-1');
    expect((await limiter.getState('42', 'swap-1')).locked).toBe(false);
  });

  it('allows attempts after the backing TTL expires', async () => {
    const store = new FakeStore();
    const limiter = createPinAttemptLimiter({ store, maxAttempts: 1, windowSeconds: 60 });
    await limiter.recordFailure('42', 'swap-1');
    store.values.clear();
    expect(await limiter.getState('42', 'swap-1')).toMatchObject({
      attempts: 0,
      locked: false,
    });
  });

  it('propagates store errors so approval can fail closed', async () => {
    const store = new FakeStore();
    store.fail = true;
    const limiter = createPinAttemptLimiter({ store, maxAttempts: 3, windowSeconds: 60 });
    await expect(limiter.getState('42', 'swap-1')).rejects.toThrow('redis unavailable');
  });

  it('isolates swap and withdrawal PIN attempts', async () => {
    const store = new FakeStore();
    const limiter = createPinAttemptLimiter({ store, maxAttempts: 1, windowSeconds: 60 });
    await limiter.recordFailure('42', 'same-id', 'withdrawal');
    expect((await limiter.getState('42', 'same-id', 'withdrawal')).locked).toBe(true);
    expect((await limiter.getState('42', 'same-id', 'swap')).locked).toBe(false);
  });
});
