/**
 * Local NGN withdrawal intent, review, locking, and settlement services.
 *
 * Intent creation does not move funds. Approval snapshots bank details and
 * locks the total debit; provider completion or rejection then settles or
 * restores that hold.
 *
 * @module ngnWithdrawalService
 */

import { randomInt } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import CONFIG from '../../config/config';
import { db } from '../../database';
import { accountVersions } from '../../db/schema/account-version.schema';
import { banks } from '../../db/schema/bank.schema';
import { currencies } from '../../db/schema/currency.schema';
import { users } from '../../db/schema/user.schema';
import { wallets } from '../../db/schema/wallet.schema';
import { withdrawals, type Withdrawal } from '../../db/schema/withdrawal.schema';
import { findBanksForUser } from '../../queries/bank.query';
import { findBankNameByCode } from '../../queries/bank-catalog.query';
import { getUserByTelegramId } from '../../queries/user.query';
import { findOneWallet } from '../../queries/wallet.query';
import { addStoredDecimals, standardDecimal } from '../../utils/decimal';
import { addBalance, mutateWalletAndRecordVersion } from './account-versions';
import { resolvePlatformFee } from './platform-fees';
import { createWithdrawal } from './withdrawals';
import { appendProviderResponse } from '../../utils/provider-response';

const NGN_VALUE = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** Creates a compact provider-safe reference such as `ngn-withdrawal-qwerutiasd`. */
export const createNgnWithdrawalReference = (): string => {
  const suffix = Array.from(
    { length: 10 },
    () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)],
  ).join('');
  return `ngn-withdrawal-${suffix}`;
};

const ngnValue = (value: string | number, label: string, allowZero: boolean): string => {
  const raw = String(value).trim();
  if (!NGN_VALUE.test(raw)) throw new Error(`${label} must be an NGN amount with at most two decimal places`);
  const normalized = standardDecimal(raw);
  if (!allowZero && normalized === '0') throw new Error(`${label} must be greater than zero`);
  return normalized;
};

/** The payout account remains the operational availability gate for bank withdrawals. */
export const isNgnWithdrawalPayoutAvailable = (): boolean => Boolean(CONFIG.MAIN_ACCOUNT_ID?.trim());

/**
 * Compatibility reader for callers that need the current configured flat value.
 * New transaction paths resolve the fee against their actual amount instead.
 */
export const getConfiguredNgnWithdrawalFee = async (): Promise<string | null> => {
  if (!isNgnWithdrawalPayoutAvailable()) return null;
  return (await resolvePlatformFee('ngn', 'withdrawal', '0')).amount;
};

/** Returns the total wallet debit for an NGN withdrawal. */
export const getNgnWithdrawalTotal = (withdrawal: Pick<Withdrawal, 'amount' | 'fee'>): string =>
  addStoredDecimals(withdrawal.amount, withdrawal.fee);

/** Result discriminators for local NGN withdrawal-intent creation. */
export type CreateNgnWithdrawalIntentResult =
  | { outcome: 'unavailable' | 'user-not-found' | 'wallet-not-found' | 'no-bank-account' }
  | { outcome: 'invalid-amount'; message: string }
  | { outcome: 'insufficient-balance'; balance: string; total: string }
  | { outcome: 'created'; withdrawal: Withdrawal; total: string };

/** Creates a local intent only. No funds move and no provider request occurs. */
export const createNgnWithdrawalIntent = async (
  telegramId: string,
  requestedAmount: string | number,
): Promise<CreateNgnWithdrawalIntentResult> => {
  if (!isNgnWithdrawalPayoutAvailable()) return { outcome: 'unavailable' };
  let amount: string;
  try {
    amount = ngnValue(requestedAmount, 'Withdrawal amount', false);
  } catch (error: unknown) {
    return { outcome: 'invalid-amount', message: error instanceof Error ? error.message : 'Invalid amount' };
  }
  const user = await getUserByTelegramId(telegramId);
  if (!user?.isActive) return { outcome: 'user-not-found' };
  const wallet = await findOneWallet({ userId: user.id, currency: 'ngn' });
  if (!wallet || wallet.isCrypto) return { outcome: 'wallet-not-found' };
  if (!(await findBanksForUser(user.id)).length) return { outcome: 'no-bank-account' };
  const resolvedFee = await resolvePlatformFee('ngn', 'withdrawal', amount);
  const fee = resolvedFee.amount;
  const total = addStoredDecimals(amount, fee);
  if (addStoredDecimals(wallet.balance, `-${total}`).startsWith('-')) {
    return { outcome: 'insufficient-balance', balance: standardDecimal(wallet.balance), total };
  }
  const withdrawal = await createWithdrawal({
    userId: user.id,
    walletId: wallet.id,
    amount,
    fee,
    feeSnapshot: resolvedFee.snapshot,
    reference: createNgnWithdrawalReference(),
  });
  return { outcome: 'created', withdrawal, total };
};

