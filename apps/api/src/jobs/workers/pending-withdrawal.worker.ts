import type Bull from 'bull';
import Logging from '../../library/logging.utils';
import { quidax } from '../../services/integrations/quidax';
import { processApprovedNgnWithdrawal } from '../../services/financial/ngn-payouts';
import { findNgnWithdrawalOwner, getNgnWithdrawalTotal } from '../../services/financial/ngn-withdrawals';
import { telegramClient } from '../../plugins/bot';
import { sendTelegramNotification } from '../../services/telegram/notifications';
import { sendWithdrawalReceipt } from '../../services/telegram/receipts';
import { standardDecimal } from '../../utils/decimal';
import { MESSAGES } from '../../helpers/messages';
import type { NgnWithdrawalJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Approved NGN withdrawal worker.
 *
 * @module pendingWithdrawalWorker
 */

/** Registers the idempotent NGN bank-payout processor and sends the final owner notification. */
export const initializePendingWithdrawalWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.PENDING_WITHDRAWAL);
  await initializeWorker(queue, 'Pending NGN Withdrawal', async (job: Bull.Job<NgnWithdrawalJobPayload>) => {
    const result = await processApprovedNgnWithdrawal(job.data.id, quidax);
    if (result === 'success' || result === 'failed') {
      const owner = await findNgnWithdrawalOwner(job.data.id);
      if (owner) {
        const message = result === 'success'
          ? `✅ Your ₦${standardDecimal(owner.withdrawal.amount)} bank withdrawal was successful.`
          : MESSAGES.FAILED_NGN_WITHDRAWAL(
            standardDecimal(owner.withdrawal.amount),
            getNgnWithdrawalTotal(owner.withdrawal),
          );
        await sendTelegramNotification(telegramClient, owner.chatId, message);
        if (result === 'success') {
          await sendWithdrawalReceipt(telegramClient, owner.chatId, {
            amount: owner.withdrawal.amount,
            platformFee: owner.withdrawal.fee,
            totalDebit: getNgnWithdrawalTotal(owner.withdrawal),
            bankCode: owner.withdrawal.bankCode ?? '',
            bankName: owner.bankName,
            accountNumber: owner.withdrawal.accountNumber ?? '',
            reference: owner.withdrawal.reference,
            providerWithdrawalId: owner.withdrawal.providerWithdrawalId,
            completedAt: owner.withdrawal.completedAt ?? new Date(),
          });
        }
      }
    }
    Logging.info(`NGN withdrawal ${job.data.id} provider result: ${result}`);
  });
};
