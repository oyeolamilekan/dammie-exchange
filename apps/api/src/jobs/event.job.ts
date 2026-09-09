import type Bull from 'bull';
import Logging from '../library/logging.utils';
import {
  queueRegistry,
  type CreateWalletJobPayload,
  type DepositWebhookJobPayload,
  type SuccessfulSwapJobPayload,
  type SuccessfulWithdrawJobPayload,
  type SwapApprovalJobPayload,
  type SwapRecoveryJobPayload,
  type NgnWithdrawalJobPayload,
  type WalletAddressAssignmentJobPayload,
} from './queue-registry.job';
import { QUEUE_NAMES } from './queueNames.job';

/**
 * Job-producer helpers used by HTTP handlers, webhooks, and financial services.
 *
 * Provider-event jobs use the correlation ID as a Bull job ID and retry with
 * exponential backoff. Customer approval jobs use a deterministic ID so
 * repeated approvals do not enqueue duplicate work.
 *
 * @module eventJobs
 */

/** Shared retry and cleanup options for provider webhook jobs. @internal */
const webhookJobOptions = (correlationId?: string): Bull.JobOptions => ({
  ...(correlationId ? { jobId: correlationId } : {}),
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: true,
  removeOnFail: true,
});

/** Enqueues wallet provisioning for a newly registered user. */
export const createWalletJob = async (data: CreateWalletJobPayload): Promise<void> => {
  Logging.info(`Creating wallet for user: ${data.userId}`);
  await queueRegistry.enqueue(QUEUE_NAMES.CREATE_WALLET, data);
};

/** Enqueues a provider wallet-address assignment job. */
export const assignWalletAddress = async (
  data: WalletAddressAssignmentJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.ASSIGN_WALLET_ADDRESS,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues a provider deposit-confirmation job. */
export const depositConfirmation = async (
  data: DepositWebhookJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.DEPOSIT_CONFIRMATION,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues a successful-deposit credit/notification job. */
export const creditDepositConfirmation = async (
  data: DepositWebhookJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.DEPOSIT_SUCCESSFUL,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues processing for a customer-approved swap. */
export const processSwap = async (data: SwapApprovalJobPayload): Promise<void> => {
  await queueRegistry.enqueue(QUEUE_NAMES.PENDING_SWAP, data, {
    jobId: `swap-approval:${data.id}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
};

/** Enqueues settlement processing for a successful provider swap event. */
export const processSuccessSwap = async (
  data: SuccessfulSwapJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.SUCCESSFUL_SWAP,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues finalization for a successful or rejected provider withdrawal event. */
export const processFinalizeSwap = async (
  data: SuccessfulWithdrawJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.FINALIZE_SWAP,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues recovery processing for a failed or reversed swap event. */
export const processSwapRecovery = async (
  data: SwapRecoveryJobPayload,
  correlationId?: string,
): Promise<void> => {
  await queueRegistry.enqueue(
    QUEUE_NAMES.SWAP_RECOVERY,
    data,
    webhookJobOptions(correlationId),
  );
};

/** Enqueues processing for a customer-approved NGN withdrawal. */
export const processNgnWithdrawal = async (data: NgnWithdrawalJobPayload): Promise<void> => {
  await queueRegistry.enqueue(QUEUE_NAMES.PENDING_WITHDRAWAL, data, {
    jobId: `ngn-withdrawal:${data.id}`,
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
};
