import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../database';
import { admins, adminSessions, type NewAdmin } from '../db/schema/admin.schema';

/**
 * Administrator identity and session persistence queries.
 *
 * Session lookups accept only token hashes and return active, non-expired
 * administrator profiles.
 *
 * @module adminAuthQuery
 */

/**
 * Database projection used when returning administrator data.
 * Password hashes are intentionally excluded except from the credentials
 * lookup used by the login flow.
 */
const safeAdminColumns = {
  id: admins.id,
  email: admins.email,
  isActive: admins.isActive,
  lastLoginAt: admins.lastLoginAt,
  createdAt: admins.createdAt,
  updatedAt: admins.updatedAt,
};

/** Normalizes an administrator email for lookup and storage. */
export const normalizeAdminEmail = (email: string): string =>
  email.trim().toLowerCase();

/** Creates an administrator and returns its non-secret profile fields. */
export const createAdmin = async (input: NewAdmin) => (
  await db.insert(admins).values({
    ...input,
    email: normalizeAdminEmail(input.email),
  }).returning(safeAdminColumns)
)[0];

/**
 * Finds login credentials by normalized email.
 *
 * @returns The administrator profile plus password hash, or `null` when no
 * matching account exists.
 */
export const findAdminCredentialsByEmail = async (email: string) => (
  await db.select({ ...safeAdminColumns, passwordHash: admins.passwordHash })
    .from(admins)
    .where(eq(sql`lower(${admins.email})`, normalizeAdminEmail(email)))
    .limit(1)
)[0] ?? null;

/**
 * Creates an admin session and updates the administrator's last-login time in
 * the same database transaction.
 *
 * @param adminId Administrator owning the session.
 * @param tokenHash Hash of the random client-session token.
 * @param expiresAt Session expiry timestamp.
 * @returns The created session metadata and safe administrator profile.
 */
export const createAdminSession = async (
  adminId: string,
  tokenHash: string,
  expiresAt: Date,
) => db.transaction(async (tx) => {
  const session = (await tx.insert(adminSessions).values({
    adminId,
    tokenHash,
    expiresAt,
  }).returning({ id: adminSessions.id, expiresAt: adminSessions.expiresAt }))[0];
  const admin = (await tx.update(admins).set({
    lastLoginAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(admins.id, adminId)).returning(safeAdminColumns))[0];
  return { session, admin };
});

/** Finds an active, non-expired administrator session by token hash. */
export const findActiveAdminBySessionHash = async (tokenHash: string) => (
  await db.select(safeAdminColumns)
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .where(and(
      eq(adminSessions.tokenHash, tokenHash),
      gt(adminSessions.expiresAt, new Date()),
      eq(admins.isActive, true),
    ))
    .limit(1)
)[0] ?? null;

/** Revokes an administrator session by its stored token hash. */
export const deleteAdminSessionByHash = async (tokenHash: string): Promise<void> => {
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
};
