/**
 * Provider deposit recording and wallet-credit services.
 *
 * Deposit confirmation and successful-credit paths are idempotent and update
 * wallet balances through account-version transactions.
 *
 * @module depositService
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../database';
import { deposits } from '../../db/schema/deposit.schema';
import { users } from '../../db/schema/user.schema';
import { currencies } from '../../db/schema/currency.schema';
import { wallets } from '../../db/schema/wallet.schema';
import { findDeposit } from '../../queries/deposit.query';
import { findOneWallet } from '../../queries/wallet.query';
import { getUserBy } from '../../queries/user.query';
import { standardDecimal } from '../../utils/decimal';
import { normalizeCurrency } from '../../utils/currency';
import {
  addBalance,
  mutateWalletAndRecordVersion,
  type AccountVersionTransaction,
} from './account-versions';

/** Provider payload used to credit a successful cryptocurrency deposit. */
export interface SuccessfulDepositPayload {
  /** Provider deposit identifier. */
  id: string;
  /** Required to record a deposit when success arrives before confirmation. */
  txid?: string;
  network?: string | null;
  /** Deposited amount in the provider's decimal representation. */
  amount: string | number;
  /** Deposit currency code. */
  currency: string;
  /** Provider sub-user identity associated with the deposit. */
  user: { id: string };
}

/** Result of an idempotent successful-deposit credit attempt. */
export interface DepositCreditResult {
  /** Whether this call changed a pending deposit into a credited deposit. */
  credited: boolean;
  /** Notification-safe user details returned only for a newly credited deposit. */
  user?: { chatId: string; email: string };
}

type DepositUser = { id: string; chatId: string; email: string };
type PendingDeposit = typeof deposits.$inferSelect;
type DepositWallet = {
  id: string;
  userId: string;
  currency: string;
  balance: string;
  lockedBalance: string;
};

/** Provider payload used to record a deposit awaiting confirmation. */
export interface DepositConfirmationPayload {
  id: string;
  amount: string | number;
  currency: string;
  txid: string;
  network?: string | null;
  user: { id: string };
  payment_address?: { network?: string | null } | null;
}

/** Result of recording the pending deposit, before its Telegram notification. */
export interface DepositConfirmationResult {
  recorded: boolean;
  user?: { chatId: string };
}

/**
 * Validates and normalizes a successful deposit amount.
 *
 * @param value - Provider amount to credit.
 * @returns Canonical decimal text used by wallet arithmetic and queries.
 * @throws If the amount is not a positive finite decimal.
 */
const validateDepositAmount = (value: string | number): string => {
  const amount = standardDecimal(value);
  if (amount.startsWith('-') || amount === '0') {
    throw new Error('Deposit amount must be a positive finite number');
  }
  return amount;
};

/** Records one provider deposit idempotently before network confirmation. */
export const recordDepositConfirmation = async (
  payload: DepositConfirmationPayload,
): Promise<DepositConfirmationResult> => {
  const user = await getUserBy({ subUserId: payload.user.id });
  if (!user) throw new Error(`User not found for subUserId: ${payload.user.id}`);

  const existingDeposit = await findDeposit({ depositId: payload.id });
  if (existingDeposit) return { recorded: false };

  const wallet = await findOneWallet({
    userId: user.id,
    currency: normalizeCurrency(payload.currency),
  }, { enabledOnly: false });
  if (!wallet) throw new Error(`Wallet not found for user: ${user.id}, currency: ${payload.currency}`);

  const inserted = await db.insert(deposits).values({
    userId: user.id,
    walletId: wallet.id,
    currency: normalizeCurrency(payload.currency),
    depositId: payload.id,
    network: payload.network,
    amount: validateDepositAmount(payload.amount),
    txid: payload.txid,
  }).onConflictDoNothing({ target: deposits.depositId }).returning({ id: deposits.id });
  return inserted.length ? { recorded: true, user: { chatId: user.chatId } } : { recorded: false };
};

/**
 * Loads the local user associated with a provider sub-user.
 *
 * @param tx - Transaction connection used for the lookup.
 * @param providerUserId - Provider sub-user identifier.
 * @returns Local user identity and notification fields.
 * @throws If no local user matches the provider identity.
 */
const loadDepositUser = async (
  tx: AccountVersionTransaction,
  providerUserId: string,
): Promise<DepositUser> => {
  const user = (await tx.select({ id: users.id, chatId: users.chatId, email: users.email })
    .from(users).where(eq(users.subUserId, providerUserId)).limit(1))[0];
  if (!user) throw new Error('Deposit user relationship is invalid');
  return user;
};

