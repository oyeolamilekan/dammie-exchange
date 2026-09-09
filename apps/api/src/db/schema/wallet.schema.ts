import { check, index, numeric, pgTable, uniqueIndex, uuid, varchar, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idColumn, timestampColumns } from './common';
import { currencies } from './currency.schema';
import { networks } from './network.schema';
import { users } from './user.schema';

/**
 * Customer wallet and network-address schema.
 *
 * One wallet exists per user/currency pair, while one address exists per
 * wallet/network pair. Available and locked balances are non-negative numeric
 * values and must be changed through account-version transactions.
 *
 * @module walletSchema
 */

/** Customer wallet balances and provider wallet identity. */
export const wallets = pgTable('wallets', {
  id: idColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletId: varchar('wallet_id', { length: 250 }),
  inProgress: boolean('in_progress').default(false).notNull(),
  currencyId: uuid('currency_id').notNull().references(() => currencies.id, { onDelete: 'restrict' }),
  balance: numeric('balance', { precision: 36, scale: 18 }).default('0').notNull(),
  lockedBalance: numeric('locked_balance', { precision: 36, scale: 18 }).default('0').notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('wallets_user_currency_id_unique').on(table.userId, table.currencyId),
  uniqueIndex('wallets_provider_id_unique').on(table.walletId),
  index('wallets_user_currency_id_idx').on(table.userId, table.currencyId),
  check('wallets_balance_nonnegative', sql`${table.balance} >= 0`),
  check('wallets_locked_balance_nonnegative', sql`${table.lockedBalance} >= 0`),
]);

/** Network-specific deposit addresses belonging to a wallet. */
export const walletAddresses = pgTable('wallet_addresses', {
  id: idColumn(),
  walletId: uuid('wallet_id').notNull().references(() => wallets.id, { onDelete: 'cascade' }),
  networkId: uuid('network_id').notNull().references(() => networks.id, { onDelete: 'restrict' }),
  destinationTag: varchar('destination_tag', { length: 250 }),
  address: varchar('address', { length: 500 }).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('wallet_addresses_wallet_network_id_unique').on(table.walletId, table.networkId),
]);

/** Wallet row returned from the database. */
export type Wallet = typeof wallets.$inferSelect;

/** Wallet values accepted for insertion. */
export type NewWallet = typeof wallets.$inferInsert;

/** Wallet-address row returned from the database. */
export type WalletAddress = typeof walletAddresses.$inferSelect;

/** Wallet-address values accepted for insertion. */
export type NewWalletAddress = typeof walletAddresses.$inferInsert;

/** Wallet row populated with its network-specific addresses. */
export type WalletWithAddresses = Wallet & { addresses: WalletAddress[] };
