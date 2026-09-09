import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import asyncHandler from '../helpers/async-handler.helper';
import CONFIG from '../config/config';

/**
 * Quidax webhook signature middleware.
 *
 * @module webhookMiddleware
 */

/** Error carrying the HTTP status for a webhook-authentication failure. */
export class WebhookAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'WebhookAuthenticationError';
  }
}

/** Ensures the shared webhook secret is configured before verification. */
export const assertWebhookConfiguration = (secret: string | undefined) => {
  if (!secret) {
    throw new WebhookAuthenticationError(
      'CRYPTO_WEBHOOK_KEY is required',
      503,
    );
  }
};

/** Compares a provider signature with the configured secret in constant time. */
export const verifyQuidaxWebhookSignature = (
  signatureHeader: string,
  secret: string,
): void => {
  assertWebhookConfiguration(secret);

  // This integration sends the configured shared secret as the header value.
  const expected = Buffer.from(secret, 'utf8');
  const actual = Buffer.from(signatureHeader, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new WebhookAuthenticationError('Invalid webhook signature', 401);
  }
};

/**
 * Express middleware that authenticates the `quidax-signature` header.
 * Invalid signatures return `401`; missing configuration returns `503`.
 */
export const protectCryptoWebhook = asyncHandler(async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    assertWebhookConfiguration(CONFIG.CRYPTO_WEBHOOK_KEY);
    const signature = req.get('quidax-signature');
    if (!signature) {
      throw new WebhookAuthenticationError('Webhook signature is required', 401);
    }
    verifyQuidaxWebhookSignature(
      signature,
      CONFIG.CRYPTO_WEBHOOK_KEY as string,
    );
    next();
  } catch (error) {
    const authError = error instanceof WebhookAuthenticationError
      ? error
      : new WebhookAuthenticationError('Webhook authentication failed', 401);
    return res.status(authError.status).json({ message: authError.message });
  }
});
