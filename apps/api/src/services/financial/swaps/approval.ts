/**
 * Approved-swap provider confirmation service.
 *
 * Refreshes and confirms a locally approved quotation, then records the
 * provider transaction relationship for later settlement/recovery.
 *
 * @module swapApprovalService
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../database';
import { swaps } from '../../../db/schema/swap.schema';
import { currencies } from '../../../db/schema/currency.schema';
import { wallets } from '../../../db/schema/wallet.schema';
import { findSwapById } from '../../../queries/swap.query';
import { addBalance, mutateWalletAndRecordVersion } from '../account-versions';
import type { QuidaxClient } from '../../integrations/quidax';
import { appendProviderResponse } from '../../../utils/provider-response';

/** Provider operations used to confirm and reconcile an approved swap. */
export type ApprovalQuidaxClient = Pick<
  QuidaxClient,
  'refreshInstantSwap' | 'confirmInstantSwap' | 'findSwapTransactionByQuotation'
>;

type ApprovedSwap = NonNullable<Awaited<ReturnType<typeof findSwapById>>>;

/**
 * Builds the provider refresh body from the stored swap.
 *
 * @param swap - Stored approved swap with its owner identity.
 * @returns Provider-compatible refresh request body.
 */
const buildRefreshRequest = (swap: ApprovedSwap): Record<string, unknown> => ({
  from_currency: swap.fromCurrency.toLowerCase(),
  to_currency: swap.toCurrency.toLowerCase(),
  from_amount: swap.fromAmount,
});

/**
 * Atomically claims a pending approval for one worker.
 *
 * @param swapId - Internal swap identifier.
 * @returns True when this worker moved the approval to processing.
 * @sideEffects Updates approval status and timestamp only when the pending state still matches.
 */
const claimPendingApproval = async (swapId: string): Promise<boolean> => {
  const claimedRow = (await db.update(swaps).set({ approvalStatus: 'processing', updatedAt: new Date() })
    .where(and(
      eq(swaps.id, swapId),
      eq(swaps.status, 'pending'),
      eq(swaps.approvalStatus, 'pending'),
      isNull(swaps.swapTransactionId),
      eq(swaps.reconciliationRequired, false),
    )).returning({ id: swaps.id }))[0];
  return Boolean(claimedRow);
};

/**
 * Commits a confirmed provider transaction and locks the swap funds atomically.
 *
 * @param swapId - Internal swap identifier.
 * @param transactionId - Provider transaction identifier.
 * @returns True when this call committed a new confirmation, false for an exact duplicate.
 * @throws If the swap, wallet, or available balance is no longer valid.
 * @sideEffects Locks the wallet and records its immutable swap-lock version in the same database transaction as confirmation.
 */
const commitConfirmedSwap = (
  swapId: string,
  transactionId: string,
  providerResponse?: unknown,
): Promise<boolean> => db.transaction(async (tx) => {
  const current = (await tx.select().from(swaps).where(eq(swaps.id, swapId)).for('update').limit(1))[0];
  if (!current) throw new Error('Confirmed swap state is invalid');
  if (current.approvalStatus === 'success' && current.swapTransactionId === transactionId) return false;
  if (current.status !== 'pending' || current.approvalStatus !== 'processing' || current.swapTransactionId) {
    throw new Error('Confirmed swap state is invalid');
  }
  const swap = (await tx.update(swaps).set({
    approvalStatus: 'success',
    swapTransactionId: transactionId,
    ...(providerResponse === undefined ? {} : {
      providerResponse: appendProviderResponse(current.providerResponse, 'confirmation', providerResponse),
    }),
    updatedAt: new Date(),
  }).where(and(eq(swaps.id, swapId), eq(swaps.approvalStatus, 'processing'), isNull(swaps.swapTransactionId))).returning())[0];
  if (!swap) {
    throw new Error('Confirmed swap state is invalid');
  }
  const wallet = (await tx.select({
    id: wallets.id,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
  }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
    eq(wallets.userId, swap.userId),
    eq(currencies.code, swap.fromCurrency.trim().toLowerCase()),
  )).for('update').limit(1))[0];
  if (!wallet) throw new Error('Confirmed swap wallet state is invalid');
  const availableAfterLock = addBalance(wallet.balance, `-${swap.fromAmount}`);
  if (availableAfterLock.startsWith('-')) throw new Error('Confirmed swap wallet state is invalid');
  await mutateWalletAndRecordVersion(tx, {
    walletId: wallet.id,
    transactionType: 'swap',
    transactionId: swap.id,
    action: 'swap_lock',
    amount: swap.fromAmount,
    balance: availableAfterLock,
    lockedBalance: addBalance(wallet.lockedBalance, swap.fromAmount),
  });
  return true;
});

/**
 * Reconciles an approval claimed by another worker through the provider search API.
 *
 * @param swap - Current processing swap.
 * @param client - Provider client used to locate the confirmed transaction.
 * @returns The reconciled workflow outcome.
 * @throws If the provider has not recorded the confirmation yet.
 */
const reconcileProcessingApproval = async (
  swap: ApprovedSwap,
  client: ApprovalQuidaxClient,
): Promise<'reconciled'> => {
  const reconciled = await client.findSwapTransactionByQuotation(swap.user.subUserId, swap.quotationId);
  if (!reconciled) throw new Error('Swap confirmation requires reconciliation');
  await commitConfirmedSwap(swap.id, reconciled.id, reconciled);
  return 'reconciled';
};

/**
 * Refreshes, confirms, and atomically commits an approved swap exactly once.
 *
 * @param swapId - Internal swap identifier to process.
 * @param client - Provider operations used for confirmation and reconciliation.
 * @returns The provider-facing outcome: confirmed, reconciled, or duplicate.
 * @throws If the swap is missing, unclaimable, or cannot be reconciled.
 * @sideEffects Provider calls occur outside database transactions; the final confirmation and wallet lock share one transaction.
 */
export const processApprovedSwap = async (
  swapId: string,
  client: ApprovalQuidaxClient,
): Promise<'confirmed' | 'reconciled' | 'duplicate'> => {
  const existing = await findSwapById(swapId);
  if (!existing) throw new Error('Approved swap was not found');
  if (existing.approvalStatus === 'success' && existing.swapTransactionId) return 'duplicate';

  const claimed = await claimPendingApproval(existing.id);
  if (!claimed) {
    const current = await findSwapById(existing.id);
    if (current?.approvalStatus === 'success' && current.swapTransactionId) return 'duplicate';
    if (current?.approvalStatus !== 'processing') throw new Error('Approved swap is not claimable');
    return reconcileProcessingApproval(current, client);
  }

  const refreshed = await client.refreshInstantSwap(
    existing.user.subUserId,
    existing.quotationId,
    buildRefreshRequest(existing),
  );
  await db.update(swaps).set({
    providerResponse: appendProviderResponse(existing.providerResponse, 'refresh', refreshed),
    updatedAt: new Date(),
  }).where(and(eq(swaps.id, existing.id), eq(swaps.approvalStatus, 'processing')));
  const transaction = await client.confirmInstantSwap(existing.user.subUserId, existing.quotationId);
  await commitConfirmedSwap(existing.id, transaction.id, transaction);
  return 'confirmed';
};
