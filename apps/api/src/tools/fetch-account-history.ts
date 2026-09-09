import { findAccountHistoryPage } from '../queries/account-history.query';
import { type AccountVersionAction, type AccountVersionTransactionType } from '../db/schema/account-version.schema';
import { getUserByTelegramId } from '../queries/user.query';
import {
  appendHistoryEntry,
  boundedTelegramField,
  buildCreatedAtFilter,
  continuationInstruction,
  type TransactionHistoryParams,
} from './transaction-history';

/** Filters supported by the account-version history tool. */
export interface AccountHistoryParams extends TransactionHistoryParams {
  action?: AccountVersionAction;
  transactionType?: AccountVersionTransactionType;
}

/**
 * Reads a bounded page of immutable account-version balance changes.
 *
 * Results are scoped to the authenticated Telegram user and may include an
 * opaque continuation cursor for the next page.
 *
 * @param params User identity, optional asset/date/action filters, and cursor.
 * @returns A Telegram-formatted history page or an explanatory empty/error
 * message.
 */
export const fetchAccountHistory = async ({
  userId, coin, startDate, endDate, cursor, action, transactionType,
}: AccountHistoryParams): Promise<string> => {
  const userData = await getUserByTelegramId(userId.toString());
  if (!userData) return '❌ User not found. Please ensure you are registered.';
  const page = await findAccountHistoryPage({
    userId: userData.id,
    currencies: coin ? [coin.toLowerCase()] : undefined,
    transactionType,
    action,
    ...buildCreatedAtFilter(startDate, endDate),
  }, { cursor });
  if (!page.items.length) return '📒 No account history found.';

  let message = '📒 *Your Account History:*\n\n';
  for (const item of page.items) {
    const entry = [
      `• ${item.action.replace(/_/g, ' ')}`,
      `${item.transactionType} ${boundedTelegramField(item.transactionId, 80)}`,
      `${item.currency} | available ${item.previousBalance} → ${item.balance} | locked ${item.lockedBalance}`,
      `${item.timestamp.toISOString()}\n`,
    ].join('\n');
    message = appendHistoryEntry(message, entry);
  }
  return message + continuationInstruction('account history', page.nextCursor);
};
