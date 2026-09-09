import { portfolioSnapshotService } from '../services/portfolio/snapshot';
import { formatFinancialAmount } from '../utils/decimal';
import { TELEGRAM_MESSAGE_LIMIT } from './transaction-history';

/** Trusted Telegram context used to scope the portfolio query. */
interface PortfolioUserContext {
  userId: number;
  username: string;
}

/**
 * Output that tells the agent runner to preserve the generated snapshot text.
 */
export interface DeterministicPortfolioOutput {
  message: string;
  deterministic: true;
}

/** Sums grouped transaction counts from the snapshot activity response. */
const countTransactions = (items: Array<{ transactionCount: number }>): number =>
  items.reduce((total, item) => total + item.transactionCount, 0);

/**
 * Renders balances and successful activity as a deterministic Telegram
 * message.
 *
 * @param snapshot Snapshot returned by the portfolio query service.
 * @returns A Telegram-formatted snapshot, or a registered-user error.
 * @throws If the rendered message exceeds Telegram's maximum message length.
 */
export const renderPortfolioSnapshot = (
  snapshot: Awaited<ReturnType<typeof portfolioSnapshotService.getSnapshot>>,
): string => {
  if (!snapshot) return '❌ User not found. Please ensure you are registered.';

  const lines = [
    '📊 *Portfolio Snapshot*',
    `_As of ${snapshot.asOf} (UTC)_`,
    '',
  ];
  if (snapshot.balances.length === 0) {
    lines.push('No supported wallets are available yet.', '');
  } else {
    for (const balance of snapshot.balances) {
      lines.push(
        `*${balance.currency}*`,
        `Available: ${formatFinancialAmount(balance.available)} ${balance.currency}`,
        `Locked: ${formatFinancialAmount(balance.locked)} ${balance.currency}`,
        `Total: ${formatFinancialAmount(balance.total)} ${balance.currency}`,
        '',
      );
    }
  }
  lines.push(
    '*Successful activity*',
    `Deposits: ${countTransactions(snapshot.activity.deposits)}`,
    ...snapshot.activity.deposits.map(
      (item) => `• ${item.amount} ${item.currency} deposited`,
    ),
    `Swaps: ${countTransactions(snapshot.activity.swaps)}`,
    ...snapshot.activity.swaps.map(
      (item) => `• ${item.amount} ${item.currency} swapped; ₦${item.netNairaAmount} net received`,
    ),
    '',
    '_No current fiat valuation or recommendation is included._',
  );
  const message = lines.join('\n');
  if (message.length > TELEGRAM_MESSAGE_LIMIT) {
    throw new Error('Portfolio snapshot exceeds Telegram message limit');
  }
  return message;
};

/**
 * Retrieves the current customer's deterministic portfolio snapshot.
 *
 * Service failures are converted to a temporary-unavailability message so a
 * provider or database error is not exposed to the customer.
 *
 * @param user Trusted Telegram user context.
 * @returns Snapshot text marked as deterministic for the agent runner.
 */
export const getPortfolioSnapshot = async (
  user: PortfolioUserContext,
): Promise<DeterministicPortfolioOutput> => {
  try {
    const snapshot = await portfolioSnapshotService.getSnapshot(
      user.userId.toString(),
    );
    return { message: renderPortfolioSnapshot(snapshot), deterministic: true };
  } catch {
    return {
      message: '❌ Portfolio snapshot is temporarily unavailable. Please try again later.',
      deterministic: true,
    };
  }
};
