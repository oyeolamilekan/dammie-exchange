/**
 * Transactional custody-sweep settlement store.
 *
 * Owns idempotent claims, provider-response persistence, account-version
 * settlement, and reconciliation-required state for completed swaps.
 *
 * @module swapSettlementStore
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../database';
import { accountVersions } from '../../../db/schema/account-version.schema';
import { swaps } from '../../../db/schema/swap.schema';
import { currencies } from '../../../db/schema/currency.schema';
import { wallets } from '../../../db/schema/wallet.schema';
import {
  addBalance,
  mutateWalletAndRecordVersion,
} from '../account-versions';
import {
  type ExecutionDetails,
  validatePositiveProviderValue,
} from './settlement-values';
import { standardDecimal } from '../../../utils/decimal';
import { appendProviderResponse } from '../../../utils/provider-response';
import {
  calculateNetPlatformProceeds,
  calculatePlatformFeeFromSnapshot,
  feeConsumesProceeds,
} from '../platform-fees';

/** Outcome of claiming or observing the custody-sweep state. */
export type SweepClaimOutcome = 'claimed' | 'processing' | 'duplicate' | 'reconciliation-required';

const feeSnapshotForSwap = (swap: typeof swaps.$inferSelect) => swap.platformFeeId && swap.platformFeeType
  && swap.platformFeeConfiguredAmount !== null
  ? {
    platformFeeId: swap.platformFeeId,
    platformFeeType: swap.platformFeeType,
    platformFeeConfiguredAmount: swap.platformFeeConfiguredAmount,
    platformFeeMinimumFee: swap.platformFeeMinimumFee,
    platformFeeMaximumFee: swap.platformFeeMaximumFee,
  }
  : null;

/**
 * Marks a swap as requiring operator/provider reconciliation.
 *
 * @param swapId - Internal swap identifier whose state is unsafe to continue.
 * @returns True when this call newly set the reconciliation flag, otherwise false.
 * @sideEffects Updates only the reconciliation flag and timestamp; it never restores funds.
 */
export const markSwapAsReconciliationRequired = async (swapId: string): Promise<boolean> => {
  const updated = await db.update(swaps).set({
    reconciliationRequired: true,
    updatedAt: new Date(),
  }).where(and(
    eq(swaps.id, swapId),
    eq(swaps.reconciliationRequired, false),
  )).returning({ id: swaps.id });
  return updated.length > 0;
};

/**
 * Commits verified swap execution and claims the custody sweep atomically.
 *
 * @param swapId - Internal swap identifier to settle.
 * @param details - Verified execution amount, price candidate, and completion time.
 * @returns Claim state plus the gross amount and deterministic sweep reference.
 * @throws If the swap, wallet, locked balance, or execution amount is invalid.
 * @sideEffects Records the immutable swap-complete version, updates execution fields, and claims the sweep in one transaction.
 */