/**
 * Loads and locks the deposit, recording it if success arrived before confirmation.
 *
 * @param tx - Transaction connection used for the locked lookup.
 * @param payload - Provider deposit identity and amount.
 * @param userId - Local user identifier.
 * @param amount - Normalized deposit amount.
 * @returns The validated local deposit row before crediting.
 * @throws If the deposit identity, owner, currency, or amount is invalid.
 */
const loadPendingDeposit = async (
  tx: AccountVersionTransaction,
  payload: SuccessfulDepositPayload,
  userId: string,
  amount: string,
): Promise<PendingDeposit> => {
  const load = async () => (await tx.select().from(deposits)
    .where(eq(deposits.depositId, payload.id)).for('update').limit(1))[0];
  let deposit = await load();
  if (!deposit) {
    if (!payload.txid?.trim()) throw new Error('Missing deposit requires a transaction ID');
    const wallet = (await tx.select({ id: wallets.id }).from(wallets)
      .innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
      eq(wallets.userId, userId),
      eq(currencies.code, normalizeCurrency(payload.currency)),
    )).limit(1))[0];
    if (!wallet) throw new Error('Deposit wallet relationship is invalid');
    await tx.insert(deposits).values({
      depositId: payload.id, userId, walletId: wallet.id,
      currency: normalizeCurrency(payload.currency), amount, txid: payload.txid,
      network: payload.network,
    }).onConflictDoNothing({ target: deposits.depositId });
    // A concurrent confirmation or success may have inserted first. Lock and validate its row.
    deposit = await load();
  }
  if (!deposit || deposit.userId !== userId
    || normalizeCurrency(deposit.currency) !== normalizeCurrency(payload.currency)
    || standardDecimal(deposit.amount) !== amount
    || (payload.txid !== undefined && deposit.txid !== payload.txid)) {
    throw new Error('Deposit state or relationship is invalid');
  }
  if (payload.network && deposit.network !== payload.network) {
    if (deposit.network) throw new Error('Verified deposit network conflicts with stored network');
    await tx.update(deposits).set({ network: payload.network, updatedAt: new Date() })
      .where(eq(deposits.id, deposit.id));
  }
  return deposit;
};

/**
 * Loads and locks the wallet that owns the pending deposit.
 *
 * @param tx - Transaction connection used for the locked lookup.
 * @param deposit - Local deposit row being credited.
 * @param user - Local deposit owner.
 * @param currency - Provider currency code.
 * @returns The matching wallet.
 * @throws If the wallet does not belong to the user or currency.
 */
const loadDepositWallet = async (
  tx: AccountVersionTransaction,
  deposit: PendingDeposit,
  user: DepositUser,
  currency: string,
): Promise<DepositWallet> => {
  const wallet = (await tx.select({
    id: wallets.id,
    userId: wallets.userId,
    currency: currencies.code,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
  }).from(wallets).innerJoin(currencies, eq(wallets['currencyId'], currencies.id)).where(and(
    eq(wallets.id, deposit.walletId),
    eq(wallets.userId, user.id),
    eq(currencies.code, normalizeCurrency(currency)),
  )).for('update').limit(1))[0];
  if (!wallet) throw new Error('Deposit wallet relationship is invalid');
  return wallet;
};

/**
 * Credits one successful deposit exactly once and records its account version.
 *
 * @param payload - Provider deposit completion payload.
 * @returns Whether the deposit was newly credited and notification-safe user details.
 * @throws If the payload or local deposit relationships are invalid.
 * @sideEffects Locks and mutates the wallet, inserts an immutable account version, and conditionally updates the deposit inside one transaction.
 */
export const creditSuccessfulDeposit = async (payload: SuccessfulDepositPayload): Promise<DepositCreditResult> => {
  const amount = validateDepositAmount(payload.amount);
  return db.transaction(async (tx) => {
    const user = await loadDepositUser(tx, payload.user.id);
    const deposit = await loadPendingDeposit(tx, payload, user.id, amount);
    if (deposit.status === 'success') return { credited: false };
    if (deposit.status !== 'pending') throw new Error('Deposit state or relationship is invalid');

    const wallet = await loadDepositWallet(tx, deposit, user, payload.currency);
    await mutateWalletAndRecordVersion(tx, {
      walletId: wallet.id, transactionType: 'deposit', transactionId: deposit.id,
      action: 'deposit_credit', amount, balance: addBalance(wallet.balance, amount), lockedBalance: wallet.lockedBalance,
    });
    await tx.update(deposits).set({ status: 'success', updatedAt: new Date() })
      .where(and(eq(deposits.id, deposit.id), eq(deposits.status, 'pending')));
    return { credited: true, user: { chatId: user.chatId, email: user.email } };
  });
};
