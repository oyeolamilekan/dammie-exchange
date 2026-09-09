import { aggregateSwapSummary, type SwapFilter } from '../queries/swap.query';
import { getUserByTelegramId } from '../queries/user.query';
import {
  buildCreatedAtFilter,
  type TransactionHistoryParams,
} from './transaction-history';

/** Aggregated successful swap values prepared for Telegram formatting. */
interface SwapSummary {
  totalFromAmount: string;
  totalToAmount: string;
  totalNairaAmount: string;
  transactionCount: number;
  fromCurrency: string;
  toCurrency: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Calculates successful swap totals for the authenticated Telegram user.
 *
 * @param params User identity and optional source-currency/date filters.
 * @returns The aggregate summary, or `null` when the user is not registered.
 * @internal
 */
const computeTotalSwap = async ({
  userId,
  coin,
  startDate,
  endDate,
}: TransactionHistoryParams): Promise<SwapSummary | null> => {
  const userData = await getUserByTelegramId(userId.toString());
  if (!userData) return null;

  const filter: SwapFilter = { userId: userData.id, status: 'success' };
  if (coin) filter.fromCurrency = coin.toLowerCase();
  const createdAt = buildCreatedAtFilter(startDate, endDate);
  if (createdAt) Object.assign(filter, createdAt);
  const result = await aggregateSwapSummary(filter);

  return {
    totalFromAmount: result.totalFromAmount,
    totalToAmount: result.totalToAmount,
    totalNairaAmount: result.totalNairaAmount,
    transactionCount: result.transactionCount,
    fromCurrency: coin?.toUpperCase()
      ?? (result.fromCurrencies.length === 1 ? result.fromCurrencies[0] : 'MIXED'),
    toCurrency: result.toCurrencies.length === 1 ? result.toCurrencies[0] : 'NGN',
    startDate,
    endDate,
  };
};

/**
 * Formats a swap aggregate as a Telegram Markdown message.
 *
 * @param summary Aggregate returned by {@link computeTotalSwap}.
 * @returns A customer-facing summary or an explanatory empty/error message.
 * @internal
 */
const formatSwapSummary = (summary: SwapSummary | null): string => {
  if (!summary) return '❌ User not found. Please ensure you are registered.';
  if (summary.transactionCount === 0) {
    return '🔄 No successful swap transactions found for the specified criteria.';
  }

  let message = '💱 *Swap Summary:*\n\n';
  message += `📊 Total Swapped: ${Number(summary.totalFromAmount).toFixed(8)} ${summary.fromCurrency}\n`;
  message += `💰 Total Received: ₦${Number(summary.totalNairaAmount).toLocaleString()}\n`;
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
 * Computes and formats successful swap totals for the current customer.
 *
 * @param params User identity and optional source-currency/date filters
 * supplied by the agent.
 * @returns A Telegram-formatted swap summary.
 */
export const computeAndFormatTotalSwap = async (
  params: TransactionHistoryParams,
): Promise<string> => formatSwapSummary(await computeTotalSwap(params));
