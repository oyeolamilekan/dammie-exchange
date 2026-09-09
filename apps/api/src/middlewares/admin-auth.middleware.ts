import type { NextFunction, Request, Response } from 'express';
import { findActiveAdminBySessionHash } from '../queries/admin-auth.query';
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
  readCookie,
} from '../services/security/admin-session';
import { isAllowedFrontendOrigin } from '../services/security/frontend-origin';

/**
 * Administrator session-authentication and mutation-origin middleware.
 *
 * @module adminAuthMiddleware
 */

/** Sends the standard unauthorized administrator response. @internal */
const unauthorized = (res: Response) =>
  res.status(401).json({ message: 'Admin authentication required' });

/**
 * Resolves the admin session cookie and attaches the active admin to the request.
 * Requests without a valid session receive `401`; unexpected errors are passed
 * to Express's error pipeline.
 */
export const authenticateAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!token) {
      unauthorized(res);
      return;
    }
    const admin = await findActiveAdminBySessionHash(hashAdminSessionToken(token));
    if (!admin) {
      unauthorized(res);
      return;
    }
    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Requires an allowed frontend origin for state-changing admin requests.
 * Safe methods (`GET`, `HEAD`, and `OPTIONS`) pass through without an origin
 * check.
 */
export const validateAdminMutationOrigin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (!origin || !isAllowedFrontendOrigin(origin)) {
    res.status(403).json({ message: 'Invalid request origin' });
    return;
  }
  next();
};
