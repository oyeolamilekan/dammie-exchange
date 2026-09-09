import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Shared column factories used by the Drizzle schema modules. @module commonSchema */

/** Creates the standard UUID primary-key column used by application tables. */
export const idColumn = () => uuid('id').defaultRandom().primaryKey();

/**
 * Creates timezone-aware creation and update timestamp columns.
 * `updatedAt` is refreshed by Drizzle when the row is updated.
 */
export const timestampColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
