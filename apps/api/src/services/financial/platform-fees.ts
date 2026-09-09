/**
 * Platform-fee calculation and resolution services.
 *
 * Rules are read from PostgreSQL without process-level caching, and all fee
 * calculations preserve decimal precision and transaction snapshots.
 *
 * @module platformFeeService
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../database';
import { currencies } from '../../db/schema/currency.schema';
import {
  platformFees,
  type PlatformFee,
  type PlatformFeeContext,
  type PlatformFeeSnapshotValues,
} from '../../db/schema/platform-fee.schema';
import { normalizeCurrency } from '../../utils/currency';
import {
  addStoredDecimals,
  compareStoredDecimals,
  divideStoredDecimalByPowerOfTen,
  multiplyStoredDecimals,
  roundStoredDecimal,
  standardDecimal,
} from '../../utils/decimal';

/** Fee fields needed by calculation and snapshot resolution. */
export type PlatformFeeRule = Pick<
  PlatformFee,
  'id' | 'type' | 'amount' | 'minimumFee' | 'maximumFee'
>;

/** Resolved fee amount plus the rule/snapshot used to calculate it. */
export interface ResolvedPlatformFee {
  amount: string;
  rule: PlatformFeeRule | null;
  snapshot: PlatformFeeSnapshotValues | null;
}

const normalizeFeeCurrency = (currency: string): string => normalizeCurrency(currency);

const roundForCurrency = (amount: string, currency: string): string =>
  normalizeFeeCurrency(currency) === 'ngn' ? roundStoredDecimal(amount, 2) : standardDecimal(amount);

const assertNonnegative = (value: string | number, label: string): string => {
  const normalized = standardDecimal(value);
  if (normalized.startsWith('-')) throw new Error(`${label} must be nonnegative`);
  return normalized;
};

/** Calculates a fee from one immutable rule using integer decimal arithmetic. */
export const calculatePlatformFee = (
  baseAmount: string | number,
  rule: Pick<PlatformFee, 'type' | 'amount' | 'minimumFee' | 'maximumFee'>,
  currency = 'ngn',
): string => {
  const base = assertNonnegative(baseAmount, 'Fee base amount');
  const configuredAmount = assertNonnegative(rule.amount, 'Platform fee amount');
  if (rule.type === 'percentage' && compareStoredDecimals(configuredAmount, '100') > 0) {
    throw new Error('Percentage platform fees cannot exceed 100%');
  }
  if (rule.type === 'flat' && (rule.minimumFee !== null && rule.minimumFee !== undefined
    || rule.maximumFee !== null && rule.maximumFee !== undefined)) {
    throw new Error('Flat platform fees cannot have minimum or maximum caps');
  }
  if (rule.minimumFee !== null && rule.minimumFee !== undefined
    && rule.maximumFee !== null && rule.maximumFee !== undefined
    && compareStoredDecimals(rule.minimumFee, rule.maximumFee) > 0) {
    throw new Error('Minimum fee cannot exceed maximum fee');
  }
  let fee = rule.type === 'flat'
    ? configuredAmount
    : divideStoredDecimalByPowerOfTen(multiplyStoredDecimals(base, configuredAmount), 2);

  if (rule.type === 'percentage') {
    if (rule.minimumFee !== null && rule.minimumFee !== undefined
      && compareStoredDecimals(fee, rule.minimumFee) < 0) fee = standardDecimal(rule.minimumFee);
    if (rule.maximumFee !== null && rule.maximumFee !== undefined
      && compareStoredDecimals(fee, rule.maximumFee) > 0) fee = standardDecimal(rule.maximumFee);
  }

  return roundForCurrency(fee, currency);
};

/** Calculates a fee from the stored transaction snapshot, without consulting current configuration. */
export const calculatePlatformFeeFromSnapshot = (
  baseAmount: string | number,
  snapshot: PlatformFeeSnapshotValues | null,
  currency = 'ngn',
): string => snapshot
  ? calculatePlatformFee(baseAmount, {
    type: snapshot.platformFeeType,
    amount: snapshot.platformFeeConfiguredAmount,
    minimumFee: snapshot.platformFeeMinimumFee,
    maximumFee: snapshot.platformFeeMaximumFee,
  }, currency)
  : '0';

const snapshotFromRule = (rule: PlatformFeeRule): PlatformFeeSnapshotValues => ({
  platformFeeId: rule.id,
  platformFeeType: rule.type,
  platformFeeConfiguredAmount: standardDecimal(rule.amount),
  platformFeeMinimumFee: rule.minimumFee === null ? null : standardDecimal(rule.minimumFee),
  platformFeeMaximumFee: rule.maximumFee === null ? null : standardDecimal(rule.maximumFee),
});

/** Resolves one enabled rule directly from PostgreSQL; deliberately uncached. */
export const resolvePlatformFee = async (
  currency: string,
  context: PlatformFeeContext,
  baseAmount: string | number,
): Promise<ResolvedPlatformFee> => {
  const row = (await db.select({
    id: platformFees.id,
    type: platformFees.type,
    amount: platformFees.amount,
    minimumFee: platformFees.minimumFee,
    maximumFee: platformFees.maximumFee,
  }).from(platformFees)
    .innerJoin(currencies, eq(platformFees.currencyId, currencies.id))
    .where(and(
      eq(currencies.code, normalizeFeeCurrency(currency)),
      eq(platformFees.context, context),
      eq(platformFees.enabled, true),
    )).limit(1))[0] ?? null;

  if (!row) return { amount: '0', rule: null, snapshot: null };
  const rule: PlatformFeeRule = row;
  return {
    amount: calculatePlatformFee(baseAmount, rule, currency),
    rule,
    snapshot: snapshotFromRule(rule),
  };
};

/** Returns the customer proceeds after a fee, preserving every stored decimal digit. */
export const calculateNetPlatformProceeds = (
  grossAmount: string | number,
  feeAmount: string | number,
): string => addStoredDecimals(grossAmount, `-${standardDecimal(feeAmount)}`);

/** True when a calculated fee leaves no positive proceeds for the customer. */
export const feeConsumesProceeds = (
  grossAmount: string | number,
  feeAmount: string | number,
): boolean => compareStoredDecimals(calculateNetPlatformProceeds(grossAmount, feeAmount), '0') <= 0;

// Friendly aliases for callers and tests that use the domain wording instead of the table wording.
/** Alias for {@link calculatePlatformFee}. */
export const calculateFee = calculatePlatformFee;

/** Alias for {@link resolvePlatformFee}. */
export const resolveFee = resolvePlatformFee;

/** Alias for {@link calculatePlatformFeeFromSnapshot}. */
export const calculateFeeFromSnapshot = calculatePlatformFeeFromSnapshot;

/** Alias for {@link calculateNetPlatformProceeds}. */
export const netAfterPlatformFee = calculateNetPlatformProceeds;
