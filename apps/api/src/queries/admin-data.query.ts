import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { db } from '../database';
import { chatMessages } from '../db/schema/chat-message.schema';
import { deposits } from '../db/schema/deposit.schema';
import { swaps } from '../db/schema/swap.schema';
import { currencies } from '../db/schema/currency.schema';
import { networks } from '../db/schema/network.schema';
import { users } from '../db/schema/user.schema';
import { walletAddresses, wallets } from '../db/schema/wallet.schema';
import { withdrawals } from '../db/schema/withdrawal.schema';
import { standardDecimal } from '../utils/decimal';
import { findAccountHistoryPage } from './account-history.query';
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
  normalizeTransactionPageSize,
  type TransactionCursor,
} from './cursor-pagination';

/**
 * Read models used by the administrator dashboard.
 *
 * This module combines deposits, swaps, withdrawals, wallets, account
 * versions, and chat messages into admin-facing projections. Admin cursors are
 * opaque and transaction values are returned as normalized decimal strings.
 *
 * @module adminDataQuery
 */

/** Transaction families supported by the admin activity feed. */
export type AdminTransactionType = 'deposit' | 'swap' | 'withdrawal';

/** Status values normalized across the admin activity feed. */
export type AdminTransactionStatus = 'pending' | 'processing' | 'success' | 'failed';

/** Unified transaction projection for the administrator dashboard. */
export interface AdminTransaction {
  id: string;
  type: AdminTransactionType;
  status: AdminTransactionStatus;
  createdAt: Date;
  sourceAmount: string;
  sourceCurrency: string;
  network: string | null;
  destinationAmount: string | null;
  destinationCurrency: string | null;
  grossAmount?: string | null;
  grossToAmount?: string | null;
  platformFeeAmount?: string | null;
  providerResponse?: unknown | null;
  reference: string;
}

/** Filters for the unified admin transaction feed. */
export interface AdminTransactionFilter {
  userId?: string;
  type?: AdminTransactionType;
  status?: AdminTransactionStatus;
  createdAfter?: Date;
  createdBefore?: Date;
}

/** Cursor-paginated response for administrator transactions. */
export interface AdminTransactionPage {
  items: AdminTransaction[];
  nextCursor?: string;
}

/**
 * Sorts mixed transaction rows and creates the next keyset cursor.
 *
 * @param rows Transaction rows loaded from individual transaction tables.
 * @param limit Maximum number of rows to return.
 * @returns A newest-first page and optional continuation cursor.
 */
export const paginateAdminTransactions = (
  rows: AdminTransaction[],
  limit: number,
): AdminTransactionPage => {
  const combined = [...rows].sort((left, right) => {
    const byDate = right.createdAt.getTime() - left.createdAt.getTime();
    return byDate || right.id.localeCompare(left.id);
  });
  const hasNext = combined.length > limit;
  const items = combined.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    ...(hasNext && last
      ? { nextCursor: encodeTransactionCursor(last.createdAt, last.id) }
      : {}),
  };
};

/** Trims an admin search term and converts blank input to `undefined`. */
export const normalizeAdminUserSearch = (search?: string): string | undefined => {
  const normalized = search?.trim();
  return normalized || undefined;
};

/** Builds a shared newest-first cursor predicate for a query. @internal */
const cursorClause = (
  createdAt: SQLWrapper,
  id: SQLWrapper,
  cursor?: TransactionCursor,
): SQL | undefined => cursor ? or(
  lt(createdAt, cursor.createdAt),
  and(eq(createdAt, cursor.createdAt), lt(id, cursor.id)),
) : undefined;

/** Builds inclusive creation-time predicates for an admin query. @internal */
const dateClauses = (
  createdAt: SQLWrapper,
  filter: AdminTransactionFilter,
): SQL[] => [
  ...(filter.createdAfter ? [gte(createdAt, filter.createdAfter)] : []),
  ...(filter.createdBefore ? [lte(createdAt, filter.createdBefore)] : []),
];

/**
 * Reads deposits, swaps, and withdrawals as one cursor-paginated admin feed.
 *
 * Each transaction family is queried independently, then merged and sorted in
 * memory so the response has one consistent shape.
 *
 * @param filter Optional user, type, status, and date filters.
 * @param options Opaque cursor and bounded page size.
 * @returns Unified transaction items and an optional next cursor.
 */
