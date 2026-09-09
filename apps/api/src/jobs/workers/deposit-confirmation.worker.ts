import type Bull from 'bull';
import { MESSAGES } from '../../helpers/messages';
import Logging from '../../library/logging.utils';
import { telegramClient } from '../../plugins/bot';
import { creditSuccessfulDeposit, recordDepositConfirmation } from '../../services/financial/deposits';
import { verifyDeposit } from '../../services/financial/provider-verification';
import { quidax } from '../../services/integrations/quidax';
import type { DepositWebhookJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';
import { sendTelegramNotification } from '../../services/telegram/notifications';

/**
 * Deposit-confirmation worker for provider events that have not settled yet.
 *
 * @module depositConfirmationWorker
 */

/**
 * Registers the worker that verifies provider deposits, records pending
 * confirmations, credits accepted deposits, and notifies the owner.
 */
export const initializeDepositConfirmationWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.DEPOSIT_CONFIRMATION);
  await initializeWorker(queue, 'Deposit Confirmation', async (job: Bull.Job<DepositWebhookJobPayload>) => {
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
      Logging.info(`Deposit confirmation processed for event id: ${id}`);
    } catch (error: unknown) {
      Logging.error(`Deposit confirmation failed for user ${user.id}: ${error}`);
      throw error;
    }
  });
};
