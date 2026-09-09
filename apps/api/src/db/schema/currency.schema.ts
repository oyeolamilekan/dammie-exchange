import { boolean, check, pgTable, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idColumn, timestampColumns } from './common';

/**
 * Currency catalog schema.
 *
 * Codes are stored normalized to lowercase and can be enabled/disabled without
 * deleting historical transaction relationships.
 *
 * @module currencySchema
 */

/** Relational identity and display metadata for a supported currency. */
export const currencies = pgTable('currency', {
  id: idColumn(),
  name: varchar('name', { length: 250 }).notNull(),
  code: varchar('code', { length: 16 }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  isCrypto: boolean('is_crypto').default(true).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('currency_code_unique').on(table.code),
  check('currency_code_normalized', sql`${table.code} = lower(btrim(${table.code}))`),
]);

/** Currency catalog row returned from the database. */
export type Currency = typeof currencies.$inferSelect;

/** Currency catalog values accepted for insertion. */
export type NewCurrency = typeof currencies.$inferInsert;