/** Owner-scoped withdrawal review returned to the Mini App. */
export interface NgnWithdrawalReview {
  id: string;
  amount: string;
  fee: string;
  total: string;
  status: Withdrawal['status'];
  approved: boolean;
  balance: string;
  bankAccounts: Array<{
    id: string;
    accountName: string;
    accountNumberMasked: string;
    bankCode: string;
    isDefault: boolean;
  }>;
}

/** Loads only an authenticated owner's withdrawal review data. */
export const getNgnWithdrawalReview = async (
  withdrawalId: string,
  telegramId: string,
): Promise<NgnWithdrawalReview | null> => {
  if (!UUID.test(withdrawalId)) return null;
  const user = await getUserByTelegramId(telegramId);
  if (!user?.isActive) return null;
  const row = (await db.select({
    withdrawal: withdrawals,
    balance: wallets.balance,
    currency: currencies.code,
    isCrypto: currencies.isCrypto,
  }).from(withdrawals)
    .innerJoin(wallets, eq(withdrawals.walletId, wallets.id))
    .innerJoin(currencies, eq(wallets.currencyId, currencies.id))
    .where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.userId, user.id)))
    .limit(1))[0];
  if (!row || row.currency !== 'ngn' || row.isCrypto) return null;
  const bankAccounts = (await findBanksForUser(user.id)).map((bank) => ({
    id: bank.id,
    accountName: bank.accountName,
    accountNumberMasked: `${'•'.repeat(Math.max(0, bank.accountNumber.length - 4))}${bank.accountNumber.slice(-4)}`,
    bankCode: bank.bankCode,
    isDefault: bank.isDefault,
  }));
  return {
    id: row.withdrawal.id,
    amount: standardDecimal(row.withdrawal.amount),
    fee: standardDecimal(row.withdrawal.fee),
    total: getNgnWithdrawalTotal(row.withdrawal),
    status: row.withdrawal.status,
    approved: Boolean(row.withdrawal.approvedAt),
    balance: standardDecimal(row.balance),
    bankAccounts,
  };
};

/** Outcomes of atomically locking a withdrawal for provider submission. */
export type LockNgnWithdrawalResult =
  | { outcome: 'not-found' | 'bank-not-found' | 'invalid-state' | 'wallet-unavailable' }
  | { outcome: 'insufficient-balance'; balance: string; total: string }
  | { outcome: 'locked' | 'already-locked'; withdrawal: Withdrawal; total: string };

