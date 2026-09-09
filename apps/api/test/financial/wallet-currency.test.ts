import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  limitResults: [] as unknown[][],
  listResults: [] as unknown[][],
}));
vi.mock('../../src/database', () => ({
  db: {
    select: () => {
      const builder: {
        innerJoin: () => typeof builder;
        where: typeof mocks.where;
      } = {
        innerJoin: () => builder,
        where: mocks.where,
      };
      mocks.where.mockImplementation(() => ({
        limit: vi.fn().mockImplementation(async () => mocks.limitResults.shift() ?? []),
        orderBy: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(async () => mocks.listResults.shift() ?? []),
          }),
        }),
      }));
      return { from: () => builder };
    },
    insert: () => ({ values: mocks.values }),
    update: () => ({ set: mocks.set }),
  },
}));

import { createWallet, findOneWallet, updateWallet } from '../../src/queries/wallet.query';

const dialect = new PgDialect();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.limitResults = [[{ id: 'currency-usdt' }], [{ code: 'usdt', isCrypto: true }]];
  mocks.listResults = [[]];
  mocks.values.mockImplementation((row) => ({ returning: async () => [row] }));
  mocks.set.mockImplementation((row) => ({ where: () => ({ returning: async () => [row] }) }));
});

describe('wallet currency normalization', () => {
  it.each(['USDT', 'usdt', 'UsDt', ' USDT '])('looks up %s using lowercase currency while retaining user ownership', async (currency) => {
    await findOneWallet({ userId: 'user-1', currency });
    const query = dialect.sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.sql).toContain('"currency"."code" = $1');
    expect(query.params).toEqual(['usdt', true]);
    const walletQuery = dialect.sqlToQuery(mocks.where.mock.calls[1][0]);
    expect(walletQuery.sql).toContain('"wallets"."user_id"');
    expect(walletQuery.sql).toContain('"wallets"."currency_id"');
    expect(walletQuery.params).toEqual(['user-1', 'currency-usdt', true]);
  });

  it('creates wallets with a canonical lowercase currency', async () => {
    const wallet = await createWallet({ userId: 'user-1', currency: ' UsDt ', balance: '0' });
    expect(wallet).toMatchObject({ userId: 'user-1', currency: 'usdt', balance: '0' });
  });

  it('filters wallet classification through the related currency', async () => {
    await findOneWallet({ userId: 'user-1', isCrypto: true });
    const query = dialect.sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.sql).toContain('"currency"."is_crypto"');
    expect(query.params).toEqual(['user-1', true, true]);
  });

  it('normalizes currency changes without changing balances', async () => {
    mocks.limitResults = [[{ id: 'currency-usdc' }], [{ code: 'usdc', isCrypto: true }]];
    expect(await updateWallet('wallet-1', { currency: ' USDC ' })).toMatchObject({ currency: 'usdc' });
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty('balance');
    await expect(updateWallet('wallet-1', { currency: 'USDC', balance: '10' })).rejects.toThrow('account-version transaction');
  });
});
