import { boolean, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';

/**
 * Telegram signup/conversation intent schema.
 *
 * Telegram IDs and signup-completion IDs are unique so repeated bot messages
 * resolve to the same intent.
 *
 * @module intentSchema
 */

/** Telegram identity and signup state associated with a chat. */
export const intents = pgTable('intents', {
  id: idColumn(),
  telegramId: varchar('telegram_id', { length: 15 }).notNull(),
  chatId: varchar('chat_id', { length: 250 }).notNull(),
  completeSignupId: uuid('complete_signup_id').defaultRandom().notNull(),
  isCompleted: boolean('is_completed').default(false).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('intents_complete_signup_id_unique').on(table.completeSignupId),
  uniqueIndex('intents_telegram_id_unique').on(table.telegramId),
]);

/** Intent row returned from the database. */
export type Intent = typeof intents.$inferSelect;

/** Intent values accepted for insertion. */
export type NewIntent = typeof intents.$inferInsert;