/** Snapshots the selected bank and atomically moves the customer debit into locked funds. */
export const lockNgnWithdrawal = (
  withdrawalId: string,
  userId: string,
  bankId: string,
): Promise<LockNgnWithdrawalResult> => db.transaction(async (tx) => {
  const withdrawal = (await tx.select().from(withdrawals).where(and(
    eq(withdrawals.id, withdrawalId), eq(withdrawals.userId, userId),
  )).for('update').limit(1))[0];
  if (!withdrawal) return { outcome: 'not-found' };
  const total = getNgnWithdrawalTotal(withdrawal);
  if (withdrawal.approvedAt) {
    if (withdrawal.bankId !== bankId || !['pending', 'processing'].includes(withdrawal.status)) {
      return { outcome: 'invalid-state' };
    }
    const lockedVersion = (await tx.select({ id: accountVersions.id }).from(accountVersions).where(and(
      eq(accountVersions.transactionType, 'withdrawal'),
      eq(accountVersions.transactionId, withdrawal.id),
      eq(accountVersions.action, 'withdrawal_lock'),
    )).limit(1))[0];
    if (!lockedVersion) return { outcome: 'invalid-state' };
    return { outcome: 'already-locked', withdrawal, total };
  }
  if (withdrawal.status !== 'pending') return { outcome: 'invalid-state' };
  const bank = (await tx.select().from(banks).where(and(
    eq(banks.id, bankId), eq(banks.userId, userId), isNull(banks.deletedAt),
  )).limit(1))[0];
  if (!bank) return { outcome: 'bank-not-found' };
  const wallet = (await tx.select({
    id: wallets.id,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
  }).from(wallets).innerJoin(currencies, eq(wallets.currencyId, currencies.id)).where(and(
    eq(wallets.id, withdrawal.walletId),
    eq(wallets.userId, userId),
    eq(currencies.code, 'ngn'),
    eq(currencies.isCrypto, false),
    eq(currencies.enabled, true),
  )).for('update').limit(1))[0];
  if (!wallet) return { outcome: 'wallet-unavailable' };
  const nextBalance = addBalance(wallet.balance, `-${total}`);
  if (nextBalance.startsWith('-')) {
    return { outcome: 'insufficient-balance', balance: standardDecimal(wallet.balance), total };
  }
  await mutateWalletAndRecordVersion(tx, {
    walletId: wallet.id,
    transactionType: 'withdrawal',
    transactionId: withdrawal.id,
    action: 'withdrawal_lock',
    amount: total,
    balance: nextBalance,
    lockedBalance: addBalance(wallet.lockedBalance, total),
  });
  const updated = (await tx.update(withdrawals).set({
    bankId: bank.id,
    accountNumber: bank.accountNumber,
    accountName: bank.accountName,
    bankCode: bank.bankCode,
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(withdrawals.id, withdrawal.id)).returning())[0];
  return { outcome: 'locked', withdrawal: updated, total };
});

/** Atomically claims an approved local withdrawal for provider submission. */
export const claimApprovedNgnWithdrawal = async (withdrawalId: string): Promise<Withdrawal | null> => {
  const claimed = (await db.update(withdrawals).set({ status: 'processing', updatedAt: new Date() }).where(and(
    eq(withdrawals.id, withdrawalId),
    eq(withdrawals.status, 'pending'),
    isNotNull(withdrawals.approvedAt),
    isNotNull(withdrawals.bankId),
    isNotNull(withdrawals.accountNumber),
    isNotNull(withdrawals.accountName),
    isNotNull(withdrawals.bankCode),
  )).returning())[0];
  if (claimed) return claimed;
  return (await db.select().from(withdrawals)
    .where(eq(withdrawals.id, withdrawalId)).limit(1))[0] ?? null;
};

/** Saves provider withdrawal identity/response data for later reconciliation. */
export const saveNgnProviderWithdrawal = async (
  withdrawalId: string,
  providerWithdrawalId: string,
  providerFee: string | number,
  providerResponse?: unknown,
  responseStage = 'payoutVerification',
): Promise<Withdrawal | null> => db.transaction(async (tx) => {
  const current = (await tx.select().from(withdrawals).where(and(
    eq(withdrawals.id, withdrawalId), eq(withdrawals.status, 'processing'),
  )).for('update').limit(1))[0];
  if (!current) return null;
  return (await tx.update(withdrawals).set({
    providerWithdrawalId,
    providerFee: standardDecimal(providerFee),
    ...(providerResponse === undefined ? {} : {
      providerResponse: appendProviderResponse(current.providerResponse, responseStage, providerResponse),
    }),
    updatedAt: new Date(),
  }).where(eq(withdrawals.id, withdrawalId)).returning())[0] ?? null;
});

/** Result of settling a provider withdrawal webhook. */
export interface SettleNgnWithdrawalResult {
  changed: boolean;
  withdrawal: Withdrawal;
  total: string;
}

const settleNgnWithdrawal = (
  withdrawalId: string,
  outcome: 'success' | 'failed',
  providerFee: string | number,
  failureReason?: string,
  providerResponse?: unknown,
): Promise<SettleNgnWithdrawalResult | null> => db.transaction(async (tx) => {
  const withdrawal = (await tx.select().from(withdrawals)
    .where(eq(withdrawals.id, withdrawalId)).for('update').limit(1))[0];
  if (!withdrawal) return null;
  const total = getNgnWithdrawalTotal(withdrawal);
  if (withdrawal.status === outcome) return { changed: false, withdrawal, total };
  const canSettle = outcome === 'success'
    ? withdrawal.status === 'processing' && Boolean(withdrawal.approvedAt)
    : withdrawal.status === 'processing' || withdrawal.status === 'pending';
  if (!canSettle) {
    throw new Error('NGN withdrawal cannot be settled from its current state');
  }
  const settlementUpdate = {
    status: outcome,
    providerFee: standardDecimal(providerFee),
    failureReason: outcome === 'failed' ? failureReason?.slice(0, 500) ?? 'Provider rejected withdrawal' : null,
    ...(providerResponse === undefined ? {} : {
      providerResponse: appendProviderResponse(withdrawal.providerResponse, 'payoutVerification', providerResponse),
    }),
    completedAt: new Date(),
    updatedAt: new Date(),
  } as const;
  const lockedVersion = (await tx.select({ id: accountVersions.id }).from(accountVersions).where(and(
    eq(accountVersions.transactionType, 'withdrawal'),
    eq(accountVersions.transactionId, withdrawal.id),
    eq(accountVersions.action, 'withdrawal_lock'),
  )).limit(1))[0];
  if (!lockedVersion) {
    if (outcome !== 'failed' || withdrawal.status !== 'pending') {
      throw new Error('NGN withdrawal lock record is missing');
    }
    const updated = (await tx.update(withdrawals).set(settlementUpdate)
      .where(eq(withdrawals.id, withdrawal.id)).returning())[0];
    return { changed: true, withdrawal: updated, total };
  }
  const wallet = (await tx.select().from(wallets).where(eq(wallets.id, withdrawal.walletId))
    .for('update').limit(1))[0];
  if (!wallet) throw new Error('NGN withdrawal wallet was not found');
  const nextLocked = addBalance(wallet.lockedBalance, `-${total}`);
  if (nextLocked.startsWith('-')) throw new Error('NGN withdrawal locked balance is invalid');
  await mutateWalletAndRecordVersion(tx, {
    walletId: wallet.id,
    transactionType: 'withdrawal',
    transactionId: withdrawal.id,
    action: outcome === 'success' ? 'withdrawal_complete' : 'withdrawal_restore',
    amount: total,
    balance: outcome === 'success' ? wallet.balance : addBalance(wallet.balance, total),
    lockedBalance: nextLocked,
  });
  const updated = (await tx.update(withdrawals).set(settlementUpdate)
    .where(eq(withdrawals.id, withdrawal.id)).returning())[0];
  return { changed: true, withdrawal: updated, total };
});

/** Completes a successful withdrawal and records any provider fee. */
export const completeNgnWithdrawal = (id: string, providerFee: string | number) =>
  settleNgnWithdrawal(id, 'success', providerFee);

/** Restores a rejected withdrawal's locked funds and stores its failure reason. */
export const restoreNgnWithdrawal = (
  id: string,
  providerFee: string | number,
  reason?: string,
  providerResponse?: unknown,
) => settleNgnWithdrawal(id, 'failed', providerFee, reason, providerResponse);

/** Retrieves the payout owner without exposing authentication secrets. */
export const findNgnWithdrawalOwner = async (withdrawalId: string) => {
  const owner = (await db.select({ withdrawal: withdrawals, chatId: users.chatId })
    .from(withdrawals).innerJoin(users, eq(withdrawals.userId, users.id))
    .where(eq(withdrawals.id, withdrawalId)).limit(1))[0] ?? null;
  if (!owner) return null;
  const bankName = owner.withdrawal.bankCode
    ? await findBankNameByCode(owner.withdrawal.bankCode)
    : null;
  return { ...owner, bankName };
};
