/**
 * Immutable wallet balance-transition services.
 *
 * All financial balance changes are validated and recorded with account
 * versions, including idempotent retries and concurrent wallet updates.
 *
 * @module accountVersionService
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../database';
import { accountVersions, type AccountVersion, type AccountVersionAction, type AccountVersionTransactionType } from '../../db/schema/account-version.schema';
import { deposits } from '../../db/schema/deposit.schema';
import { swaps } from '../../db/schema/swap.schema';
import { currencies } from '../../db/schema/currency.schema';
import { wallets } from '../../db/schema/wallet.schema';
import { withdrawals } from '../../db/schema/withdrawal.schema';
import { addStoredDecimals, standardDecimal } from '../../utils/decimal';

/** The transaction type accepted by Drizzle's node-postgres driver. */
export type AccountVersionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Input identity and balances for one immutable account-version action. */
export interface RecordAccountVersionInput {
  /** Wallet whose balance observation is being recorded. */
  walletId: string;
  /** Transaction family that owns the account-version action. */
  transactionType: AccountVersionTransactionType;
  /** Database identifier of the originating transaction. */
  transactionId: string;
  /** Immutable balance-transition action being recorded. */
  action: AccountVersionAction;
  /** Amount moved by this immutable action, represented as a decimal value. */
  amount: string | number;
  /** Available balance before the transition, represented as a decimal value. */
  previousBalance: string | number;
  /** Available balance after the transition, represented as a decimal value. */
  balance: string | number;
  /** Locked balance after the transition, represented as a decimal value. */
  lockedBalance: string | number;
  /** Optional originating timestamp retained for a first insert. */
  createdAt?: Date;
}

/** Result of an account-version insert or idempotent retry lookup. */
export interface RecordedAccountVersion {
  /** Immutable account-version row returned by the operation. */
  version: AccountVersion;
  /** Whether this call inserted the row instead of observing an existing retry. */
  created: boolean;
}

const actionType: Record<AccountVersionAction, AccountVersionTransactionType> = {
  deposit_credit: 'deposit',
  swap_lock: 'swap',
  swap_complete: 'swap',
  swap_credit: 'swap',
  swap_restore: 'swap',
  withdrawal_lock: 'withdrawal',
  withdrawal_complete: 'withdrawal',
  withdrawal_restore: 'withdrawal',
};

/**
 * Normalizes a stored balance and enforces the schema's nonnegative precision.
 *
 * @param value - Decimal balance supplied by a caller or database calculation.
 * @param label - Human-readable balance name used in validation errors.
 * @returns Canonical decimal text accepted by numeric(36,18).
 * @throws If the value is empty, negative, or exceeds numeric(36,18).
 */
const normalizeBalance = (value: string | number, label: string): string => {
  const raw = String(value);
  if (!raw.trim()) throw new Error(`${label} is required`);
  const normalized = standardDecimal(value);
  if (normalized.startsWith('-')) throw new Error(`${label} must be nonnegative`);
  const [integer, fraction = ''] = normalized.split('.');
  if (integer.length > 18 || fraction.length > 18) {
    throw new Error(`${label} exceeds numeric(36,18)`);
  }
  return normalized;
};

/**
 * Compares two decimal values without allowing formatting differences to matter.
 *
 * @param left - First stored or requested decimal value.
 * @param right - Second stored or requested decimal value.
 * @returns Whether both values represent the same decimal amount.
 */
const sameAmount = (left: string | number, right: string | number): boolean =>
  standardDecimal(left) === standardDecimal(right);

type AccountVersionTarget = Pick<RecordAccountVersionInput, 'walletId' | 'transactionType' | 'transactionId' | 'action'>;
type TargetWallet = { id: string; userId: string; currency: string };
type AccountVersionBalances = Pick<RecordAccountVersionInput, 'amount' | 'previousBalance' | 'balance' | 'lockedBalance'>;

/**
 * Confirms that an account-version action is valid for its transaction family.
 *
 * @param action - Account-version action to validate.
 * @param transactionType - Transaction family supplied by the caller.
 * @throws If the action belongs to a different transaction family.
 */
const assertActionMatchesTransactionType = (
  action: AccountVersionAction,
  transactionType: AccountVersionTransactionType,
): void => {
  if (actionType[action] !== transactionType) {
    throw new Error('Account version action does not match transaction type');
  }
};

/**
 * Loads the wallet targeted by an account-version operation.
 *
 * @param tx - Transaction connection used for the read.
 * @param walletId - Wallet identifier supplied by the operation.
 * @returns The wallet identity and currency needed for relationship checks.
 * @throws If the wallet does not exist.
 */
