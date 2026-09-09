import { findBanksForUser } from '../queries/bank.query';
import { getUserByTelegramId } from '../queries/user.query';

interface BankAccountToolUserContext {
  userId: string | number;
}

/** Opens the authenticated Mini App flow for removing a saved bank account. */
export const removeBankAccount = async (
  user: BankAccountToolUserContext,
): Promise<string> => {
  const userData = await getUserByTelegramId(String(user.userId));
  if (!userData) {
    return '❌ User not found. Please ensure you are registered.';
  }
  if (!(await findBanksForUser(userData.id)).length) {
    return 'You do not have any saved bank accounts to remove.';
  }

  return `
🏦 *Manage Bank Accounts*

Choose the saved bank account you want to remove. Historical withdrawals will remain unchanged.

ACTION: REMOVE_BANK_ACCOUNT
PARAM: ${userData.id}
`;
};
