import type Bull from 'bull';
import CONFIG from '../../config/config';
import Logging from '../../library/logging.utils';
import { telegramClient } from '../../plugins/bot';
import { findSwap } from '../../queries/swap.query';
import { processCompletedSwapWithdrawal } from '../../services/financial/swaps/settlement';
import { quidax } from '../../services/integrations/quidax';
import { sendTelegramNotification } from '../../services/telegram/notifications';
import type { SuccessfulSwapJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Successful provider-swap settlement worker.
 *
 * @module successfulSwapWorker
 */

/**
 * Registers the worker that settles completed swaps, starts custody sweeps,
 * and notifies the owner of completion or required operations review.
 */
export const initializeSuccessfulSwapWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.SUCCESSFUL_SWAP);
  await initializeWorker(queue, 'Successful Swap', async (job: Bull.Job<SuccessfulSwapJobPayload>) => {
    try {
      const { id } = job.data.data;
      const swap = await findSwap({ swapTransactionId: id });
      if (!swap) {
        Logging.info(`Swap not found for transactionId: ${id}`);
        return;
      }

      const outcome = await processCompletedSwapWithdrawal(
        job.data.data,
        quidax,
        CONFIG.MAIN_ACCOUNT_ID,
      );
      if (outcome === 'created' || outcome === 'reconciled') {
        await sendTelegramNotification(
          telegramClient,
          swap.user.chatId,
          '✅ Your swap is complete! Your NGN wallet will be credited after custody confirmation. 🚀',
        );
      }
      if (outcome === 'reconciliation-required') {
        await sendTelegramNotification(
          telegramClient,
          swap.user.chatId,
          '⚠️ Your swap needs an operations review before the NGN proceeds can be credited.',
        );
      }
      Logging.info(`Successful swap processed for transactionId: ${id}`);
    } catch (error: unknown) {
      Logging.error(`Successful swap processing failed: ${error}`);
      throw error;
    }
  });
};
