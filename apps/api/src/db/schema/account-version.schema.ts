import { desc, sql } from 'drizzle-orm';
import { check, index, numeric, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './common';
import { wallets } from './wallet.schema';

/**
 * Immutable balance-transition schema.
 *
 * Each row records the before/after wallet balances for one financial action.
 * Constraints ensure the action belongs to the declared transaction family and
 * that all balances remain non-negative.
 *
 * @module accountVersionSchema
 */

/** The only transaction families that can produce an account version. */
export const accountVersionTransactionTypeEnum = pgEnum('account_version_transaction_type', [
  'deposit', 'swap', 'withdrawal',
]);

/** Every balance mutation has one, and only one, action in its transaction family. */
export const accountVersionActionEnum = pgEnum('account_version_action', [
  'deposit_credit',
  'swap_lock',
  'swap_complete',
  'swap_credit',
  'swap_restore',
  'withdrawal_lock',
  'withdrawal_complete',
  'withdrawal_restore',
]);

/** TypeScript union of account-version transaction families. */
export type AccountVersionTransactionType = typeof accountVersionTransactionTypeEnum.enumValues[number];

/** TypeScript union of valid balance-transition actions. */
export type AccountVersionAction = typeof accountVersionActionEnum.enumValues[number];

/** Append-only ledger of wallet balance changes. */
export const accountVersions = pgTable('account_versions', {
  id: idColumn(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  transactionType: accountVersionTransactionTypeEnum('transaction_type').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  action: accountVersionActionEnum('action').notNull(),
  amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
  previousBalance: numeric('previous_balance', { precision: 36, scale: 18 }).notNull(),
  balance: numeric('balance', { precision: 36, scale: 18 }).notNull(),
  lockedBalance: numeric('locked_balance', { precision: 36, scale: 18 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('account_versions_transaction_action_unique')
    .on(table.transactionType, table.transactionId, table.action),
  index('account_versions_wallet_history_idx')
    .on(table.walletId, desc(table.createdAt), desc(table.id)),
  index('account_versions_transaction_lookup_idx')
    .on(table.transactionType, table.transactionId),
  check('account_versions_previous_balance_nonnegative', sql`${table.previousBalance} >= 0`),
  check('account_versions_amount_nonnegative', sql`${table.amount} >= 0`),
  check('account_versions_balance_nonnegative', sql`${table.balance} >= 0`),
  check('account_versions_locked_balance_nonnegative', sql`${table.lockedBalance} >= 0`),
  check('account_versions_action_type_check', sql`
    (${table.transactionType} = 'deposit' AND ${table.action} = 'deposit_credit') OR
    (${table.transactionType} = 'swap' AND ${table.action} IN ('swap_lock', 'swap_complete', 'swap_credit', 'swap_restore')) OR
    (${table.transactionType} = 'withdrawal' AND ${table.action} IN ('withdrawal_lock', 'withdrawal_complete', 'withdrawal_restore'))
  `),
]);

/** Account-version row returned from the database. */
export type AccountVersion = typeof accountVersions.$inferSelect;

/** Account-version values accepted for insertion. */
export type NewAccountVersion = typeof accountVersions.$inferInsert;
