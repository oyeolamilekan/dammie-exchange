import type Bull from 'bull';
import { MESSAGES } from '../../helpers/messages';
import Logging from '../../library/logging.utils';
import { telegramClient } from '../../plugins/bot';
import { quidax } from '../../services/integrations/quidax';
import { sendTelegramNotification } from '../../services/telegram/notifications';
import { provisionUserWallets } from '../../services/users/register';
import {
  type CreateWalletJobPayload,
} from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Wallet provisioning worker.
 *
 * @module createWalletWorker
 */

/**
 * Registers the worker that creates provider wallets and their network
 * addresses, then notifies the customer as addresses become available.
 */
export const initializeCreateWalletWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.CREATE_WALLET);
  await initializeWorker(queue, 'Wallet Creation', async (job: Bull.Job<CreateWalletJobPayload>) => {
    try {
      const { email } = job.data;
      const results = await provisionUserWallets(job.data, {
        quidax,
        onAddressAssigned: async ({ chatId, address, currency, network }) => {
          await sendTelegramNotification(
            telegramClient,
            chatId,
            MESSAGES.ADDRESS_ASSIGNED(
              address,
              currency.toUpperCase(),
              network.toUpperCase(),
            ),
          );
        },
      });
      for (const result of results) {
        if ('error' in result) {
          Logging.error(`Failed to create wallet for ${result.currency}: ${result.error}`);
          continue;
        }
        Logging.info(
          `${email} ${result.currency} wallet ${result.created ? 'created' : 'updated'} with ${result.networks.length} network addresses`,
        );
      }
      return results.map((result) => {
        if ('error' in result) {
          const { error: _error, ...summary } = result;
          return summary;
        }
        return result;
      });
    } catch (error: unknown) {
      Logging.error(`Wallet creation failed - Attempt ${job.attemptsMade} for job ${job.id}: ${error}`);
      throw error;
    }
  });
};
