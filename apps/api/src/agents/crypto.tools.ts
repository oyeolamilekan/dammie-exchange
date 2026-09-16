import { dynamicTool } from 'ai';
import type {
  AccountVersionAction,
  AccountVersionTransactionType,
} from '../db/schema/account-version.schema';
import type { SupportedCrypto } from '../queries/catalog.query';
import {
  addBankAccount,
  completeSignUp,
  fetchWallet,
  getPortfolioSnapshot,
  getWalletAddress,
  getWalletBalance,
  removeBankAccount,
  withdrawNgn,
} from '../tools';
import { computeAndFormatTotalDeposit } from '../tools/compute-user-deposit';
import { computeAndFormatTotalSwap } from '../tools/compute-user-swaps';
import { initiateSwap } from '../tools/create-swap';
import { fetchAccountHistory } from '../tools/fetch-account-history';
import { fetchUserDeposits } from '../tools/fetch-user-deposit';
import { fetchUserSwaps } from '../tools/fetch-user-swaps';
import { extractValue, removeKeyValuePairs } from '../utils';
import { createCryptoSchemas } from './crypto.schemas';
import type { CryptoToolOutput, CryptoUserContext } from './crypto.types';

type CryptoDynamicTool = ReturnType<typeof dynamicTool>;

type CryptoToolName =
  | 'completeSignUp'
  | 'addBankAccount'
  | 'removeBankAccount'
  | 'fetchSwaps'
  | 'fetchDeposits'
  | 'computeTotalDeposits'
  | 'computeTotalSwaps'
  | 'createSwap'
  | 'withdrawNgn'
  | 'fetchWallet'
  | 'getPortfolioSnapshot'
  | 'getWalletBalance'
  | 'getWalletAddress'
  | 'fetchAccountHistory';

export type CryptoTools = Record<CryptoToolName, CryptoDynamicTool>;

export interface CryptoAgentDependencies {
  addBankAccount: typeof addBankAccount;
  completeSignUp: typeof completeSignUp;
  removeBankAccount: typeof removeBankAccount;
  fetchUserSwaps: typeof fetchUserSwaps;
  fetchUserDeposits: typeof fetchUserDeposits;
  computeTotalDeposit: typeof computeAndFormatTotalDeposit;
  computeTotalSwap: typeof computeAndFormatTotalSwap;
  initiateSwap: typeof initiateSwap;
  withdrawNgn: typeof withdrawNgn;
  fetchWallet: typeof fetchWallet;
  getPortfolioSnapshot: typeof getPortfolioSnapshot;
  getWalletBalance: typeof getWalletBalance;
  getWalletAddress: typeof getWalletAddress;
  fetchAccountHistory: typeof fetchAccountHistory;
}

const defaultDependencies: CryptoAgentDependencies = {
  addBankAccount,
  completeSignUp,
  removeBankAccount,
  fetchUserSwaps,
  fetchUserDeposits,
  computeTotalDeposit: computeAndFormatTotalDeposit,
  computeTotalSwap: computeAndFormatTotalSwap,
  initiateSwap,
  withdrawNgn,
  fetchWallet,
  getPortfolioSnapshot,
  getWalletBalance,
  getWalletAddress,
  fetchAccountHistory,
};

/** Converts the legacy ACTION/PARAM tool protocol into a typed trusted output. */
export function normalizeToolOutput(response: string): CryptoToolOutput {
  const action = extractValue(response, 'ACTION');
  const param = extractValue(response, 'PARAM')?.trim();
  const message = removeKeyValuePairs(response, ['ACTION', 'PARAM']);

  if (action === 'GET_WALLET_ADDRESS' && param) {
    return { message, action: { kind: 'wallet_address', address: param } };
  }

  if (
    param
    && (
      action === 'ADD_BANK_ACCOUNT'
      || action === 'REMOVE_BANK_ACCOUNT'
      || action === 'APPROVE_SWAP_ACTION'
      || action === 'APPROVE_WITHDRAWAL_ACTION'
    )
  ) {
    return { message, action: { kind: 'web_app', name: action, param } };
  }

  return { message };
}

const normalize = async (result: Promise<string>): Promise<CryptoToolOutput> =>
  normalizeToolOutput(await result);

const resolveToolArguments = (
  catalogOrOverrides: readonly SupportedCrypto[] | Partial<CryptoAgentDependencies>,
  overrides: Partial<CryptoAgentDependencies>,
) => Array.isArray(catalogOrOverrides)
  ? { catalog: catalogOrOverrides, overrides }
  : { catalog: [], overrides: catalogOrOverrides };