const loadTargetWallet = async (
  tx: AccountVersionTransaction,
  walletId: string,
): Promise<TargetWallet> => {
  const wallet = (await tx.select({
    id: wallets.id,
    userId: wallets.userId,
    currency: currencies.code,
  }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(eq(wallets.id, walletId)).limit(1))[0];
  if (!wallet) throw new Error('Account version wallet was not found');
  return wallet;
};

/**
 * Validates the originating transaction relationship for an account version.
 *
 * @param tx - Transaction connection used for relationship reads.
 * @param input - Wallet and transaction identity being checked.
 * @returns The validated target wallet.
 * @throws If the action family, wallet, or originating relationship is invalid.
 */
const validateTarget = async (
  tx: AccountVersionTransaction,
  input: AccountVersionTarget,
): Promise<TargetWallet> => {
  assertActionMatchesTransactionType(input.action, input.transactionType);

  const wallet = await loadTargetWallet(tx, input.walletId);
  const currency = wallet.currency.toLowerCase();

  if (input.transactionType === 'deposit') {
    const deposit = (await tx.select({
      id: deposits.id, walletId: deposits.walletId, userId: deposits.userId, currency: deposits.currency,
    }).from(deposits).where(eq(deposits.id, input.transactionId)).limit(1))[0];
    if (!deposit || deposit.walletId !== wallet.id || deposit.userId !== wallet.userId ||
      deposit.currency.toLowerCase() !== currency) {
      throw new Error('Account version deposit relationship is invalid');
    }
  } else if (input.transactionType === 'swap') {
    const swap = (await tx.select({
      id: swaps.id, userId: swaps.userId,
      fromCurrency: swaps.fromCurrency, toCurrency: swaps.toCurrency,
    }).from(swaps).where(eq(swaps.id, input.transactionId)).limit(1))[0];
    const expectedCurrency = input.action === 'swap_credit'
      ? swap?.toCurrency.toLowerCase()
      : swap?.fromCurrency.toLowerCase();
    if (!swap || swap.userId !== wallet.userId || expectedCurrency !== currency) {
      throw new Error('Account version swap relationship is invalid');
    }
  } else {
    const withdrawal = (await tx.select({
      id: withdrawals.id, walletId: withdrawals.walletId, userId: withdrawals.userId,
    }).from(withdrawals).where(eq(withdrawals.id, input.transactionId)).limit(1))[0];
    if (!withdrawal || withdrawal.walletId !== wallet.id || withdrawal.userId !== wallet.userId) {
      throw new Error('Account version withdrawal relationship is invalid');
    }
  }

  return wallet;
};

/**
 * Compares an immutable account-version row with normalized requested balances.
 *
 * @param version - Persisted account-version row to inspect.
 * @param balances - Requested amount and balance values for the same action.
 * @returns Whether the wallet and all three balances match the immutable row.
 */
const compareVersion = (
  version: AccountVersion,
  balances: AccountVersionBalances,
): boolean => sameAmount(version.amount, balances.amount) &&
  sameAmount(version.previousBalance, balances.previousBalance) &&
  sameAmount(version.balance, balances.balance) &&
  sameAmount(version.lockedBalance, balances.lockedBalance);

/**
 * Builds the unique identity condition for one account-version action.
 *
 * @param transactionType - Transaction family owning the action.
 * @param transactionId - Originating transaction identifier.
 * @param action - Immutable action identifier.
 * @returns Drizzle condition matching only this transaction/action identity.
 */
const accountVersionIdentity = (
  transactionType: AccountVersionTransactionType,
  transactionId: string,
  action: AccountVersionAction,
): ReturnType<typeof and> => and(
  eq(accountVersions.transactionType, transactionType),
  eq(accountVersions.transactionId, transactionId),
  eq(accountVersions.action, action),
);

/**
 * Looks up an account-version row so retries can be handled idempotently.
 *
 * @param tx - Transaction connection used for the lookup.
 * @param input - Transaction/action identity to search.
 * @returns The existing immutable row, or undefined when this is the first attempt.
 */
const findExistingVersion = async (
  tx: AccountVersionTransaction,
  input: AccountVersionTarget,
): Promise<AccountVersion | undefined> => (await tx.select().from(accountVersions)
  .where(accountVersionIdentity(input.transactionType, input.transactionId, input.action))
  .limit(1))[0];

/**
 * Asserts that a retry observes the same wallet and immutable balances.
 *
 * @param version - Existing account-version row.
 * @param walletId - Wallet requested by the retry.
 * @param balances - Normalized balances requested by the retry.
 * @throws If the immutable action was reused with a different wallet or balance.
 */
const assertVersionMatchesRequest = (
  version: AccountVersion,
  walletId: string,
  balances: AccountVersionBalances,
): void => {
  if (version.walletId !== walletId || !compareVersion(version, balances)) {
    throw new Error('Account version action was reused with different balances');
  }
};

/**
 * Inserts one immutable balance observation in the caller's transaction.
 * The unique transaction/action key makes retries idempotent and rejects a
 * retry that attempts to record different balances for the same action.
 *
 * @param tx - Caller-owned database transaction.
 * @param input - Wallet, originating transaction, action, and requested balances.
 * @returns The existing or newly inserted version and its creation discriminator.
 * @throws If validation fails or an immutable action is reused with different details.
 * @sideEffects Inserts at most one account-version row; the caller controls the surrounding transaction boundary.
 */
export const recordAccountVersion = async (
  tx: AccountVersionTransaction,
  input: RecordAccountVersionInput,
): Promise<RecordedAccountVersion> => {
  const previousBalance = normalizeBalance(input.previousBalance, 'Previous balance');
  const balance = normalizeBalance(input.balance, 'Balance');
  const lockedBalance = normalizeBalance(input.lockedBalance, 'Locked balance');
  const amount = normalizeBalance(input.amount, 'Amount');
  await validateTarget(tx, input);

  const existing = await findExistingVersion(tx, input);
  if (existing) {
    assertVersionMatchesRequest(existing, input.walletId, { amount, previousBalance, balance, lockedBalance });
    return { version: existing, created: false };
  }

  const inserted = await tx.insert(accountVersions).values({
    walletId: input.walletId,
    transactionType: input.transactionType,
    transactionId: input.transactionId,
    action: input.action,
    amount,
    previousBalance,
    balance,
    lockedBalance,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  }).onConflictDoNothing({
    target: [accountVersions.transactionType, accountVersions.transactionId, accountVersions.action],
  }).returning({ id: accountVersions.id });

  const version = await findExistingVersion(tx, input);
  if (!version) throw new Error('Account version could not be recorded');
  assertVersionMatchesRequest(version, input.walletId, { amount, previousBalance, balance, lockedBalance });
  return { version, created: inserted.length > 0 };
};

/** Input for locking a wallet, applying balances, and recording one action. */
export interface MutateWalletAndRecordInput extends Omit<RecordAccountVersionInput, 'previousBalance' | 'balance' | 'lockedBalance'> {
  /** Available balance after the wallet mutation. */
  balance: string | number;
  /** Locked balance after the wallet mutation. */
  lockedBalance: string | number;
  /** Optional optimistic check against the wallet's available balance. */
  expectedPreviousBalance?: string | number;
}

/**
 * Locks, mutates, and records a wallet in one database transaction.
 *
 * @param tx - Caller-owned database transaction.
 * @param input - Wallet mutation, originating transaction, and expected-balance policy.
 * @returns The existing or newly inserted version and its creation discriminator.
 * @throws If the wallet, relationship, expected balance, or requested balances are invalid.
 * @sideEffects Acquires the wallet row lock, updates balances, and records one immutable action in the caller's transaction.
 */
export const mutateWalletAndRecordVersion = async (
  tx: AccountVersionTransaction,
  input: MutateWalletAndRecordInput,
): Promise<RecordedAccountVersion> => {
  const wallet = (await tx.select().from(wallets).where(eq(wallets.id, input.walletId)).for('update').limit(1))[0];
  if (!wallet) throw new Error('Wallet was not found');

  const balance = normalizeBalance(input.balance, 'Balance');
  const lockedBalance = normalizeBalance(input.lockedBalance, 'Locked balance');
  const amount = normalizeBalance(input.amount, 'Amount');
  await validateTarget(tx, input);
  const existing = await findExistingVersion(tx, input);
  if (existing) {
    assertVersionMatchesRequest(existing, input.walletId, {
      amount, previousBalance: existing.previousBalance, balance, lockedBalance,
    });
    return { version: existing, created: false };
  }
  if (input.expectedPreviousBalance !== undefined &&
    !sameAmount(wallet.balance, input.expectedPreviousBalance)) {
    throw new Error('Wallet available balance changed during mutation');
  }

  const updated = (await tx.update(wallets).set({
    balance, lockedBalance, updatedAt: new Date(),
  }).where(eq(wallets.id, wallet.id)).returning())[0];
  if (!updated) throw new Error('Wallet mutation failed');
  return recordAccountVersion(tx, {
    walletId: wallet.id,
    transactionType: input.transactionType,
    transactionId: input.transactionId,
    action: input.action,
    amount,
    previousBalance: wallet.balance,
    balance,
    lockedBalance,
  });
};

/**
 * Adds two stored decimal values without converting them through binary floating point.
 *
 * @param left - First exact decimal value.
 * @param right - Second exact decimal value.
 * @returns Exact decimal sum suitable for wallet persistence.
 */
export const addBalance = (left: string | number, right: string | number): string =>
  addStoredDecimals(left, right);
