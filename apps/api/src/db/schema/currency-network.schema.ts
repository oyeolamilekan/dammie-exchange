import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { currencies } from './currency.schema';
import { networks } from './network.schema';

/**
 * Many-to-many relationship between currencies and supported networks.
 *
 * The composite primary key prevents duplicate currency/network pairs.
 *
 * @module currencyNetworkSchema
 */

/** Allowed network relationship for a currency. */
export const currencyNetworks = pgTable('currency_network', {
  currencyId: uuid('currency_id').notNull().references(() => currencies.id, { onDelete: 'restrict' }),
  networkId: uuid('network_id').notNull().references(() => networks.id, { onDelete: 'restrict' }),
}, (table) => [
  primaryKey({ name: 'currency_network_pkey', columns: [table.currencyId, table.networkId] }),
  index('currency_network_network_idx').on(table.networkId),
]);

/** Currency/network relationship row returned from the database. */
export type CurrencyNetwork = typeof currencyNetworks.$inferSelect;

/** Currency/network relationship values accepted for insertion. */
export type NewCurrencyNetwork = typeof currencyNetworks.$inferInsert;
