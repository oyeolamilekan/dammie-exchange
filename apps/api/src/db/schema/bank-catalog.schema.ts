import { index, pgTable, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';

/**
 * Provider bank directory schema.
 *
 * This is separate from `banks`, which stores customer-owned bank accounts.
 * The directory may contain more than one provider label for a bank code, so
 * the code is indexed but intentionally not unique.
 *
 * @module bankCatalogSchema
 */

/** Bank institutions available for customer bank-account selection. */
export const bankCatalog = pgTable('bank_catalog', {
  id: idColumn(),
  code: varchar('code', { length: 32 }).notNull(),
  name: varchar('name', { length: 250 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  currency: varchar('currency', { length: 16 }).notNull(),
  ...timestampColumns(),
}, (table) => [
  index('bank_catalog_code_idx').on(table.code),
  index('bank_catalog_name_idx').on(table.name),
]);

/** Bank directory row returned from the database. */
export type BankCatalogEntry = typeof bankCatalog.$inferSelect;

/** Bank directory values accepted for insertion. */
export type NewBankCatalogEntry = typeof bankCatalog.$inferInsert;
