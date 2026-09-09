import { describe, expect, it, vi } from 'vitest';
import {
  InputFile,
  type Context,
} from 'node-telegram-bot-api';
import {
  TelegramClientAdapter,
  type TelegramSdkBot,
} from '../../src/services/telegram/client';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createSdkBot = () => {
  const registration = deferred<boolean>();
  let messageHandler: ((context: Context) => Promise<void>) | undefined;
  let errorHandler: ((error: unknown, context: Context) => unknown) | undefined;

  const api = {
    sendMessage: vi.fn().mockResolvedValue({}),
    sendChatAction: vi.fn().mockResolvedValue(true),
    sendPhoto: vi.fn().mockResolvedValue({}),
    setWebhook: vi.fn(() => registration.promise),
  };
  const sdk = {
    api,
    on: vi.fn((_kind, handler) => {
      messageHandler = handler as (context: Context) => Promise<void>;
      return sdk;
    }),
    catch: vi.fn((handler) => {
      errorHandler = handler;
      return sdk;
    }),
    handleUpdate: vi.fn().mockResolvedValue(undefined),
  } as unknown as TelegramSdkBot;

  return {
    sdk,
    api,
    registration,
    getMessageHandler: () => messageHandler,
    getErrorHandler: () => errorHandler,
  };
};

describe('TelegramClientAdapter', () => {
  const webhook = {
    url: 'https://api.example.test/api/v1/webhooks/telegram',
    secretToken: 'telegram_webhook_secret',
  };

  it('maps text, preview, action, and in-memory photo requests to the 2.1 API', async () => {
    const fake = createSdkBot();
    const client = new TelegramClientAdapter(fake.sdk, webhook);

    await client.sendMessage(42, 'hello', {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.test' } }]],
      },
    });
    await client.sendChatAction('42', 'typing');
    await client.sendPhoto(42, Buffer.from([1, 2, 3]), {
      caption: 'QR',
      parse_mode: 'Markdown',
    });

    expect(fake.api.sendMessage).toHaveBeenCalledWith({
      chat_id: 42,
      text: 'hello',
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: 'Open', web_app: { url: 'https://example.test' } }]],
      },
    });
    expect(fake.api.sendChatAction).toHaveBeenCalledWith({
      chat_id: '42',
      action: 'typing',
    });
    const photoRequest = fake.api.sendPhoto.mock.calls[0][0];
    expect(photoRequest).toMatchObject({
      chat_id: 42,
      caption: 'QR',
      parse_mode: 'Markdown',
    });
    expect(photoRequest.photo).toBeInstanceOf(InputFile);
    expect(Array.from(photoRequest.photo.data as Uint8Array)).toEqual([1, 2, 3]);
    expect(photoRequest.photo.meta).toEqual({
      filename: 'qr-code.png',
      contentType: 'image/png',
    });
  });

  it('registers inbound message and error handlers without registering the webhook', async () => {
    const fake = createSdkBot();
    const client = new TelegramClientAdapter(fake.sdk, webhook);
    const messageHandler = vi.fn().mockResolvedValue(undefined);
    const errorHandler = vi.fn();

    client.onMessage(messageHandler);
    client.onError(errorHandler);

    expect(fake.api.setWebhook).not.toHaveBeenCalled();
    await fake.getMessageHandler()!({
      message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text: 'hi' },
    } as Context);
    fake.getErrorHandler()!(new Error('handler failed'), {} as Context);

    expect(messageHandler).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hi', chat: expect.objectContaining({ id: 42 }) }),
    );
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('dispatches an inbound webhook update through the SDK', async () => {
    const fake = createSdkBot();
    const client = new TelegramClientAdapter(fake.sdk, webhook);
    const update = {
      update_id: 12,
      message: { message_id: 1, date: 1, chat: { id: 42, type: 'private' }, text: 'hi' },
    } as Context['update'];

    await client.handleUpdate(update);

    expect(fake.sdk.handleUpdate).toHaveBeenCalledWith(update);
  });

  it('registers one webhook even when lifecycle calls repeat', async () => {
    const fake = createSdkBot();
    const client = new TelegramClientAdapter(fake.sdk, webhook);

    const firstRun = client.start();
    const secondRun = client.start();
    expect(firstRun).toBe(secondRun);
    expect(fake.api.setWebhook).toHaveBeenCalledTimes(1);
    expect(fake.api.setWebhook).toHaveBeenCalledWith({
      url: webhook.url,
      secret_token: webhook.secretToken,
      allowed_updates: ['message'],
    });

    fake.registration.resolve(true);
    await Promise.all([firstRun, secondRun]);
    expect(client.isRunning()).toBe(true);

    await Promise.all([client.stop(), client.stop()]);
    expect(client.isRunning()).toBe(false);
  });
});
