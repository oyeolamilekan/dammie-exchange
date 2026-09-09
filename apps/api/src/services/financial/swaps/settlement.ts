/**
 * Completed-swap and custody-sweep settlement orchestration.
 *
 * Verifies provider callbacks, claims settlement work, persists sweep state,
 * and coordinates recovery/reconciliation outcomes.
 *
 * @module swapSettlementService
 */

import { findSwap } from '../../../queries/swap.query';
import { buildExecutionDetails } from './settlement-values';
import {
  commitVerifiedExecutionAndClaimSweep,
  creditSuccessfulCustodySweep,
  markSwapAsReconciliationRequired,
  persistCreatedSweepWithdrawal,
  persistReconciledSweepWithdrawal,
} from './settlement-store';
import { assertReconciledWithdrawal, verifySwap } from '../provider-verification';
import { recoverFailedOrReversedSwap } from './recovery';
import type { QuidaxClient } from '../../integrations/quidax';

/** Provider operations used by the custody-sweep workflow. */
export type SettlementQuidaxClient = Pick<
  QuidaxClient,
  'createWithdrawal' | 'findWithdrawalByReference' | 'findSwapTransactionById'
>;

/** Provider webhook payload for a completed swap transaction. */
export interface CompletedSwapPayload {
  /** Provider swap transaction identifier. */
  id: string;
  /** Gross received amount reported by the webhook. */
  received_amount?: string | number;
  /** Optional execution price reported by the webhook. */
  execution_price?: string | number;
  /** Legacy execution-price field accepted by the webhook contract. */
  price?: string | number;
  /** Optional provider completion timestamp. */
  completed_at?: string | Date;
}

/**
 * Reconciles or creates the custody sweep for a completed provider swap.
 *
 * @param payload - Completed-swap provider webhook payload.
 * @param client - Provider withdrawal and mandatory transaction-verification operations.
 * @param mainAccountId - Provider custody account receiving the sweep.
 * @returns Whether the sweep was created, reconciled, duplicated, or requires reconciliation.
 * @throws If the swap is missing, provider verification fails, totals are invalid, or an existing provider operation cannot be reconciled.
 * @sideEffects Provider calls remain outside database transactions; wallet execution and sweep claiming are committed atomically.
 */
export const processCompletedSwapWithdrawal = async (
  payload: CompletedSwapPayload,
  client: SettlementQuidaxClient,
  mainAccountId: string,
): Promise<'created' | 'reconciled' | 'duplicate' | 'reconciliation-required' | 'restored'> => {
  const swap = await findSwap({ swapTransactionId: payload.id });
  if (!swap) throw new Error('Completed swap target was not found');
  const verified = await verifySwap(client, payload.id, swap);
  if (verified.status === 'failed' || verified.status === 'reversed') {
    const result = await recoverFailedOrReversedSwap({
      event: verified.status === 'reversed' ? 'swap_transaction.reversed' : 'swap_transaction.failed',
      data: { id: verified.id },
    });
    return result.outcome;
  }
  if (verified.status !== 'completed') throw new Error(`Quidax swap is not completed: ${verified.status}`);
  const execution = buildExecutionDetails(verified);
  if (swap.status === 'failed' || swap.recoveryEvent || swap.reconciliationRequired) {
    await markSwapAsReconciliationRequired(swap.id);
    return 'reconciliation-required';
  }

  if (swap.swapStatus === 'processing' && swap.sweepReference) {
  const reconciled = await client.findWithdrawalByReference(
      swap.user.subUserId,
      swap.sweepReference,
      'ngn',
    );
    if (!reconciled) throw new Error('Sweep withdrawal requires reconciliation');
    assertReconciledWithdrawal(reconciled, swap.sweepReference);
    await persistReconciledSweepWithdrawal(swap.id, reconciled.id, reconciled);
    return 'reconciled';
  }

  const claim = await commitVerifiedExecutionAndClaimSweep(
    swap.id,
    execution,
    verified,
  );
  if (claim.outcome === 'reconciliation-required') return 'reconciliation-required';
  if (claim.outcome === 'duplicate' && !claim.reference) return 'duplicate';
  const reference = claim.reference || `dammie-sweep-${swap.id}`;
  if (claim.outcome === 'duplicate' && swap.sweepId) return 'duplicate';
  if (claim.outcome === 'processing') {
    const reconciled = await client.findWithdrawalByReference(swap.user.subUserId, reference, 'ngn');
    if (!reconciled) throw new Error('Sweep withdrawal requires reconciliation');
    assertReconciledWithdrawal(reconciled, reference);
    await persistReconciledSweepWithdrawal(swap.id, reconciled.id, reconciled);
    return 'reconciled';
  }

  const withdrawal = await client.createWithdrawal(swap.user.subUserId, {
    amount: claim.gross,
    currency: 'ngn',
    fund_uid: mainAccountId,
    reference,
  });
  const persisted = await persistCreatedSweepWithdrawal(swap.id, reference, withdrawal.id, withdrawal);
  return persisted ? 'created' : 'duplicate';
};

/**
 * Applies the user-facing NGN credit after a custody withdrawal is verified.
 *
 * @param sweepId - Verified provider withdrawal identifier stored on the swap.
 * @returns Whether the gross proceeds were newly credited.
 * @sideEffects Atomically credits the fiat wallet and completes the swap.
 */
export const finalizeSuccessfulCustodySweep = (
  sweepId: string,
  providerResponse?: unknown,
): Promise<{ credited: boolean; amount: string }> => creditSuccessfulCustodySweep(sweepId, providerResponse);
