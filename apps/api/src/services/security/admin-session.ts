/**
 * Administrator session-token and cookie helpers.
 *
 * @module adminSessionService
 */

import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import CONFIG from '../../config/config';

/** Name of the HTTP-only administrator session cookie. */
export const ADMIN_SESSION_COOKIE = 'dammie_admin_session';

/** Hashes a raw session token before database lookup/storage. */
export const hashAdminSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Creates a cryptographically random raw session token. */
export const createAdminSessionToken = (): string => randomBytes(32).toString('base64url');

/** Calculates session expiry from the configured session lifetime. */
export const adminSessionExpiry = (now = new Date()): Date =>
  new Date(now.getTime() + CONFIG.ADMIN_SESSION_HOURS * 60 * 60 * 1000);

/** Returns secure cookie options for the administrator session. */
export const adminSessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: CONFIG.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/admin',
  maxAge: CONFIG.ADMIN_SESSION_HOURS * 60 * 60 * 1000,
});

/** Reads and URI-decodes one named cookie from a raw Cookie header. */
export const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
};