export const findAdminTransactionPage = async (
  filter: AdminTransactionFilter = {},
  options: { cursor?: string; limit?: number } = {},
): Promise<AdminTransactionPage> => {
  const limit = normalizeTransactionPageSize(options.limit);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;

  const loadDeposits = async (): Promise<AdminTransaction[]> => {
    if (filter.type && filter.type !== 'deposit') return [];
    const clauses: SQL[] = [
      ...dateClauses(deposits.createdAt, filter),
      ...(filter.userId ? [eq(deposits.userId, filter.userId)] : []),
      ...(filter.status ? [
        filter.status === 'processing' ? sql`false` : eq(deposits.status, filter.status),
      ] : []),
      ...(cursorClause(deposits.createdAt, deposits.id, cursor)
        ? [cursorClause(deposits.createdAt, deposits.id, cursor)!] : []),
    ];
    const rows = await db.select({
      id: deposits.id,
      status: deposits.status,
      createdAt: deposits.createdAt,
      amount: deposits.amount,
      currency: deposits.currency,
      network: deposits.network,
      reference: deposits.txid,
    }).from(deposits).where(and(...clauses))
      .orderBy(desc(deposits.createdAt), desc(deposits.id)).limit(limit + 1);
    return rows.map((row) => ({
      id: row.id,
      type: 'deposit',
      status: row.status,
      createdAt: row.createdAt,
      sourceAmount: standardDecimal(row.amount),
      sourceCurrency: row.currency.toUpperCase(),
      network: row.network,
      destinationAmount: null,
      destinationCurrency: null,
      grossAmount: null,
      grossToAmount: null,
      platformFeeAmount: null,
      providerResponse: null,
      reference: row.reference,
    }));
  };

  const loadSwaps = async (): Promise<AdminTransaction[]> => {
    if (filter.type && filter.type !== 'swap') return [];
    const clauses: SQL[] = [
      ...dateClauses(swaps.createdAt, filter),
      ...(filter.userId ? [eq(swaps.userId, filter.userId)] : []),
      ...(filter.status ? [eq(swaps.status, filter.status)] : []),
      ...(cursorClause(swaps.createdAt, swaps.id, cursor)
        ? [cursorClause(swaps.createdAt, swaps.id, cursor)!] : []),
    ];
    const rows = await db.select({
      id: swaps.id,
      status: swaps.status,
      createdAt: swaps.createdAt,
      sourceAmount: swaps.fromAmount,
      sourceCurrency: swaps.fromCurrency,
      destinationAmount: swaps.toAmount,
      destinationCurrency: swaps.toCurrency,
      grossAmount: sql<string>`case when ${swaps.grossToAmount} = 0 then ${swaps.toAmount} else ${swaps.grossToAmount} end`,
      platformFeeAmount: swaps.platformFeeAmount,
      providerResponse: swaps.providerResponse,
      reference: sql<string>`coalesce(${swaps.swapTransactionId}, ${swaps.quotationId})`,
    }).from(swaps).where(and(...clauses))
      .orderBy(desc(swaps.createdAt), desc(swaps.id)).limit(limit + 1);
    return rows.map((row) => ({
      id: row.id,
      type: 'swap',
      status: row.status,
      createdAt: row.createdAt,
      sourceAmount: standardDecimal(row.sourceAmount),
      sourceCurrency: row.sourceCurrency.toUpperCase(),
      network: null,
      destinationAmount: standardDecimal(row.destinationAmount),
      destinationCurrency: row.destinationCurrency.toUpperCase(),
      grossAmount: standardDecimal(row.grossAmount),
      grossToAmount: standardDecimal(row.grossAmount),
      platformFeeAmount: standardDecimal(row.platformFeeAmount),
      providerResponse: row.providerResponse,
      reference: row.reference,
    }));
  };

  const loadWithdrawals = async (): Promise<AdminTransaction[]> => {
    if (filter.type && filter.type !== 'withdrawal') return [];
    const clauses: SQL[] = [
      ...dateClauses(withdrawals.createdAt, filter),
      ...(filter.userId ? [eq(withdrawals.userId, filter.userId)] : []),
      ...(filter.status ? [eq(withdrawals.status, filter.status)] : []),
      ...(cursorClause(withdrawals.createdAt, withdrawals.id, cursor)
        ? [cursorClause(withdrawals.createdAt, withdrawals.id, cursor)!] : []),
    ];
    const rows = await db.select({
      id: withdrawals.id,
      status: withdrawals.status,
      createdAt: withdrawals.createdAt,
      amount: withdrawals.amount,
      platformFeeAmount: withdrawals.fee,
      providerResponse: withdrawals.providerResponse,
      currency: currencies.code,
      reference: withdrawals.reference,
    }).from(withdrawals).innerJoin(wallets, eq(wallets.id, withdrawals.walletId))
      .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
      .where(and(...clauses))
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id)).limit(limit + 1);
    return rows.map((row) => ({
      id: row.id,
      type: 'withdrawal',
      status: row.status,
      createdAt: row.createdAt,
      sourceAmount: standardDecimal(row.amount),
      sourceCurrency: row.currency.toUpperCase(),
      network: null,
      destinationAmount: null,
      destinationCurrency: null,
      grossAmount: null,
      grossToAmount: null,
      platformFeeAmount: standardDecimal(row.platformFeeAmount),
      providerResponse: row.providerResponse,
      reference: row.reference,
    }));
  };

  const combined = (await Promise.all([
    loadDeposits(), loadSwaps(), loadWithdrawals(),
  ])).flat();
  return paginateAdminTransactions(combined, limit);
};

