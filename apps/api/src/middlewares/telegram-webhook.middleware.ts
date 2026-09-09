import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import CONFIG from '../config/config';
import asyncHandler from '../helpers/async-handler.helper';

/** Header Telegram sends when a `secret_token` is configured for the webhook. */
export const TELEGRAM_WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Error carrying the HTTP status for Telegram webhook configuration/auth failures. */
export class TelegramWebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TelegramWebhookError';
  }
}

/** Validates the deployment values Telegram requires for webhook delivery. */
export const assertTelegramWebhookConfiguration = (
  url: string | undefined,
  secret: string | undefined,
): void => {
  if (!url) {
    throw new TelegramWebhookError('TELEGRAM_WEBHOOK_URL is required', 503);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TelegramWebhookError('TELEGRAM_WEBHOOK_URL must be a valid URL', 503);
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new TelegramWebhookError('TELEGRAM_WEBHOOK_URL must use HTTPS', 503);
  }

  if (!secret) {
    throw new TelegramWebhookError('TELEGRAM_WEBHOOK_SECRET is required', 503);
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new TelegramWebhookError(
      'TELEGRAM_WEBHOOK_SECRET must use only A-Z, a-z, 0-9, _ and -',
      503,
    );
  }
};

/** Compares Telegram's secret-token header with the configured value. */
export const verifyTelegramWebhookSecret = (
  suppliedSecret: string,
  configuredSecret: string,
): void => {
  const expected = Buffer.from(configuredSecret, 'utf8');
  const actual = Buffer.from(suppliedSecret, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TelegramWebhookError('Invalid Telegram webhook secret', 401);
  }
};

/** Authenticates Telegram webhook requests before their updates are dispatched. */
export const protectTelegramWebhook = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    assertTelegramWebhookConfiguration(
      CONFIG.TELEGRAM_WEBHOOK_URL,
      CONFIG.TELEGRAM_WEBHOOK_SECRET,
    );
    const suppliedSecret = req.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
    if (!suppliedSecret) {
      throw new TelegramWebhookError('Telegram webhook secret is required', 401);
    }
    verifyTelegramWebhookSecret(suppliedSecret, CONFIG.TELEGRAM_WEBHOOK_SECRET);
    next();
  } catch (error) {
    const webhookError = error instanceof TelegramWebhookError
      ? error
      : new TelegramWebhookError('Telegram webhook authentication failed', 401);
    return res.status(webhookError.status).json({ message: webhookError.message });
  }
});
