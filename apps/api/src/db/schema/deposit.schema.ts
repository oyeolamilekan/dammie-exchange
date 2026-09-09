import { desc, sql } from 'drizzle-orm';
import { check, index, numeric, pgEnum, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { users } from './user.schema';
import { wallets } from './wallet.schema';

/**
 * Cryptocurrency deposit schema.
 *
 * Deposit IDs are unique provider identifiers and amounts use numeric(36,18)
 * to preserve financial precision.
 *
 * @module depositSchema
 */

/** Lifecycle states for a provider deposit. */
export const depositStatusEnum = pgEnum('deposit_status', ['pending', 'failed', 'success']);

/** Customer deposit records linked to a wallet and provider transaction. */
export const deposits = pgTable('deposits', {
  id: idColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'restrict' }),
  depositId: varchar('deposit_id', { length: 250 }).notNull(),
  currency: varchar('currency', { length: 16 }).notNull(),
  network: varchar('network', { length: 64 }),
  txid: varchar('txid', { length: 500 }).notNull(),
  status: depositStatusEnum('status').default('pending').notNull(),
  amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('deposits_deposit_id_unique').on(table.depositId),
  index('deposit_user_history').on(table.userId, desc(table.createdAt), desc(table.id)),
  index('deposit_user_currency_history').on(table.userId, table.currency, desc(table.createdAt), desc(table.id)),
  index('deposit_user_status_currency_summary').on(table.userId, table.status, table.currency, desc(table.createdAt)),
  check('deposits_amount_positive', sql`${table.amount} > 0`),
]);

/** Deposit row returned from the database. */
export type Deposit = typeof deposits.$inferSelect;

/** Deposit values accepted for insertion. */
export type NewDeposit = typeof deposits.$inferInsert;
