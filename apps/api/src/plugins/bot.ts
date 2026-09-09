import CONFIG from '../config/config';
import {
  TelegramClientAdapter,
  type TelegramClient,
} from '../services/telegram/client';

let client: TelegramClient | undefined;

export const getTelegramClient = (): TelegramClient => {
  client ??= TelegramClientAdapter.create(CONFIG.BOT_TOKEN, {
    url: CONFIG.TELEGRAM_WEBHOOK_URL,
    secretToken: CONFIG.TELEGRAM_WEBHOOK_SECRET,
  });
  return client;
};

/**
 * Side-effect-free application facade. Importing it never constructs a bot or
 * registers a webhook; the concrete client is created on the first runtime action.
 */
export const telegramClient: TelegramClient = {
  onMessage: (handler) => getTelegramClient().onMessage(handler),
  onError: (handler) => getTelegramClient().onError(handler),
  handleUpdate: (update) => getTelegramClient().handleUpdate(update),
  sendMessage: (chatId, text, options) =>
    getTelegramClient().sendMessage(chatId, text, options),
  sendChatAction: (chatId, action) =>
    getTelegramClient().sendChatAction(chatId, action),
  sendPhoto: (chatId, photo, options) =>
    getTelegramClient().sendPhoto(chatId, photo, options),
  start: () => getTelegramClient().start(),
  stop: () => (client ? client.stop() : Promise.resolve()),
  isRunning: () => client?.isRunning() ?? false,
};
