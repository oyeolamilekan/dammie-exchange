import type { SupportedCrypto } from '../queries/catalog.query';

const renderSupportedCryptoList = (supportedCryptos: readonly SupportedCrypto[]): string =>
  supportedCryptos
  .map(({ code, networks }) => (
    `• ${code.toUpperCase()}: ${networks.map((network) => network.code.toUpperCase()).join(', ')}`
  ))
  .join('\n');

const renderCryptoExamples = (supportedCryptos: readonly SupportedCrypto[]): string => {
  const first = supportedCryptos[0]?.code.toUpperCase() || 'CRYPTO';
  const second = supportedCryptos[1]?.code.toUpperCase() || first;
  return [
    `• "What's my ${first} balance?"`,
    `• "I want to swap 10 ${second} to Naira"`,
  ].join('\n');
};

export const MESSAGES = {
  /**
   * @function WELCOME
   * @description Welcome message displayed when a user first interacts with the bot.
   * @param {string} username - The username of the user.
   * @param supportedCryptos - Catalog rows loaded for this operation.
   * @returns {string} Formatted welcome message with supported cryptocurrencies and usage examples.
   */
  WELCOME: (username: string, supportedCryptos: readonly SupportedCrypto[] = []) => `
🚀 *Welcome to Dammie Crypto Bot!*

Hello ${username}, how far? I'm here to help you with crypto-to-Naira conversions! 💰

*Supported Cryptocurrencies:*
${renderSupportedCryptoList(supportedCryptos)}

Ready to start trading? Just type your request naturally, like:
${renderCryptoExamples(supportedCryptos)}

No wahala, I got you covered! 🇳🇬
  `,

  /** Message shown when signup is requested for an existing customer. */
  ALREADY_REGISTERED: (username: string, supportedCryptos: readonly SupportedCrypto[] = []) => `
✅ *You're Already Registered!*

Hello ${username}, your Dammie account is already set up and ready to trade crypto-to-Naira! 💰

*Supported Cryptocurrencies:*
${renderSupportedCryptoList(supportedCryptos)}

You can ask me naturally, for example:
${renderCryptoExamples(supportedCryptos)}

No wahala, I got you covered! 🇳🇬
  `,

  /**
   * @function HELP
   * @description Displays help information and usage instructions for the bot.
   * @returns {string} Help message with natural language commands and security tips.
   */
  HELP: () => `
❓ *How to Use Dammie Crypto Bot*

*Natural Language Commands:*
• "Check my USDC balance"
• "What's my USDT wallet address on TRC20?"
• "I want to swap 100 USDT to Naira"
• "Give me a quote for 50 CNGN"

*Need Support?*
Email: support@appstate.co

*Security Tips:*
⚠️ Never share your private keys
⚠️ Always verify transaction details
⚠️ Double-check wallet addresses
  `,

  /**
   * @function PENDING_DESPOSIT
   * @description Message for a pending cryptocurrency deposit awaiting network confirmations.
   * @param {string} amount - The amount of cryptocurrency being deposited.
   * @param {string} currency - The currency symbol (e.g., USDC, USDT).
   * @param {string} blockchain - The blockchain network (e.g., BASE, ERC20).
   * @param {string} hash - The transaction hash.
   * @returns {string} Formatted message indicating deposit is pending confirmation.
   */
  PENDING_DESPOSIT: (amount: string, currency: string, blockchain: string | null | undefined, hash: string) => `
🚀 Your deposit is on its way! ⏳
💎 Amount: ${amount} ${currency.toUpperCase()}
🌐 Blockchain: ${blockchain?.trim().toUpperCase() || 'Not provided'}
📝 Transaction ID: ${hash}
🔄 Currently awaiting network confirmations...
⏱️ This usually takes just a few minutes
🔔 We'll ping you the moment it's ready!
  `,

  /**
   * @function ADDRESS_ASSIGNED
   * @description Message sent when a wallet address is assigned to a user for a specific cryptocurrency.
   * @param {string} address - The assigned wallet address.
   * @param {string} currency - The currency symbol (e.g., USDC, USDT).
   * @param {string} network - The configured blockchain network.
   * @returns {string} Formatted message with the assigned wallet address and instructions.
   */
  ADDRESS_ASSIGNED: (address: string, currency: string, network: string) => `
🚀 Your wallet address has been assigned! ✅
💎 Address: ${address}
💎 Currency: ${currency.toUpperCase()}
🌐 Network: ${network.toUpperCase()}
You can now send your ${currency.toUpperCase()} on ${network.toUpperCase()} to this address.
  `,

  /**
   * @function SUCESS_DEPOSIT
   * @description Message for a successfully deposited cryptocurrency.
   * @param {string} amount - The amount of cryptocurrency deposited.
   * @param {string} currency - The currency symbol (e.g., USDC, USDT).
   * @param {string} blockchain - The blockchain network (e.g., BASE, ERC20).
   * @param {string} hash - The transaction hash.
   */
  SUCESS_DEPOSIT: (amount: string, currency: string, blockchain: string | null | undefined, hash: string) => `
🎉 Deposit Complete - You're All Set! ✅
💎 Amount Credited: ${amount} ${currency.toUpperCase()}
🌐 Blockchain: ${blockchain?.trim().toUpperCase() || 'Not provided'}
📝 Transaction ID: ${hash}
✨ Successfully confirmed and added to your balance
🚀 Your funds are now available for trading!

  `,

  /**
   * @description Rate limiting warning message when user sends messages too quickly.
   */
  RATE_LIMITED: "⚠️ Please slow down! You're sending messages too quickly. Try again in a minute.",

  /**
   * @description Generic error message for unexpected errors.
   */
  ERROR: "😔 Sorry, I encountered an error. Please try again later or contact support.",

  /**
   * @description Error message displayed when the system is receiving too many requests.
   */
  RATE_LIMIT_ERROR: "⚠️ I'm receiving too many requests. Please wait a moment and try again.",

  /**
   * @description Message for invalid message types (non-text messages).
   */
  INVALID_MESSAGE: "Please send a text message. I can help you with crypto transactions! 💰",

  /**
   * @description Message for unrecognized or unclear user requests.
   */
  UNKNOWN_REQUEST: "🤔 I'm not sure how to help with that. Try asking about crypto balances, wallet addresses, or swaps!",

  /**
   * @function SWAP_COMPLETED
   * @description Message for a successfully completed swap.
   * @param {string} amount - The amount of cryptocurrency swapped.
   * @param {string} currency - The configured currency symbol.
   */
  SWAP_COMPLETED: (amount: string, currency: string) => `
🎉 Swap Completed! Your ${amount} ${currency} swap is all done. The Naira has been sent to your bank. 🚀
`,

  /**
   * @function FAILED_SWAP
   * @description Message for a failed swap.
   * @param {string} amount - The amount of cryptocurrency that failed to swap.
   * @param {string} currency - The configured currency symbol.
   */
  FAILED_SWAP: (amount: string, currency: string) => `
❌ Your swap of ${amount} ${currency} has failed. The crypto has been returned to your wallet. Please try again or contact support. 😔
`,

  /**
   * @description Message for a failed customer NGN bank withdrawal.
   * @param {string} amount - The amount sent to the bank.
   * @param {string} total - The total amount restored to the wallet.
   */
  FAILED_NGN_WITHDRAWAL: (amount: string, total: string) => `
❌ Your ₦${amount} bank withdrawal failed and ₦${total} was restored to your NGN wallet. Please try again or contact support.
`,

  /**
   * @description Message for a custody transfer failure during a completed swap.
   */
  FAILED_CUSTODY_WITHDRAWAL: () => `
❌ Your swap payout failed while being transferred to your NGN wallet. Our team has been notified and will review it shortly.
`,

  /**
   * @function BANK_ACCOUNT_UPDATED
   * @description Message for successfully updated bank account details.
   * @param {string} accountName - The name on the bank account.
   * @param {string} accountNumber - The bank account number.
   * @param {string} bankName - The name of the bank.
   */
  BANK_ACCOUNT_UPDATED: () => `
✅ Your bank account details have been successfully added!
`,

/**
 * @function ACCOUNT_CREATED
 * @description Message for successfully created account.
 * @param {string} username - The username of the user.
 */
  ACCOUNT_CREATED: (username: string, supportedCryptos: readonly SupportedCrypto[] = []) => `
🎉 Account Created Successfully! ✅
Hello ${username}, how far? I'm here to help you with crypto-to-Naira conversions! 💰

*Supported Cryptocurrencies:*
${renderSupportedCryptoList(supportedCryptos)}

Ready to start trading? Just type your request naturally, like:
${renderCryptoExamples(supportedCryptos)}

No wahala, I got you covered! 🇳🇬
  `,

  /**
   * @function SWAP_APPROVED
   * @description Message for successfully approved swap.
   * @param {string} amount - The amount of cryptocurrency swapped.
   * @param {string} currency - The configured currency symbol.
   */
  SWAP_APPROVED: (amount: string, currency: string) => `
🎉 Swap Approved! ✅
Your swap of ${amount} ${currency} has been approved. And Transaction is being processed. 🚀
`
};
