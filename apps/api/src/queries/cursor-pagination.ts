/**
 * Keyset-pagination helpers shared by transaction query modules.
 *
 * Cursors contain only a versioned created-at/id pair and are encoded as
 * URL-safe base64 so they can be passed through API and Telegram responses.
 *
 * @module cursorPagination
 */

/** Default number of records returned by a transaction page. */
export const DEFAULT_TRANSACTION_PAGE_SIZE = 10;

/** Hard upper bound for a transaction page size. */
export const MAX_TRANSACTION_PAGE_SIZE = 20;

/** Versioned serialized form of a transaction cursor. */
interface TransactionCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
}

/** Decoded keyset cursor used by transaction queries. */
export interface TransactionCursor {
  createdAt: Date;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates and clamps a requested transaction page size.
 *
 * @param limit Requested page size, or the default when omitted.
 * @returns A value between the default/positive minimum and the hard maximum.
 * @throws If an explicitly supplied limit is not a positive integer.
 */
export const normalizeTransactionPageSize = (limit?: number): number => {
  if (limit === undefined) return DEFAULT_TRANSACTION_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Transaction page size must be a positive integer');
  }
  return Math.min(limit, MAX_TRANSACTION_PAGE_SIZE);
};

/** Encodes a created-at/id keyset position as an opaque cursor. */
export const encodeTransactionCursor = (createdAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({
    v: 1,
    createdAt: createdAt.toISOString(),
    id,
  } satisfies TransactionCursorPayload)).toString('base64url');

/**
 * Decodes and validates an opaque transaction cursor.
 *
 * @param cursor URL-safe base64 cursor returned by a previous page.
 * @returns The validated created-at/id position.
 * @throws If the cursor is malformed, unsupported, or contains an invalid ID.
 */
export const decodeTransactionCursor = (cursor: string): TransactionCursor => {
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<TransactionCursorPayload>;
    const createdAt = new Date(payload.createdAt ?? '');
    if (payload.v !== 1 || Number.isNaN(createdAt.valueOf()) ||
      !payload.id || !UUID_PATTERN.test(payload.id)) {
      throw new Error('invalid payload');
    }
    return { createdAt, id: payload.id };
  } catch {
    throw new Error('Invalid transaction cursor');
  }
};
