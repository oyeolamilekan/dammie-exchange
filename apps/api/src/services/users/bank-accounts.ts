/**
 * Bank-account verification and persistence service.
 *
 * Provider validation and customer-name matching run before the account is
 * saved as the user's default bank account.
 *
 * @module bankAccountService
 */

import { isAcceptableAccountName } from '../../helpers/nameMatcher';
import { MESSAGES } from '../../helpers/messages';
import {
  createBank,
  findBank,
  findBanksForUser,
  removeBankForUser,
} from '../../queries/bank.query';
import { getUserByTelegramId } from '../../queries/user.query';
import type { QuidaxClient } from '../integrations/quidax';

/** Minimal provider operation required by bank-account verification. @internal */
type BankAccountQuidaxClient = Pick<QuidaxClient, 'validateBankAccount'>;
/** Persisted bank-account row returned by the query layer. @internal */
type CreatedBankAccount = Awaited<ReturnType<typeof createBank>>;

/** Side effects supplied by the HTTP composition root for bank-account mutations. */
export interface BankAccountServiceDependencies {
  quidax: BankAccountQuidaxClient;
  notify(chatId: string, text: string): Promise<unknown>;
}

/** Input extracted from the authenticated bank-account request. */
export interface AddBankAccountInput {
  telegramId: string;
  bankCode?: string;
  accountNumber?: string;
}

/** Expected bank-account outcomes; provider and database failures still throw. */
export type AddBankAccountResult =
  | { outcome: 'user-not-found' }
  | { outcome: 'invalid-input'; message: string }
  | { outcome: 'already-exists' }
  | { outcome: 'name-mismatch' }
  | { outcome: 'created'; bankAccount: CreatedBankAccount };

export interface SavedBankAccount {
  id: string;
  accountName: string;
  accountNumberMasked: string;
  bankCode: string;
  isDefault: boolean;
}

export type ListBankAccountsResult =
  | { outcome: 'user-not-found' }
  | { outcome: 'found'; bankAccounts: SavedBankAccount[] };

export type RemoveBankAccountResult =
  | { outcome: 'invalid-input' | 'user-not-found' | 'bank-not-found' }
  | { outcome: 'removed' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toSavedBankAccount = (bank: Awaited<ReturnType<typeof findBanksForUser>>[number]): SavedBankAccount => ({
  id: bank.id,
  accountName: bank.accountName,
  accountNumberMasked: `${'•'.repeat(Math.max(0, bank.accountNumber.length - 4))}${bank.accountNumber.slice(-4)}`,
  bankCode: bank.bankCode,
  isDefault: bank.isDefault,
});

/** Creates the bank-account verification and persistence workflow. */
export const createBankAccountService = (dependencies: BankAccountServiceDependencies) =>
  async (input: AddBankAccountInput): Promise<AddBankAccountResult> => {
    const user = await getUserByTelegramId(input.telegramId);
    if (!user) return { outcome: 'user-not-found' };
    if (!input.bankCode || !input.accountNumber) {
      return {
        outcome: 'invalid-input',
        message: 'Bank code and account number are required',
      };
    }

    const existingBankAccount = await findBank({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
    if (existingBankAccount) return { outcome: 'already-exists' };

    const bankAccountData = await dependencies.quidax.validateBankAccount(
      input.accountNumber,
      input.bankCode,
    );
    if (!isAcceptableAccountName(
      bankAccountData.account_name,
      `${user.firstName} ${user.lastName}`,
    )) {
      return { outcome: 'name-mismatch' };
    }

    const bankAccount = await createBank({
      userId: user.id,
      accountNumber: input.accountNumber,
      accountName: bankAccountData.account_name,
      bankCode: input.bankCode,
    });
    void dependencies.notify(user.chatId, MESSAGES.BANK_ACCOUNT_UPDATED());
    return { outcome: 'created', bankAccount };
  };

/** Constructed bank-account service contract. */
export type BankAccountService = ReturnType<typeof createBankAccountService>;

/** Lists the authenticated customer's active saved accounts without exposing full numbers. */
export const listSavedBankAccounts = async (
  telegramId: string,
): Promise<ListBankAccountsResult> => {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return { outcome: 'user-not-found' };
  return {
    outcome: 'found',
    bankAccounts: (await findBanksForUser(user.id)).map(toSavedBankAccount),
  };
};

/** Soft-deletes only a bank account owned by the authenticated customer. */
export const removeSavedBankAccount = async (input: {
  telegramId: string;
  bankId: string;
}): Promise<RemoveBankAccountResult> => {
  if (!UUID.test(input.bankId)) return { outcome: 'invalid-input' };
  const user = await getUserByTelegramId(input.telegramId);
  if (!user) return { outcome: 'user-not-found' };
  const removed = await removeBankForUser(input.bankId, user.id);
  return removed ? { outcome: 'removed' } : { outcome: 'bank-not-found' };
};
