/**
 * Crypto-to-NGN quotation and pending-swap creation service.
 *
 * Validates a trusted user's wallet, obtains a provider quotation, resolves
 * the platform fee, and persists a pending swap for later approval.
 *
 * @module swapCreateService
 */

import { createSwap as persistSwap } from '../../../queries/swap.query';
import { getUserByTelegramId } from '../../../queries/user.query';
import { findOneWallet } from '../../../queries/wallet.query';
import { findSupportedCryptos, type SupportedCrypto } from '../../../queries/catalog.query';
import { addStoredDecimals, standardDecimal } from '../../../utils/decimal';
import { normalizeCurrency } from '../../../utils/currency';
import { appendProviderResponse } from '../../../utils/provider-response';
import { quidax, type QuidaxClient } from '../../integrations/quidax';
import {
  calculateNetPlatformProceeds,
  feeConsumesProceeds,
  resolvePlatformFee,
  type ResolvedPlatformFee,
} from '../platform-fees';

type CreateSwapQuidaxClient = Pick<QuidaxClient, 'createInstantSwap'>;
type CreatedSwap = Awaited<ReturnType<typeof persistSwap>>;

/** Trusted identity and swap values supplied by the Telegram tool adapter. */
export interface CreateSwapInput {
  amount: string;
  coin: string;
  telegramId: string;
  /** Catalog loaded by the surrounding AI/direct operation, when available. */
  supportedCryptos?: readonly SupportedCrypto[];
}

/** Expected precondition outcomes for swap quotation creation. */
export type CreateSwapResult =
  | { outcome: 'user-not-found' }
  | { outcome: 'wallet-not-found' }
  | { outcome: 'insufficient-balance'; balance: string }
  | { outcome: 'invalid-amount' }
  | { outcome: 'empty-wallet' }
  | { outcome: 'fee-exceeds-proceeds' }
  | { outcome: 'created'; swap: CreatedSwap };

const normalizeRequestedAmount = (amount: string): string | null => {
  try {
    return standardDecimal(amount);
  } catch {
    return null;
  }
};

/** Creates the quotation and pending swap record workflow for a trusted user. */
export const createSwapService = (
  client: CreateSwapQuidaxClient,
  loadSupportedCryptos: () => Promise<SupportedCrypto[]> = findSupportedCryptos,
  resolveFee: (
    currency: string,
    context: 'swap' | 'withdrawal',
    baseAmount: string | number,
  ) => Promise<ResolvedPlatformFee> = resolvePlatformFee,
) =>
  async (input: CreateSwapInput): Promise<CreateSwapResult> => {
    const user = await getUserByTelegramId(input.telegramId);
    if (!user) return { outcome: 'user-not-found' };

    const supportedCryptos = input.supportedCryptos
      ?? await loadSupportedCryptos();
    const currency = normalizeCurrency(input.coin);
    if (!supportedCryptos.some(({ code }) => normalizeCurrency(code) === currency)) {
      return { outcome: 'wallet-not-found' };
    }
    const wallet = await findOneWallet({ userId: user.id, currency });
    if (!wallet) return { outcome: 'wallet-not-found' };

    const amount = normalizeRequestedAmount(input.amount);
    if (amount === null) return { outcome: 'invalid-amount' };

    const remainingBalance = addStoredDecimals(wallet.balance, `-${amount}`);
    if (remainingBalance.startsWith('-')) {
      return { outcome: 'insufficient-balance', balance: wallet.balance };
    }
    if (amount.startsWith('-') || amount === '0') return { outcome: 'invalid-amount' };
    if (standardDecimal(wallet.balance) === '0') return { outcome: 'empty-wallet' };

    const response = await client.createInstantSwap(user.subUserId, {
      from_currency: currency,
      to_currency: 'ngn',
      from_amount: amount,
    });
    const grossToAmount = standardDecimal(response.to_amount);
    const resolvedFee = await resolveFee(response.to_currency, 'swap', grossToAmount);
    if (feeConsumesProceeds(grossToAmount, resolvedFee.amount)) {
      return { outcome: 'fee-exceeds-proceeds' };
    }
    const netToAmount = calculateNetPlatformProceeds(grossToAmount, resolvedFee.amount);
    const swap = await persistSwap({
      quotationId: response.id,
      fromCurrency: response.from_currency,
      quotedPrice: response.quoted_price,
      toCurrency: response.to_currency,
      fromAmount: response.from_amount,
      grossToAmount,
      toAmount: netToAmount,
      platformFeeAmount: resolvedFee.amount,
      providerResponse: appendProviderResponse(null, 'quotation', response),
      ...(resolvedFee.snapshot ? {
        platformFeeId: resolvedFee.snapshot.platformFeeId,
        platformFeeType: resolvedFee.snapshot.platformFeeType,
        platformFeeConfiguredAmount: resolvedFee.snapshot.platformFeeConfiguredAmount,
        platformFeeMinimumFee: resolvedFee.snapshot.platformFeeMinimumFee,
        platformFeeMaximumFee: resolvedFee.snapshot.platformFeeMaximumFee,
      } : {}),
      userId: user.id,
    });
    return { outcome: 'created', swap };
  };

/** Configured swap quotation workflow used by the Telegram adapter. */
export const createSwap = createSwapService(quidax);

export type CreateSwapService = ReturnType<typeof createSwapService>;
