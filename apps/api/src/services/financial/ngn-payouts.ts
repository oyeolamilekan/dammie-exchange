/**
 * NGN provider-payout orchestration services.
 *
 * Approved withdrawals are reconciled against existing provider records before
 * a new payout is created, and webhook outcomes settle or restore local funds.
 *
 * @module ngnPayoutService
 */

import CONFIG from '../../config/config';
import { findWithdrawalByProviderId } from './withdrawals';
import {
  claimApprovedNgnWithdrawal,
  completeNgnWithdrawal,
  findNgnWithdrawalOwner,
  restoreNgnWithdrawal,
  saveNgnProviderWithdrawal,
} from './ngn-withdrawals';
import { validateNgnPayoutRecord, type VerifiedWithdrawalRecord } from './provider-verification';
import {
  QuidaxWithdrawalNotFoundError,
  type QuidaxClient,
} from '../integrations/quidax';
import Logging from '../../library/logging.utils';

/** Minimal provider operations required by the payout workflow. @internal */
type PayoutClient = Pick<QuidaxClient, 'createWithdrawal' | 'findWithdrawalByReference'>;

/** Options controlling recovery when a provider withdrawal is absent. */
export interface ProcessApprovedNgnWithdrawalOptions {
  cancelMissingProviderWithdrawal?: boolean;
}

const requireMainAccountId = (): string => {
  if (!CONFIG.MAIN_ACCOUNT_ID?.trim()) throw new Error('MAIN_ACCOUNT_ID is required for NGN withdrawals');
  return CONFIG.MAIN_ACCOUNT_ID.trim();
};

const applyProviderRecord = async (
  withdrawalId: string,
  record: VerifiedWithdrawalRecord,
  responseStage: 'payoutCreation' | 'payoutVerification',
) => {
  await saveNgnProviderWithdrawal(withdrawalId, record.id, record.fee, record, responseStage);
  if (record.status === 'done') return completeNgnWithdrawal(withdrawalId, record.fee);
  if (record.status === 'rejected' || record.status === 'failed') {
    return restoreNgnWithdrawal(withdrawalId, record.fee, record.reason ?? undefined);
  }
  return null;
};

/** Reconciles first, then creates at most one provider payout for an approved withdrawal. */
export const processApprovedNgnWithdrawal = async (
  withdrawalId: string,
  client: PayoutClient,
  options: ProcessApprovedNgnWithdrawalOptions = {},
): Promise<'processing' | 'success' | 'failed' | 'duplicate'> => {
  const withdrawal = await claimApprovedNgnWithdrawal(withdrawalId);
  if (!withdrawal) throw new Error('NGN withdrawal is not approved');
  if (withdrawal.status === 'success' || withdrawal.status === 'failed') return 'duplicate';
  const hasBankSnapshot = Boolean(
    withdrawal.bankId && withdrawal.accountNumber && withdrawal.accountName
      && withdrawal.bankCode && withdrawal.approvedAt,
  );
  if (!hasBankSnapshot && !options.cancelMissingProviderWithdrawal) {
    throw new Error('NGN withdrawal bank snapshot is missing');
  }
  const expectedOwnerId = requireMainAccountId();
  let reconciled;
  try {
    reconciled = options.cancelMissingProviderWithdrawal
      ? await client.findWithdrawalByReference(
        'me', withdrawal.reference, 'ngn', { surfaceMissingWithdrawal: true },
      )
      : await client.findWithdrawalByReference('me', withdrawal.reference, 'ngn');
  } catch (error: unknown) {
    if (!(options.cancelMissingProviderWithdrawal && error instanceof QuidaxWithdrawalNotFoundError)) {
      throw error;
    }
    const restored = await restoreNgnWithdrawal(
      withdrawal.id,
      withdrawal.providerFee ?? '0',
      error.message,
      error.providerResponse,
    );
    if (!restored) throw new Error('NGN withdrawal settlement state is missing');
    return restored.changed ? 'failed' : 'duplicate';
  }
  if (!hasBankSnapshot) throw new Error('NGN withdrawal bank snapshot is missing');
  let record: VerifiedWithdrawalRecord;
  if (reconciled) {
    record = validateNgnPayoutRecord(reconciled, {
      reference: withdrawal.reference,
      expectedAmount: withdrawal.amount,
      expectedOwnerId,
      expectedId: withdrawal.providerWithdrawalId ?? undefined,
    });
  } else {
    if (withdrawal.providerWithdrawalId) {
      throw new Error('Existing NGN provider withdrawal requires reconciliation');
    }
    const created = await client.createWithdrawal('me', {
      currency: 'NGN',
      amount: withdrawal.amount,
      fund_uid: withdrawal.accountNumber,
      fund_uid2: withdrawal.bankCode,
      reference: withdrawal.reference,
      transaction_note: `Dammie withdrawal ${withdrawal.id}`,
      narration: 'Dammie NGN payout',
    });

    Logging.info(created)
    record = validateNgnPayoutRecord(created, {
      reference: withdrawal.reference,
      expectedAmount: withdrawal.amount,
      expectedOwnerId,
    });
  }
  const settled = await applyProviderRecord(withdrawal.id, record, reconciled ? 'payoutVerification' : 'payoutCreation');
  if (record.status === 'done') return settled?.changed === false ? 'duplicate' : 'success';
  if (record.status === 'rejected' || record.status === 'failed') {
    return settled?.changed === false ? 'duplicate' : 'failed';
  }
  return 'processing';
};

/** Verifies and settles a customer-payout webhook by provider ID. */
export const settleNgnPayoutWebhook = async (
  providerWithdrawalId: string,
  event: 'withdraw.successful' | 'withdraw.rejected',
  client: Pick<QuidaxClient, 'findWithdrawalByReference'>,
) => {
  const withdrawal = await findWithdrawalByProviderId(providerWithdrawalId);
  if (!withdrawal) return null;
  const expectedOwnerId = requireMainAccountId();
  const provider = await client.findWithdrawalByReference('me', withdrawal.reference, 'ngn');
  const record = validateNgnPayoutRecord(provider, {
    reference: withdrawal.reference,
    expectedAmount: withdrawal.amount,
    expectedOwnerId,
    expectedId: providerWithdrawalId,
  });
  const expectedStatuses = event === 'withdraw.successful' ? ['done'] : ['rejected', 'failed'];
  if (!expectedStatuses.includes(record.status)) {
    throw new Error(`Quidax NGN payout webhook status mismatch: ${record.status}`);
  }
  const settlement = await applyProviderRecord(withdrawal.id, record, 'payoutVerification');
  const owner = await findNgnWithdrawalOwner(withdrawal.id);
  if (!owner || !settlement) throw new Error('NGN withdrawal settlement state is missing');
  return {
    ...settlement,
    chatId: owner.chatId,
    bankName: owner.bankName,
    status: record.status,
  };
};
