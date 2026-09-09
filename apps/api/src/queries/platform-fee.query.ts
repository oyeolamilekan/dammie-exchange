import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../database';
import { admins } from '../db/schema/admin.schema';
import { currencies } from '../db/schema/currency.schema';
import {
  platformFeeAudits,
  platformFees,
  type PlatformFee,
  type PlatformFeeContext,
  type PlatformFeeType,
} from '../db/schema/platform-fee.schema';
import { compareStoredDecimals, standardDecimal } from '../utils/decimal';

/**
 * Administrator queries for platform-fee configuration and audit history.
 *
 * Fee amounts are normalized to decimal strings before persistence and every
 * create/update operation writes an immutable audit row in the same transaction.
 *
 * @module platformFeeQuery
 */

/** Fields accepted when creating or updating a platform-fee rule. */
export interface PlatformFeeMutationInput {
  currencyId?: string;
  context?: PlatformFeeContext;
  type?: PlatformFeeType;
  amount?: string | number;
  minimumFee?: string | number | null;
  maximumFee?: string | number | null;
  enabled?: boolean;
}

/** Error carrying an HTTP-friendly status for fee administration failures. */
export class PlatformFeeAdminError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PlatformFeeAdminError';
  }
}

const hasDatabaseCode = (error: unknown, code: string): boolean => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: unknown }).code === code
);

const normalizeNonnegative = (value: string | number, label: string): string => {
  let normalized: string;
  try {
    normalized = standardDecimal(value);
  } catch {
    throw new PlatformFeeAdminError(400, `${label} must be a valid decimal`);
  }
  if (normalized.startsWith('-')) throw new PlatformFeeAdminError(400, `${label} must be nonnegative`);
  const [, fraction = ''] = normalized.split('.');
  if (normalized.split('.')[0]!.replace('-', '').length > 18 || fraction.length > 18) {
    throw new PlatformFeeAdminError(400, `${label} exceeds numeric(36,18)`);
  }
  return normalized;
};

const normalizeConfiguration = (input: {
  type: PlatformFeeType;
  amount: string | number;
  minimumFee?: string | number | null;
  maximumFee?: string | number | null;
}) => {
  const amount = normalizeNonnegative(input.amount, 'Platform fee amount');
  if (input.type === 'percentage' && compareStoredDecimals(amount, '100') > 0) {
    throw new PlatformFeeAdminError(400, 'Percentage platform fees cannot exceed 100%');
  }
  const minimumFee = input.minimumFee === undefined || input.minimumFee === null
    ? null
    : normalizeNonnegative(input.minimumFee, 'Minimum fee');
  const maximumFee = input.maximumFee === undefined || input.maximumFee === null
    ? null
    : normalizeNonnegative(input.maximumFee, 'Maximum fee');
  if (input.type === 'flat' && (minimumFee !== null || maximumFee !== null)) {
    throw new PlatformFeeAdminError(400, 'Flat platform fees cannot have minimum or maximum caps');
  }
  if (minimumFee !== null && maximumFee !== null && compareStoredDecimals(minimumFee, maximumFee) > 0) {
    throw new PlatformFeeAdminError(400, 'Minimum fee cannot exceed maximum fee');
  }
  return { type: input.type, amount, minimumFee, maximumFee };
};

const snapshot = (rule: PlatformFee) => ({
  id: rule.id,
  currencyId: rule.currencyId,
  context: rule.context,
  type: rule.type,
  amount: standardDecimal(rule.amount),
  minimumFee: rule.minimumFee === null ? null : standardDecimal(rule.minimumFee),
  maximumFee: rule.maximumFee === null ? null : standardDecimal(rule.maximumFee),
  enabled: rule.enabled,
  createdByAdminId: rule.createdByAdminId,
  updatedByAdminId: rule.updatedByAdminId,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});

const mapFee = (row: {
  fee: PlatformFee;
  currencyName: string;
  currencyCode: string;
  updatedByEmail: string;
}) => ({
  ...row.fee,
  amount: standardDecimal(row.fee.amount),
  minimumFee: row.fee.minimumFee === null ? null : standardDecimal(row.fee.minimumFee),
  maximumFee: row.fee.maximumFee === null ? null : standardDecimal(row.fee.maximumFee),
  currency: {
    id: row.fee.currencyId,
    name: row.currencyName,
    code: row.currencyCode,
  },
  updatedBy: { id: row.fee.updatedByAdminId, email: row.updatedByEmail },
});

const findFeeRow = async (id: string) => (await db.select({
  fee: platformFees,
  currencyName: currencies.name,
  currencyCode: currencies.code,
  updatedByEmail: admins.email,
}).from(platformFees)
  .innerJoin(currencies, eq(platformFees.currencyId, currencies.id))
  .innerJoin(admins, eq(platformFees.updatedByAdminId, admins.id))
  .where(eq(platformFees.id, id)).limit(1))[0] ?? null;

/**
 * Lists current fee rules with currency and administrator projections.
 *
 * No process-level cache is used, so admin callers observe database changes on
 * the next read.
 */
export const findAdminFees = async () => {
  const rows = await db.select({
    fee: platformFees,
    currencyName: currencies.name,
    currencyCode: currencies.code,
    updatedByEmail: admins.email,
  }).from(platformFees)
    .innerJoin(currencies, eq(platformFees.currencyId, currencies.id))
    .innerJoin(admins, eq(platformFees.updatedByAdminId, admins.id))
    .orderBy(asc(currencies.code), asc(platformFees.context), asc(platformFees.id));
  return rows.map(mapFee);
};

