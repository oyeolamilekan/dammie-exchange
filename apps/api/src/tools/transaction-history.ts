/**
 * Shared helpers for bounded Telegram transaction-history responses.
 *
 * History tools use these helpers to convert date filters into UTC boundaries,
 * keep messages below Telegram's size limit, and provide opaque continuation
 * instructions.
 *
 * @module transactionHistory
 */

/** Telegram's maximum message size in characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4_096;

/** Target size used to leave room for a continuation instruction. */
export const TELEGRAM_HISTORY_TARGET = 3_900;

/** Common identity, filtering, and pagination inputs for history tools. */
export interface TransactionHistoryParams {
  /** Optional Telegram username retained by the agent context. */
  username?: string;
  /** Telegram ID from the trusted agent context. */
  userId: number;
  /** Optional configured currency code. */
  coin?: string;
  /** Inclusive UTC calendar-date lower bound in `YYYY-MM-DD` form. */
  startDate?: string;
  /** Inclusive UTC calendar-date upper bound in `YYYY-MM-DD` form. */
  endDate?: string;
  /** Opaque cursor returned by a previous history page. */
  cursor?: string;
}

/**
 * Converts inclusive calendar-date filters into query-layer UTC boundaries.
 *
 * @param startDate Lower date boundary in `YYYY-MM-DD` form.
 * @param endDate Upper date boundary in `YYYY-MM-DD` form.
 * @returns Query dates, or `undefined` when no date filter was supplied.
 */
export const buildCreatedAtFilter = (
  startDate?: string,
  endDate?: string,
): { createdAfter?: Date; createdBefore?: Date } | undefined => {
  if (!startDate && !endDate) return undefined;
  const createdAt: { createdAfter?: Date; createdBefore?: Date } = {};
  if (startDate) createdAt.createdAfter = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) createdAt.createdBefore = new Date(`${endDate}T23:59:59.999Z`);
  return createdAt;
};

/**
 * Bounds a field before it is inserted into a Telegram history message.
 *
 * @param value Value to stringify and bound.
 * @param maxLength Maximum returned character length.
 * @returns The original text or a truncated text ending in an ellipsis.
 */
export const boundedTelegramField = (value: unknown, maxLength = 180): string => {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
};

/**
 * Appends a history entry only while the message remains within the target
 * Telegram size.
 *
 * @param message Message assembled so far.
 * @param entry Formatted history entry to append.
 * @returns The extended message, or the original message when it would exceed
 * the target.
 */
export const appendHistoryEntry = (
  message: string,
  entry: string,
): string => {
  if (message.length + entry.length <= TELEGRAM_HISTORY_TARGET) {
    return message + entry;
  }
  return message;
};

/**
 * Builds the customer instruction for requesting the next opaque history page.
 *
 * @param kind History resource name shown to the customer.
 * @param cursor Optional next-page cursor.
 * @returns A continuation instruction, or an empty string when there is no
 * next page.
 */
export const continuationInstruction = (
  kind: 'deposits' | 'swaps' | 'account history',
  cursor?: string,
): string => cursor
  ? `\nNext page: send “next ${kind} cursor ${cursor}”.`
  : '';
