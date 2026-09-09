/**
 * Failed/reversed swap recovery service.
 *
 * Restores customer funds through an idempotent account-version transaction
 * when a provider swap cannot complete.
 *
 * @module swapRecoveryService
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../../database';
import { accountVersions } from '../../../db/schema/account-version.schema';
import { swaps } from '../../../db/schema/swap.schema';
import { currencies } from '../../../db/schema/currency.schema';
import { wallets } from '../../../db/schema/wallet.schema';
import {
  addBalance,
  mutateWalletAndRecordVersion,
  type AccountVersionTransaction,
} from '../account-versions';

/** Provider failure or reversal event used to restore a swap. */
export interface SwapRecoveryPayload {
  /** Provider event name that determines the stored recovery event. */
  event: 'swap_transaction.failed' | 'swap_transaction.reversed';
  /** Provider transaction identity carried by the event. */
  data: { id: string };
}

/** Result discriminators for failed or reversed swap recovery. */
export type SwapRecoveryResult =
  | { outcome: 'restored' }
  | { outcome: 'duplicate' }
  | { outcome: 'reconciliation-required' };

type RecoveryEvent = 'failed' | 'reversed';
type StoredSwap = typeof swaps.$inferSelect;

/**
 * Maps a provider event name to the persisted recovery event value.
 *
 * @param event - Provider failure or reversal event name.
 * @returns The compact recovery event stored on the swap.
 */
const mapRecoveryEvent = (event: SwapRecoveryPayload['event']): RecoveryEvent =>
  event.endsWith('.reversed') ? 'reversed' : 'failed';

/**
 * Detects whether any settlement state makes direct fund restoration unsafe.
 *
 * @param swap - Locked swap row being recovered.
 * @returns True when custody or customer settlement has started.
 */
const hasSettlementStarted = (swap: StoredSwap): boolean => Boolean(
  swap.sweepId || swap.sweepReference || swap.swapStatus !== 'pending',
);

/**
 * Looks up whether execution was already recorded for the swap.
 *
 * @param tx - Transaction connection used for the lookup.
 * @param swapId - Internal swap identifier.
 * @returns True when a swap-complete account version exists.
 */
const hasRecordedExecution = async (
  tx: AccountVersionTransaction,
  swapId: string,
): Promise<boolean> => Boolean((await tx.select({ id: accountVersions.id }).from(accountVersions).where(and(
  eq(accountVersions.transactionType, 'swap'),
  eq(accountVersions.transactionId, swapId),
  eq(accountVersions.action, 'swap_complete'),
)).limit(1))[0]);

/**
 * Computes the locked balance after a safe recovery restoration.
 *
 * @param lockedBalance - Current locked wallet balance.
 * @param fromAmount - Original swap amount.
 * @param executionRecorded - Whether completion already consumed the lock.
 * @returns Nonnegative locked balance for the restore account version.
 * @throws If subtracting an uncompleted swap would make the locked balance negative.
 */
const computeRestoredLockedBalance = (
  lockedBalance: string,
  fromAmount: string,
  executionRecorded: boolean,
): string => {
  const restoredLockedBalance = executionRecorded
    ? lockedBalance
    : addBalance(lockedBalance, `-${fromAmount}`);
  if (restoredLockedBalance.startsWith('-')) throw new Error('Swap recovery wallet state is invalid');
  return restoredLockedBalance;
};

/**
 * Restores the wallet exactly once after a failed or reversed swap.
 *
 * @param payload - Provider recovery event and transaction identity.
 * @returns Whether funds were restored, the event was a duplicate, or reconciliation is required.
 * @throws If the target swap or wallet cannot be found or its state is invalid.
 * @sideEffects Locks the swap and wallet, then records one immutable restore version in a database transaction.
 */
export const recoverFailedOrReversedSwap = async (payload: SwapRecoveryPayload): Promise<SwapRecoveryResult> =>
  db.transaction(async (tx) => {
    const swap = (await tx.select().from(swaps).where(eq(swaps.swapTransactionId, payload.data.id))
      .for('update').limit(1))[0];
    if (!swap) throw new Error('Swap recovery target was not found');
    const recoveryEvent = mapRecoveryEvent(payload.event);
    if (swap.status === 'failed' && swap.recoveryEvent === recoveryEvent) return { outcome: 'duplicate' };

    const executionRecorded = await hasRecordedExecution(tx, swap.id);
    if (hasSettlementStarted(swap) || (executionRecorded && swap.status === 'success')) {
      await tx.update(swaps).set({ recoveryEvent, reconciliationRequired: true, updatedAt: new Date() })
        .where(eq(swaps.id, swap.id));
      return { outcome: 'reconciliation-required' };
    }

    if (swap.status !== 'pending' || swap.reconciliationRequired) return { outcome: 'duplicate' };
    await tx.update(swaps).set({
      status: 'failed', swapStatus: 'failed', recoveryEvent, updatedAt: new Date(),
    }).where(and(eq(swaps.id, swap.id), eq(swaps.status, 'pending')));

    const wallet = (await tx.select({
      id: wallets.id,
      balance: wallets.balance,
      lockedBalance: wallets.lockedBalance,
    }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
      eq(wallets.userId, swap.userId),
      eq(currencies.code, swap.fromCurrency.trim().toLowerCase()),
    )).for('update').limit(1))[0];
    if (!wallet) throw new Error('Swap recovery wallet state is invalid');

    const restoredLockedBalance = computeRestoredLockedBalance(
      wallet.lockedBalance,
      swap.fromAmount,
      executionRecorded,
    );
    await mutateWalletAndRecordVersion(tx, {
      walletId: wallet.id,
      transactionType: 'swap',
      transactionId: swap.id,
      action: 'swap_restore',
      amount: swap.fromAmount,
      balance: addBalance(wallet.balance, swap.fromAmount),
      lockedBalance: restoredLockedBalance,
    });
    return { outcome: 'restored' };
  });
