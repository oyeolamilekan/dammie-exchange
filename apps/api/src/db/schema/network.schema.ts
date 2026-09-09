import { check, pgTable, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idColumn, timestampColumns } from './common';

/**
 * Blockchain network catalog schema.
 *
 * Network codes are normalized to lowercase and referenced by the
 * currency/network relationship and wallet-address tables.
 *
 * @module networkSchema
 */

/** Relational identity and display metadata for a blockchain network. */
export const networks = pgTable('network', {
  id: idColumn(),
  name: varchar('name', { length: 250 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('network_code_unique').on(table.code),
  check('network_code_normalized', sql`${table.code} = lower(btrim(${table.code}))`),
]);

/** Network catalog row returned from the database. */
export type Network = typeof networks.$inferSelect;

/** Network catalog values accepted for insertion. */
export type NewNetwork = typeof networks.$inferInsert;
