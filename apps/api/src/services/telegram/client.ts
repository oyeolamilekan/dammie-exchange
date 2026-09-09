/**
 * Application-owned Telegram client contract and SDK adapter.
 *
 * Keeping the SDK behind this interface makes bot workflows easy to fake in
 * tests and limits the surface exposed to services.
 *
 * @module telegramClientService
 */

import {
  Bot,
  InputFile,
  type Context,
  type SendChatActionParams,
  type SendMessageParams,
  type SendPhotoParams,
  type Update,
} from 'node-telegram-bot-api';

/** Telegram webhook registration values supplied by deployment configuration. */
export interface TelegramWebhookConfig {
  /** Public HTTPS endpoint Telegram sends updates to. */
  url: string;
  /** Secret mirrored in Telegram's webhook authentication header. */
  secretToken: string;
}

/** Minimal inbound Telegram message contract exposed to the bot workflow. */
export interface TelegramMessage {
  /** Telegram's per-chat message identifier, used for update idempotency. */
  message_id: number;
  /** Optional sender identity from Telegram. */
  from?: {
    id: number;
    username?: string;
    first_name: string;
  };
  /** Chat receiving the message. */
  chat: { id: number };
  /** Optional text body. */
  text?: string;
}

/** Options forwarded to Telegram sendMessage after compatibility mapping. */
export type TelegramMessageOptions = Omit<
  SendMessageParams,
  'chat_id' | 'text' | 'link_preview_options'
> & {
  /** Compatibility name used by the 0.x client. */
  disable_web_page_preview?: boolean;
  link_preview_options?: SendMessageParams['link_preview_options'];
};

/** Options forwarded to Telegram sendPhoto after the photo is supplied by the adapter. */
export type TelegramPhotoOptions = Omit<
  SendPhotoParams,
  'chat_id' | 'photo'
>;

/** Lifecycle and messaging contract used by application services and the bot. */
export interface TelegramClient {
  /**
   * Registers one asynchronous inbound-message handler.
   *
   * @param handler - Application callback for inbound messages.
   * @returns Nothing; registration is held by the adapter.
   */
  onMessage(handler: (message: TelegramMessage) => Promise<void>): void;
  /**
   * Registers an error handler for Telegram update and API failures.
   *
   * @param handler - Callback receiving the unknown Telegram error.
   * @returns Nothing; registration is held by the adapter.
   */
  onError(handler: (error: unknown) => void): void;
  /** Dispatches one authenticated Telegram webhook update. */
  handleUpdate(update: Update): Promise<void>;
  /**
   * Sends text with the supported preview compatibility option.
   *
   * @param chatId - Telegram chat identifier.
   * @param text - Text to send.
   * @param options - Optional Telegram message options.
   * @returns A promise that resolves after delivery is accepted.
   */
  sendMessage(
    chatId: number | string,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<void>;
  /**
   * Sends a chat action such as typing.
   *
   * @param chatId - Telegram chat identifier.
   * @param action - Telegram-supported action.
   * @returns A promise that resolves after delivery is accepted.
   */
  sendChatAction(
    chatId: number | string,
    action: SendChatActionParams['action'],
  ): Promise<void>;
  /**
   * Sends an in-memory PNG photo payload.
   *
   * @param chatId - Telegram chat identifier.
   * @param photo - PNG bytes.
   * @param options - Optional Telegram photo options.
   * @returns A promise that resolves after delivery is accepted.
   */
  sendPhoto(
    chatId: number | string,
    photo: Uint8Array,
    options?: TelegramPhotoOptions,
  ): Promise<void>;
  /**
   * Registers the configured Telegram webhook.
   *
   * @returns A promise that resolves after Telegram accepts the registration.
   */
  start(): Promise<void>;
  /**
   * Marks the local webhook client as stopped without deleting the remote webhook.
   *
   * @returns A promise that resolves after local shutdown bookkeeping.
   */
  stop(): Promise<void>;
  /**
   * Reports whether webhook registration completed for this process.
   *
   * @returns True after registration and before local shutdown.
   */
  isRunning(): boolean;
}

/** Subset of the Telegram SDK bot surface needed by the adapter. */
export type TelegramSdkBot = Pick<
  Bot,
  'api' | 'on' | 'catch' | 'handleUpdate'
>;

/** Adapts the Telegram SDK to the application-owned client contract. */
export class TelegramClientAdapter implements TelegramClient {
  /** Promise shared by concurrent webhook-registration attempts. */
  private registrationPromise?: Promise<void>;
  private registered = false;

  /**
   * Creates an adapter around an existing Telegram SDK bot.
   *
   * @param bot - Telegram SDK surface used for messaging and webhook dispatch.
   */
  constructor(
    private readonly bot: TelegramSdkBot,
    private readonly webhook: TelegramWebhookConfig,
  ) {}

