/**
 * Frontend-origin allowlist helpers for browser mutation protection.
 *
 * @module frontendOriginService
 */

import CONFIG from '../../config/config';

/** Converts a configured frontend URL to its origin. @internal */
const toOrigin = (value: string): string => new URL(value).origin;

/** Returns the configured admin and customer frontend origins. */
export const configuredFrontendOrigins = (): ReadonlySet<string> => new Set([
  toOrigin(CONFIG.FRONTEND_URL),
  toOrigin(CONFIG.ADMIN_FRONTEND_URL),
]);

/** Returns whether a request origin is allowed; absent origins are accepted for non-browser callers. */
export const isAllowedFrontendOrigin = (origin: string | undefined): boolean =>
  origin === undefined || configuredFrontendOrigins().has(origin);
