import type { SupportedCrypto } from '../queries/catalog.query';
import { findSupportedCryptos } from '../queries/catalog.query';
import { getUserByTelegramId } from '../queries/user.query';
import {
  findOneWallet,
  type WalletAddressRecord,
} from '../queries/wallet.query';
import { normalizeCurrency } from '../utils/currency';
import { addStoredDecimals, formatFinancialAmount } from '../utils/decimal';

interface FetchWalletUserContext {
  userId: string | number;
}

const renderAddresses = (addresses: WalletAddressRecord[]): string[] => {
  if (!addresses.length) return ['Deposit addresses: Not available yet'];

  return [
    'Deposit addresses:',
    ...addresses.map((address) => {
      const destinationTag = address.destinationTag
        ? ` · Memo/tag: \`${address.destinationTag}\``
        : '';
      return `• ${address.network.toUpperCase()}: \`${address.address}\`${destinationTag}`;
    }),
  ];
};

/**
 * Fetches one authenticated customer's wallet by currency.
 *
 * The response intentionally omits database IDs, provider wallet IDs, and
 * owner data. NGN is supported alongside the active crypto catalog.
 */
export const fetchWallet = async (
  coin: string,
  user: FetchWalletUserContext,
  supportedCryptos?: readonly SupportedCrypto[],
): Promise<string> => {
  const catalog = supportedCryptos ?? await findSupportedCryptos();
  const currency = normalizeCurrency(coin);
  const isSupported = currency === 'ngn'
    || catalog.some(({ code }) => normalizeCurrency(code) === currency);

  if (!isSupported) {
    return `❌ ${coin.toUpperCase()} is not a supported wallet currency.`;
  }

  const userData = await getUserByTelegramId(String(user.userId));
  if (!userData) {
    return '❌ User not found. Please ensure you are registered.';
  }

  const wallet = await findOneWallet({ userId: userData.id, currency });
  if (!wallet) {
    return `❌ No ${currency.toUpperCase()} wallet was found for your account.`;
  }

  const symbol = currency.toUpperCase();
  const available = formatFinancialAmount(wallet.balance);
  const locked = formatFinancialAmount(wallet.lockedBalance);
  const total = formatFinancialAmount(
    addStoredDecimals(wallet.balance, wallet.lockedBalance),
  );
  const addressLines = wallet.isCrypto
    ? renderAddresses(wallet.addresses)
    : ['Deposit addresses: Not applicable'];

  return [
    `💼 *${symbol} Wallet*`,
    '',
    `Available: ${available} ${symbol}`,
    `Locked: ${locked} ${symbol}`,
    `Total: ${total} ${symbol}`,
    `Status: ${wallet.inProgress ? 'Provisioning ⏳' : 'Active ✅'}`,
    `Last updated: ${wallet.updatedAt.toISOString()}`,
    '',
    ...addressLines,
    '',
    'ACTION: NO_ACTION',
  ].join('\n');
};
