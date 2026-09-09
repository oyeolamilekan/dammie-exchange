import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CONFIG from '../../src/config/config';
import {
  assertTelegramWebhookConfiguration,
  protectTelegramWebhook,
  TELEGRAM_WEBHOOK_SECRET_HEADER,
  verifyTelegramWebhookSecret,
} from '../../src/middlewares/telegram-webhook.middleware';

const mocks = vi.hoisted(() => ({ handleUpdate: vi.fn() }));
vi.mock('../../src/plugins/bot', () => ({
  telegramClient: { handleUpdate: mocks.handleUpdate },
}));

import {
  isTelegramUpdate,
  telegramWebhookController,
} from '../../src/controllers/telegram-webhook.controller';

const originalUrl = CONFIG.TELEGRAM_WEBHOOK_URL;
const originalSecret = CONFIG.TELEGRAM_WEBHOOK_SECRET;

afterEach(() => {
  CONFIG.TELEGRAM_WEBHOOK_URL = originalUrl;
  CONFIG.TELEGRAM_WEBHOOK_SECRET = originalSecret;
  vi.clearAllMocks();
});

const invokeMiddleware = (secret?: string) => new Promise<{ status: number; continued: boolean }>((resolve, reject) => {
  let status = 200;
  const req = {
    get: vi.fn((header: string) => header === TELEGRAM_WEBHOOK_SECRET_HEADER ? secret : undefined),
  } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json() { resolve({ status, continued: false }); return this; },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => {
    if (error) reject(error);
    else resolve({ status, continued: true });
  };
  protectTelegramWebhook(req, res, next);
});

const invokeController = (body: unknown) => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
  let status = 200;
  const req = { body } as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(responseBody: unknown) { resolve({ status, body: responseBody }); return this; },
  } as unknown as Response;
  telegramWebhookController(req, res, reject as NextFunction);
});

describe('Telegram webhook', () => {
  it('requires a public HTTPS URL and Telegram-compatible secret', () => {
    expect(() => assertTelegramWebhookConfiguration(
      'https://api.example.test/api/v1/webhooks/telegram',
      'valid_secret-123',
    )).not.toThrow();
    expect(() => assertTelegramWebhookConfiguration(undefined, 'secret')).toThrow(
      'TELEGRAM_WEBHOOK_URL is required',
    );
    expect(() => assertTelegramWebhookConfiguration('http://api.example.test/hook', 'secret')).toThrow(
      'must use HTTPS',
    );
    expect(() => assertTelegramWebhookConfiguration('https://api.example.test/hook', 'bad secret')).toThrow(
      'must use only',
    );
  });

  it('authenticates the exact Telegram secret-token header', async () => {
    CONFIG.TELEGRAM_WEBHOOK_URL = 'https://api.example.test/api/v1/webhooks/telegram';
    CONFIG.TELEGRAM_WEBHOOK_SECRET = 'telegram_secret';

    expect(() => verifyTelegramWebhookSecret('telegram_secret', 'telegram_secret')).not.toThrow();
    expect(() => verifyTelegramWebhookSecret('telegram_secrex', 'telegram_secret')).toThrow(
      'Invalid Telegram webhook secret',
    );
    expect(await invokeMiddleware('telegram_secret')).toEqual({ status: 200, continued: true });
    expect(await invokeMiddleware()).toEqual({ status: 401, continued: false });
    expect(await invokeMiddleware('wrong')).toEqual({ status: 401, continued: false });
  });

  it('rejects malformed payloads and dispatches valid updates', async () => {
    mocks.handleUpdate.mockResolvedValue(undefined);
    expect(isTelegramUpdate({ update_id: 14, message: {} })).toBe(true);
    expect(isTelegramUpdate({ message: {} })).toBe(false);
    expect(await invokeController({ message: {} })).toEqual({
      status: 400,
      body: { message: 'Invalid Telegram update' },
    });

    const update = { update_id: 14, message: { message_id: 2 } };
    expect(await invokeController(update)).toEqual({ status: 200, body: {} });
    expect(mocks.handleUpdate).toHaveBeenCalledWith(update);
  });
});
