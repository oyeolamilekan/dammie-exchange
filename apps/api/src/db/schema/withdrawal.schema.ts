import { desc, sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { banks } from './bank.schema';
import { users } from './user.schema';
import { wallets } from './wallet.schema';
import { platformFeeTypeEnum, platformFees } from './platform-fee.schema';

/**
 * NGN withdrawal schema.
 *
 * The row starts as a review intent and receives a bank-details snapshot only
 * after approval. Provider identifiers, responses, fees, and completion state
 * support reconciliation and recovery workflows.
 *
 * @module withdrawalSchema
 */

/** Lifecycle states for an NGN withdrawal. */
export const withdrawalStatusEnum = pgEnum('withdrawal_status', [
  'pending', 'processing', 'success', 'failed',
]);

/** TypeScript union of withdrawal lifecycle states. */
export type WithdrawalStatus = typeof withdrawalStatusEnum.enumValues[number];

/** Persistence only. Provider orchestration is intentionally out of scope. */
export const withdrawals = pgTable('withdrawals', {
  id: idColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  bankId: uuid('bank_id').references(() => banks.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
  fee: numeric('fee', { precision: 36, scale: 18 }).default('0').notNull(),
  platformFeeId: uuid('platform_fee_id').references(() => platformFees.id, { onDelete: 'restrict' }),
  platformFeeType: platformFeeTypeEnum('platform_fee_type'),
  platformFeeConfiguredAmount: numeric('platform_fee_configured_amount', { precision: 36, scale: 18 }),
  platformFeeMinimumFee: numeric('platform_fee_minimum_fee', { precision: 36, scale: 18 }),
  platformFeeMaximumFee: numeric('platform_fee_maximum_fee', { precision: 36, scale: 18 }),
  providerFee: numeric('provider_fee', { precision: 36, scale: 18 }),
  providerResponse: jsonb('provider_response'),
  status: withdrawalStatusEnum('status').default('pending').notNull(),
  providerWithdrawalId: varchar('provider_withdrawal_id', { length: 250 }),
  reference: varchar('reference', { length: 250 }).notNull(),
  accountNumber: varchar('account_number', { length: 32 }),
  accountName: varchar('account_name', { length: 250 }),
  bankCode: varchar('bank_code', { length: 32 }),
  failureReason: varchar('failure_reason', { length: 500 }),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('withdrawals_reference_unique').on(table.reference),
  uniqueIndex('withdrawals_provider_id_unique').on(table.providerWithdrawalId),
  index('withdrawals_user_history_idx').on(table.userId, desc(table.createdAt), desc(table.id)),
  index('withdrawals_wallet_history_idx').on(table.walletId, desc(table.createdAt), desc(table.id)),
  check('withdrawals_amount_positive', sql`${table.amount} > 0`),
  check('withdrawals_fee_nonnegative', sql`${table.fee} >= 0`),
  check('withdrawals_platform_fee_snapshot_complete', sql`
    (${table.platformFeeId} IS NULL AND ${table.platformFeeType} IS NULL
      AND ${table.platformFeeConfiguredAmount} IS NULL AND ${table.platformFeeMinimumFee} IS NULL
      AND ${table.platformFeeMaximumFee} IS NULL) OR
    (${table.platformFeeId} IS NOT NULL AND ${table.platformFeeType} IS NOT NULL
      AND ${table.platformFeeConfiguredAmount} IS NOT NULL)
  `),
  check('withdrawals_platform_fee_snapshot_nonnegative', sql`
    (${table.platformFeeConfiguredAmount} IS NULL OR ${table.platformFeeConfiguredAmount} >= 0) AND
    (${table.platformFeeMinimumFee} IS NULL OR ${table.platformFeeMinimumFee} >= 0) AND
    (${table.platformFeeMaximumFee} IS NULL OR ${table.platformFeeMaximumFee} >= 0) AND
    (${table.platformFeeMinimumFee} IS NULL OR ${table.platformFeeMaximumFee} IS NULL
      OR ${table.platformFeeMinimumFee} <= ${table.platformFeeMaximumFee})
  `),
  check('withdrawals_platform_fee_snapshot_caps_match_type', sql`
    ${table.platformFeeType} IS NULL OR ${table.platformFeeType} = 'percentage'
      OR (${table.platformFeeMinimumFee} IS NULL AND ${table.platformFeeMaximumFee} IS NULL)
  `),
  check('withdrawals_provider_fee_nonnegative', sql`${table.providerFee} IS NULL OR ${table.providerFee} >= 0`),
  check('withdrawals_bank_snapshot_complete', sql`
    (${table.approvedAt} IS NULL AND ${table.bankId} IS NULL AND ${table.accountNumber} IS NULL
      AND ${table.accountName} IS NULL AND ${table.bankCode} IS NULL) OR
    (${table.approvedAt} IS NOT NULL AND ${table.bankId} IS NOT NULL AND ${table.accountNumber} IS NOT NULL
      AND ${table.accountName} IS NOT NULL AND ${table.bankCode} IS NOT NULL)
  `),
]);

/** Withdrawal row returned from the database. */
export type Withdrawal = typeof withdrawals.$inferSelect;

/** Withdrawal values accepted for insertion. */
export type NewWithdrawal = typeof withdrawals.$inferInsert;
