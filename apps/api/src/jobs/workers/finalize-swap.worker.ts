import type Bull from 'bull';
import Logging from '../../library/logging.utils';
import { telegramClient } from '../../plugins/bot';
import { finalizeSuccessfulCustodySweep } from '../../services/financial/swaps/settlement';
import { markSwapAsReconciliationRequired } from '../../services/financial/swaps/settlement-store';
import { findSwap } from '../../queries/swap.query';
import { verifyWithdrawal } from '../../services/financial/provider-verification';
import { quidax } from '../../services/integrations/quidax';
import { sendTelegramNotification } from '../../services/telegram/notifications';
import { sendSwapReceipt, sendWithdrawalReceipt } from '../../services/telegram/receipts';
import { settleNgnPayoutWebhook } from '../../services/financial/ngn-payouts';
import { standardDecimal } from '../../utils/decimal';
import { MESSAGES } from '../../helpers/messages';
import type { SuccessfulWithdrawJobPayload } from '../queue-registry.job';
import { QUEUE_NAMES } from '../queueNames.job';
import { createWorkerQueue, initializeWorker } from './runtime';

/**
 * Finalization worker for custody sweeps and provider NGN payout events.
 *
 * @module finalizeSwapWorker
 */

/**
 * Registers the worker that settles direct NGN payout webhooks or verifies and
 * finalizes a custody sweep before crediting the customer's NGN wallet.
 */
export const initializeFinalizeSwapWorker = async (): Promise<void> => {
  const queue = createWorkerQueue(QUEUE_NAMES.FINALIZE_SWAP);
  await initializeWorker(queue, 'Finalize Swap', async (job: Bull.Job<SuccessfulWithdrawJobPayload>) => {
    try {
      const { id } = job.data.data;
      const providerEvent = job.data.event;
      if (providerEvent === 'withdraw.successful' || providerEvent === 'withdraw.rejected') {
        const payout = await settleNgnPayoutWebhook(id, providerEvent, quidax);
        if (payout) {
          if (payout.changed) {
            const message = payout.status === 'done'
              ? `✅ Your ₦${standardDecimal(payout.withdrawal.amount)} bank withdrawal was successful.`
              : payout.status === 'failed'
                ? MESSAGES.FAILED_NGN_WITHDRAWAL(
                  standardDecimal(payout.withdrawal.amount),
                  payout.total,
                )
                : `❌ Your ₦${standardDecimal(payout.withdrawal.amount)} bank withdrawal was rejected and ₦${payout.total} was restored to your NGN wallet.`;
            await sendTelegramNotification(telegramClient, payout.chatId, message);
            if (payout.status === 'done') {
              await sendWithdrawalReceipt(telegramClient, payout.chatId, {
                amount: payout.withdrawal.amount,
                platformFee: payout.withdrawal.fee,
                totalDebit: payout.total,
                bankCode: payout.withdrawal.bankCode ?? '',
                bankName: payout.bankName,
                accountNumber: payout.withdrawal.accountNumber ?? '',
                reference: payout.withdrawal.reference,
                providerWithdrawalId: payout.withdrawal.providerWithdrawalId,
                completedAt: payout.withdrawal.completedAt ?? new Date(),
              });
            }
          }
          Logging.info(`Finalized customer NGN payout for provider withdrawal: ${id}`);
          return;
        }
      }
      const swap = await findSwap({ sweepId: id });
      if (!swap) throw new Error('Withdrawal has no local swap relationship');
      if (swap.reconciliationRequired) {
        Logging.info(`Skipped already-reconciled failed custody sweep: ${id}`);
        return;
      }
      const reference = swap.sweepReference;
      const expectedAmount = swap.executedReceivedAmount;
      if (!reference || !expectedAmount) throw new Error('Withdrawal verification requires the stored reference and amount');
      let verified;
      try {
        verified = await verifyWithdrawal(quidax, {
          id, reference, expectedAmount,
          ownerId: swap.user.subUserId,
        });
      } catch (error: unknown) {
        if (!(error instanceof Error && (
          error.name === 'QuidaxWithdrawalFailedError'
          || error.message === 'Quidax withdrawal failed: failed'
        ))) throw error;
        const newlyFlagged = await markSwapAsReconciliationRequired(swap.id);
        if (newlyFlagged !== false) {
          await sendTelegramNotification(
            telegramClient,
            swap.user.chatId,
            MESSAGES.FAILED_CUSTODY_WITHDRAWAL(),
          );
          Logging.info(`Customer notified about failed custody sweep: ${id}`);
        } else {
          Logging.info(`Skipped duplicate failed custody sweep notification: ${id}`);
        }
        return;
      }
      const result = await finalizeSuccessfulCustodySweep(verified.id, verified);
      if (result.credited) {
        await sendTelegramNotification(
          telegramClient,
          swap.user.chatId,
          `✅ ₦${result.amount} has been credited to your NGN wallet. 💳`,
        );
        const settledSwap = await findSwap({ sweepId: id });
        if (settledSwap) {
          await sendSwapReceipt(telegramClient, settledSwap.user.chatId, {
            sourceAmount: settledSwap.fromAmount,
            sourceCurrency: settledSwap.fromCurrency,
            receivedAmount: settledSwap.toAmount,
            receivedCurrency: settledSwap.toCurrency,
            grossAmount: settledSwap.grossToAmount,
            platformFee: settledSwap.platformFeeAmount,
            executionPrice: settledSwap.executionPrice ?? settledSwap.quotedPrice,
            providerTransactionId: settledSwap.swapTransactionId,
            reference: settledSwap.sweepReference,
            completedAt: settledSwap.completedAt ?? new Date(),
          });
        }
      }
      Logging.info(`Finalized NGN wallet credit for sweepId: ${id}`);
    } catch (error: unknown) {
      Logging.error(`Finalize swap processing failed: ${error}`);
      throw error;
    }
  });
};
