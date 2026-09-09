import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { z } from 'zod';
import CONFIG from '../config/config';
import asyncHandler from '../helpers/async-handler.helper';
import {
  createAdminSession,
  deleteAdminSessionByHash,
  findAdminCredentialsByEmail,
  normalizeAdminEmail,
} from '../queries/admin-auth.query';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  adminSessionExpiry,
  createAdminSessionToken,
  hashAdminSessionToken,
  readCookie,
} from '../services/security/admin-session';
import { redisSecurityStore } from '../services/security/store';

/**
 * Express handlers for administrator login, logout, and session introspection.
 *
 * Login uses normalized email lookup, a dummy bcrypt hash for unknown users to
 * reduce timing differences, Redis-backed rate limiting, and an HTTP-only
 * session cookie containing a random token.
 *
 * @module adminAuthController
 */

const DUMMY_PASSWORD_HASH = '$2b$12$Cc0g4wPIATFSHbVI2rdkgu3LIT0uY2G4GHI90nTcZRfSnt9byqKc2';
const loginSchema = z.object({
  email: z.string().trim().email().max(250),
  password: z.string().min(1).max(1024),
}).strict();

const safeAdmin = (admin: NonNullable<Request['admin']>) => ({
  id: admin.id,
  email: admin.email,
  isActive: admin.isActive,
  lastLoginAt: admin.lastLoginAt,
  createdAt: admin.createdAt,
});

/** Builds the Redis key used to rate-limit one email/IP login identity. */
export const adminLoginRateLimitKey = (email: string, ip: string): string => {
  const identity = createHash('sha256')
    .update(`${normalizeAdminEmail(email)}\0${ip}`)
    .digest('hex');
  return `security:admin-login:${identity}`;
};

/**
 * Authenticates an administrator and establishes an HTTP-only session cookie.
 *
 * Responds with `400` for malformed input, `429` when the login limit is
 * reached, `401` for invalid credentials, and the safe admin profile on
 * success.
 */
export const loginAdminController = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid login request' });
    return;
  }

  const email = normalizeAdminEmail(parsed.data.email);
  const rateKey = adminLoginRateLimitKey(email, req.ip ?? 'unknown');
  if (await redisSecurityStore.getNumber(rateKey) >= CONFIG.ADMIN_LOGIN_MAX_ATTEMPTS) {
    const ttl = await redisSecurityStore.ttl(rateKey);
    res.set('Retry-After', String(Math.max(ttl, 1)));
    res.status(429).json({ message: 'Too many login attempts. Try again later.' });
    return;
  }

  const admin = await findAdminCredentialsByEmail(email);
  const passwordMatches = await bcrypt.compare(
    parsed.data.password,
    admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!admin || !passwordMatches || !admin.isActive) {
    await redisSecurityStore.incrementWithTtl(
      rateKey,
      CONFIG.ADMIN_LOGIN_WINDOW_SECONDS,
    );
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const token = createAdminSessionToken();
  const expiresAt = adminSessionExpiry();
  const { admin: loggedInAdmin } = await createAdminSession(
    admin.id,
    hashAdminSessionToken(token),
    expiresAt,
  );
  await redisSecurityStore.delete(rateKey);
  res.cookie(ADMIN_SESSION_COOKIE, token, adminSessionCookieOptions());
  res.json({ admin: safeAdmin(loggedInAdmin), expiresAt });
});

/** Revokes the current administrator session and clears its cookie. */
export const logoutAdminController = asyncHandler(async (req, res) => {
  const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
  if (token) await deleteAdminSessionByHash(hashAdminSessionToken(token));
  const { maxAge: _maxAge, ...clearOptions } = adminSessionCookieOptions();
  res.clearCookie(ADMIN_SESSION_COOKIE, clearOptions);
  res.status(204).send();
});

/** Returns the administrator attached by session-authentication middleware. */
export const getCurrentAdminController = (req: Request, res: Response): void => {
  res.json({ admin: safeAdmin(req.admin!) });
};
