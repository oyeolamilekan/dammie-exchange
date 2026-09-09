/**
 * Telegram Mini App init-data verification service.
 *
 * It validates Telegram's HMAC signature, freshness, required identity fields,
 * and optional one-time replay claims in the security store.
 *
 * @module telegramAuthService
 */

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import type { SecurityStore } from './store';

/** Sanitized Telegram identity accepted after Mini App HMAC verification. */
export interface AuthenticatedTelegramUser {
  /** Telegram user identifier represented as text for stable lookup. */
  id: string;
  /** Telegram first name supplied in the signed user payload. */
  firstName: string;
  /** Optional Telegram last name. */
  lastName?: string;
  /** Optional Telegram username. */
  username?: string;
}

/** Authentication error carrying the HTTP status appropriate for the caller. */
export class TelegramAuthenticationError extends Error {
  /**
   * Creates a typed Telegram authentication failure.
   *
   * @param message - Privacy-safe authentication error message.
   * @param status - HTTP status returned by the authentication boundary.
   */
  constructor(
    message: string,
    public readonly status: number = 401,
  ) {
    super(message);
    this.name = 'TelegramAuthenticationError';
  }
}

/** Dependencies and clock policy used to verify Telegram Mini App data. */
interface VerifyTelegramInitDataOptions {
  /** Telegram bot token used to derive the Mini App HMAC secret. */
  botToken: string;
  /** Maximum accepted age of the signed auth_date in seconds. */
  maxAgeSeconds: number;
  /** Replay store used to claim the signed payload exactly once. */
  store: SecurityStore;
  /** Optional clock used by deterministic tests and callers. */
  now?: Date;
  /** Whether to consume this signed payload. Disable only for read-only requests. */
  claimReplay?: boolean;
}

/**
 * Parses and sanitizes the signed Telegram user JSON value.
 *
 * @param value - URL-encoded Telegram user JSON, or null when absent.
 * @returns Sanitized Telegram identity fields.
 * @throws If the user is missing or malformed.
 */
const parseTelegramUser = (value: string | null): AuthenticatedTelegramUser => {
  if (!value) throw new TelegramAuthenticationError('Telegram user is missing');

  try {
    const user = JSON.parse(value) as Record<string, unknown>;
    if (
      (typeof user.id !== 'string' && typeof user.id !== 'number') ||
      typeof user.first_name !== 'string'
    ) {
      throw new Error('invalid user fields');
    }

    return {
      id: String(user.id),
      firstName: user.first_name,
      ...(typeof user.last_name === 'string' ? { lastName: user.last_name } : {}),
      ...(typeof user.username === 'string' ? { username: user.username } : {}),
    };
  } catch {
    throw new TelegramAuthenticationError('Telegram user is malformed');
  }
};

/**
 * Builds Telegram's sorted bot-token HMAC data-check string while excluding hash.
 * Telegram's newer signature field is part of this HMAC input; it is excluded
 * only by the separate Ed25519 third-party verification algorithm.
 *
 * @param params - Parsed Telegram init-data parameters.
 * @returns Newline-delimited sorted key/value data for HMAC verification.
 */
const buildDataCheckString = (params: URLSearchParams): string => [...params.entries()]
  .filter(([key]) => key !== 'hash')
  .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n');

/**
 * Computes Telegram's expected Web App HMAC from the bot token and data-check string.
 *
 * @param botToken - Telegram bot token used to derive the secret key.
 * @param dataCheckString - Canonical signed parameter string.
 * @returns Expected binary SHA-256 HMAC.
 */
const computeExpectedHash = (botToken: string, dataCheckString: string): Buffer => {
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  return createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
};

/**
 * Compares the supplied hexadecimal hash to the expected HMAC safely.
 *
 * @param suppliedHash - Syntax-validated hexadecimal hash from init data.
 * @param expectedHash - Expected binary HMAC.
 * @returns Whether the supplied hash matches with a timing-safe comparison.
 */
const matchesExpectedHash = (suppliedHash: string, expectedHash: Buffer): boolean => {
  const actualHash = Buffer.from(suppliedHash, 'hex');
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
};

/**
 * Validates the signed auth_date against the current time and configured age window.
 *
 * @param params - Parsed Telegram init-data parameters.
 * @param maxAgeSeconds - Maximum allowed age in seconds.
 * @param now - Verification clock.
 * @throws If auth_date is not a safe integer, too far in the future, or expired.
 */
const validateAuthDate = (
  params: URLSearchParams,
  maxAgeSeconds: number,
  now: Date,
): void => {
  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + 30 ||
    nowSeconds - authDate > maxAgeSeconds
  ) {
    throw new TelegramAuthenticationError('Telegram authentication has expired');
  }
};

/**
 * Builds the replay key for one signed init-data payload.
 *
 * @param initData - Original signed Telegram init-data string.
 * @returns Stable security-store key containing only a hash of the payload.
 */
const buildReplayKey = (initData: string): string =>
  `security:telegram-init:${createHash('sha256').update(initData).digest('hex')}`;

/**
 * Claims a Telegram payload replay key and translates storage failures to unavailable auth.
 *
 * @param replayKey - Hash-based replay key to claim.
 * @param options - Security store and replay TTL settings.
 * @returns A promise that resolves only when the payload is newly claimed.
 * @throws A replay error when already claimed, or a 503 auth error when storage fails.
 */
const claimReplayKey = async (
  replayKey: string,
  options: VerifyTelegramInitDataOptions,
): Promise<void> => {
  try {
    const claimed = await options.store.claimOnce(replayKey, options.maxAgeSeconds + 30);
    if (!claimed) {
      throw new TelegramAuthenticationError(
        'Telegram authentication has already been used',
      );
    }
  } catch (error: unknown) {
    if (error instanceof TelegramAuthenticationError) throw error;
    throw new TelegramAuthenticationError(
      'Telegram authentication is unavailable',
      503,
    );
  }
};

/**
 * Verifies Telegram Mini App authentication and claims the signed payload once.
 *
 * @param initData - URL-encoded Telegram init-data payload.
 * @param options - Bot token, age policy, replay store, and optional clock.
 * @returns Sanitized authenticated Telegram user.
 * @throws If configuration, presence, hash, timestamp, user, replay, or security storage validation fails.
 * @sideEffects Claims the payload's replay key for maxAgeSeconds plus the future allowance.
 */
export const verifyTelegramInitData = async (
  initData: string,
  options: VerifyTelegramInitDataOptions,
): Promise<AuthenticatedTelegramUser> => {
  if (!options.botToken) {
    throw new TelegramAuthenticationError(
      'Telegram authentication is unavailable',
      503,
    );
  }

  if (!initData) throw new TelegramAuthenticationError('Telegram authentication is required');

  const params = new URLSearchParams(initData);
  const suppliedHash = params.get('hash');
  if (!suppliedHash || !/^[a-f\d]{64}$/i.test(suppliedHash)) {
    throw new TelegramAuthenticationError('Telegram authentication is malformed');
  }

  const dataCheckString = buildDataCheckString(params);
  const expectedHash = computeExpectedHash(options.botToken, dataCheckString);
  if (!matchesExpectedHash(suppliedHash, expectedHash)) {
    throw new TelegramAuthenticationError('Telegram authentication is invalid');
  }

  validateAuthDate(params, options.maxAgeSeconds, options.now ?? new Date());
  const user = parseTelegramUser(params.get('user'));
  if (options.claimReplay ?? true) {
    await claimReplayKey(buildReplayKey(initData), options);
  }
  return user;
};
