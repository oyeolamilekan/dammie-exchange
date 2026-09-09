/**
 * Provider settlement-value normalization helpers.
 *
 * Converts untrusted execution and sweep values into validated decimal/date
 * structures before the settlement store persists them.
 *
 * @module swapSettlementValues
 */

import { addStoredDecimals, standardDecimal } from '../../../utils/decimal';

/** Normalized provider execution values needed by the settlement store. */
export interface ExecutionDetails {
  /** Gross amount received from the completed swap. */
  gross: string;
  /** Provider execution price, retained until persistence validates it. */
  price: unknown;
  /** Provider completion time or the current time when absent or invalid. */
  completedAt: Date;
}

/** Normalized provider sweep totals used for reconciliation. */
export interface SweepDetails {
  /** Amount delivered by the provider sweep. */
  delivered: string;
  /** Provider fee included in the reported total. */
  fee: string;
  /** Provider-reported total amount. */
  total: string;
}

/**
 * Narrows an unknown provider value to a record without trusting its shape.
 *
 * @param value - Provider response value to inspect.
 * @returns The value as a record when it is object-like, otherwise an empty record.
 */
export const asProviderRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

/**
 * Validates and normalizes a positive provider decimal value.
 *
 * @param value - Provider field value to normalize.
 * @param label - Domain field label used in validation errors.
 * @returns Canonical positive decimal text.
 * @throws If the value is not a string/number decimal, zero, or negative.
 */
export const validatePositiveProviderValue = (value: unknown, label: string): string => {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label} is invalid`);
  const amount = standardDecimal(value);
  if (amount.startsWith('-') || amount === '0') throw new Error(`${label} is invalid`);
  return amount;
};

/**
 * Resolves a valid provider completion timestamp with the existing current-time fallback.
 *
 * @param value - Provider timestamp value, if present.
 * @returns The valid supplied date or a new Date when the value is absent or invalid.
 */
export const resolveCompletionTimestamp = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date;
  }
  return new Date();
};

/**
 * Builds execution details exclusively from the re-queried provider transaction.
 *
 * @param verified - Re-read provider transaction values, when available.
 * @returns Gross amount, execution price candidate, and completion timestamp.
 * @throws If the resolved received amount is not a positive provider value.
 */
export const buildExecutionDetails = (
  verified: Record<string, unknown>,
): ExecutionDetails => ({
  gross: validatePositiveProviderValue(verified.received_amount, 'Completed swap amount'),
  price: validatePositiveProviderValue(verified.execution_price ?? verified.price, 'Execution price'),
  completedAt: resolveCompletionTimestamp(verified.completed_at ?? verified.completedAt),
});

/**
 * Builds and reconciles the provider sweep amount, fee, and total.
 *
 * @param payload - Successful-sweep webhook totals.
 * @param fallbackAmount - Stored executed amount used when the webhook omits amount.
 * @returns Normalized sweep values whose amount plus fee equals total.
 * @throws If any value is invalid or the exact decimal totals do not reconcile.
 */
export const buildSweepDetails = (
  payload: {
    amount?: string | number;
    fee?: string | number;
    total?: string | number;
    total_amount?: string | number;
  },
  fallbackAmount: string,
): SweepDetails => {
  const delivered = validatePositiveProviderValue(payload.amount ?? fallbackAmount, 'Sweep amount');
  const fee = payload.fee === undefined ? '0' : standardDecimal(payload.fee);
  if (fee.startsWith('-')) throw new Error('Provider fee is invalid');
  const total = validatePositiveProviderValue(
    payload.total ?? payload.total_amount ?? addStoredDecimals(delivered, fee),
    'Sweep total',
  );
  if (standardDecimal(addStoredDecimals(delivered, fee)) !== total) {
    throw new Error('Sweep amount and provider total do not reconcile');
  }
  return { delivered, fee, total };
};
