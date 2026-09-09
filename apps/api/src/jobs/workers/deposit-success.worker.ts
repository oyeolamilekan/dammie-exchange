import type Bull from 'bull';
import { MESSAGES } from '../../helpers/messages';
import Logging from '../../library/logging.utils';
import { telegramClient } from '../../plugins/bot';
import { creditSuccessfulDeposit, recordDepositConfirmation } from '../../services/financial/deposits';
import { sendTelegramNotification } from '../../services/telegram/notifications';
import { verifyDeposit } from '../../services/financial/provider-verification';
import { quidax } from '../../services/integrations/quidax';
import type { DepositWebhookJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Successful-deposit credit worker.
 *
 * @module depositSuccessWorker
 */

/**
 * Registers the worker that re-verifies provider deposits, atomically credits
 * accepted deposits, records pending states, and notifies the owner.
 */
export const initializeDepositSuccessWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.DEPOSIT_SUCCESSFUL);
  await initializeWorker(queue, 'Deposit Success', async (job: Bull.Job<DepositWebhookJobPayload>) => {
    const { id, user } = job.data.data;
    try {
      const verified = await verifyDeposit(quidax, id, user.id);
      const { amount, currency, payment_address: paymentAddress, txid } = verified;
      const accepted = verified.status === 'accepted';
      if (!accepted && !['submitting', 'submitted', 'pending_review', 'checked'].includes(verified.status)) {
        throw new Error(`Quidax deposit is not accepted: ${verified.status}`);
      }
      const result = accepted
        ? await creditSuccessfulDeposit(verified)
        : await recordDepositConfirmation(verified);
      const changed = 'credited' in result ? result.credited : result.recorded;
      if (!changed) {
        if (!accepted) throw new Error(`Quidax deposit is still pending: ${verified.status}`);
        Logging.info(`Deposit already processed for id: ${id}`);
        return;
      }
      await sendTelegramNotification(
        telegramClient,
        result.user!.chatId,
        (accepted ? MESSAGES.SUCESS_DEPOSIT : MESSAGES.PENDING_DESPOSIT)(
          String(amount),
          currency.toUpperCase(),
          paymentAddress?.network,
          txid,
        ),
      );
      if (!accepted) throw new Error(`Quidax deposit is still pending: ${verified.status}`);
      Logging.info(`Successful deposit processed for event id: ${id}`);
    } catch (error: unknown) {
      Logging.error(`Deposit success processing failed: ${error}`);
      throw error;
    }
  });
};