const insertAudit = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ruleId: string,
  adminId: string,
  action: string,
  before: unknown,
  after: unknown,
) => {
  await tx.insert(platformFeeAudits).values({
    platformFeeId: ruleId,
    adminId,
    action,
    before: before as Record<string, unknown> | null,
    after: after as Record<string, unknown> | null,
  });
};

/**
 * Creates a platform-fee rule and records a `created` audit entry.
 *
 * @param input Fee currency, context, type, amount, optional caps, and enabled
 * state.
 * @param adminId Administrator creating the rule.
 * @returns The created fee projection, or `null` if it cannot be reloaded.
 * @throws {@link PlatformFeeAdminError} for invalid configuration, missing
 * references, or duplicate rules.
 */
export const createAdminFee = async (input: {
  currencyId: string;
  context: PlatformFeeContext;
  type: PlatformFeeType;
  amount: string | number;
  minimumFee?: string | number | null;
  maximumFee?: string | number | null;
  enabled?: boolean;
}, adminId: string) => {
  const config = normalizeConfiguration(input);
  try {
    const createdId = await db.transaction(async (tx) => {
      const currency = (await tx.select({ id: currencies.id }).from(currencies)
        .where(eq(currencies.id, input.currencyId)).limit(1))[0];
      if (!currency) throw new PlatformFeeAdminError(404, 'Currency not found');
      const inserted = (await tx.insert(platformFees).values({
        currencyId: input.currencyId,
        context: input.context,
        type: config.type,
        amount: config.amount,
        minimumFee: config.minimumFee,
        maximumFee: config.maximumFee,
        enabled: input.enabled ?? true,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      }).returning())[0];
      if (!inserted) throw new Error('Platform fee was not created');
      await insertAudit(tx, inserted.id, adminId, 'created', null, snapshot(inserted));
      return inserted.id;
    });
    const row = await findFeeRow(createdId);
    return row ? mapFee(row) : null;
  } catch (error) {
    if (error instanceof PlatformFeeAdminError) throw error;
    if (hasDatabaseCode(error, '23505')) {
      throw new PlatformFeeAdminError(409, 'A platform fee already exists for that currency and context');
    }
    if (hasDatabaseCode(error, '23503')) throw new PlatformFeeAdminError(404, 'Currency or administrator not found');
    throw error;
  }
};

/**
 * Updates a platform-fee rule and records an `updated` audit entry.
 *
 * @param id Platform-fee rule identifier.
 * @param input Mutable fee fields; omitted values retain their current values.
 * @param adminId Administrator applying the update.
 * @returns The updated fee projection, or `null` if it cannot be reloaded.
 * @throws {@link PlatformFeeAdminError} when the rule or administrator is
 * missing, or the configuration is invalid.
 */
export const updateAdminFee = async (
  id: string,
  input: {
    type?: PlatformFeeType;
    amount?: string | number;
    minimumFee?: string | number | null;
    maximumFee?: string | number | null;
    enabled?: boolean;
  },
  adminId: string,
) => {
  try {
    const updatedId = await db.transaction(async (tx) => {
      const current = (await tx.select().from(platformFees).where(eq(platformFees.id, id))
        .for('update').limit(1))[0];
      if (!current) throw new PlatformFeeAdminError(404, 'Platform fee not found');
      const config = normalizeConfiguration({
        type: input.type ?? current.type,
        amount: input.amount ?? current.amount,
        minimumFee: input.minimumFee === undefined ? current.minimumFee : input.minimumFee,
        maximumFee: input.maximumFee === undefined ? current.maximumFee : input.maximumFee,
      });
      const updated = (await tx.update(platformFees).set({
        type: config.type,
        amount: config.amount,
        minimumFee: config.minimumFee,
        maximumFee: config.maximumFee,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        updatedByAdminId: adminId,
        updatedAt: new Date(),
      }).where(eq(platformFees.id, id)).returning())[0];
      if (!updated) throw new PlatformFeeAdminError(404, 'Platform fee not found');
      await insertAudit(tx, updated.id, adminId, 'updated', snapshot(current), snapshot(updated));
      return updated.id;
    });
    const row = await findFeeRow(updatedId);
    return row ? mapFee(row) : null;
  } catch (error) {
    if (error instanceof PlatformFeeAdminError) throw error;
    if (hasDatabaseCode(error, '23503')) throw new PlatformFeeAdminError(404, 'Administrator not found');
    throw error;
  }
};

/** Reads immutable fee history with the responsible administrator identity. */
export const findAdminFeeAudit = async (id: string) => {
  const rule = (await db.select({ id: platformFees.id }).from(platformFees)
    .where(eq(platformFees.id, id)).limit(1))[0];
  if (!rule) throw new PlatformFeeAdminError(404, 'Platform fee not found');
  const rows = await db.select({
    id: platformFeeAudits.id,
    ruleId: platformFeeAudits.platformFeeId,
    adminId: platformFeeAudits.adminId,
    adminEmail: admins.email,
    action: platformFeeAudits.action,
    before: platformFeeAudits.before,
    after: platformFeeAudits.after,
    createdAt: platformFeeAudits.createdAt,
  }).from(platformFeeAudits)
    .innerJoin(admins, eq(platformFeeAudits.adminId, admins.id))
    .where(eq(platformFeeAudits.platformFeeId, id))
    .orderBy(desc(platformFeeAudits.createdAt), desc(platformFeeAudits.id));
  return rows;
};
