/**
 * Telegram conversation-history service.
 *
 * The model receives a bounded recent window, while persistence keeps full
 * append-only conversation history and supports keyset pagination.
 *
 * @module telegramHistoryService
 */

import type { ChatMessage } from '../../db/schema/chat-message.schema';
import {
  appendAssistantChatMessage,
  claimUserChatMessage,
  encodeChatHistoryCursor,
  findChatHistoryPage,
  type AppendAssistantMessageInput,
  type ClaimUserMessageInput,
} from '../../queries/chat-history.query';

/** Maximum number of recent messages included in one model context. */
export const MODEL_CONTEXT_MESSAGE_LIMIT = 20;

/** Inputs for loading messages older than a known history position. */
export interface RecentMessagesBeforeInput {
  intentId: string;
  before: Pick<ChatMessage, 'createdAt' | 'id'>;
  limit?: number;
}

/** Minimal persistence contract used by the Telegram conversation workflow. */
export interface ChatHistoryStore {
  /**
   * Atomically stores and claims one inbound Telegram user message.
   *
   * @param input - Intent, turn, Telegram message identity, and user-visible content.
   * @returns The inserted message, or null when the Telegram update was already claimed.
   */
  claimUserMessage(input: ClaimUserMessageInput): Promise<ChatMessage | null>;
  /**
   * Appends assistant content after Telegram accepts its delivery.
   *
   * @param input - Intent, turn, and exact user-visible assistant content.
   * @returns The persisted assistant message.
   */
  appendAssistantMessage(input: AppendAssistantMessageInput): Promise<ChatMessage>;
  /** Reads prior messages in chronological order for model context. */
  getRecentMessagesBefore(input: RecentMessagesBeforeInput): Promise<ChatMessage[]>;
}

/** Database-backed writer for user-facing Telegram conversation history. */
export const chatHistoryStore: ChatHistoryStore = {
  claimUserMessage: claimUserChatMessage,
  appendAssistantMessage: appendAssistantChatMessage,
  async getRecentMessagesBefore({ intentId, before, limit = MODEL_CONTEXT_MESSAGE_LIMIT }) {
    const page = await findChatHistoryPage(intentId, {
      cursor: encodeChatHistoryCursor(before.createdAt, before.id),
      limit: Math.min(limit, MODEL_CONTEXT_MESSAGE_LIMIT),
    });
    return [...page.items].reverse();
  },
};
