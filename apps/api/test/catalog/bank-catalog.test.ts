import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findBankCatalog: vi.fn(),
}));

vi.mock('../../src/queries/bank-catalog.query', () => ({
  findBankCatalog: mocks.findBankCatalog,
}));

import { getBankCatalogController } from '../../src/controllers/bank.controller';

describe('bank catalog controller', () => {
  it('returns the database-backed bank directory in the public API envelope', async () => {
    const banks = [{
      code: '000014',
      name: 'Access Bank',
      country: 'Nigeria',
      currency: 'NGN',
    }];
    mocks.findBankCatalog.mockResolvedValue(banks);

    let responseBody: unknown;
    let responseStatus: number | undefined;
    let resolveRequest!: () => void;
    let rejectRequest!: (error: unknown) => void;
    const responseComplete = new Promise<void>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const response = {
      status: (status: number) => {
        responseStatus = status;
        return response;
      },
      json: (body: unknown) => {
        responseBody = body;
        resolveRequest();
        return response;
      },
    };

    getBankCatalogController({} as never, response as never, rejectRequest as never);
    await responseComplete;

    expect(responseStatus).toBe(200);
    expect(responseBody).toEqual({
      success: true,
      message: 'Banks retrieved successfully',
      data: banks,
    });
  });
});
