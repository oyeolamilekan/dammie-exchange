import { desc, sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, numeric, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { users, type User } from './user.schema';
import { platformFeeTypeEnum, platformFees } from './platform-fee.schema';

/**
 * Cryptocurrency swap schema.
 *
 * A swap stores the provider quotation, approval/execution state, fee snapshot,
 * and recovery metadata needed to reconcile provider events safely.
 *
 * @module swapSchema
 */

/** Lifecycle state of the overall swap workflow. */
export const swapStatusEnum = pgEnum('swap_status', ['pending', 'failed', 'success', 'processing']);

/** Lifecycle state of customer approval. */
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'processing', 'success']);

/** Provider recovery event that caused a swap recovery path. */
export const recoveryEventEnum = pgEnum('recovery_event', ['failed', 'reversed']);

/** Persisted swap quotation, approval, execution, and reconciliation state. */
export const swaps = pgTable('swaps', {
  id: idColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  quotationId: varchar('quotation_id', { length: 250 }).notNull(),
  approvalStatus: approvalStatusEnum('approval_status').default('pending').notNull(),
  swapTransactionId: varchar('swap_transaction_id', { length: 250 }),
  sweepId: varchar('sweep_id', { length: 250 }),
  sweepReference: varchar('sweep_reference', { length: 250 }),
  fromCurrency: varchar('from_currency', { length: 16 }).notNull(),
  quotedPrice: numeric('quoted_price', { precision: 36, scale: 18 }).notNull(),
  toCurrency: varchar('to_currency', { length: 16 }).notNull(),
  fromAmount: numeric('from_amount', { precision: 36, scale: 18 }).notNull(),
  status: swapStatusEnum('status').default('pending').notNull(),
  swapStatus: swapStatusEnum('swap_status').default('pending').notNull(),
  recoveryEvent: recoveryEventEnum('recovery_event'),
  reconciliationRequired: boolean('reconciliation_required').default(false).notNull(),
  grossToAmount: numeric('gross_to_amount', { precision: 36, scale: 18 }).default('0').notNull(),
  toAmount: numeric('to_amount', { precision: 36, scale: 18 }).notNull(),
  platformFeeAmount: numeric('platform_fee_amount', { precision: 36, scale: 18 }).default('0').notNull(),
  providerResponse: jsonb('provider_response'),
  platformFeeId: uuid('platform_fee_id').references(() => platformFees.id, { onDelete: 'restrict' }),
  platformFeeType: platformFeeTypeEnum('platform_fee_type'),
  platformFeeConfiguredAmount: numeric('platform_fee_configured_amount', { precision: 36, scale: 18 }),
  platformFeeMinimumFee: numeric('platform_fee_minimum_fee', { precision: 36, scale: 18 }),
  platformFeeMaximumFee: numeric('platform_fee_maximum_fee', { precision: 36, scale: 18 }),
  executedReceivedAmount: numeric('executed_received_amount', { precision: 36, scale: 18 }),
  executionPrice: numeric('execution_price', { precision: 36, scale: 18 }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  ...timestampColumns(),
}, (table) => [
  index('swap_user_history').on(table.userId, desc(table.createdAt), desc(table.id)),
  index('swap_user_currency_history').on(table.userId, table.fromCurrency, desc(table.createdAt), desc(table.id)),
  index('swap_user_status_currency_summary').on(table.userId, table.status, table.fromCurrency, desc(table.createdAt)),
  index('swaps_transaction_id_idx').on(table.swapTransactionId),
  index('swaps_sweep_id_idx').on(table.sweepId),
  check('swaps_from_amount_positive', sql`${table.fromAmount} > 0`),
  check('swaps_gross_to_amount_nonnegative', sql`${table.grossToAmount} >= 0`),
  check('swaps_platform_fee_amount_nonnegative', sql`${table.platformFeeAmount} >= 0`),
  check('swaps_to_amount_nonnegative', sql`${table.toAmount} >= 0`),
  check('swaps_platform_fee_snapshot_complete', sql`
    (${table.platformFeeId} IS NULL AND ${table.platformFeeType} IS NULL
      AND ${table.platformFeeConfiguredAmount} IS NULL AND ${table.platformFeeMinimumFee} IS NULL
      AND ${table.platformFeeMaximumFee} IS NULL) OR
    (${table.platformFeeId} IS NOT NULL AND ${table.platformFeeType} IS NOT NULL
      AND ${table.platformFeeConfiguredAmount} IS NOT NULL)
  `),
  check('swaps_platform_fee_snapshot_nonnegative', sql`
    (${table.platformFeeConfiguredAmount} IS NULL OR ${table.platformFeeConfiguredAmount} >= 0) AND
    (${table.platformFeeMinimumFee} IS NULL OR ${table.platformFeeMinimumFee} >= 0) AND
    (${table.platformFeeMaximumFee} IS NULL OR ${table.platformFeeMaximumFee} >= 0) AND
    (${table.platformFeeMinimumFee} IS NULL OR ${table.platformFeeMaximumFee} IS NULL
      OR ${table.platformFeeMinimumFee} <= ${table.platformFeeMaximumFee})
  `),
  check('swaps_platform_fee_snapshot_caps_match_type', sql`
    ${table.platformFeeType} IS NULL OR ${table.platformFeeType} = 'percentage'
      OR (${table.platformFeeMinimumFee} IS NULL AND ${table.platformFeeMaximumFee} IS NULL)
  `),
]);

/** Swap row returned from the database. */
export type Swap = typeof swaps.$inferSelect;

/** Swap values accepted for insertion. */
export type NewSwap = typeof swaps.$inferInsert;

/** Swap row with a safe user projection. */
export type SwapWithUser = Swap & { user: Omit<User, 'bvnNumber' | 'hashedPin'> };