/** Filters the administrator user directory by search text and active state. */
export interface AdminUserDirectoryFilter {
  search?: string;
  isActive?: boolean;
}

/**
 * Reads a cursor-paginated administrator user directory.
 *
 * Search matches names, email, Telegram ID, and the combined full name.
 */
export const findAdminUsersPage = async (
  filter: AdminUserDirectoryFilter,
  options: { cursor?: string; limit?: number } = {},
) => {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;
  const clauses: SQL[] = [];
  if (filter.isActive !== undefined) clauses.push(eq(users.isActive, filter.isActive));
  const normalizedSearch = normalizeAdminUserSearch(filter.search);
  if (normalizedSearch) {
    const value = `%${normalizedSearch}%`;
    clauses.push(or(
      ilike(users.firstName, value),
      ilike(users.lastName, value),
      ilike(users.email, value),
      ilike(users.telegramId, value),
      ilike(sql`concat(${users.firstName}, ' ', ${users.lastName})`, value),
    ) as SQL);
  }
  if (cursor) clauses.push(or(
    lt(users.createdAt, cursor.createdAt),
    and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
  ) as SQL);

  const rows = await db.select({
    id: users.id,
    email: users.email,
    firstName: users.firstName,
    lastName: users.lastName,
    telegramId: users.telegramId,
    isActive: users.isActive,
    createdAt: users.createdAt,
    walletCount: sql<number>`(
      select count(*)::int from ${wallets}
      where ${wallets.userId} = ${users.id}
    )`,
  }).from(users).where(and(...clauses))
    .orderBy(desc(users.createdAt), desc(users.id)).limit(limit + 1);
  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    ...(hasNext && last
      ? { nextCursor: encodeTransactionCursor(last.createdAt, last.id) }
      : {}),
  };
};

/**
 * Loads an administrator's profile, wallets, and network-specific addresses.
 *
 * Sensitive authentication fields are excluded from the returned projection.
 */
