/**
 * Quidax HTTP provider adapter.
 *
 * The client centralizes authentication headers, response normalization,
 * provider error handling, and the small provider operation surface used by
 * financial workflows.
 *
 * @module quidaxService
 */

import axios from 'axios';
import CONFIG from '../../config/config';
import Logging from '../../library/logging.utils';

type ProviderRequestBody = Record<string, unknown>;
type HttpMethod = 'get' | 'post' | 'put' | 'delete';

/** HTTP request shape injected into the provider adapter and easy to fake in tests. */
export type QuidaxRequest = (config: {
  method: HttpMethod;
  baseURL: string;
  url: string;
  headers: Record<string, string>;
  data?: unknown;
}) => Promise<{ data: unknown }>;

/** Logger surface required by the provider adapter. */
export type QuidaxLogger = Pick<typeof Logging, 'info' | 'error'>;

/** Dependencies for one isolated Quidax client instance. */
export interface CreateQuidaxClientOptions {
  request: QuidaxRequest;
  baseUrl: string;
  apiKey: string;
  logger: QuidaxLogger;
}

type QuidaxWithdrawalRecord = {
  id: string;
  reference?: string;
  status?: string;
} & Record<string, unknown>;

type QuidaxSwapTransactionRecord = {
  id: string;
  swap_quotation?: { id?: string };
} & Record<string, unknown>;

type QuidaxIdentifiedResource = { id: string } & Record<string, unknown>;
type QuidaxBankValidation = { account_name: string } & Record<string, unknown>;
type QuidaxInstantSwap = {
  id: string;
  quoted_price: string;
  to_amount: string;
  from_currency: string;
  to_currency: string;
  from_amount: string;
} & Record<string, unknown>;

type AxiosLikeError = {
  response?: { status: number; data: unknown };
  request?: unknown;
};

/** Options controlling whether a missing provider withdrawal is surfaced as a typed error. */
export interface FindWithdrawalByReferenceOptions {
  surfaceMissingWithdrawal?: boolean;
}

/** Raised on demand when Quidax explicitly reports that a withdrawal reference is unknown. */
export class QuidaxWithdrawalNotFoundError extends Error {
  readonly code = '110112';
  readonly providerResponse: unknown;

  constructor(message: string, providerResponse: unknown) {
    super(message);
    this.name = 'QuidaxWithdrawalNotFoundError';
    this.providerResponse = providerResponse;
  }
}

const asProviderRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const collectionFromResponse = <T extends Record<string, unknown>>(
  response: unknown,
  collectionName: string,
): T[] => {
  if (Array.isArray(response)) return response as T[];
  const providerResponse = asProviderRecord(response);
  const namedCollection = providerResponse[collectionName];
  if (Array.isArray(namedCollection)) return namedCollection as T[];
  const nestedCollection = providerResponse.data;
  return Array.isArray(nestedCollection) ? nestedCollection as T[] : [];
};

const messageFromError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Unknown error';
};

const asAxiosLikeError = (error: unknown): AxiosLikeError | null => {
  if (axios.isAxiosError(error)) return error;
  if (!error || typeof error !== 'object') return null;
  if ('response' in error || 'request' in error) return error as AxiosLikeError;
  return null;
};

const missingWithdrawalDetails = (value: unknown): { message: string; response: unknown } | null => {
  const body = asProviderRecord(value);
  const data = asProviderRecord(body.data);
  const code = data.code ?? body.code;
  if (String(code) !== '110112') return null;
  const message = [data.message, body.message]
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    ?? 'Withdrawal does not exist';
  return { message: message.trim(), response: value };
};

/** Quidax uses HTTP 400, rather than 404, when an exact withdrawal reference is absent. */
const isMissingProviderResource = (error: unknown): boolean => {
  const response = asAxiosLikeError(error)?.response;
  if (!response) return false;
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = asProviderRecord(response.data);
  const message = [body.message, body.error]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return /(?:withdrawal|withdraw)\b[\s\S]*\bdoes not exist\b/i.test(message);
};

