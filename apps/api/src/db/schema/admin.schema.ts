import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';

/**
 * Administrator identity and session tables.
 *
 * Password hashes and session-token hashes are stored separately from the
 * public administrator projection used by the API.
 *
 * @module adminSchema
 */

/** Administrator login identity and account status. */
export const admins = pgTable('admins', {
  id: idColumn(),
  email: varchar('email', { length: 250 }).notNull(),
  passwordHash: varchar('password_hash', { length: 250 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('admins_normalized_email_unique').on(sql`lower(${table.email})`),
]);

/** HTTP session records associated with administrators. */
export const adminSessions = pgTable('admin_sessions', {
  id: idColumn(),
  adminId: uuid('admin_id').notNull().references(() => admins.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('admin_sessions_token_hash_unique').on(table.tokenHash),
  index('admin_sessions_expiry_idx').on(table.expiresAt),
  index('admin_sessions_admin_idx').on(table.adminId),
]);

/** Administrator row returned from the database. */
export type Admin = typeof admins.$inferSelect;

/** Administrator values accepted for insertion. */
export type NewAdmin = typeof admins.$inferInsert;

/** Administrator session row returned from the database. */
export type AdminSession = typeof adminSessions.$inferSelect;
