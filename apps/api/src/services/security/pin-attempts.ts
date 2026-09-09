/**
 * Redis-backed transaction-PIN attempt limiting.
 *
 * Counters are scoped by Telegram user, operation scope, and transaction ID so
 * failed attempts cannot be reused across unrelated approvals.
 *
 * @module pinAttemptsService
 */

import type { SecurityStore } from './store';

/** Current PIN-failure count and lock window exposed to approval callers. */
export interface PinAttemptState {
  /** Whether the configured failure threshold has been reached. */
  locked: boolean;
  /** Number of failures in the active security window. */
  attempts: number;
  /** Nonnegative seconds remaining before the counter can expire. */
  retryAfterSeconds: number;
}

/** Dependencies and limits used to construct a PIN attempt limiter. */
export interface PinAttemptLimiterDependencies {
  store: SecurityStore;
  maxAttempts: number;
  windowSeconds: number;
}

/** Creates a Redis-backed PIN attempt limiter scoped to one user and transaction. */
export const createPinAttemptLimiter = ({
  store,
  maxAttempts,
  windowSeconds,
}: PinAttemptLimiterDependencies) => {
  const key = (telegramId: string, transactionId: string, scope = 'swap'): string =>
    `security:pin:${telegramId}:${scope}:${transactionId}`;
  const buildState = (attempts: number, ttl: number): PinAttemptState => ({
    locked: attempts >= maxAttempts,
    attempts,
    retryAfterSeconds: Math.max(ttl, 0),
  });

  return {
    getState: async (telegramId: string, transactionId: string, scope?: string): Promise<PinAttemptState> => {
      const counterKey = key(telegramId, transactionId, scope);
      const attempts = await store.getNumber(counterKey);
      const ttl = attempts > 0 ? await store.ttl(counterKey) : 0;
      return buildState(attempts, ttl);
    },
    recordFailure: async (telegramId: string, transactionId: string, scope?: string): Promise<PinAttemptState> => {
      const counterKey = key(telegramId, transactionId, scope);
      const attempts = await store.incrementWithTtl(counterKey, windowSeconds);
      const ttl = await store.ttl(counterKey);
      return buildState(attempts, ttl);
    },
    reset: async (telegramId: string, transactionId: string, scope?: string): Promise<void> => {
      await store.delete(key(telegramId, transactionId, scope));
    },
  };
};

/** Constructed PIN attempt limiter contract. */
export type PinAttemptLimiter = ReturnType<typeof createPinAttemptLimiter>;
