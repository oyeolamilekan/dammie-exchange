/**
 * Durable local withdrawal persistence services.
 *
 * This module creates idempotent withdrawal records and updates their provider
 * lifecycle state; provider calls and balance holds belong to higher-level
 * financial workflows.
 *
 * @module withdrawalService
 */

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../database';
import { wallets } from '../../db/schema/wallet.schema';
import { withdrawals, type Withdrawal, type WithdrawalStatus } from '../../db/schema/withdrawal.schema';
import type { PlatformFeeSnapshotValues } from '../../db/schema/platform-fee.schema';
import { standardDecimal } from '../../utils/decimal';

/** Input required to create an idempotent durable withdrawal record. */
export interface CreateWithdrawalInput {
  /** Authenticated owner of the wallet withdrawal. */
  userId: string;
  /** Wallet from which the withdrawal is requested. */
  walletId: string;
  /** Positive withdrawal amount, normalized before persistence. */
  amount: string | number;
  /** Customer-visible fee charged in addition to the recipient amount. */
  fee?: string | number;
  /** Immutable platform-fee configuration copied at intent creation. */
  feeSnapshot?: PlatformFeeSnapshotValues | null;
  /** Optional caller-supplied idempotency reference. */
  reference?: string;
}

/**
 * Normalizes and validates a positive withdrawal amount.
 *
 * @param value - Decimal amount supplied by the caller.
 * @returns Canonical decimal text suitable for numeric(36,18) persistence.
 * @throws If the amount is non-positive or exceeds numeric(36,18).
 */
const positiveAmount = (value: string | number): string => {
  const amount = standardDecimal(value);
  if (amount.startsWith('-') || amount === '0') throw new Error('Withdrawal amount must be positive');
  const [integer, fraction = ''] = amount.split('.');
  if (integer.length > 18 || fraction.length > 18) throw new Error('Withdrawal amount exceeds numeric(36,18)');
  return amount;
};

/**
 * Resolves the caller reference or derives the stable withdrawal idempotency key.
 *
 * @param input - Withdrawal owner and wallet identity.
 * @param amount - Normalized positive withdrawal amount.
 * @returns A trimmed explicit reference or deterministic reference string.
 */
const deterministicReference = (input: CreateWithdrawalInput, amount: string): string => input.reference?.trim() ||
  `withdrawal-${createHash('sha256').update(`${input.userId}:${input.walletId}:${amount}`).digest('hex').slice(0, 40)}`;

/**
 * Compares a stored withdrawal with the requested idempotent identity.
 *
 * @param withdrawal - Existing database row found by reference.
 * @param input - Requested withdrawal owner and wallet.
 * @param amount - Normalized requested amount.
 * @returns Whether the existing row is safe to return for this retry.
 */
const matchesWithdrawalRequest = (
  withdrawal: Withdrawal,
  input: CreateWithdrawalInput,
  amount: string,
  fee: string,
): boolean => withdrawal.walletId === input.walletId &&
  withdrawal.userId === input.userId &&
  standardDecimal(withdrawal.amount) === amount &&
  standardDecimal(withdrawal.fee) === fee;

/**
 * Creates only the durable withdrawal record; no provider call is made here.
 *
 * @param input - Withdrawal owner, wallet, amount, and optional idempotency reference.
 * @returns Existing matching withdrawal or the newly inserted durable row.
 * @throws If the amount, reference, wallet relationship, or idempotent details are invalid.
 * @sideEffects Inserts at most one withdrawal row inside a database transaction and safely reloads concurrent conflicts.
 */
export const createWithdrawal = async (input: CreateWithdrawalInput): Promise<Withdrawal> => {
  const amount = positiveAmount(input.amount);
  const fee = standardDecimal(input.fee ?? '0');
  if (fee.startsWith('-')) throw new Error('Withdrawal fee must be nonnegative');
  const reference = deterministicReference(input, amount);
  if (!reference || reference.length > 250) throw new Error('Withdrawal reference is invalid');
  return db.transaction(async (tx) => {
    const wallet = (await tx.select({ id: wallets.id, userId: wallets.userId }).from(wallets).where(and(
      eq(wallets.id, input.walletId), eq(wallets.userId, input.userId),
    )).limit(1))[0];
    if (!wallet) throw new Error('Withdrawal wallet/user relationship is invalid');
    const existing = (await tx.select().from(withdrawals).where(eq(withdrawals.reference, reference)).limit(1))[0];
    if (existing) {
      if (!matchesWithdrawalRequest(existing, input, amount, fee)) {
        throw new Error('Withdrawal reference was reused with different details');
      }
      return existing;
    }
    const inserted = await tx.insert(withdrawals).values({
      userId: input.userId,
      walletId: input.walletId,
      amount,
      fee,
      reference,
      ...(input.feeSnapshot ? {
        platformFeeId: input.feeSnapshot.platformFeeId,
        platformFeeType: input.feeSnapshot.platformFeeType,
        platformFeeConfiguredAmount: input.feeSnapshot.platformFeeConfiguredAmount,
        platformFeeMinimumFee: input.feeSnapshot.platformFeeMinimumFee,
        platformFeeMaximumFee: input.feeSnapshot.platformFeeMaximumFee,
      } : {}),
    }).onConflictDoNothing({ target: withdrawals.reference }).returning();
    if (inserted[0]) return inserted[0];
    const concurrent = (await tx.select().from(withdrawals).where(eq(withdrawals.reference, reference)).limit(1))[0];
    if (!concurrent || !matchesWithdrawalRequest(concurrent, input, amount, fee)) {
      throw new Error('Withdrawal reference was reused with different details');
    }
    return concurrent;
  });
};

/**
 * Updates the provider status of a durable withdrawal record.
 *
 * @param id - Internal withdrawal identifier.
 * @param status - New provider-facing withdrawal status.
 * @param providerWithdrawalId - Optional provider withdrawal identifier.
 * @returns The updated row, or null when no withdrawal has the identifier.
 */
export const updateWithdrawalStatus = async (
  id: string,
  status: WithdrawalStatus,
  providerWithdrawalId?: string,
): Promise<Withdrawal | null> =>
  (await db.update(withdrawals).set({ status, providerWithdrawalId, updatedAt: new Date() })
    .where(eq(withdrawals.id, id)).returning())[0] ?? null;

/**
 * Finds a durable withdrawal by its idempotency reference without changing state.
 *
 * @param reference - Durable withdrawal reference.
 * @returns The matching withdrawal, or null when it does not exist.
 */
export const findWithdrawalByReference = async (reference: string): Promise<Withdrawal | null> =>
  (await db.select().from(withdrawals).where(eq(withdrawals.reference, reference)).limit(1))[0] ?? null;

/** Finds a local withdrawal by the provider identifier used in webhook payloads. */
export const findWithdrawalByProviderId = async (providerWithdrawalId: string): Promise<Withdrawal | null> =>
  (await db.select().from(withdrawals)
    .where(eq(withdrawals.providerWithdrawalId, providerWithdrawalId)).limit(1))[0] ?? null;
