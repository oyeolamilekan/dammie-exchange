import type { SupportedCrypto } from '../queries/catalog.query';
import {
  createSwap,
  type CreateSwapResult,
} from '../services/financial/swaps/create';

/** Trusted Telegram context supplied by the agent, never by model tool input. */
export interface SwapToolUserContext {
  userId: number;
  username: string;
}

/**
 * Converts a quotation-service result into the message shown by Telegram.
 *
 * @param result Typed outcome from the swap quotation workflow.
 * @param coin Requested source currency, used in customer-facing text.
 * @returns A Telegram-formatted result, including approval metadata when a
 * pending swap was created.
 * @internal
 */
const formatResult = (
  result: CreateSwapResult,
  coin: string,
): string => {
  switch (result.outcome) {
    case 'user-not-found':
      return '❌ User not found. Please ensure you are registered.';
    case 'wallet-not-found':
      return '❌ Wallet not found. Please ensure you have a wallet set up.';
    case 'insufficient-balance':
      return `❌ Insufficient balance. You have only ${result.balance} ${coin}`;
    case 'invalid-amount':
      return '❌ Invalid amount. Please enter a valid amount to swap.';
    case 'empty-wallet':
      return `❌ Your ${coin} wallet is empty. Please deposit some ${coin} before swapping.`;
    case 'fee-exceeds-proceeds':
      return '❌ This swap quote cannot be completed because the platform fee would consume the full Naira proceeds.';
    case 'created': {
      const { swap } = result;
      return `
🔄 *Swap Details:*
• Amount: ${swap.fromAmount} ${swap.fromCurrency}
• Gross Naira proceeds: ₦${swap.grossToAmount}
• Platform fee: ₦${swap.platformFeeAmount}
• You receive: ₦${swap.toAmount}
• Rate: ${swap.quotedPrice} per ${coin.toUpperCase()}
• Status: Ready for approval

💰 *You'll receive:* ₦${swap.toAmount}

⏰ *Processing Time:* 1-2 minutes after approval
💳 *Delivery:* Credited to your NGN wallet

ACTION: APPROVE_SWAP_ACTION
PARAM: ${swap.id}
`;
    }
  }
};

/**
 * Creates a pending swap quotation for the authenticated customer.
 *
 * This tool checks the user's available balance, obtains the provider quote,
 * applies the configured platform fee, and returns an approval action. It does
 * not validate the transaction PIN, move funds, or complete the swap.
 *
 * @param amount Source-currency amount as a positive decimal string.
 * @param coin Configured source cryptocurrency symbol.
 * @param user Trusted Telegram user context.
 * @param supportedCryptos Optional runtime catalog used for validation.
 * @returns A Telegram-formatted quotation or an explanatory failure message.
 */
export const initiateSwap = async (
  amount: string,
  coin: string,
  user: SwapToolUserContext,
  supportedCryptos?: readonly SupportedCrypto[],
): Promise<string> => formatResult(
  await createSwap({
    amount,
    coin,
    telegramId: user.userId.toString(),
    supportedCryptos,
  }),
  coin,
);