export const commitVerifiedExecutionAndClaimSweep = async (
  swapId: string,
  details: ExecutionDetails,
  providerResponse?: unknown,
): Promise<{ outcome: SweepClaimOutcome; gross: string; reference?: string }> =>
  db.transaction(async (tx) => {
    const swap = (await tx.select().from(swaps).where(eq(swaps.id, swapId)).for('update').limit(1))[0];
    if (!swap) throw new Error('Completed swap target was not found');
    if (swap.reconciliationRequired || swap.recoveryEvent) {
      return { outcome: 'reconciliation-required', gross: swap.executedReceivedAmount ?? details.gross };
    }
    if (swap.sweepId) return { outcome: 'duplicate', gross: swap.executedReceivedAmount ?? details.gross };
    if (swap.swapStatus === 'processing' && swap.sweepReference) {
      return {
        outcome: 'processing',
        gross: swap.executedReceivedAmount ?? details.gross,
        reference: swap.sweepReference,
      };
    }

    let gross = swap.executedReceivedAmount ?? details.gross;
    if (swap.executedReceivedAmount && standardDecimal(swap.executedReceivedAmount) !== standardDecimal(details.gross)) {
      throw new Error('Verified completed swap amount changed during retry');
    }
    const execution = (await tx.select({ id: accountVersions.id }).from(accountVersions).where(and(
      eq(accountVersions.transactionType, 'swap'),
      eq(accountVersions.transactionId, swap.id),
      eq(accountVersions.action, 'swap_complete'),
    )).limit(1))[0];
    if (!execution) {
      const wallet = (await tx.select({
        id: wallets.id,
        balance: wallets.balance,
        lockedBalance: wallets.lockedBalance,
      }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
        eq(wallets.userId, swap.userId),
        eq(currencies.code, swap.fromCurrency.trim().toLowerCase()),
      )).for('update').limit(1))[0];
      if (!wallet) throw new Error('Completed swap wallet state is invalid');
      const lockedAfter = addBalance(wallet.lockedBalance, `-${swap.fromAmount}`);
      if (lockedAfter.startsWith('-')) throw new Error('Completed swap locked balance is invalid');
      await mutateWalletAndRecordVersion(tx, {
        walletId: wallet.id,
        transactionType: 'swap',
        transactionId: swap.id,
        action: 'swap_complete',
        amount: swap.fromAmount,
        balance: wallet.balance,
        lockedBalance: lockedAfter,
      });
      const price = details.price === undefined || details.price === null
        ? swap.quotedPrice
        : validatePositiveProviderValue(details.price, 'Execution price');
      const platformFeeAmount = calculatePlatformFeeFromSnapshot(
        gross,
        feeSnapshotForSwap(swap),
        swap.toCurrency,
      );
      const netToAmount = feeConsumesProceeds(gross, platformFeeAmount)
        ? '0'
        : calculateNetPlatformProceeds(gross, platformFeeAmount);
      await tx.update(swaps).set({
        executedReceivedAmount: gross,
        grossToAmount: gross,
        platformFeeAmount,
        executionPrice: price,
        completedAt: details.completedAt,
        toAmount: netToAmount,
        ...(providerResponse === undefined ? {} : {
          providerResponse: appendProviderResponse(swap.providerResponse, 'execution', providerResponse),
        }),
        ...(feeConsumesProceeds(gross, platformFeeAmount) ? { reconciliationRequired: true } : {}),
        updatedAt: new Date(),
      }).where(eq(swaps.id, swap.id));
      if (feeConsumesProceeds(gross, platformFeeAmount)) {
        return { outcome: 'reconciliation-required', gross };
      }
    } else {
      gross = swap.executedReceivedAmount ?? details.gross;
    }

    const reference = swap.sweepReference || `dammie-sweep-${swap.id}`;
    await tx.update(swaps).set({
      swapStatus: 'processing',
      sweepReference: reference,
      updatedAt: new Date(),
    }).where(and(eq(swaps.id, swap.id), isNull(swaps.sweepId)));
    return { outcome: 'claimed', gross, reference };
  });

/**
 * Persists a provider withdrawal found while reconciling a processing sweep.
 *
 * @param swapId - Internal swap identifier.
 * @param withdrawalId - Existing provider custody-withdrawal identifier.
 * @returns A promise that resolves after the conditional state update.
 * @sideEffects Moves the custody sweep from processing to success only when it has no stored sweep id.
 */
export const persistReconciledSweepWithdrawal = async (
  swapId: string,
  withdrawalId: string,
  providerResponse?: unknown,
): Promise<void> => {
  await db.transaction(async (tx) => {
    const current = (await tx.select().from(swaps).where(and(
      eq(swaps.id, swapId), eq(swaps.swapStatus, 'processing'), isNull(swaps.sweepId),
    )).for('update').limit(1))[0];
    if (!current) return;
    await tx.update(swaps).set({
      swapStatus: 'success',
      sweepId: withdrawalId,
      ...(providerResponse === undefined ? {} : {
        providerResponse: appendProviderResponse(current.providerResponse, 'custodyWithdrawalVerification', providerResponse),
      }),
      updatedAt: new Date(),
    }).where(eq(swaps.id, swapId));
  });
};

/**
 * Credits the user's fiat wallet after the custody sweep is verified successful.
 *
 * @param sweepId - Provider withdrawal identifier for the completed custody sweep.
 * @returns Whether this call applied a new NGN credit and the exact credited amount.
 * @throws If the swap or its non-crypto destination wallet is invalid.
 * @sideEffects Credits the destination wallet, records an immutable account version,
 * and marks the swap successful in one transaction.
 */
