import type Bull from 'bull';
import Logging from '../../library/logging.utils';
import { processApprovedSwap } from '../../services/financial/swaps/approval';
import { quidax } from '../../services/integrations/quidax';
import type { SwapApprovalJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Approved-swap processing worker.
 *
 * @module pendingSwapWorker
 */

/** Registers the worker that refreshes, confirms, and locks approved swaps. */
export const initializePendingSwapWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.PENDING_SWAP);
  await initializeWorker(queue, 'Pending Swap', async (job: Bull.Job<SwapApprovalJobPayload>) => {
    try {
      await processApprovedSwap(job.data.id, quidax);
      Logging.info(`Approved swap processed for id: ${job.data.id}`);
    } catch (error: unknown) {
      Logging.error(`Pending swap processing failed: ${error}`);
      throw error;
    }
  });
};
