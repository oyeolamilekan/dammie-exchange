import { and, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { currencies } from '../db/schema/currency.schema';
import { deposits, type Deposit, type NewDeposit } from '../db/schema/deposit.schema';
import { decodeTransactionCursor, encodeTransactionCursor, normalizeTransactionPageSize } from './cursor-pagination';
import { standardDecimal } from '../utils/decimal';

/**
 * Deposit persistence, history, and aggregation queries.
 *
 * Query results expose normalized decimal strings and use the shared
 * newest-first transaction cursor for history pages.
 *
 * @module depositQuery
 */

/** Optional fields used to filter deposits. */
export interface DepositFilter {
  id?: string;
  userId?: string;
  walletId?: string;
  depositId?: string;
  currency?: string;
  txid?: string;
  status?: Deposit['status'];
  amount?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

/** Normalized deposit record returned by history queries. */
export interface DepositHistoryRecord {
  id: string;
  amount: string;
  currency: string;
  network: string | null;
  txid: string;
  status: Deposit['status'];
  createdAt: Date;
}

/** Cursor-paginated deposit history response. */
export interface DepositPage { items: DepositHistoryRecord[]; nextCursor?: string }

/** Aggregate of successful deposits matching a filter. */
export interface DepositSummaryResult { totalAmount: string; transactionCount: number; currencies: string[] }

/** Deposit activity grouped by currency. */
export interface DepositActivityTotal { currency: string; amount: string; transactionCount: number }

/** Builds a Drizzle predicate from deposit filter fields. */
export const depositWhere = (filter: DepositFilter): SQL | undefined => {
  const clauses: SQL[] = [];
  if (filter.id !== undefined) clauses.push(eq(deposits.id, filter.id));
  if (filter.userId !== undefined) clauses.push(eq(deposits.userId, filter.userId));
  if (filter.walletId !== undefined) clauses.push(eq(deposits.walletId, filter.walletId));
  if (filter.depositId !== undefined) clauses.push(eq(deposits.depositId, filter.depositId));
  if (filter.currency !== undefined) clauses.push(eq(deposits.currency, filter.currency));
  if (filter.txid !== undefined) clauses.push(eq(deposits.txid, filter.txid));
  if (filter.status !== undefined) clauses.push(eq(deposits.status, filter.status));
  if (filter.amount !== undefined) clauses.push(eq(deposits.amount, filter.amount));
  if (filter.createdAfter !== undefined) clauses.push(gte(deposits.createdAt, filter.createdAfter));
  if (filter.createdBefore !== undefined) clauses.push(lte(deposits.createdAt, filter.createdBefore));
  return clauses.length ? and(...clauses) : undefined;
};

/** Inserts and returns a deposit record. */
export const createDeposit = async (data: NewDeposit) => (await db.insert(deposits).values(data).returning())[0];

/** Finds the first deposit matching the supplied filter. */
export const findDeposit = async (condition: DepositFilter) =>
  (await db.select().from(deposits).where(depositWhere(condition)).limit(1))[0] ?? null;

/**
 * Reads a newest-first, cursor-paginated deposit history page.
 *
 * @param condition Deposit filters, commonly including the owning user.
 * @param options Opaque continuation cursor and optional bounded page size.
 * @returns Deposit history items and an optional next cursor.
 */
export const findDepositPage = async (condition: DepositFilter, options: { cursor?: string; limit?: number } = {}): Promise<DepositPage> => {
  const limit = normalizeTransactionPageSize(options.limit);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;
  const cursorClause = cursor ? or(
    lt(deposits.createdAt, cursor.createdAt),
    and(eq(deposits.createdAt, cursor.createdAt), lt(deposits.id, cursor.id)),
  ) : undefined;
  const rows = await db.select({
    id: deposits.id, amount: deposits.amount, currency: deposits.currency, network: deposits.network,
    txid: deposits.txid, status: deposits.status, createdAt: deposits.createdAt,
  }).from(deposits).where(and(depositWhere(condition), cursorClause))
    .orderBy(desc(deposits.createdAt), desc(deposits.id)).limit(limit + 1);
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, ...(hasNext && last ? { nextCursor: encodeTransactionCursor(last.createdAt, last.id) } : {}) };
};

/** Aggregates total amount, count, and currencies for matching deposits. */
export const aggregateDepositSummary = async (condition: DepositFilter): Promise<DepositSummaryResult> => {
  const row = (await db.select({
    totalAmount: sql<string>`coalesce(sum(${deposits.amount}), 0)::text`,
    transactionCount: sql<number>`count(*)::int`,
    currencies: sql<string[]>`coalesce(array_agg(distinct upper(${deposits.currency})), array[]::text[])`,
  }).from(deposits).where(depositWhere(condition)))[0];
  return { ...row, totalAmount: standardDecimal(row.totalAmount) };
};

/** Aggregates enabled-currency deposit activity by currency. */
export const aggregateDepositActivity = async (condition: DepositFilter): Promise<DepositActivityTotal[]> => {
  const rows = await db.select({
    currency: sql<string>`upper(${deposits.currency})`,
    amount: sql<string>`sum(${deposits.amount})::text`,
    transactionCount: sql<number>`count(*)::int`,
  }).from(deposits)
    .innerJoin(currencies, sql`lower(btrim(${deposits.currency})) = ${currencies.code}`)
    .where(and(depositWhere(condition), eq(currencies.enabled, true)))
    .groupBy(sql`upper(${deposits.currency})`).orderBy(sql`upper(${deposits.currency})`);
  return rows.map((row) => ({ ...row, amount: standardDecimal(row.amount) }));
};

/** Updates matching deposits and refreshes their update timestamps. */
export const findAndUpdateDeposit = async (condition: DepositFilter, data: Partial<NewDeposit>) =>
  (await db.update(deposits).set({ ...data, updatedAt: new Date() }).where(depositWhere(condition)).returning())[0] ?? null;
