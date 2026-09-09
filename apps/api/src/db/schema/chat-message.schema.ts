import { desc } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn } from './common';
import { intents } from './intent.schema';

/**
 * Append-only Telegram conversation schema.
 *
 * Messages belong to an intent and turn. The unique inbound-message index
 * supports idempotent handling of repeated Telegram updates.
 *
 * @module chatMessageSchema
 */

/** Roles that can appear in persisted user-facing conversation history. */
export const chatMessageRoleEnum = pgEnum('chat_message_role', [
  'user',
  'assistant',
]);

/** TypeScript union of persisted conversation roles. */
export type ChatMessageRole = typeof chatMessageRoleEnum.enumValues[number];

/** Append-only Telegram conversation messages grouped into request/response turns. */
export const chatMessages = pgTable('chat_messages', {
  id: idColumn(),
  intentId: uuid('intent_id')
    .notNull()
    .references(() => intents.id, { onDelete: 'cascade' }),
  turnId: uuid('turn_id').notNull(),
  role: chatMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  telegramMessageId: integer('telegram_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
}, (table) => [
  index('chat_messages_intent_history_idx')
    .on(table.intentId, desc(table.createdAt), desc(table.id)),
  index('chat_messages_turn_idx').on(table.turnId),
  uniqueIndex('chat_messages_telegram_inbound_unique')
    .on(table.intentId, table.role, table.telegramMessageId),
]);

/** Chat-message row returned from the database. */
export type ChatMessage = typeof chatMessages.$inferSelect;

/** Chat-message values accepted for insertion. */
export type NewChatMessage = typeof chatMessages.$inferInsert;