  /**
   * Creates an adapter with a new Telegram SDK bot.
   *
   * @param token - Telegram bot token.
   * @returns Configured Telegram client adapter.
   * @throws If the bot token is empty.
   */
  static create(
    token: string,
    webhook: TelegramWebhookConfig,
  ): TelegramClientAdapter {
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required to register the Telegram webhook');
    }
    return new TelegramClientAdapter(new Bot(token), webhook);
  }

  /**
   * Registers a handler and forwards only updates containing a message.
   *
   * @param handler - Application handler for the normalized Telegram message.
   * @returns Nothing; registration is performed on the SDK bot.
   */
  onMessage(handler: (message: TelegramMessage) => Promise<void>): void {
    this.bot.on('message', async (context: Context) => {
      const message = context.message;
      if (message) await handler(message);
    });
  }

  /**
   * Registers an application error handler on the SDK bot.
   *
   * @param handler - Callback receiving the unknown SDK error.
   * @returns Nothing; registration is performed on the SDK bot.
   */
  onError(handler: (error: unknown) => void): void {
    this.bot.catch((error) => handler(error));
  }

  /** Dispatches an update received by the authenticated Express webhook route. */
  handleUpdate(update: Update): Promise<void> {
    return this.bot.handleUpdate(update);
  }

  /**
   * Sends text while translating the legacy preview-disable flag.
   *
   * @param chatId - Telegram chat identifier.
   * @param text - Message text.
   * @param options - Telegram message options and compatibility flag.
   * @returns A promise that resolves after Telegram accepts the message.
   * @throws When the Telegram SDK rejects the request.
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options: TelegramMessageOptions = {},
  ): Promise<void> {
    const {
      disable_web_page_preview: disableWebPagePreview,
      link_preview_options: linkPreviewOptions,
      ...rest
    } = options;

    await this.bot.api.sendMessage({
      ...rest,
      chat_id: chatId,
      text,
      ...(disableWebPagePreview
        ? {
            link_preview_options: {
              ...linkPreviewOptions,
              is_disabled: true,
            },
          }
        : linkPreviewOptions
          ? { link_preview_options: linkPreviewOptions }
          : {}),
    });
  }

  /**
   * Sends a typing or other chat action through Telegram.
   *
   * @param chatId - Telegram chat identifier.
   * @param action - Telegram-supported chat action.
   * @returns A promise that resolves after Telegram accepts the action.
   * @throws When the Telegram SDK rejects the request.
   */
  async sendChatAction(
    chatId: number | string,
    action: SendChatActionParams['action'],
  ): Promise<void> {
    await this.bot.api.sendChatAction({ chat_id: chatId, action });
  }

  /**
   * Sends an in-memory PNG as a Telegram InputFile with the stable QR filename.
   *
   * @param chatId - Telegram chat identifier.
   * @param photo - PNG bytes held in memory.
   * @param options - Optional Telegram photo options.
   * @returns A promise that resolves after Telegram accepts the photo.
   * @throws When the Telegram SDK rejects the request.
   */
  async sendPhoto(
    chatId: number | string,
    photo: Uint8Array,
    options: TelegramPhotoOptions = {},
  ): Promise<void> {
    const bytes = new Uint8Array(photo.buffer, photo.byteOffset, photo.byteLength);
    await this.bot.api.sendPhoto({
      ...options,
      chat_id: chatId,
      photo: new InputFile(bytes, {
        filename: 'qr-code.png',
        contentType: 'image/png',
      }),
    });
  }

  /**
   * Registers exactly one Telegram webhook per process lifecycle.
   *
   * @returns The existing or newly started registration promise.
   * @throws When webhook registration fails.
   */
  start(): Promise<void> {
    if (this.registered) return Promise.resolve();
    if (this.registrationPromise) return this.registrationPromise;

    const registrationPromise = this.bot.api.setWebhook({
      url: this.webhook.url,
      secret_token: this.webhook.secretToken,
      allowed_updates: ['message'],
    }).then((accepted) => {
      if (!accepted) {
        throw new Error('Telegram did not accept the webhook registration');
      }
      this.registered = true;
    }).finally(() => {
      if (this.registrationPromise === registrationPromise) {
        this.registrationPromise = undefined;
      }
    });
    this.registrationPromise = registrationPromise;
    return registrationPromise;
  }

  /**
   * Marks this process as stopped. The remote webhook remains registered so
   * Telegram can retry deliveries while the service restarts.
   *
   * @returns A promise that resolves after any in-flight registration settles.
   * @throws When an in-flight registration rejects.
   */
  async stop(): Promise<void> {
    await this.registrationPromise;
    this.registered = false;
  }

  /**
   * Reads the local webhook-registration state without changing it.
   *
   * @returns True while this process considers the webhook registered.
   */
  isRunning(): boolean {
    return this.registered;
  }
}
