import type Bull from 'bull';
import Logging from '../../library/logging.utils';
import CONFIG from '../../config/config';
import { quidax } from '../../services/integrations/quidax';
import { processCompletedSwapWithdrawal } from '../../services/financial/swaps/settlement';
import type { SwapRecoveryJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Failed/reversed swap recovery worker.
 *
 * @module swapRecoveryWorker
 */

/** Registers the worker that restores safe failed or reversed swaps. */
export const initializeSwapRecoveryWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.SWAP_RECOVERY);
  await initializeWorker(queue, 'Swap Recovery', async (job: Bull.Job<SwapRecoveryJobPayload>) => {
    const result = await processCompletedSwapWithdrawal({ id: job.data.data.id }, quidax, CONFIG.MAIN_ACCOUNT_ID);
    Logging.info(`Swap recovery ${result} for event id: ${job.data.data.id}`);
    return result;
  });
};
