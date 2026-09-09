import { getUserByTelegramId } from '../queries/user.query';
import { createNgnWithdrawalIntent } from '../services/financial/ngn-withdrawals';
import { formatFinancialAmount } from '../utils/decimal';

export interface WithdrawNgnToolUserContext {
  userId: string | number;
}

/**
 * Creates a reviewable NGN bank-withdrawal intent without moving funds.
 *
 * The service validates the amount, wallet balance, fee, and bank-account
 * prerequisites. A successful result asks the customer to choose a verified
 * bank account and approve with a transaction PIN in the Mini App.
 *
 * @param amount NGN amount as a positive decimal string.
 * @param user Trusted Telegram user context.
 * @returns A Telegram-formatted review, prerequisite instruction, or failure
 * message.
 */
export const withdrawNgn = async (
  amount: string,
  user: WithdrawNgnToolUserContext,
): Promise<string> => {
  const telegramId = String(user.userId);
  const result = await createNgnWithdrawalIntent(telegramId, amount);
  switch (result.outcome) {
    case 'unavailable':
      return '❌ NGN withdrawals are temporarily unavailable. Please try again later.';
    case 'user-not-found':
      return '❌ User not found. Please ensure you are registered.';
    case 'wallet-not-found':
      return '❌ Your NGN wallet is unavailable.';
    case 'invalid-amount':
      return `❌ ${result.message}`;
    case 'insufficient-balance':
      return `❌ Insufficient NGN balance. This withdrawal requires ₦${formatFinancialAmount(result.total)}, but you have ₦${formatFinancialAmount(result.balance)}.`;
    case 'no-bank-account': {
      const owner = await getUserByTelegramId(telegramId);
      if (!owner) return '❌ User not found. Please ensure you are registered.';
      return `
🏦 *Bank Account Required*

Add and verify a bank account before withdrawing from your NGN wallet.

ACTION: ADD_BANK_ACCOUNT
PARAM: ${owner.id}
`;
    }
    case 'created':
      return `
🏦 *NGN Withdrawal Review*
• Bank receives: ₦${formatFinancialAmount(result.withdrawal.amount)}
• Withdrawal fee: ₦${formatFinancialAmount(result.withdrawal.fee)}
• Total wallet debit: ₦${formatFinancialAmount(result.total)}
• Status: Awaiting PIN approval

Choose a verified bank account and enter your transaction PIN to continue.

ACTION: APPROVE_WITHDRAWAL_ACTION
PARAM: ${result.withdrawal.id}
`;
  }
};
