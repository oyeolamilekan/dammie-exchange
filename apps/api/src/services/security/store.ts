/**
 * Security-store abstraction and Redis implementation.
 *
 * The store provides replay claims, counters, TTLs, and explicit shutdown for
 * authentication and mutation security controls.
 *
 * @module securityStoreService
 */

import Redis from 'ioredis';
import CONFIG from '../../config/config';

/** Redis-backed primitives used by authentication and mutation security controls. */
export interface SecurityStore {
  /**
   * Atomically claims an absent key and applies its expiry.
   *
   * @param key - Security key to claim.
   * @param ttlSeconds - Expiry applied to a new key.
   * @returns True for the first claimant, false for an existing key.
   */
  claimOnce(key: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Reads a numeric counter without changing it.
   *
   * @param key - Counter key to read.
   * @returns Stored counter or zero when absent.
   */
  getNumber(key: string): Promise<number>;
  /**
   * Atomically increments a counter and sets expiry on its first increment.
   *
   * @param key - Counter key to increment.
   * @param ttlSeconds - First-increment expiry in seconds.
   * @returns Updated counter value.
   */
  incrementWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /**
   * Deletes a security key and its remaining TTL.
   *
   * @param key - Security key to delete.
   * @returns A promise that resolves after deletion.
   */
  delete(key: string): Promise<void>;
  /**
   * Reads the backing key TTL in Redis seconds.
   *
   * @param key - Security key whose TTL should be read.
   * @returns Raw Redis TTL value.
   */
  ttl(key: string): Promise<number>;
}

/** Increments a counter atomically and applies expiry only to its first increment. */
const REDIS_INCREMENT_WITH_TTL_SCRIPT =
  "local value = redis.call('INCR', KEYS[1]); if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return value";

let redis: Redis | undefined;
let redisConnectPromise: Promise<void> | undefined;

/**
 * Lazily creates the shared Redis connection used by security controls.
 *
 * @returns The configured Redis client.
 * @throws If REDIS_URL is missing, preserving fail-closed security behavior.
 */
const getRedis = async (): Promise<Redis> => {
  if (!CONFIG.REDIS_URL) {
    throw new Error('REDIS_URL is required for mutation security controls');
  }

  redis ??= new Redis(CONFIG.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  // With lazyConnect and the offline queue disabled, the first command must
  // explicitly wait for connect() or ioredis rejects it before opening a socket.
  if (redis.status === 'wait') {
    redisConnectPromise ??= redis.connect().finally(() => {
      redisConnectPromise = undefined;
    });
  }
  if (redisConnectPromise) await redisConnectPromise;

  return redis;
};

/** Shared Redis implementation of the security-store contract. */
export const redisSecurityStore: SecurityStore = {
  /**
   * Claims a key once with an atomic NX/EX operation.
   *
   * @param key - Security key to claim.
   * @param ttlSeconds - Expiry applied only when the key is newly created.
   * @returns True when this caller created the key, false for an existing claim.
   * @throws Redis or configuration errors, allowing sensitive operations to fail closed.
  */
  async claimOnce(key, ttlSeconds) {
    const redisClient = await getRedis();
    const result = await redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  },
  /**
   * Reads a security counter as a number.
   *
   * @param key - Counter key to read.
   * @returns Stored integer, or zero when the key is absent.
   * @throws Redis or configuration errors.
  */
  async getNumber(key) {
    const redisClient = await getRedis();
    return Number((await redisClient.get(key)) ?? 0);
  },
  /**
   * Increments a security counter and preserves its first-increment expiry.
   *
   * @param key - Counter key to increment.
   * @param ttlSeconds - Expiry applied atomically when the counter starts.
   * @returns Updated counter value.
   * @throws Redis or configuration errors.
  */
  async incrementWithTtl(key, ttlSeconds) {
    const redisClient = await getRedis();
    const result = await redisClient.eval(
      REDIS_INCREMENT_WITH_TTL_SCRIPT,
      1,
      key,
      ttlSeconds,
    );
    return Number(result);
  },
  /**
   * Deletes a security key.
   *
   * @param key - Security key to remove.
   * @returns A promise that resolves after deletion.
   * @throws Redis or configuration errors.
  */
  async delete(key) {
    const redisClient = await getRedis();
    await redisClient.del(key);
  },
  /**
   * Reads a security key's remaining Redis TTL.
   *
   * @param key - Security key whose TTL should be read.
   * @returns Redis TTL seconds, including Redis's negative missing/no-expiry values.
   * @throws Redis or configuration errors.
  */
  async ttl(key) {
    const redisClient = await getRedis();
    return redisClient.ttl(key);
  },
};

/**
 * Gracefully closes the lazy Redis client with a disconnect fallback.
 *
 * @returns A promise that resolves when the client is closed or already inactive.
 * @sideEffects Clears the lazy singleton and attempts quit before disconnecting.
 */
export const closeSecurityStore = async (): Promise<void> => {
  const activeRedis = redis;
  redis = undefined;
  redisConnectPromise = undefined;
  if (!activeRedis || activeRedis.status === 'end') return;

  try {
    await activeRedis.quit();
  } catch {
    activeRedis.disconnect();
  }
};
