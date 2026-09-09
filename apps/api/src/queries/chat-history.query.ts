import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../database';
import {
  chatMessages,
  type ChatMessage,
} from '../db/schema/chat-message.schema';

/**
 * Telegram conversation persistence and keyset-pagination queries.
 *
 * Inbound messages are claimed with a database uniqueness constraint so retrying
 * the same Telegram update is safe. Assistant messages are stored separately
 * after the response has been accepted for delivery.
 *
 * @module chatHistoryQuery
 */

/** Default number of conversation messages returned per page. */
export const DEFAULT_CHAT_HISTORY_PAGE_SIZE = 20;

/** Hard upper bound for a conversation-history page. */
export const MAX_CHAT_HISTORY_PAGE_SIZE = 100;

/** Versioned serialized form of a chat-history cursor. */
interface ChatHistoryCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
}

/** Decoded chat-history keyset cursor. */
interface ChatHistoryCursor {
  createdAt: Date;
  id: string;
}

/** Data required to atomically claim an inbound Telegram message. */
export interface ClaimUserMessageInput {
  /** Telegram intent owning the conversation. */
  intentId: string;
  /** Application turn identifier used to group user and assistant messages. */
  turnId: string;
  /** Telegram update message ID used for duplicate detection. */
  telegramMessageId: number;
  /** User message text. */
  content: string;
}

/** Data required to persist the assistant response for a turn. */
export interface AppendAssistantMessageInput {
  /** Telegram intent owning the conversation. */
  intentId: string;
  /** Application turn identifier shared with the inbound message. */
  turnId: string;
  /** Exact assistant text accepted for delivery. */
  content: string;
}

/** Cursor-paginated conversation message response. */
export interface ChatHistoryPage {
  items: ChatMessage[];
  nextCursor?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Applies the default and hard maximum for one history read. */
export const normalizeChatHistoryPageSize = (limit?: number): number => {
  if (limit === undefined) return DEFAULT_CHAT_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Chat history page size must be a positive integer');
  }
  return Math.min(limit, MAX_CHAT_HISTORY_PAGE_SIZE);
};

/** Encodes a stable created-at/id keyset cursor without exposing query internals. */
export const encodeChatHistoryCursor = (createdAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({
    v: 1,
    createdAt: createdAt.toISOString(),
    id,
  } satisfies ChatHistoryCursorPayload)).toString('base64url');

/** Validates and decodes a chat-history cursor. */
export const decodeChatHistoryCursor = (cursor: string): ChatHistoryCursor => {
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<ChatHistoryCursorPayload>;
    const createdAt = new Date(payload.createdAt ?? '');
    if (
      payload.v !== 1
      || Number.isNaN(createdAt.valueOf())
      || !payload.id
      || !UUID_PATTERN.test(payload.id)
    ) {
      throw new Error('invalid payload');
    }
    return { createdAt, id: payload.id };
  } catch {
    throw new Error('Invalid chat history cursor');
  }
};

/**
 * Atomically stores an inbound user message and claims its Telegram update.
 * A null result means the same Telegram message was already processed.
 */
export const claimUserChatMessage = async (
  input: ClaimUserMessageInput,
): Promise<ChatMessage | null> => {
  const inserted = (await db.insert(chatMessages).values({
    ...input,
    role: 'user',
  }).onConflictDoNothing({
    target: [
      chatMessages.intentId,
      chatMessages.role,
      chatMessages.telegramMessageId,
    ],
  }).returning())[0];
  return inserted ?? null;
};

/** Appends the exact assistant text accepted for delivery in one claimed turn. */
export const appendAssistantChatMessage = async (
  input: AppendAssistantMessageInput,
): Promise<ChatMessage> => (
  await db.insert(chatMessages).values({
    ...input,
    role: 'assistant',
  }).returning()
)[0];

/** Reads one intent's history with stable newest-first keyset pagination. */
export const findChatHistoryPage = async (
  intentId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ChatHistoryPage> => {
  const limit = normalizeChatHistoryPageSize(options.limit);
  const cursor = options.cursor
    ? decodeChatHistoryCursor(options.cursor)
    : undefined;
  const clauses: SQL[] = [eq(chatMessages.intentId, intentId)];
  if (cursor) {
    clauses.push(or(
      lt(chatMessages.createdAt, cursor.createdAt),
      and(
        eq(chatMessages.createdAt, cursor.createdAt),
        lt(chatMessages.id, cursor.id),
      ),
    ) as SQL);
  }

  const rows = await db.select().from(chatMessages)
    .where(and(...clauses))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit + 1);
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    ...(hasNext && last
      ? { nextCursor: encodeChatHistoryCursor(last.createdAt, last.id) }
      : {}),
  };
};
