import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQuidaxClient,
  QuidaxWithdrawalNotFoundError,
  type QuidaxRequest,
} from '../../src/services/integrations/quidax';

const createTestClient = (responses: unknown[]) => {
  const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>(
    async () => ({ data: { data: responses.shift() } }),
  );
  const logger = { info: vi.fn(), error: vi.fn() };
  return {
    client: createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger,
    }),
    request,
    logger,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Quidax adapter search compatibility', () => {
  it('requests a payment address for the selected network', async () => {
    const { client, request } = createTestClient([
      { address: '0x123', network: 'base' },
    ]);

    await expect(client.createPaymentAddress('user-1', 'usdc', 'base'))
      .resolves.toEqual({ address: '0x123', network: 'base' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      baseURL: 'https://quidax.test',
      url: 'users/user-1/wallets/usdc/addresses?network=base',
      data: undefined,
      headers: {
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
    }));
  });

  it('fetches a withdrawal by its exact reference instead of scanning lists', async () => {
    const { client, request } = createTestClient([{ id: 'withdraw-1', reference: 'ref/1', status: 'done' }]);
    expect(await client.findWithdrawalByReference('user-1', 'ref/1', 'ngn')).toMatchObject({ id: 'withdraw-1' });
    expect(request.mock.calls[0][0].url).toBe('users/user-1/withdraws/reference/ref%2F1');
  });

  it('fetches a deposit directly by ID under the requested user', async () => {
    const { client, request } = createTestClient([{ id: 'deposit-1', status: 'accepted' }]);
    expect(await client.findDepositById('sub-user', 'deposit-1')).toMatchObject({ id: 'deposit-1' });
    expect(request.mock.calls[0][0].url).toBe('users/sub-user/deposits/deposit-1');
  });

  it('returns null for missing resources and propagates provider outages', async () => {
    const { client, request } = createTestClient([]);
    request.mockRejectedValueOnce({ response: { status: 404, data: {} } });
    expect(await client.findDepositById('sub-user', 'missing')).toBeNull();
    request.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'withdrawal with reference ref-1 does not exist' } },
    });
    expect(await client.findWithdrawalByReference('me', 'ref-1', 'ngn')).toBeNull();
    request.mockRejectedValueOnce({ response: { status: 400, data: { message: 'invalid withdrawal request' } } });
    await expect(client.findWithdrawalByReference('me', 'ref-1', 'ngn')).rejects.toThrow('400');
    request.mockRejectedValueOnce({ response: { status: 503, data: {} } });
    await expect(client.findWithdrawalByReference('me', 'ref-1', 'ngn')).rejects.toThrow('503');
  });

  it.each([
    'resolved response',
    'rejected response',
  ])('surfaces withdrawal error 110112 from a %s when requested', async (responseType) => {
    const providerResponse = {
      status: 'error',
      message: 'withdrawal with reference ref-1 does not exist ',
      data: {
        code: '110112',
        message: 'withdrawal with reference ref-1 does not exist ',
      },
    };
    const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>();
    if (responseType === 'resolved response') {
      request.mockResolvedValue({ data: providerResponse });
    } else {
      request.mockRejectedValue({ response: { status: 400, data: providerResponse } });
    }
    const client = createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const result = client.findWithdrawalByReference('me', 'ref-1', 'ngn', {
      surfaceMissingWithdrawal: true,
    });
    await expect(result).rejects.toMatchObject({
      name: 'QuidaxWithdrawalNotFoundError',
      code: '110112',
      message: 'withdrawal with reference ref-1 does not exist',
      providerResponse,
    } satisfies Partial<QuidaxWithdrawalNotFoundError>);
  });

  it('keeps returning null for error 110112 unless surfacing is requested', async () => {
    const providerResponse = {
      status: 'error',
      data: { code: '110112', message: 'withdrawal with reference ref-1 does not exist' },
    };
    const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>()
      .mockResolvedValue({ data: providerResponse });
    const client = createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(client.findWithdrawalByReference('me', 'ref-1', 'ngn')).resolves.toBeNull();
  });

  it.each([
    [{ swap_transactions: [{ id: 'quotation-match', swap_quotation: { id: 'quote-1' } }] }],
    [{ data: [{ id: 'quotation-match', swap_quotation: { id: 'quote-1' } }] }],
    [[{ id: 'quotation-match', swap_quotation: { id: 'quote-1' } }]],
  ])('finds swap transactions across supported collection shapes: %j', async (response) => {
    const { client } = createTestClient([response]);
    await expect(client.findSwapTransactionByQuotation('user-1', 'quote-1'))
      .resolves.toMatchObject({ id: 'quotation-match' });
  });

  it('fetches a swap transaction directly by provider ID', async () => {
    const { client, request } = createTestClient([{ id: 'transaction-1', status: 'completed' }]);
    expect(await client.findSwapTransactionById('user-1', 'transaction-1')).toMatchObject({ id: 'transaction-1' });
    expect(request.mock.calls[0][0].url).toBe('users/user-1/swap_transactions/transaction-1');
  });
});

describe('Quidax adapter requests and errors', () => {
  it('logs an outbound request body without logging authentication headers', async () => {
    const { client, logger } = createTestClient([{ account_name: 'Test User' }]);

    await client.validateBankAccount('0123456789', '000014');

    expect(logger.info).toHaveBeenCalledWith('Request body:', {
      fund_uid: '0123456789',
      fund_uid2: '000014',
      currency: 'ngn',
    });
    expect(logger.info.mock.calls.flat()).not.toContainEqual(expect.objectContaining({
      Authorization: expect.any(String),
    }));
  });

  it('does not print a request body for requests without one', async () => {
    const { client, logger } = createTestClient([{ id: 'wallet-1' }]);

    await client.fetchCurrency('user-1', 'btc');

    expect(logger.info).not.toHaveBeenCalledWith('Request body:', expect.anything());
  });

  it('preserves the server-error message category', async () => {
    const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>()
      .mockRejectedValue({ response: { status: 422, data: { message: 'invalid request' } } });
    const client = createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger: { info: vi.fn(), error: vi.fn() },
    });
    await expect(client.fetchCurrency('user-1', 'btc'))
      .rejects.toThrow('Server error: 422 - invalid request');
  });

  it('preserves the network-error message category', async () => {
    const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>()
      .mockRejectedValue({ request: {}, message: 'timeout' });
    const client = createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger: { info: vi.fn(), error: vi.fn() },
    });
    await expect(client.fetchCurrency('user-1', 'btc'))
      .rejects.toThrow('Network error: Unable to connect to Quidax API');
  });

  it('preserves the request-error message category', async () => {
    const request = vi.fn<Parameters<QuidaxRequest>, ReturnType<QuidaxRequest>>()
      .mockRejectedValue(new Error('invalid URL'));
    const client = createQuidaxClient({
      request,
      baseUrl: 'https://quidax.test',
      apiKey: 'test-key',
      logger: { info: vi.fn(), error: vi.fn() },
    });
    await expect(client.fetchCurrency('user-1', 'btc'))
      .rejects.toThrow('Request error: invalid URL');
  });
});
