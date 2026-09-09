import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  chatMessageRoleEnum,
  chatMessages,
} from '../../src/db/schema/chat-message.schema';
import {
  decodeChatHistoryCursor,
  encodeChatHistoryCursor,
  MAX_CHAT_HISTORY_PAGE_SIZE,
  normalizeChatHistoryPageSize,
} from '../../src/queries/chat-history.query';

describe('chat history schema and pagination', () => {
  it('stores user and assistant messages under an intent and turn', () => {
    const columns = getTableColumns(chatMessages);
    const config = getTableConfig(chatMessages);

    expect(chatMessageRoleEnum.enumValues).toEqual(['user', 'assistant']);
    expect(Object.keys(columns)).toEqual([
      'id',
      'intentId',
      'turnId',
      'role',
      'content',
      'telegramMessageId',
      'createdAt',
    ]);
    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0].onDelete).toBe('cascade');
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      'chat_messages_intent_history_idx',
      'chat_messages_turn_idx',
      'chat_messages_telegram_inbound_unique',
    ]);
  });

  it('round-trips stable cursors and enforces bounded page sizes', () => {
    const createdAt = new Date('2026-08-30T00:00:00.000Z');
    const id = '018f7d22-7c3d-7a9e-8f6b-123456789abc';

    expect(decodeChatHistoryCursor(
      encodeChatHistoryCursor(createdAt, id),
    )).toEqual({ createdAt, id });
    expect(normalizeChatHistoryPageSize()).toBe(20);
    expect(normalizeChatHistoryPageSize(1_000)).toBe(
      MAX_CHAT_HISTORY_PAGE_SIZE,
    );
    expect(() => normalizeChatHistoryPageSize(0)).toThrow(
      'positive integer',
    );
    expect(() => decodeChatHistoryCursor('not-a-cursor')).toThrow(
      'Invalid chat history cursor',
    );
  });
});
