import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { accountVersions, type AccountVersionAction, type AccountVersionTransactionType } from '../db/schema/account-version.schema';
import { currencies } from '../db/schema/currency.schema';
import { wallets } from '../db/schema/wallet.schema';
import { decodeTransactionCursor, encodeTransactionCursor, normalizeTransactionPageSize } from './cursor-pagination';
import { standardDecimal } from '../utils/decimal';

/**
 * Immutable wallet account-version queries.
 *
 * Account versions record the balance transition associated with a financial
 * transaction and are exposed through newest-first keyset pagination.
 *
 * @module accountHistoryQuery
 */

/** Query filters for immutable wallet account-version records. */
export interface AccountHistoryFilter {
  /** Owning user identifier. */
  userId: string;
  /** Optional wallet identifier. */
  walletId?: string;
  /** Optional business transaction identifier. */
  transactionId?: string;
  /** Optional currency codes to include. */
  currencies?: string[];
  /** Optional transaction family filter. */
  transactionType?: AccountVersionTransactionType;
  /** Optional balance-change action filter. */
  action?: AccountVersionAction;
  /** Inclusive lower creation-time bound. */
  createdAfter?: Date;
  /** Inclusive upper creation-time bound. */
  createdBefore?: Date;
}

/** Normalized account-version record returned to application callers. */
export interface AccountHistoryRecord {
  id: string;
  transactionType: AccountVersionTransactionType;
  transactionId: string;
  action: AccountVersionAction;
  amount: string;
  timestamp: Date;
  /** Alias retained for consumers that use the database field name. */
  createdAt: Date;
  currency: string;
  previousBalance: string;
  balance: string;
  lockedBalance: string;
}

/** Cursor-paginated account history response. */
export interface AccountHistoryPage {
  items: AccountHistoryRecord[];
  nextCursor?: string;
}

/**
 * Reads immutable balance changes for one user with newest-first keyset
 * pagination.
 *
 * Currency codes are normalized to uppercase and stored decimal values are
 * returned in standard decimal string form.
 *
 * @param filter User and optional account-history filters.
 * @param options Opaque continuation cursor and bounded page size.
 * @returns A page of account-version records and an optional next cursor.
 */
export const findAccountHistoryPage = async (
  filter: AccountHistoryFilter,
  options: { cursor?: string; limit?: number } = {},
): Promise<AccountHistoryPage> => {
  const limit = normalizeTransactionPageSize(options.limit);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;
  const clauses: SQL[] = [eq(wallets.userId, filter.userId)];
  if (filter.walletId) clauses.push(eq(accountVersions.walletId, filter.walletId));
  if (filter.transactionId) clauses.push(eq(accountVersions.transactionId, filter.transactionId));
  if (filter.transactionType) clauses.push(eq(accountVersions.transactionType, filter.transactionType));
  if (filter.action) clauses.push(eq(accountVersions.action, filter.action));
  if (filter.createdAfter) clauses.push(gte(accountVersions.createdAt, filter.createdAfter));
  if (filter.createdBefore) clauses.push(lte(accountVersions.createdAt, filter.createdBefore));
  if (filter.currencies?.length) {
    clauses.push(inArray(sql`lower(${currencies.code})`, filter.currencies.map((value) => value.trim().toLowerCase())));
  }
  if (cursor) clauses.push(or(
    lt(accountVersions.createdAt, cursor.createdAt),
    and(eq(accountVersions.createdAt, cursor.createdAt), lt(accountVersions.id, cursor.id)),
  ) as SQL);

  const rows = await db.select({
    id: accountVersions.id,
    transactionType: accountVersions.transactionType,
    transactionId: accountVersions.transactionId,
    action: accountVersions.action,
    amount: accountVersions.amount,
    timestamp: accountVersions.createdAt,
    currency: currencies.code,
    previousBalance: accountVersions.previousBalance,
    balance: accountVersions.balance,
    lockedBalance: accountVersions.lockedBalance,
  }).from(accountVersions).innerJoin(wallets, eq(wallets.id, accountVersions.walletId))
    .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(and(...clauses))
    .orderBy(desc(accountVersions.createdAt), desc(accountVersions.id))
    .limit(limit + 1);
  const hasNext = rows.length > limit;
  const pageRows = hasNext ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => ({
    ...row,
    createdAt: row.timestamp,
    currency: row.currency.toUpperCase(),
    amount: standardDecimal(row.amount),
    previousBalance: standardDecimal(row.previousBalance),
    balance: standardDecimal(row.balance),
    lockedBalance: standardDecimal(row.lockedBalance),
  }));
  const last = pageRows[pageRows.length - 1];
  return {
    items,
    ...(hasNext && last ? { nextCursor: encodeTransactionCursor(last.timestamp, last.id) } : {}),
  };
};