export const findAdminUserDetail = async (userId: string) => {
  const user = (await db.select({
    id: users.id,
    email: users.email,
    firstName: users.firstName,
    lastName: users.lastName,
    telegramId: users.telegramId,
    subUserId: users.subUserId,
    isActive: users.isActive,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
  }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) return null;
  const walletRows = await db.select({
    id: wallets.id,
    currency: currencies.code,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
    isCrypto: currencies.isCrypto,
    createdAt: wallets.createdAt,
    updatedAt: wallets.updatedAt,
  }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(eq(wallets.userId, userId)).orderBy(asc(currencies.code));
  const addressRows = walletRows.length ? await db.select({
    id: walletAddresses.id,
    walletId: walletAddresses.walletId,
    network: networks.code,
    address: walletAddresses.address,
    destinationTag: walletAddresses.destinationTag,
  }).from(walletAddresses).innerJoin(networks, eq(walletAddresses['networkId'], networks.id))
    .where(inArray(walletAddresses.walletId, walletRows.map((wallet) => wallet.id)))
    .orderBy(asc(networks.code), asc(walletAddresses.id)) : [];
  return {
    ...user,
    wallets: walletRows.map((wallet) => ({
      ...wallet,
      currency: wallet.currency.toUpperCase(),
      balance: standardDecimal(wallet.balance),
      lockedBalance: standardDecimal(wallet.lockedBalance),
      addresses: addressRows.filter((address) => address.walletId === wallet.id)
        .map(({ walletId: _walletId, ...address }) => address),
    })),
  };
};

/** Builds the dashboard overview of users, balances, transactions, and warnings. */
export const getAdminOverview = async () => {
  const [userRows, depositRows, swapRows, withdrawalRows, balanceRows, recentTransactions, warningRow, warnings] = await Promise.all([
    db.select({ isActive: users.isActive, count: sql<number>`count(*)::int` })
      .from(users).groupBy(users.isActive),
    db.select({ status: deposits.status, count: sql<number>`count(*)::int` })
      .from(deposits).groupBy(deposits.status),
    db.select({ status: swaps.status, count: sql<number>`count(*)::int` })
      .from(swaps).groupBy(swaps.status),
    db.select({ status: withdrawals.status, count: sql<number>`count(*)::int` })
      .from(withdrawals).groupBy(withdrawals.status),
    db.select({
      currency: sql<string>`upper(${currencies.code})`,
      balance: sql<string>`coalesce(sum(${wallets.balance}), 0)::text`,
      lockedBalance: sql<string>`coalesce(sum(${wallets.lockedBalance}), 0)::text`,
      walletCount: sql<number>`count(*)::int`,
    }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
      .groupBy(sql`upper(${currencies.code})`).orderBy(sql`upper(${currencies.code})`),
    findAdminTransactionPage({}, { limit: 10 }),
    db.select({ count: count() }).from(swaps).where(eq(swaps.reconciliationRequired, true)),
    db.select({
      id: swaps.id,
      status: swaps.status,
      createdAt: swaps.createdAt,
      reference: sql<string>`coalesce(${swaps.swapTransactionId}, ${swaps.quotationId})`,
    }).from(swaps).where(eq(swaps.reconciliationRequired, true))
      .orderBy(desc(swaps.createdAt), desc(swaps.id)).limit(5),
  ]);

  const active = userRows.find((row) => row.isActive)?.count ?? 0;
  const inactive = userRows.find((row) => !row.isActive)?.count ?? 0;
  return {
    users: { total: active + inactive, active, inactive },
    transactions: {
      deposit: Object.fromEntries(depositRows.map((row) => [row.status, row.count])),
      swap: Object.fromEntries(swapRows.map((row) => [row.status, row.count])),
      withdrawal: Object.fromEntries(withdrawalRows.map((row) => [row.status, row.count])),
    },
    balances: balanceRows.map((row) => ({
      ...row,
      balance: standardDecimal(row.balance),
      lockedBalance: standardDecimal(row.lockedBalance),
    })),
    recentTransactions: recentTransactions.items,
    reconciliation: { count: Number(warningRow[0]?.count ?? 0), items: warnings },
  };
};

/** Lightweight grouped conversation-turn row used by the admin formatter. */
interface ConversationTurnRow { turnId: string; createdAt: Date }

/** Chat message row used when hydrating administrator conversation turns. */
interface ConversationMessageRow {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

/** Groups chat messages by turn and orders messages chronologically. */
export const groupAdminConversationTurns = (
  turns: ConversationTurnRow[],
  messages: ConversationMessageRow[],
) => turns.map((turn) => ({
  turnId: turn.turnId,
  createdAt: turn.createdAt,
  messages: messages.filter((message) => message.turnId === turn.turnId)
    .sort((left, right) => (
      left.createdAt.getTime() - right.createdAt.getTime()
      || left.id.localeCompare(right.id)
    )),
}));

/**
 * Reads account-version history for an administrator and resolves transaction
 * IDs to human-readable references.
 */
export const findAdminAccountVersions = async (
  userId: string,
  options: { cursor?: string; limit?: number },
) => {
  const page = await findAccountHistoryPage({ userId }, options);
  const idsByType = {
    deposit: page.items.filter((item) => item.transactionType === 'deposit').map((item) => item.transactionId),
    swap: page.items.filter((item) => item.transactionType === 'swap').map((item) => item.transactionId),
    withdrawal: page.items.filter((item) => item.transactionType === 'withdrawal').map((item) => item.transactionId),
  };
  const [depositRefs, swapRefs, withdrawalRefs] = await Promise.all([
    idsByType.deposit.length ? db.select({ id: deposits.id, reference: deposits.txid })
      .from(deposits).where(inArray(deposits.id, idsByType.deposit)) : [],
    idsByType.swap.length ? db.select({
      id: swaps.id,
      reference: sql<string>`coalesce(${swaps.swapTransactionId}, ${swaps.quotationId})`,
    }).from(swaps).where(inArray(swaps.id, idsByType.swap)) : [],
    idsByType.withdrawal.length ? db.select({ id: withdrawals.id, reference: withdrawals.reference })
      .from(withdrawals).where(inArray(withdrawals.id, idsByType.withdrawal)) : [],
  ]);
  const references = new Map([
    ...depositRefs.map((row) => [row.id, row.reference] as const),
    ...swapRefs.map((row) => [row.id, row.reference] as const),
    ...withdrawalRefs.map((row) => [row.id, row.reference] as const),
  ]);
  return {
    ...page,
    items: page.items.map(({ transactionId, ...item }) => ({
      ...item,
      transactionReference: references.get(transactionId) ?? transactionId,
    })),
  };
};

/**
 * Reads cursor-paginated conversation turns for a Telegram intent.
 *
 * A maximum of 400 messages is hydrated per response; `truncated` indicates
 * when that message bound was reached.
 */
export const findAdminConversationTurns = async (
  intentId: string,
  options: { cursor?: string; limit?: number } = {},
) => {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 20);
  const cursor = options.cursor ? decodeTransactionCursor(options.cursor) : undefined;
  const latestAt = sql<Date>`max(${chatMessages.createdAt})`;
  const turnClauses: SQL[] = [eq(chatMessages.intentId, intentId)];
  const turnRows = await db.select({
    turnId: chatMessages.turnId,
    createdAt: latestAt,
  }).from(chatMessages).where(and(...turnClauses))
    .groupBy(chatMessages.turnId)
    .having(cursor ? or(
      lt(latestAt, cursor.createdAt),
      and(eq(latestAt, cursor.createdAt), lt(chatMessages.turnId, cursor.id)),
    ) : undefined)
    .orderBy(desc(latestAt), desc(chatMessages.turnId)).limit(limit + 1);
  const hasNext = turnRows.length > limit;
  // PostgreSQL drivers may return aggregate timestamps (MAX(created_at)) as
  // strings even when the selected column is typed as Date. Normalize them
  // before sorting, serializing, or encoding the pagination cursor.
  const selectedTurns = turnRows.slice(0, limit).map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
  }));
  const turnIds = selectedTurns.map((row) => row.turnId);
  const messageRows = turnIds.length ? await db.select({
    id: chatMessages.id,
    turnId: chatMessages.turnId,
    role: chatMessages.role,
    content: chatMessages.content,
    createdAt: chatMessages.createdAt,
  }).from(chatMessages).where(and(
    eq(chatMessages.intentId, intentId),
    inArray(chatMessages.turnId, turnIds),
  )).orderBy(asc(chatMessages.createdAt), asc(chatMessages.id)).limit(401) : [];
  const truncated = messageRows.length > 400;
  const boundedMessages = messageRows.slice(0, 400);
  const turns = groupAdminConversationTurns(selectedTurns, boundedMessages);
  const last = selectedTurns[selectedTurns.length - 1];
  return {
    items: turns,
    truncated,
    ...(hasNext && last
      ? { nextCursor: encodeTransactionCursor(last.createdAt, last.turnId) }
      : {}),
  };
};

/** Finds the intent ID associated with a user, or `null` when absent. */
export const findUserIntentId = async (userId: string): Promise<string | null> => (
  await db.select({ intentId: users.intentId }).from(users)
    .where(eq(users.id, userId)).limit(1)
)[0]?.intentId ?? null;
