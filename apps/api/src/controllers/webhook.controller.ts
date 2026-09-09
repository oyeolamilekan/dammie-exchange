import { type Request, type Response } from 'express';
import asyncHandler from '../helpers/async-handler.helper';
import {
  creditDepositConfirmation,
  depositConfirmation,
  processFinalizeSwap,
  processSuccessSwap,
  processSwapRecovery,
} from '../jobs/event.job';
import {
  claimProviderEventForEnqueue,
  getQuidaxEventIdentity,
  persistProviderEvent,
  releaseProviderEventClaim,
} from '../queries/provider-event.query';
import type {
  DepositWebhookJobPayload,
  SuccessfulSwapJobPayload,
  SuccessfulWithdrawJobPayload,
  SwapRecoveryJobPayload,
} from '../jobs/queue-registry.job';

/**
 * Quidax webhook ingestion controller.
 *
 * The handler persists an event identity before enqueueing work, claims each
 * event conditionally, and releases the claim when queue submission fails.
 * This makes provider retries idempotent while allowing failed enqueue attempts
 * to be retried.
 *
 * @module webhookController
 */

/** Minimum provider webhook shape accepted by the controller. */
type ProviderWebhookPayload = {
  event: string;
  data: { id: string; [key: string]: unknown };
};

/** Queue adapter for one provider event type. @internal */
type EnqueueWebhook = (
  data: ProviderWebhookPayload,
  correlationId?: string,
) => Promise<void>;

/** Narrows a provider payload to a deposit queue payload. @internal */
const asDepositPayload = (data: ProviderWebhookPayload): DepositWebhookJobPayload =>
  data as unknown as DepositWebhookJobPayload;

/** Narrows a provider payload to a successful-swap queue payload. @internal */
const asSuccessfulSwapPayload = (data: ProviderWebhookPayload): SuccessfulSwapJobPayload =>
  data as unknown as SuccessfulSwapJobPayload;

/** Narrows a provider payload to a successful-withdrawal queue payload. @internal */
const asSuccessfulWithdrawPayload = (data: ProviderWebhookPayload): SuccessfulWithdrawJobPayload =>
  data as unknown as SuccessfulWithdrawJobPayload;

/** Narrows a provider payload to a swap-recovery queue payload. @internal */
const asRecoveryPayload = (data: ProviderWebhookPayload): SwapRecoveryJobPayload =>
  data as unknown as SwapRecoveryJobPayload;

/** Explicit provider-event to queue mapping; aliases are retained for webhook compatibility. */
export const enqueueByEvent: Record<string, EnqueueWebhook> = {
  'deposit.transaction.confirmation': (data, correlationId) =>
    depositConfirmation(asDepositPayload(data), correlationId),
  'deposit.successful': (data, correlationId) =>
    creditDepositConfirmation(asDepositPayload(data), correlationId),
  'swap_transaction.completed': (data, correlationId) =>
    processSuccessSwap(asSuccessfulSwapPayload(data), correlationId),
  'swap_transaction.complete': (data, correlationId) =>
    processSuccessSwap(asSuccessfulSwapPayload(data), correlationId),
  'swap_transaction.failed': (data, correlationId) =>
    processSwapRecovery(asRecoveryPayload(data), correlationId),
  'swap_transaction.reversed': (data, correlationId) =>
    processSwapRecovery(asRecoveryPayload(data), correlationId),
  'withdraw.successful': (data, correlationId) =>
    processFinalizeSwap(asSuccessfulWithdrawPayload(data), correlationId),
  'withdraw.rejected': (data, correlationId) =>
    processFinalizeSwap(asSuccessfulWithdrawPayload(data), correlationId),
};

/**
 * Persists and conditionally enqueues a supported Quidax webhook.
 *
 * Unknown events, already-succeeded events, and duplicate claims are
 * acknowledged with HTTP 200 so the provider does not retry them indefinitely.
 *
 * Route: `POST /webhooks/crypto`.
 */
export const cryptoWebhookController = asyncHandler(async (req: Request, res: Response) => {
  const data = req.body;
  const identity = getQuidaxEventIdentity(data);
  const event = await persistProviderEvent(identity);
  const enqueue = enqueueByEvent[identity.eventType];

  if (!enqueue || event?.status === 'succeeded') {
    return res.status(200).json({});
  }

  const claimed = await claimProviderEventForEnqueue(identity.correlationId);
  if (!claimed) return res.status(200).json({});

  try {
    await enqueue(data as ProviderWebhookPayload, identity.correlationId);
  } catch (error: unknown) {
    await releaseProviderEventClaim(identity.correlationId);
    throw error;
  }

  return res.status(200).json({});
});
