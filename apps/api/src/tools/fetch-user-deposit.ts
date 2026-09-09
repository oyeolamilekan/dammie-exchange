import { findDepositPage, type DepositFilter } from '../queries/deposit.query';
import { getUserByTelegramId } from '../queries/user.query';
import {
  appendHistoryEntry,
  boundedTelegramField,
  buildCreatedAtFilter,
  continuationInstruction,
  type TransactionHistoryParams,
} from './transaction-history';

/**
 * Reads and formats one bounded page of the current user's deposit history.
 *
 * The query is scoped by the trusted Telegram user ID. The optional cursor is
 * opaque and is returned in the message when another page is available.
 *
 * @param params User identity, optional currency/date filters, and cursor.
 * @returns A Telegram-formatted deposit history page or an explanatory
 * empty/error message.
 */
export const fetchUserDeposits = async ({
  userId,
  coin,
  startDate,
  endDate,
  cursor,
}: TransactionHistoryParams): Promise<string> => {
  const userData = await getUserByTelegramId(userId.toString());
  if (!userData) return '❌ User not found. Please ensure you are registered.';

  const filter: DepositFilter = { userId: userData.id };
  if (coin) filter.currency = coin.toLowerCase();
  const createdAt = buildCreatedAtFilter(startDate, endDate);
  if (createdAt) Object.assign(filter, createdAt);

  const page = await findDepositPage(filter, { cursor });
  if (page.items.length === 0) return '📥 No deposit transactions found.';

  let message = '📥 *Your Deposit History:*\n\n';
  for (const deposit of page.items) {
    const statusEmoji = deposit.status === 'success'
      ? '✅'
      : deposit.status === 'pending' ? '🕐' : '❌';
    const entry = [
      `${statusEmoji} ${deposit.amount} ${deposit.currency.toUpperCase()}`,
      `Blockchain hash: ${boundedTelegramField(deposit.txid)}`,
      `${deposit.status} • ${deposit.createdAt.toLocaleDateString()}`,
      '',
    ].join('\n');
    message = appendHistoryEntry(message, entry);
  }

  return message + continuationInstruction('deposits', page.nextCursor);
};
