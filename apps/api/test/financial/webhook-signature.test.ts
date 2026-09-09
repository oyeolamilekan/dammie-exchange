import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CONFIG from '../../src/config/config';
import {
  assertWebhookConfiguration,
  protectCryptoWebhook,
  verifyQuidaxWebhookSignature,
} from '../../src/middlewares/webhook.middleware';

const SECRET = 'webhook-secret';
const originalSecret = CONFIG.CRYPTO_WEBHOOK_KEY;
afterEach(() => { CONFIG.CRYPTO_WEBHOOK_KEY = originalSecret; });

const invoke = (signature?: string) => new Promise<{ status: number; continued: boolean }>((resolve, reject) => {
  let status = 200;
  const req = { get: vi.fn(() => signature), body: { event: 'deposit.successful' } } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json() { resolve({ status, continued: false }); return this; },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => {
    if (error) reject(error);
    else resolve({ status, continued: true });
  };
  protectCryptoWebhook(req, res, next);
});

describe('Quidax plaintext webhook signature verification', () => {
  it('accepts an exact plaintext secret', () => {
    expect(() => verifyQuidaxWebhookSignature(SECRET, SECRET)).not.toThrow();
  });

  it.each(['', 'wrong-secret', 'WEBHOOK-SECRET', 'webhook-secret ', ' webhook-secret',
    `t=1800000000,v1=${'a'.repeat(64)}`,
  ])('rejects a missing or mismatched header: %s', (header) => {
    expect(() => verifyQuidaxWebhookSignature(header, SECRET)).toThrow('Invalid webhook signature');
  });

  it('compares exact bytes even for equal-length and Unicode values', () => {
    expect(() => verifyQuidaxWebhookSignature('webhook-secrex', SECRET)).toThrow('Invalid webhook signature');
    expect(() => verifyQuidaxWebhookSignature('secret-🔑', 'secret-🔑')).not.toThrow();
    expect(() => verifyQuidaxWebhookSignature('secret-🔒', 'secret-🔑')).toThrow('Invalid webhook signature');
  });

  it('fails closed when the secret is missing', () => {
    expect(() => assertWebhookConfiguration(undefined)).toThrow('CRYPTO_WEBHOOK_KEY is required');
    expect(() => verifyQuidaxWebhookSignature('', '')).toThrow('CRYPTO_WEBHOOK_KEY is required');
  });

  it('allows the plaintext header without requiring rawBody', async () => {
    CONFIG.CRYPTO_WEBHOOK_KEY = SECRET;
    expect(await invoke(SECRET)).toEqual({ status: 200, continued: true });
  });

  it.each([undefined, '', 'incorrect'])('rejects unauthenticated requests before the controller', async (header) => {
    CONFIG.CRYPTO_WEBHOOK_KEY = SECRET;
    expect(await invoke(header)).toEqual({ status: 401, continued: false });
  });

  it('returns 503 when the server secret is missing', async () => {
    CONFIG.CRYPTO_WEBHOOK_KEY = '';
    expect(await invoke(SECRET)).toEqual({ status: 503, continued: false });
  });
});
