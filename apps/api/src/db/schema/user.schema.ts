import { boolean, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';
import { intents } from './intent.schema';

/**
 * Customer identity schema.
 *
 * The table stores the hashed transaction PIN and BVN for server-side
 * workflows; application read models should use projections that omit them.
 *
 * @module userSchema
 */

/** Registered customer identity linked to Telegram and the provider sub-user. */
export const users = pgTable('users', {
  id: idColumn(),
  email: varchar('email', { length: 250 }).notNull(),
  firstName: varchar('first_name', { length: 250 }).notNull(),
  lastName: varchar('last_name', { length: 250 }).notNull(),
  bvnNumber: varchar('bvn_number', { length: 250 }).notNull(),
  hashedPin: varchar('hashed_pin', { length: 250 }).notNull(),
  telegramId: varchar('telegram_id', { length: 32 }).notNull(),
  subUserId: varchar('sub_user_id', { length: 250 }).notNull(),
  intentId: uuid('intent_id').notNull().references(() => intents.id, { onDelete: 'restrict' }),
  chatId: varchar('chat_id', { length: 250 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
  uniqueIndex('users_telegram_id_unique').on(table.telegramId),
  uniqueIndex('users_sub_user_id_unique').on(table.subUserId),
  uniqueIndex('users_chat_id_unique').on(table.chatId),
  uniqueIndex('users_intent_id_unique').on(table.intentId),
]);

/** Complete user row returned from the database. */
export type User = typeof users.$inferSelect;

/** User values accepted for insertion. */
export type NewUser = typeof users.$inferInsert;

/** User projection safe for public/customer-facing responses. */
export type PublicUser = Omit<User, 'bvnNumber' | 'hashedPin'>;

/** User row populated with its signup intent. */
export type PopulatedUser = User & { intent: import('./intent.schema').Intent };
