import { and, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { swaps, type NewSwap, type Swap, type SwapWithUser } from '../db/schema/swap.schema';
import { currencies } from '../db/schema/currency.schema';
import { users } from '../db/schema/user.schema';
import { decodeTransactionCursor, encodeTransactionCursor, normalizeTransactionPageSize } from './cursor-pagination';
import { standardDecimal } from '../utils/decimal';

/**
 * Swap persistence, history, and aggregation queries.
 *
 * Query results expose normalized decimal strings and use newest-first keyset
 * pagination for transaction history.
 *
 * @module swapQuery
 */

/** Optional fields used to filter swap records. */
export interface SwapFilter {
  id?: string; userId?: string; quotationId?: string; swapTransactionId?: string;
  sweepId?: string; fromCurrency?: string;
  status?: Swap['status']; swapStatus?: Swap['swapStatus'];
  approvalStatus?: Swap['approvalStatus']; reconciliationRequired?: boolean;
  createdAfter?: Date; createdBefore?: Date;
}

/** Normalized swap record returned by history queries. */
export interface SwapHistoryRecord {
  id: string; fromAmount: string; fromCurrency: string; toAmount: string;
  grossToAmount?: string; platformFeeAmount?: string;
  toCurrency: string; status: Swap['status']; createdAt: Date;
}

/** Cursor-paginated swap history response. */
export interface SwapPage { items: SwapHistoryRecord[]; nextCursor?: string }

/** Aggregate totals for swaps matching a filter. */
export interface SwapSummaryResult {
  totalFromAmount: string; totalToAmount: string; totalNairaAmount: string;
  transactionCount: number; fromCurrencies: string[]; toCurrencies: string[];
}

/** Swap activity grouped by source currency. */
export interface SwapActivityTotal { currency: string; amount: string; transactionCount: number; netNairaAmount: string }

/** Builds a Drizzle predicate from swap filter fields. */
export const swapWhere = (filter: SwapFilter): SQL | undefined => {
  const clauses: SQL[] = [];
  if (filter.id !== undefined) clauses.push(eq(swaps.id, filter.id));
  if (filter.userId !== undefined) clauses.push(eq(swaps.userId, filter.userId));
  if (filter.quotationId !== undefined) clauses.push(eq(swaps.quotationId, filter.quotationId));
  if (filter.swapTransactionId !== undefined) clauses.push(eq(swaps.swapTransactionId, filter.swapTransactionId));
  if (filter.sweepId !== undefined) clauses.push(eq(swaps.sweepId, filter.sweepId));
  if (filter.fromCurrency !== undefined) clauses.push(eq(swaps.fromCurrency, filter.fromCurrency));
  if (filter.status !== undefined) clauses.push(eq(swaps.status, filter.status));
  if (filter.swapStatus !== undefined) clauses.push(eq(swaps.swapStatus, filter.swapStatus));
  if (filter.approvalStatus !== undefined) clauses.push(eq(swaps.approvalStatus, filter.approvalStatus));
  if (filter.reconciliationRequired !== undefined) clauses.push(eq(swaps.reconciliationRequired, filter.reconciliationRequired));
  if (filter.createdAfter !== undefined) clauses.push(gte(swaps.createdAt, filter.createdAfter));
  if (filter.createdBefore !== undefined) clauses.push(lte(swaps.createdAt, filter.createdBefore));
  return clauses.length ? and(...clauses) : undefined;
};

/** Loads one swap together with its safe user projection. @internal */
const withUser = async (where: SQL | undefined): Promise<SwapWithUser | null> => {
  const row = (await db.select({
    swap: swaps,
    user: {
      id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
      telegramId: users.telegramId, subUserId: users.subUserId, intentId: users.intentId,
      chatId: users.chatId, isActive: users.isActive, createdAt: users.createdAt, updatedAt: users.updatedAt,
    },
  }).from(swaps)
    .innerJoin(users, eq(swaps.userId, users.id)).where(where).limit(1))[0];
  return row ? { ...row.swap, user: row.user } : null;
};

/** Inserts and returns a swap record. */
export const createSwap = async (data: NewSwap) => (await db.insert(swaps).values(data).returning())[0];

/** Finds a swap by ID and includes its safe owner projection. */
export const findSwapById = (swapId: string) => withUser(eq(swaps.id, swapId));

/** Finds a swap by ID while enforcing the owning user ID. */
export const findSwapByIdForUser = (swapId: string, userId: string) => withUser(and(eq(swaps.id, swapId), eq(swaps.userId, userId)));

/** Finds the first swap matching a filter and includes its safe owner. */
export const findSwap = (condition: SwapFilter) => withUser(swapWhere(condition));

/**
 * Reads a newest-first, cursor-paginated swap history page.
 *
 * @param condition Swap filters, commonly including the owning user.
 * @param options Opaque continuation cursor and optional bounded page size.
 * @returns Swap history items and an optional next cursor.
 */
export const findSwapPage = async (condition: SwapFilter, options: { cursor?: string; limit?: number } = {}): Promise<SwapPage> => {
  const limit = normalizeTransactionPageSize(options.limit);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;
  const cursorClause = cursor ? or(
    lt(swaps.createdAt, cursor.createdAt),
    and(eq(swaps.createdAt, cursor.createdAt), lt(swaps.id, cursor.id)),
  ) : undefined;
  const rows = await db.select({
    id: swaps.id, fromAmount: swaps.fromAmount, fromCurrency: swaps.fromCurrency,
    toAmount: swaps.toAmount,
    grossToAmount: sql<string>`case when ${swaps.grossToAmount} = 0 then ${swaps.toAmount} else ${swaps.grossToAmount} end`,
    platformFeeAmount: swaps.platformFeeAmount,
    toCurrency: swaps.toCurrency, status: swaps.status,
    createdAt: swaps.createdAt,
  }).from(swaps).where(and(swapWhere(condition), cursorClause))
    .orderBy(desc(swaps.createdAt), desc(swaps.id)).limit(limit + 1);
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map((item) => ({
      ...item,
      toAmount: standardDecimal(item.toAmount),
      grossToAmount: standardDecimal(item.grossToAmount),
      platformFeeAmount: standardDecimal(item.platformFeeAmount),
    })),
    ...(hasNext && last ? { nextCursor: encodeTransactionCursor(last.createdAt, last.id) } : {}),
  };
};

