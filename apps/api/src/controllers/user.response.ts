import type { UserRecord } from '../queries/user.query';

/**
 * Public user fields safe to return from customer-facing endpoints.
 * Authentication and financial identity secrets are intentionally excluded.
 *
 * @module userResponse
 */
export interface PublicUserResponse {
  /** Internal user identifier. */
  id: string;
  /** Registered email address. */
  email: string;
  /** User's first name. */
  firstName: string;
  /** User's last name. */
  lastName: string;
}

/** Maps a safe user record to the public customer response shape. */
export const toPublicUserResponse = (user: UserRecord): PublicUserResponse => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
});
