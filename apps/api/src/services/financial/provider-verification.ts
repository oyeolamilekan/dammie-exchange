/**
 * Provider response validation for deposits, swaps, and withdrawals.
 *
 * Untrusted provider payloads are parsed and checked against the local owner,
 * reference, amount, and status expectations before settlement.
 *
 * @module providerVerificationService
 */

import { z } from 'zod';
import { normalizeCurrency } from '../../utils/currency';
import { addStoredDecimals, standardDecimal } from '../../utils/decimal';
import type { QuidaxClient } from '../integrations/quidax';

const amount = z.union([z.string().min(1), z.number().finite()]).transform(standardDecimal);
const positiveAmount = amount.refine((value) => value !== '0' && !value.startsWith('-'), 'Amount must be positive');
const nonnegativeAmount = amount.refine((value) => !value.startsWith('-'), 'Amount must not be negative');
const currency = z.string().trim().min(1).transform(normalizeCurrency);
const status = z.string().trim().min(1).transform((value) => value.toLowerCase());
const user = z.object({ id: z.string().nullable().optional() }).nullish();
const identity = z.object({ id: z.string().min(1), status, user }).passthrough();
const network = z.string().trim().transform((value) => value ? value.toLowerCase() : null).nullish();
const depositSchema = identity.extend({
  amount: positiveAmount, currency, txid: z.string().trim().min(1),
  network,
  payment_address: z.object({ network }).nullish(),
});
const swapSchema = identity.extend({
  from_currency: currency, to_currency: currency, from_amount: positiveAmount,
  received_amount: nonnegativeAmount.nullish(), execution_price: nonnegativeAmount.nullish(),
  price: nonnegativeAmount.nullish(), completed_at: z.string().nullish(),
  swap_quotation: z.object({ id: z.string() }).optional(),
});
const withdrawalSchema = identity.extend({
  reference: z.string().min(1), currency, amount: positiveAmount, fee: nonnegativeAmount,
  total: positiveAmount.optional(), total_amount: positiveAmount.optional(),
  reason: z.string().nullish(),
});

/** Normalized provider withdrawal record accepted by payout settlement. */
export type VerifiedWithdrawalRecord = z.infer<typeof withdrawalSchema>;

/** Error raised when Quidax reports a custody withdrawal as terminally failed. */
export class QuidaxWithdrawalFailedError extends Error {
  constructor() {
    super('Quidax withdrawal failed: failed');
    this.name = 'QuidaxWithdrawalFailedError';
  }
}

/** An API request scoped to the local owner is authoritative; reject an explicit different owner. */
const assertIdentity = (record: z.infer<typeof identity>, id: string, ownerId: string) => {
  if (record.id !== id || (record.user?.id && record.user.id !== ownerId)) {
    throw new Error('Quidax verification identity mismatch');
  }
};

/** Re-reads and validates a provider deposit for the expected owner. */
export const verifyDeposit = async (
  client: Pick<QuidaxClient, 'findDepositById'>,
  id: string,
  ownerId: string,
) => {
  const record = depositSchema.parse(await client.findDepositById(ownerId, id));
  assertIdentity(record, id, ownerId);
  const verifiedNetwork = record.network ?? record.payment_address?.network ?? null;
  return { ...record, network: verifiedNetwork, user: { id: ownerId }, payment_address: { network: verifiedNetwork } };
};

/** Re-reads and validates a provider swap transaction for the expected owner. */
export const verifySwap = async (
  client: Pick<QuidaxClient, 'findSwapTransactionById'>,
  id: string,
  local: { fromCurrency: string; toCurrency: string; fromAmount: string; quotationId: string; user: { subUserId: string } },
) => {
  const record = swapSchema.parse(await client.findSwapTransactionById(local.user.subUserId, id));
  assertIdentity(record, id, local.user.subUserId);
  if (record.from_currency !== normalizeCurrency(local.fromCurrency)
    || record.to_currency !== normalizeCurrency(local.toCurrency)
    || record.from_amount !== standardDecimal(local.fromAmount)
    || (record.swap_quotation && record.swap_quotation.id !== local.quotationId)) {
    throw new Error('Quidax swap verification relationship mismatch');
  }
  return record;
};

/** Re-reads and validates a provider custody withdrawal for the expected owner. */
export const verifyWithdrawal = async (
  client: Pick<QuidaxClient, 'findWithdrawalByReference'>,
  input: { id: string; reference: string; ownerId: string; expectedAmount: string },
) => {
  const record = withdrawalSchema.parse(await client.findWithdrawalByReference(
    input.ownerId, input.reference, 'ngn',
  ));
  assertIdentity(record, input.id, input.ownerId);
  if (record.reference !== input.reference || record.currency !== 'ngn'
    || record.amount !== standardDecimal(input.expectedAmount)) {
    throw new Error('Quidax withdrawal verification relationship mismatch');
  }
  if (record.status === 'failed') throw new QuidaxWithdrawalFailedError();
  if (record.status !== 'done') throw new Error(`Quidax withdrawal is not done: ${record.status}`);
  if (!record.total && !record.total_amount) throw new Error('Quidax withdrawal total is missing');
  return record;
};

/** Validates a provider payout against immutable local NGN withdrawal data. */
export const validateNgnPayoutRecord = (
  value: unknown,
  input: { reference: string; expectedAmount: string; expectedOwnerId: string; expectedId?: string },
): VerifiedWithdrawalRecord => {
  const record = withdrawalSchema.parse(value);
  if (input.expectedId && record.id !== input.expectedId) {
    throw new Error('Quidax NGN payout identifier mismatch');
  }
  if (record.user?.id && record.user.id !== input.expectedOwnerId) {
    throw new Error('Quidax NGN payout owner mismatch');
  }
  if (record.reference !== input.reference || record.currency !== 'ngn'
    || record.amount !== standardDecimal(input.expectedAmount)) {
    throw new Error('Quidax NGN payout relationship mismatch');
  }
  if (!['processing', 'done', 'rejected', 'failed'].includes(record.status)) {
    throw new Error(`Quidax NGN payout status is invalid: ${record.status}`);
  }
  const total = record.total ?? record.total_amount;
  if (!total) throw new Error('Quidax NGN payout total is missing');
  if (standardDecimal(total) !== addStoredDecimals(record.amount, record.fee)) {
    throw new Error('Quidax NGN payout total is invalid');
  }
  return record;
};

/** Reconciliation may record an in-flight operation, but never a rejected or unrelated one. */
export const assertReconciledWithdrawal = (record: { id: string; reference?: string; status?: string } | null, reference: string): void => {
  if (!record?.id || record.reference !== reference || !['processing', 'done'].includes(record.status?.toLowerCase() ?? '')) {
    throw new Error('Quidax withdrawal reconciliation could not be verified');
  }
};