/** Aggregates source, destination, NGN, currency, and count totals for swaps. */
export const aggregateSwapSummary = async (condition: SwapFilter): Promise<SwapSummaryResult> => {
  const row = (await db.select({
    totalFromAmount: sql<string>`coalesce(sum(${swaps.fromAmount}), 0)::text`,
    totalToAmount: sql<string>`coalesce(sum(${swaps.toAmount}), 0)::text`,
    totalNairaAmount: sql<string>`coalesce(sum(${swaps.toAmount}), 0)::text`,
    transactionCount: sql<number>`count(*)::int`,
    fromCurrencies: sql<string[]>`coalesce(array_agg(distinct upper(${swaps.fromCurrency})), array[]::text[])`,
    toCurrencies: sql<string[]>`coalesce(array_agg(distinct upper(${swaps.toCurrency})), array[]::text[])`,
  }).from(swaps).where(swapWhere(condition)))[0];
  return {
    ...row,
    totalFromAmount: standardDecimal(row.totalFromAmount),
    totalToAmount: standardDecimal(row.totalToAmount),
    totalNairaAmount: standardDecimal(row.totalNairaAmount),
  };
};

/** Aggregates enabled-currency swap activity by source currency. */
export const aggregateSwapActivity = async (condition: SwapFilter): Promise<SwapActivityTotal[]> => {
  const rows = await db.select({
    currency: sql<string>`upper(${swaps.fromCurrency})`,
    amount: sql<string>`sum(${swaps.fromAmount})::text`,
    transactionCount: sql<number>`count(*)::int`,
    netNairaAmount: sql<string>`sum(${swaps.toAmount})::text`,
  }).from(swaps)
    .innerJoin(currencies, sql`lower(btrim(${swaps.fromCurrency})) = ${currencies.code}`)
    .where(and(swapWhere(condition), eq(currencies.enabled, true)))
    .groupBy(sql`upper(${swaps.fromCurrency})`).orderBy(sql`upper(${swaps.fromCurrency})`);
  return rows.map((row) => ({ ...row, amount: standardDecimal(row.amount), netNairaAmount: standardDecimal(row.netNairaAmount) }));
};

/** Updates matching swaps and reloads the first changed row with its safe owner. */
export const findAndUpdateSwap = async (condition: SwapFilter, data: Partial<NewSwap>) => {
  const row = (await db.update(swaps).set({ ...data, updatedAt: new Date() }).where(swapWhere(condition)).returning())[0];
  return row ? withUser(eq(swaps.id, row.id)) : null;
};
