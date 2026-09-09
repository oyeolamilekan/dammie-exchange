/**
 * Best-effort Telegram delivery for completed transaction receipts.
 *
 * Receipt rendering and delivery are deliberately outside financial
 * transactions. A Telegram outage must not change a settled transaction.
 *
 * @module telegramReceiptService
 */

import Logging from '../../library/logging.utils';
import {
  renderSwapReceipt,
  renderWithdrawalReceipt,
  type SwapReceiptData,
  type WithdrawalReceiptData,
} from '../../helpers/receipt';
import type { TelegramClient } from './client';

const logReceiptFailure = (): void => {
  // Keep this defensive for lightweight test doubles that implement only the
  // logging methods needed by the worker under test.
  Logging.warning?.('Telegram receipt delivery failed');
};

/** Sends one PNG photo and contains all receipt delivery failures. */
export const sendTelegramReceipt = async (
  client: TelegramClient,
  chatId: string | number,
  photo: Uint8Array,
  caption = 'Dammie receipt',
): Promise<boolean> => {
  try {
    await client.sendPhoto(chatId, photo, { caption });
    return true;
  } catch {
    logReceiptFailure();
    return false;
  }
};

/** Renders and sends a completed swap receipt without affecting settlement. */
export const sendSwapReceipt = async (
  client: TelegramClient,
  chatId: string | number,
  data: SwapReceiptData,
): Promise<boolean> => {
  try {
    const photo = await renderSwapReceipt(data);
    return await sendTelegramReceipt(client, chatId, photo, '✅ Swap receipt');
  } catch {
    logReceiptFailure();
    return false;
  }
};

/** Renders and sends a successful NGN withdrawal receipt without affecting settlement. */
export const sendWithdrawalReceipt = async (
  client: TelegramClient,
  chatId: string | number,
  data: WithdrawalReceiptData,
): Promise<boolean> => {
  try {
    const photo = await renderWithdrawalReceipt(data);
    return await sendTelegramReceipt(client, chatId, photo, '✅ Withdrawal receipt');
  } catch {
    logReceiptFailure();
    return false;
  }
};
