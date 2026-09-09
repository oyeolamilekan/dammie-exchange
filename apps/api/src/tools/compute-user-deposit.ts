import { aggregateDepositSummary, type DepositFilter } from '../queries/deposit.query';
import { getUserByTelegramId } from '../queries/user.query';
import {
  buildCreatedAtFilter,
  type TransactionHistoryParams,
} from './transaction-history';

/** Aggregated successful deposit values prepared for Telegram formatting. */
interface DepositSummary {
  totalAmount: string;
  transactionCount: number;
  currency: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Calculates successful deposit totals for the authenticated Telegram user.
 *
 * @param params User identity and optional currency/date filters.
 * @returns The aggregate summary, or `null` when the user is not registered.
 * @internal
 */
const computeTotalDeposit = async ({
  userId,
  coin,
  startDate,
  endDate,
}: TransactionHistoryParams): Promise<DepositSummary | null> => {
  const userData = await getUserByTelegramId(userId.toString());
  if (!userData) return null;

  const filter: DepositFilter = { userId: userData.id, status: 'success' };
  if (coin) filter.currency = coin.toLowerCase();
  const createdAt = buildCreatedAtFilter(startDate, endDate);
  if (createdAt) Object.assign(filter, createdAt);
  const result = await aggregateDepositSummary(filter);

  return {
    totalAmount: result.totalAmount,
    transactionCount: result.transactionCount,
    currency: coin?.toUpperCase()
      ?? (result.currencies.length === 1 ? result.currencies[0] : 'MIXED'),
    startDate,
    endDate,
  };
};

/**
 * Formats a deposit aggregate as a Telegram Markdown message.
 *
 * @param summary Aggregate returned by {@link computeTotalDeposit}.
 * @returns A customer-facing summary or an explanatory empty/error message.
 * @internal
 */
const formatDepositSummary = (summary: DepositSummary | null): string => {
  if (!summary) return '❌ User not found. Please ensure you are registered.';
  if (summary.transactionCount === 0) {
    return '📥 No successful deposit transactions found for the specified criteria.';
  }

  let message = '💰 *Deposit Summary:*\n\n';
  message += `📊 Total Amount: ${Number(summary.totalAmount).toFixed(8)} ${summary.currency}\n`;
  message += `📈 Transaction Count: ${summary.transactionCount}\n`;
  if (summary.startDate) {
    message += `📅 Start Date: ${new Date(summary.startDate).toLocaleDateString()}\n`;
  }
  if (summary.endDate) {
    message += `📅 End Date: ${new Date(summary.endDate).toLocaleDateString()}\n`;
  }
  return message;
};

/**
 * Computes and formats successful deposit totals for the current customer.
 *
 * @param params User identity and optional currency/date filters supplied by
 * the agent.
 * @returns A Telegram-formatted deposit summary.
 */
export const computeAndFormatTotalDeposit = async (
  params: TransactionHistoryParams,
): Promise<string> => formatDepositSummary(await computeTotalDeposit(params));
