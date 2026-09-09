import type { NextFunction, Request, Response } from 'express';

/**
 * Response-sanitization middleware for administrator endpoints.
 *
 * Sensitive recursive object keys are removed before Express serializes the
 * response. Dates and primitive values are preserved unchanged.
 *
 * @module adminResponseMiddleware
 */

/** Keys that must never appear in admin API JSON responses. @internal */
const SENSITIVE_KEYS = new Set([
  'bvnNumber',
  'hashedPin',
  'passwordHash',
  'tokenHash',
  'accountNumber',
  'accountName',
  'bankCode',
  'walletId',
  'providerWithdrawalId',
  'chatId',
  'intentId',
]);

/** Recursively removes sensitive fields from an API response value. */
export const sanitizeAdminResponse = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeAdminResponse);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    SENSITIVE_KEYS.has(key) ? [] : [[key, sanitizeAdminResponse(item)]]));
};

/** Wraps `res.json` so all downstream admin responses are sanitized recursively. */
export const sanitizeAdminResponses = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(sanitizeAdminResponse(body))) as Response['json'];
  next();
};
