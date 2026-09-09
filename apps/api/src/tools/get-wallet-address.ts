import type { SupportedCrypto } from '../queries/catalog.query';
import { findSupportedCryptos } from '../queries/catalog.query';
import { getUserByTelegramId } from "../queries/user.query";
import { findOneWallet } from "../queries/wallet.query";
import { normalizeCurrency, normalizeNetwork } from '../utils/currency';

interface WalletAddressToolUserContext {
  userId: string | number;
  username?: string;
}

/**
 * Retrieves a network-specific deposit address for the authenticated customer.
 *
 * The address and optional destination tag/memo are formatted for Telegram and
 * returned with `GET_WALLET_ADDRESS` metadata so the bot can send the address
 * and QR/photo response.
 *
 * @param coin Configured cryptocurrency symbol, such as `USDC` or `USDT`.
 * @param network Network supported by the selected currency, such as `BASE`
 * or `ERC20`.
 * @param user Trusted Telegram user context.
 * @param supportedCryptos Optional runtime currency/network catalog.
 * @returns A Telegram-formatted address or an explanatory validation/error
 * message.
 */
export const getWalletAddress = async (
  coin: string,
  network: string,
  user: WalletAddressToolUserContext,
  supportedCryptos?: readonly SupportedCrypto[],
) => {
  const catalog = supportedCryptos ?? await findSupportedCryptos();
  const selectedCoin = normalizeCurrency(coin);
  const selectedNetwork = normalizeNetwork(network);
  const supportedCrypto = catalog.find(({ code }) => code === selectedCoin);

  if (!supportedCrypto) {
    return `❌ ${coin.toUpperCase()} is not a supported cryptocurrency.`;
  }

  if (!supportedCrypto.networks.some(({ code: candidate }) => candidate === selectedNetwork)) {
    return `❌ ${network.toUpperCase()} is not supported for ${coin.toUpperCase()}. Supported networks: ${supportedCrypto.networks.map(({ code: candidate }) => candidate.toUpperCase()).join(', ')}.`;
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

  if (!wallet) {
    return `❌ No ${coin.toUpperCase()} wallet was found for your account.`;
  }

  const walletAddress = wallet.addresses.find(
    (address) => address.network.toLowerCase() === selectedNetwork,
  );

  if (!walletAddress) {
    return `❌ Your ${coin.toUpperCase()} ${network.toUpperCase()} deposit address is not available yet.`;
  }

  const destinationTag = walletAddress.destinationTag
    ? `\n🏷️ *Destination tag/memo:* \`${walletAddress.destinationTag}\``
    : '';

  return `
Hi ${user.username || 'there'}! Here's your ${coin.toUpperCase()} deposit address for the ${selectedNetwork.toUpperCase()} network:

📍 *${coin.toUpperCase()} Wallet Address*

🌐 *Network:* ${walletAddress.network.toUpperCase()}
📋 *Address:* \`${walletAddress.address}\`${destinationTag}

⚠️ *Important:*
• Only send ${coin.toUpperCase()} to this address
• Ensure you're using the ${selectedNetwork.toUpperCase()} network
• Double-check the address before sending
• Transactions are irreversible

*Copy the address by tapping on it*

ACTION: GET_WALLET_ADDRESS
PARAM: ${walletAddress.address}
`;
}
