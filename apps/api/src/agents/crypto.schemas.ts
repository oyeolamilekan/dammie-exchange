import { jsonSchema } from 'ai';
import { z } from 'zod';
import type { SupportedCrypto } from '../queries/catalog.query';

export interface CryptoSchemas {
  transactionFilterSchema: z.ZodTypeAny;
  swapInputSchema: z.ZodTypeAny;
  withdrawalInputSchema: z.ZodTypeAny;
  accountHistorySchema: z.ZodTypeAny;
  walletBalanceInputSchema: z.ZodTypeAny;
  walletInputSchema: z.ZodTypeAny;
  walletAddressInputSchema: z.ZodTypeAny;
  emptyInputSchema: z.ZodTypeAny;
  emptyToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  transactionFilterToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  accountHistoryToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  swapToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  withdrawalToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  walletBalanceToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  walletToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  walletAddressToolSchema: ReturnType<typeof jsonSchema<unknown>>;
  supportedCurrencyLabel: string;
}

const ACCOUNT_ACTIONS = [
  'deposit_credit',
  'swap_lock',
  'swap_complete',
  'swap_credit',
  'swap_restore',
  'withdrawal_lock',
  'withdrawal_complete',
  'withdrawal_restore',
] as const;

const TRANSACTION_TYPES = ['deposit', 'swap', 'withdrawal'] as const;
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const DECIMAL_PATTERN = '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$';
const NGN_AMOUNT_PATTERN = '^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$';

const normalizeCatalog = (catalog: readonly SupportedCrypto[]): SupportedCrypto[] =>
  catalog.map((crypto) => ({
    ...crypto,
    code: crypto.code.trim().toLowerCase(),
    networks: crypto.networks.map((network) => ({
      ...network,
      code: network.code.trim().toLowerCase(),
    })),
  }));

const withCaseVariants = (values: readonly string[]): string[] =>
  values.flatMap((value) => [value.toUpperCase(), value]);

const isoDateSchema = z.string()
  .regex(new RegExp(DATE_PATTERN), 'Use YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date');

const validateDateRange = (
  dates: { startDate?: string; endDate?: string },
  context: z.RefinementCtx,
) => {
  if (dates.startDate && dates.endDate && dates.startDate > dates.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endDate must be on or after startDate',
      path: ['endDate'],
    });
  }
};

const transactionDateProperties = {
  startDate: { type: 'string', pattern: DATE_PATTERN },
  endDate: { type: 'string', pattern: DATE_PATTERN },
  cursor: { type: 'string', minLength: 1, maxLength: 512 },
} as const;