export const creditSuccessfulCustodySweep = async (
  sweepId: string,
  providerResponse?: unknown,
): Promise<{ credited: boolean; amount: string }> => db.transaction(async (tx) => {
  const swap = (await tx.select().from(swaps).where(eq(swaps.sweepId, sweepId))
    .for('update').limit(1))[0];
  if (!swap) throw new Error('Successful custody sweep target was not found');
  if (!swap.executedReceivedAmount) throw new Error('Successful custody sweep amount is invalid');
  if (swap.status === 'success') {
    return { credited: false, amount: standardDecimal(swap.toAmount) };
  }
  if (swap.reconciliationRequired) {
    return { credited: false, amount: '0' };
  }
  if (swap.status !== 'pending' || swap.swapStatus !== 'success') {
    throw new Error('Successful custody sweep state is invalid');
  }

  const wallet = (await tx.select({
    id: wallets.id,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
    isCrypto: currencies.isCrypto,
  }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
    eq(wallets.userId, swap.userId),
    eq(currencies.code, swap.toCurrency.trim().toLowerCase()),
  )).for('update').limit(1))[0];
  if (!wallet || wallet.isCrypto) throw new Error('Successful custody sweep wallet state is invalid');

  const gross = validatePositiveProviderValue(swap.executedReceivedAmount, 'Custody sweep amount');
  const platformFeeAmount = calculatePlatformFeeFromSnapshot(
    gross,
    feeSnapshotForSwap(swap),
    swap.toCurrency,
  );
  if (feeConsumesProceeds(gross, platformFeeAmount)) {
    await tx.update(swaps).set({
      reconciliationRequired: true,
      ...(providerResponse === undefined ? {} : {
        providerResponse: appendProviderResponse(swap.providerResponse, 'custodyWithdrawalVerification', providerResponse),
      }),
      updatedAt: new Date(),
    })
      .where(eq(swaps.id, swap.id));
    return { credited: false, amount: '0' };
  }
  const amount = validatePositiveProviderValue(
    calculateNetPlatformProceeds(gross, platformFeeAmount),
    'Customer swap proceeds',
  );
  await mutateWalletAndRecordVersion(tx, {
    walletId: wallet.id,
    transactionType: 'swap',
    transactionId: swap.id,
    action: 'swap_credit',
    amount,
    balance: addBalance(wallet.balance, amount),
    lockedBalance: wallet.lockedBalance,
  });
  const updated = await tx.update(swaps).set({
    status: 'success',
    ...(providerResponse === undefined ? {} : {
      providerResponse: appendProviderResponse(swap.providerResponse, 'custodyWithdrawalVerification', providerResponse),
    }),
    updatedAt: new Date(),
  }).where(and(eq(swaps.id, swap.id), eq(swaps.status, 'pending'))).returning({ id: swaps.id });
  if (!updated.length) throw new Error('Successful custody sweep state changed during credit');
  return { credited: true, amount };
});

/**
 * Conditionally persists a newly created custody sweep withdrawal.
 *
 * @param swapId - Internal swap identifier.
 * @param reference - Deterministic custody sweep reference.
 * @param withdrawalId - Provider custody-withdrawal identifier.
 * @returns True when this call recorded the provider withdrawal, false for a concurrent duplicate.
 * @sideEffects Moves the custody sweep from processing to success without creating an account version.
 */
export const persistCreatedSweepWithdrawal = async (
  swapId: string,
  reference: string,
  withdrawalId: string,
  providerResponse?: unknown,
): Promise<boolean> => {
  return db.transaction(async (tx) => {
    const current = (await tx.select().from(swaps).where(and(
      eq(swaps.id, swapId),
      eq(swaps.swapStatus, 'processing'),
      eq(swaps.sweepReference, reference),
      isNull(swaps.sweepId),
    )).for('update').limit(1))[0];
    if (!current) return false;
    await tx.update(swaps).set({
      swapStatus: 'success',
      sweepId: withdrawalId,
      ...(providerResponse === undefined ? {} : {
        providerResponse: appendProviderResponse(current.providerResponse, 'custodyWithdrawal', providerResponse),
      }),
      updatedAt: new Date(),
    }).where(eq(swaps.id, swapId));
    return true;
  });
};