export function createCryptoTools(
  context: CryptoUserContext,
  catalog: readonly SupportedCrypto[],
  overrides?: Partial<CryptoAgentDependencies>,
): CryptoTools;
/** Compatibility overload for callers that only need tools without a catalog. */
export function createCryptoTools(
  context: CryptoUserContext,
  overrides?: Partial<CryptoAgentDependencies>,
): CryptoTools;
export function createCryptoTools(
  context: CryptoUserContext,
  catalogOrOverrides: readonly SupportedCrypto[] | Partial<CryptoAgentDependencies> = [],
  dependencyOverrides: Partial<CryptoAgentDependencies> = {},
): CryptoTools {
  const { catalog, overrides } = resolveToolArguments(catalogOrOverrides, dependencyOverrides);
  const schemas = createCryptoSchemas(catalog);
  const dependencies = { ...defaultDependencies, ...overrides };
  const user = { username: context.username, userId: context.userId };

  const parseTransactionFilters = (input: unknown) =>
    schemas.transactionFilterSchema.parse(input) as Record<string, unknown>;

  return {
    completeSignUp: dynamicTool({
      description: 'Show the trusted signup welcome and open the signup Mini App when the user is not registered.',
      inputSchema: schemas.emptyToolSchema,
      execute: async (input) => {
        schemas.emptyInputSchema.parse(input);
        return dependencies.completeSignUp(context, catalog);
      },
    }),
    addBankAccount: dynamicTool({
      description: "Create the user's add-bank-account action.",
      inputSchema: schemas.emptyToolSchema,
      execute: async (input) => {
        schemas.emptyInputSchema.parse(input);
        return normalize(dependencies.addBankAccount(user));
      },
    }),
    removeBankAccount: dynamicTool({
      description: "Open the user's saved-bank-account removal screen.",
      inputSchema: schemas.emptyToolSchema,
      execute: async (input) => {
        schemas.emptyInputSchema.parse(input);
        return normalize(dependencies.removeBankAccount(user));
      },
    }),
    fetchSwaps: dynamicTool({
      description: "Fetch the user's swap history with optional filters.",
      inputSchema: schemas.transactionFilterToolSchema,
      execute: async (input) => normalize(dependencies.fetchUserSwaps({
        ...parseTransactionFilters(input),
        ...user,
      } as Parameters<typeof dependencies.fetchUserSwaps>[0])),
    }),
    fetchDeposits: dynamicTool({
      description: "Fetch the user's deposit history with optional filters.",
      inputSchema: schemas.transactionFilterToolSchema,
      execute: async (input) => normalize(dependencies.fetchUserDeposits({
        ...parseTransactionFilters(input),
        ...user,
      } as Parameters<typeof dependencies.fetchUserDeposits>[0])),
    }),
    fetchAccountHistory: dynamicTool({
      description: `Fetch the user's account history for ${schemas.supportedCurrencyLabel}, or NGN.`,
      inputSchema: schemas.accountHistoryToolSchema,
      execute: async (input) => {
        const filters = schemas.accountHistorySchema.parse(input) as {
          action?: AccountVersionAction;
          transactionType?: AccountVersionTransactionType;
          [key: string]: unknown;
        };
        return normalize(dependencies.fetchAccountHistory({
          ...filters,
          ...user,
        } as Parameters<typeof dependencies.fetchAccountHistory>[0]));
      },
    }),
    computeTotalDeposits: dynamicTool({
      description: "Calculate totals for the user's successful deposits.",
      inputSchema: schemas.transactionFilterToolSchema,
      execute: async (input) => normalize(dependencies.computeTotalDeposit({
        ...parseTransactionFilters(input),
        ...user,
      } as Parameters<typeof dependencies.computeTotalDeposit>[0])),
    }),
    computeTotalSwaps: dynamicTool({
      description: "Calculate totals for the user's successful swaps.",
      inputSchema: schemas.transactionFilterToolSchema,
      execute: async (input) => normalize(dependencies.computeTotalSwap({
        ...parseTransactionFilters(input),
        ...user,
      } as Parameters<typeof dependencies.computeTotalSwap>[0])),
    }),
    createSwap: dynamicTool({
      description: 'Create a crypto-to-Naira quotation that still requires explicit user approval.',
      inputSchema: schemas.swapToolSchema,
      execute: async (input) => {
        const { amount, coin } = schemas.swapInputSchema.parse(input) as {
          amount: string;
          coin: string;
        };
        return normalize(dependencies.initiateSwap(amount, coin, user, catalog));
      },
    }),
    withdrawNgn: dynamicTool({
      description: 'Create an NGN bank-withdrawal request that requires bank selection and PIN approval.',
      inputSchema: schemas.withdrawalToolSchema,
      execute: async (input) => {
        const { amount } = schemas.withdrawalInputSchema.parse(input) as { amount: string };
        return normalize(dependencies.withdrawNgn(amount, user));
      },
    }),
    fetchWallet: dynamicTool({
      description: `Fetch one wallet with its balances, status, and deposit addresses. Supported currencies: ${schemas.supportedCurrencyLabel}, or NGN.`,
      inputSchema: schemas.walletToolSchema,
      execute: async (input) => {
        const { coin } = schemas.walletInputSchema.parse(input) as { coin: string };
        return normalize(dependencies.fetchWallet(coin, user, catalog));
      },
    }),
    getPortfolioSnapshot: dynamicTool({
      description: "Read the authenticated user's complete portfolio balances and successful activity snapshot.",
      inputSchema: schemas.emptyToolSchema,
      execute: async (input) => {
        schemas.emptyInputSchema.parse(input);
        return dependencies.getPortfolioSnapshot(user);
      },
    }),
    getWalletBalance: dynamicTool({
      description: `Read the user's wallet balance for ${schemas.supportedCurrencyLabel}.`,
      inputSchema: schemas.walletBalanceToolSchema,
      execute: async (input) => {
        const { coin } = schemas.walletBalanceInputSchema.parse(input) as { coin: string };
        return normalize(dependencies.getWalletBalance(coin, user, catalog));
      },
    }),
    getWalletAddress: dynamicTool({
      description: `Read the user's network-specific deposit address for ${schemas.supportedCurrencyLabel}.`,
      inputSchema: schemas.walletAddressToolSchema,
      execute: async (input) => {
        const { coin, network } = schemas.walletAddressInputSchema.parse(input) as {
          coin: string;
          network: string;
        };
        return normalize(dependencies.getWalletAddress(coin, network, user, catalog));
      },
    }),
  };
}
