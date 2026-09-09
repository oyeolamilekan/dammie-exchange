import type { SupportedCrypto } from '../queries/catalog.query';
import { findSupportedCryptos } from '../queries/catalog.query';
import { getUserByTelegramId } from "../queries/user.query";
import { findOneWallet } from "../queries/wallet.query";
import { addStoredDecimals, formatFinancialAmount } from '../utils/decimal';
import { normalizeCurrency } from '../utils/currency';

interface WalletToolUserContext {
  userId: string | number;
}

/**
 * Retrieves and formats available, locked, and total balance for one wallet.
 *
 * Currency validation uses the runtime supported-currency catalog. If the user
 * exists but the wallet has not been provisioned yet, the response reports
 * zero balances rather than exposing a database error.
 *
 * @param coin Configured cryptocurrency symbol whose balance is requested.
 * @param user Trusted Telegram user context.
 * @param supportedCryptos Optional runtime catalog used for currency
 * validation.
 * @returns A Telegram-formatted balance message or an explanatory error.
 */
export const getWalletBalance = async (
  coin: string,
  user: WalletToolUserContext,
  supportedCryptos?: readonly SupportedCrypto[],
) => {
  const catalog = supportedCryptos ?? await findSupportedCryptos();
  const selectedCoin = normalizeCurrency(coin);
  if (!catalog.some(({ code }) => code === selectedCoin)) {
    return `❌ ${coin.toUpperCase()} is not a supported cryptocurrency.`;
  }
  const userData = await getUserByTelegramId(String(user.userId));

  if (!userData) {
    return '❌ User not found. Please ensure you are registered.';
  }

  const { id } = userData;
  const wallet = await findOneWallet({
    userId: id,
    currency: selectedCoin,
  });
  const available = wallet ? formatFinancialAmount(wallet.balance) : '0';
  const locked = wallet ? formatFinancialAmount(wallet.lockedBalance) : '0';
  const total = wallet
    ? formatFinancialAmount(addStoredDecimals(wallet.balance, wallet.lockedBalance))
    : '0';

  return `
💼 *${coin} Wallet Balance*

💰 Available: ${available} ${coin}
🔒 Locked: ${locked} ${coin}
📊 Total: ${total} ${coin}

*Wallet Status:* Active ✅
*Last Updated:* ${wallet?.updatedAt}

ACTION: NO_ACTION
`;
}
