import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { banks, type NewBank } from '../db/schema/bank.schema';

/**
 * Saved bank-account persistence queries.
 *
 * Creating an account demotes the user's previous defaults and makes the new
 * account default in one database transaction.
 *
 * @module bankQuery
 */

/** Optional fields used to find one or more saved bank accounts. */
export interface BankCondition {
  /** Bank record identifier. */
  id?: string;
  /** Owning user identifier. */
  userId?: string;
  /** Bank account number. */
  accountNumber?: string;
  /** Provider bank code. */
  bankCode?: string;
  /** Whether the account is the user's default account. */
  isDefault?: boolean;
}

/** Builds an AND predicate from the supplied bank-account fields. */
const whereBank = (condition: BankCondition): SQL | undefined => {
  const clauses: SQL[] = [isNull(banks.deletedAt)];
  if (condition.id !== undefined) clauses.push(eq(banks.id, condition.id));
  if (condition.userId !== undefined) clauses.push(eq(banks.userId, condition.userId));
  if (condition.accountNumber !== undefined) clauses.push(eq(banks.accountNumber, condition.accountNumber));
  if (condition.bankCode !== undefined) clauses.push(eq(banks.bankCode, condition.bankCode));
  if (condition.isDefault !== undefined) clauses.push(eq(banks.isDefault, condition.isDefault));
  return clauses.length ? and(...clauses) : undefined;
};

/**
 * Saves a bank account and makes it the user's default account.
 * Existing accounts for the same user are demoted in the same transaction.
 */
export const createBank = (
  data: Omit<NewBank, 'isDefault' | 'deletedAt'>,
) => db.transaction(async (tx) => {
  await tx.update(banks).set({ isDefault: false, updatedAt: new Date() }).where(and(
    eq(banks.userId, data.userId),
    isNull(banks.deletedAt),
  ));
  return (await tx.insert(banks).values({
    ...data,
    isDefault: true,
    deletedAt: null,
  }).returning())[0];
});

/** Finds the newest/default matching bank account, or `null` when absent. */
export const findBank = async (condition: BankCondition) =>
  (await db.select().from(banks).where(whereBank(condition))
    .orderBy(desc(banks.isDefault), desc(banks.createdAt)).limit(1))[0] ?? null;

/** Finds a user's default bank account. */
export const findDefaultBankForUser = (userId: string) => findBank({ userId, isDefault: true });

/** Lists all saved bank accounts for a user, default first. */
export const findBanksForUser = (userId: string) =>
  db.select().from(banks).where(and(eq(banks.userId, userId), isNull(banks.deletedAt)))
    .orderBy(desc(banks.isDefault), desc(banks.createdAt));

/** Lists bank accounts using the legacy page-number pagination contract. */
export const findAllBank = (condition: BankCondition, page = 1) =>
  db.select().from(banks).where(whereBank(condition)).orderBy(desc(banks.createdAt)).offset((page - 1) * 20).limit(20);

/** Updates the first matching bank account and refreshes its update timestamp. */
export const findAndUpdateBank = async (condition: BankCondition, data: Partial<NewBank>) =>
  (await db.update(banks).set({ ...data, updatedAt: new Date() }).where(whereBank(condition)).returning())[0] ?? null;

/**
 * Removes an owner-scoped saved account while retaining its historical row.
 * When the default is removed, the newest remaining account becomes default.
 */
export const removeBankForUser = (
  bankId: string,
  userId: string,
) => db.transaction(async (tx) => {
  const activeBanks = await tx.select().from(banks).where(and(
    eq(banks.userId, userId),
    isNull(banks.deletedAt),
  )).orderBy(desc(banks.createdAt)).for('update');
  const target = activeBanks.find((bank) => bank.id === bankId);
  if (!target) return null;

  const now = new Date();
  await tx.update(banks).set({
    deletedAt: now,
    isDefault: false,
    updatedAt: now,
  }).where(and(
    eq(banks.id, bankId),
    eq(banks.userId, userId),
    isNull(banks.deletedAt),
  ));

  if (target.isDefault) {
    const replacement = activeBanks.find((bank) => bank.id !== bankId);
    if (replacement) {
      await tx.update(banks).set({ isDefault: true, updatedAt: now })
        .where(eq(banks.id, replacement.id));
    }
  }

  return target;
});