/** Creates a Quidax adapter around an injected HTTP transport. */
export const createQuidaxClient = ({
  request,
  baseUrl,
  apiKey,
  logger,
}: CreateQuidaxClientOptions) => {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const handleNetworkError = (error: unknown, operation: string): never => {
    const axiosError = asAxiosLikeError(error);
    if (axiosError?.response) {
      const responseBody = asProviderRecord(axiosError.response.data);
      const responseMessage = typeof responseBody.message === 'string'
        ? responseBody.message
        : 'Unknown error';
      logger.error(`${operation} failed - Server error:`, axiosError.response.status);
      throw new Error(`Server error: ${axiosError.response.status} - ${responseMessage}`);
    }
    if (axiosError?.request) {
      logger.error(`${operation} failed - Network error`);
      throw new Error('Network error: Unable to connect to Quidax API');
    }
    const message = messageFromError(error);
    logger.error(`${operation} failed - Error:`, message);
    throw new Error(`Request error: ${message}`);
  };

  const makeRequest = async <T>(
    method: HttpMethod,
    url: string,
    data?: unknown,
    operation = `${method.toUpperCase()} ${url}`,
    allowNotFound = false,
    surfaceMissingWithdrawal = false,
  ): Promise<T> => {
    try {
      const requestUrl = axios.getUri({ baseURL: baseUrl, url });
      logger.info(`Request: ${method.toUpperCase()} ${requestUrl}`);
      if (data !== undefined) logger.info('Request body:', data);
      const response = await request({ method, baseURL: baseUrl, url, headers, data });
      const missingWithdrawal = missingWithdrawalDetails(response.data);
      if (allowNotFound && missingWithdrawal) {
        if (surfaceMissingWithdrawal) {
          throw new QuidaxWithdrawalNotFoundError(
            missingWithdrawal.message,
            missingWithdrawal.response,
          );
        }
        return null as T;
      }
      return asProviderRecord(response.data).data as T;
    } catch (error: unknown) {
      if (error instanceof QuidaxWithdrawalNotFoundError) throw error;
      const providerResponse = asAxiosLikeError(error)?.response?.data;
      const missingWithdrawal = missingWithdrawalDetails(providerResponse);
      if (allowNotFound && missingWithdrawal) {
        if (surfaceMissingWithdrawal) {
          throw new QuidaxWithdrawalNotFoundError(
            missingWithdrawal.message,
            missingWithdrawal.response,
          );
        }
        return null as T;
      }
      if (allowNotFound && isMissingProviderResource(error)) return null as T;
      return handleNetworkError(error, operation);
    }
  };

  return {
    createSubUser: async (data: ProviderRequestBody): Promise<QuidaxIdentifiedResource> =>
      makeRequest<QuidaxIdentifiedResource>('post', 'users', data, 'Create sub user'),

    fetchCurrency: async (userId: string, currency: string): Promise<QuidaxIdentifiedResource> =>
      makeRequest<QuidaxIdentifiedResource>('get', `users/${userId}/wallets/${currency}`, undefined, 'Fetch currency'),

    createPaymentAddress: async (
      userId: string,
      currency: string,
      network?: string,
    ): Promise<Record<string, unknown>> => makeRequest<Record<string, unknown>>(
      'post',
      `users/${userId}/wallets/${currency}/addresses${network ? `?network=${encodeURIComponent(network)}` : ''}`,
      undefined,
      'Create payment address',
    ),

    createWithdrawal: async (
      userId: string,
      body: ProviderRequestBody,
    ): Promise<QuidaxIdentifiedResource> => makeRequest<QuidaxIdentifiedResource>(
      'post',
      `users/${userId}/withdraws/`,
      body,
      'Create withdrawal',
    ),

    findDepositById: async (userId: string, depositId: string): Promise<QuidaxIdentifiedResource | null> =>
      makeRequest<QuidaxIdentifiedResource | null>('get',
        `users/${encodeURIComponent(userId)}/deposits/${encodeURIComponent(depositId)}`,
        undefined, 'Verify deposit', true),

    findWithdrawalByReference: async (
      userId: string,
      reference: string,
      _currency: string,
      options?: FindWithdrawalByReferenceOptions,
    ): Promise<QuidaxWithdrawalRecord | null> => makeRequest<QuidaxWithdrawalRecord | null>(
      'get', `users/${encodeURIComponent(userId)}/withdraws/reference/${encodeURIComponent(reference)}`,
      undefined, 'Verify withdrawal by reference', true, options?.surfaceMissingWithdrawal,
    ),

    validateBankAccount: async (
      accountNumber: string,
      bankCode: string,
    ): Promise<QuidaxBankValidation> => makeRequest<QuidaxBankValidation>(
      'post',
      'banks/verify_account',
      { fund_uid: accountNumber, fund_uid2: bankCode, currency: 'ngn' },
      'Validate bank account',
    ),

    createInstantSwap: async (
      userId: string,
      body: ProviderRequestBody,
    ): Promise<QuidaxInstantSwap> => makeRequest<QuidaxInstantSwap>(
      'post',
      `users/${userId}/swap_quotation`,
      body,
      'Create instant swap',
    ),

    refreshInstantSwap: async (
      userId: string,
      quotationId: string,
      body: ProviderRequestBody,
    ): Promise<Record<string, unknown>> => makeRequest<Record<string, unknown>>(
      'post',
      `users/${userId}/swap_quotation/${quotationId}/refresh`,
      body,
      'Refresh instant swap',
    ),

    confirmInstantSwap: async (
      userId: string,
      quotationId: string,
    ): Promise<QuidaxIdentifiedResource> => makeRequest<QuidaxIdentifiedResource>(
      'post',
      `users/${userId}/swap_quotation/${quotationId}/confirm`,
      undefined,
      'Confirm instant swap',
    ),

    findSwapTransactionByQuotation: async (
      userId: string,
      quotationId: string,
    ): Promise<QuidaxSwapTransactionRecord | null> => {
      const response = await makeRequest<unknown>(
        'get',
        `users/${userId}/swap_transactions`,
        undefined,
        'Reconcile swap confirmation',
      );
      const records = collectionFromResponse<QuidaxSwapTransactionRecord>(response, 'swap_transactions');
      return records.find((transaction) => transaction.swap_quotation?.id === quotationId) ?? null;
    },

    findSwapTransactionById: async (
      userId: string,
      transactionId: string,
    ): Promise<QuidaxSwapTransactionRecord | null> => makeRequest<QuidaxSwapTransactionRecord | null>(
      'get', `users/${encodeURIComponent(userId)}/swap_transactions/${encodeURIComponent(transactionId)}`,
      undefined, 'Verify swap transaction', true,
    ),
  };
};

/** Public provider contract inferred from the configured client factory. */
export type QuidaxClient = ReturnType<typeof createQuidaxClient>;

const configuredRequest: QuidaxRequest = (config) => axios.request({
  method: config.method,
  baseURL: config.baseURL,
  url: config.url,
  headers: config.headers,
  data: config.data,
});

/** Configured Quidax client used by runtime adapters and workflows. */
export const quidax = createQuidaxClient({
  request: configuredRequest,
  baseUrl: CONFIG.QUIDAX_API_URL ?? '',
  apiKey: CONFIG.QUIDAX_API_KEY ?? '',
  logger: Logging,
});
