import { getUserByTelegramId } from "../queries/user.query";

interface BankAccountToolUserContext {
  userId: string | number;
}

/**
 * Returns the Telegram action that opens the bank-account Mini App.
 *
 * The bank account is not created by this tool. The returned `PARAM` contains
 * the internal owner identifier used by the bot when it builds the Mini App
 * action; the Mini App still authenticates with signed Telegram init data.
 *
 * @param user Trusted Telegram context for the current customer.
 * @returns A Telegram-formatted instruction or a registered-user error.
 */
export const addBankAccount = async (user: BankAccountToolUserContext): Promise<string> => {
  const userData = await getUserByTelegramId(String(user.userId));

  if (!userData) {
    return '❌ User not found. Please ensure you are registered.';
  }

  const { id } = userData;

  return `
🏦 *Add Bank Account*

Add a bank account now so it is ready for future Naira withdrawals.

📋 *Required Information:*
• Bank Name
• Account Number (10 digits)

⚠️ *Important:*
• The account name must match the name you used during registration
• Any mismatch will cause verification failure

📱 *Next Step:*
Click the button below to open the bank account form in Telegram and update your information.

ACTION: ADD_BANK_ACCOUNT
PARAM: ${id}
`;
}
