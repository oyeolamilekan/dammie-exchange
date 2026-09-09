import { sql } from 'drizzle-orm';
import { boolean, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { users } from './user.schema';

/**
 * Saved customer bank-account schema.
 *
 * A partial unique index allows at most one default bank account per user.
 *
 * @module bankSchema
 */

/** Verified bank accounts saved for customer withdrawals. */
export const banks = pgTable('banks', {
  id: idColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountNumber: varchar('account_number', { length: 32 }).notNull(),
  accountName: varchar('account_name', { length: 250 }).notNull(),
  bankCode: varchar('bank_code', { length: 32 }).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('banks_code_account_unique')
    .on(table.bankCode, table.accountNumber)
    .where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex('banks_one_default_per_user')
    .on(table.userId)
    .where(sql`${table.isDefault} = true AND ${table.deletedAt} IS NULL`),
]);

/** Bank-account row returned from the database. */
export type Bank = typeof banks.$inferSelect;

/** Bank-account values accepted for insertion. */
export type NewBank = typeof banks.$inferInsert;
