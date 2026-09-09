/**
 * Best-effort Telegram notification service.
 *
 * Notification delivery failures are logged without rolling back already
 * completed application or financial operations.
 *
 * @module telegramNotificationService
 */

import Logging from '../../library/logging.utils';
import type {
  TelegramClient,
  TelegramMessageOptions,
} from './client';

/** Re-exported receipt delivery contract for Telegram notification consumers. */
export { sendTelegramReceipt } from './receipts';

/**
 * Delivers a best-effort user notification without allowing Telegram outages to
 * change an already-completed application or financial operation.
 *
 * @param client - Telegram client used for message delivery.
 * @param chatId - Telegram chat identifier.
 * @param text - User-facing notification text.
 * @param options - Optional Telegram message options.
 * @returns True when Telegram accepts the message, false when delivery fails.
 * @sideEffects Sends one best-effort notification and logs only a privacy-safe fixed warning on failure.
 */
export const sendTelegramNotification = async (
  client: TelegramClient,
  chatId: string | number,
  text: string,
  options?: TelegramMessageOptions,
): Promise<boolean> => {
  try {
    await client.sendMessage(chatId, text, options);
    return true;
  } catch {
    Logging.warning('Telegram notification delivery failed');
    return false;
  }
};
