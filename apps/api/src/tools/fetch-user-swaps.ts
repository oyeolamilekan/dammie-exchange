import { findSwapPage, type SwapFilter } from '../queries/swap.query';
import { getUserByTelegramId } from '../queries/user.query';
import {
  appendHistoryEntry,
  buildCreatedAtFilter,
  continuationInstruction,
  type TransactionHistoryParams,
} from './transaction-history';

/**
 * Reads and formats one bounded page of the current user's swap history.
 *
 * The query is scoped by the trusted Telegram user ID. The optional cursor is
 * opaque and is returned in the message when another page is available.
 *
 * @param params User identity, optional source-currency/date filters, and
 * cursor.
 * @returns A Telegram-formatted swap history page or an explanatory
 * empty/error message.
 */
export const fetchUserSwaps = async ({
  userId,
  coin,
  startDate,
  endDate,
  cursor,
}: TransactionHistoryParams): Promise<string> => {
  const userData = await getUserByTelegramId(userId.toString());
  if (!userData) return '❌ User not found. Please ensure you are registered.';

  const filter: SwapFilter = { userId: userData.id };
  if (coin) filter.fromCurrency = coin.toLowerCase();
  const createdAt = buildCreatedAtFilter(startDate, endDate);
  if (createdAt) Object.assign(filter, createdAt);

  const page = await findSwapPage(filter, { cursor });
  if (page.items.length === 0) return '🔄 No swap transactions found.';

  let message = '🔄 *Your Swap History:*\n\n';
  for (const swap of page.items) {
    const statusEmoji = swap.status === 'success'
      ? '✅'
      : swap.status === 'pending' ? '🕐' : '❌';
    const entry = [
      `${statusEmoji} ${swap.fromAmount} ${swap.fromCurrency.toUpperCase()} → ₦${swap.toAmount} net`,
      `Gross ₦${swap.grossToAmount ?? swap.toAmount} • Platform fee ₦${swap.platformFeeAmount ?? '0'}`,
      `${swap.status} • ${swap.createdAt.toLocaleDateString()}`,
      '',
    ].join('\n');
    message = appendHistoryEntry(message, entry);
  }

  return message + continuationInstruction('swaps', page.nextCursor);
};