/** Builds the validation and model-facing schemas for the current currency catalog. */
export const createCryptoSchemas = (
  supportedCryptos: readonly SupportedCrypto[],
): CryptoSchemas => {
  const catalog = normalizeCatalog(supportedCryptos);
  const supportedCurrencies = catalog.map(({ code }) => code);
  const supportedCurrencySet = new Set(supportedCurrencies);
  const supportedNetworks = [
    ...new Set(catalog.flatMap(({ networks }) => networks.map(({ code }) => code))),
  ];
  const supportedNetworkSet = new Set(supportedNetworks);
  const supportedCurrencyLabel = supportedCurrencies
    .map((currency) => currency.toUpperCase())
    .join(', ') || 'no currencies are currently available';

  const supportedCoinSchema = z.string()
    .transform((coin) => coin.trim().toLowerCase())
    .refine((coin) => supportedCurrencySet.has(coin), {
      message: `Supported currencies are ${supportedCurrencyLabel}`,
    });
  const supportedNetworkSchema = z.string()
    .transform((network) => network.trim().toLowerCase())
    .refine((network) => supportedNetworkSet.has(network), {
      message: 'Unsupported wallet network',
    });

  const transactionFilterSchema = z.object({
    coin: supportedCoinSchema.optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
  }).superRefine(validateDateRange);

  const swapInputSchema = z.object({
    amount: z.string()
      .regex(new RegExp(DECIMAL_PATTERN), 'Use a positive decimal amount')
      .refine((amount) => Number.isFinite(Number(amount)) && Number(amount) > 0, {
        message: 'Amount must be greater than zero',
      }),
    coin: supportedCoinSchema,
  });
  const withdrawalInputSchema = z.object({
    amount: z.string()
      .regex(
        new RegExp(NGN_AMOUNT_PATTERN),
        'Use an NGN amount with at most two decimal places',
      )
      .refine((amount) => Number(amount) > 0, 'Amount must be greater than zero'),
  });

  const accountHistoryCurrencies = [...new Set([...supportedCurrencies, 'ngn'])];
  const accountHistoryCurrencySet = new Set(accountHistoryCurrencies);
  const accountHistoryCoinSchema = z.string()
    .transform((coin) => coin.trim().toLowerCase())
    .refine((coin) => accountHistoryCurrencySet.has(coin), {
      message: `Supported account currencies are ${accountHistoryCurrencies.join(', ')}`,
    });
  const accountHistorySchema = z.object({
    coin: accountHistoryCoinSchema.optional(),
    transactionType: z.enum(TRANSACTION_TYPES).optional(),
    action: z.enum(ACCOUNT_ACTIONS).optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
  }).superRefine(validateDateRange);

  const emptyInputSchema = z.object({}).strict();
  const walletBalanceInputSchema = z.object({ coin: supportedCoinSchema });
  const walletCurrencies = [...new Set([...supportedCurrencies, 'ngn'])];
  const walletCurrencySet = new Set(walletCurrencies);
  const walletInputSchema = z.object({
    coin: z.string()
      .transform((coin) => coin.trim().toLowerCase())
      .refine((coin) => walletCurrencySet.has(coin), {
        message: `Supported wallet currencies are ${walletCurrencies.join(', ')}`,
      }),
  });
  const walletAddressInputSchema = z.object({
    coin: supportedCoinSchema,
    network: supportedNetworkSchema,
  }).superRefine(({ coin, network }, context) => {
    const currency = catalog.find(({ code }) => code === coin);
    if (!currency?.networks.some(({ code }) => code === network)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['network'],
        message: `${network.toUpperCase()} is not supported for ${coin.toUpperCase()}`,
      });
    }
  });

  const emptyToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
  const transactionFilterToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {
      coin: { type: 'string', enum: withCaseVariants(supportedCurrencies) },
      ...transactionDateProperties,
    },
    additionalProperties: false,
  });
  const accountHistoryToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {
      coin: { type: 'string', enum: withCaseVariants(accountHistoryCurrencies) },
      transactionType: { type: 'string', enum: [...TRANSACTION_TYPES] },
      action: { type: 'string', enum: [...ACCOUNT_ACTIONS] },
      ...transactionDateProperties,
    },
    additionalProperties: false,
  });
  const swapToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {
      amount: { type: 'string', pattern: DECIMAL_PATTERN },
      coin: { type: 'string', enum: withCaseVariants(supportedCurrencies) },
    },
    required: ['amount', 'coin'],
    additionalProperties: false,
  });
  const withdrawalToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: { amount: { type: 'string', pattern: NGN_AMOUNT_PATTERN } },
    required: ['amount'],
    additionalProperties: false,
  });
  const walletBalanceToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {
      coin: { type: 'string', enum: withCaseVariants(supportedCurrencies) },
    },
    required: ['coin'],
    additionalProperties: false,
  });
  const walletToolSchema = jsonSchema<unknown>({
    type: 'object',
    properties: {
      coin: { type: 'string', enum: withCaseVariants(walletCurrencies) },
    },
    required: ['coin'],
    additionalProperties: false,
  });
  const walletAddressToolSchema = jsonSchema<unknown>({
    anyOf: catalog.map(({ code, networks }) => ({
      type: 'object',
      properties: {
        coin: { type: 'string', enum: withCaseVariants([code]) },
        network: {
          type: 'string',
          enum: withCaseVariants(networks.map(({ code: network }) => network)),
        },
      },
      required: ['coin', 'network'],
      additionalProperties: false,
    })),
  });

  return {
    transactionFilterSchema,
    swapInputSchema,
    withdrawalInputSchema,
    accountHistorySchema,
    walletBalanceInputSchema,
    walletInputSchema,
    walletAddressInputSchema,
    emptyInputSchema,
    emptyToolSchema,
    transactionFilterToolSchema,
    accountHistoryToolSchema,
    swapToolSchema,
    withdrawalToolSchema,
    walletBalanceToolSchema,
    walletToolSchema,
    walletAddressToolSchema,
    supportedCurrencyLabel,
  };
};

export const createTransactionFilterSchema = (catalog: readonly SupportedCrypto[]) =>
  createCryptoSchemas(catalog).transactionFilterSchema;

export const createSwapInputSchema = (catalog: readonly SupportedCrypto[]) =>
  createCryptoSchemas(catalog).swapInputSchema;

export const createAccountHistorySchema = (catalog: readonly SupportedCrypto[]) =>
  createCryptoSchemas(catalog).accountHistorySchema;
