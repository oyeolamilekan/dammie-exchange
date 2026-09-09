import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  adminOrderBy: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('../../src/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: mocks.where,
          }),
        }),
        leftJoin: () => ({
          leftJoin: () => ({
            orderBy: mocks.adminOrderBy,
          }),
        }),
      }),
    }),
  },
}));

import { findAdminCurrencyCatalog, findSupportedCryptos } from '../../src/queries/catalog.query';

const dialect = new PgDialect();

describe('database-backed supported cryptocurrency catalog', () => {
  it('filters enabled currencies, groups relationships, lowercases codes, and orders deterministically', async () => {
    const orderBy = vi.fn().mockResolvedValue([
      {
        currencyId: 'currency-usdt', currencyName: 'Tether USD', currencyCode: 'USDT',
        networkId: 'network-trc20', networkName: 'Tron', networkCode: 'TRC20',
      },
      {
        currencyId: 'currency-usdc', currencyName: 'USD Coin', currencyCode: 'USDC',
        networkId: 'network-erc20', networkName: 'Ethereum', networkCode: 'ERC20',
      },
      {
        currencyId: 'currency-usdc', currencyName: 'USD Coin', currencyCode: 'USDC',
        networkId: 'network-base', networkName: 'Base', networkCode: 'BASE',
      },
    ]);
    mocks.where.mockReturnValue({ orderBy });

    await expect(findSupportedCryptos()).resolves.toEqual([
      {
        id: 'currency-usdc', name: 'USD Coin', code: 'usdc',
        networks: [
          { id: 'network-base', name: 'Base', code: 'base' },
          { id: 'network-erc20', name: 'Ethereum', code: 'erc20' },
        ],
      },
      {
        id: 'currency-usdt', name: 'Tether USD', code: 'usdt',
        networks: [{ id: 'network-trc20', name: 'Tron', code: 'trc20' }],
      },
    ]);

    const whereQuery = dialect.sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(whereQuery.sql).toContain('"currency"."enabled" = $1');
    expect(whereQuery.sql).toContain('"currency"."is_crypto" = $2');
    expect(whereQuery.params).toEqual([true, true]);
  });

  it('returns an empty catalog without a fallback when no relationship rows exist', async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    mocks.where.mockReturnValue({ orderBy });

    await expect(findSupportedCryptos()).resolves.toEqual([]);
  });

  it('reads the catalog again on the next operation instead of caching it', async () => {
    let rows: unknown[] = [{
      currencyId: 'currency-usdc', currencyName: 'USD Coin', currencyCode: 'usdc',
      networkId: 'network-base', networkName: 'Base', networkCode: 'base',
    }];
    const orderBy = vi.fn().mockImplementation(() => Promise.resolve(rows));
    mocks.where.mockReturnValue({ orderBy });

    await expect(findSupportedCryptos()).resolves.toHaveLength(1);
    rows = [];
    await expect(findSupportedCryptos()).resolves.toEqual([]);
    expect(orderBy).toHaveBeenCalledTimes(2);
  });

  it('propagates catalog database errors', async () => {
    const error = new Error('catalog unavailable');
    mocks.where.mockReturnValue({ orderBy: vi.fn().mockRejectedValue(error) });

    await expect(findSupportedCryptos()).rejects.toBe(error);
  });

  it('exposes the complete catalog to admin readers, including disabled and relationship-less currencies', async () => {
    mocks.adminOrderBy.mockResolvedValue([
      {
        currencyId: 'currency-usdt', currencyName: 'Tether USD', currencyCode: 'USDT', currencyEnabled: false, currencyIsCrypto: true,
        networkId: 'network-trc20', networkName: 'Tron', networkCode: 'TRC20',
      },
      {
        currencyId: 'currency-empty', currencyName: 'Empty Currency', currencyCode: 'EMPTY', currencyEnabled: true, currencyIsCrypto: false,
        networkId: null, networkName: null, networkCode: null,
      },
      {
        currencyId: 'currency-usdc', currencyName: 'USD Coin', currencyCode: 'USDC', currencyEnabled: true, currencyIsCrypto: true,
        networkId: 'network-erc20', networkName: 'Ethereum', networkCode: 'ERC20',
      },
      {
        currencyId: 'currency-usdc', currencyName: 'USD Coin', currencyCode: 'USDC', currencyEnabled: true, currencyIsCrypto: true,
        networkId: 'network-base', networkName: 'Base', networkCode: 'BASE',
      },
    ]);

    await expect(findAdminCurrencyCatalog()).resolves.toEqual([
      {
        id: 'currency-empty', name: 'Empty Currency', code: 'empty', enabled: true, isCrypto: false, networks: [],
      },
      {
        id: 'currency-usdc', name: 'USD Coin', code: 'usdc', enabled: true, isCrypto: true,
        networks: [
          { id: 'network-base', name: 'Base', code: 'base' },
          { id: 'network-erc20', name: 'Ethereum', code: 'erc20' },
        ],
      },
      {
        id: 'currency-usdt', name: 'Tether USD', code: 'usdt', enabled: false, isCrypto: true,
        networks: [{ id: 'network-trc20', name: 'Tron', code: 'trc20' }],
      },
    ]);
  });
});
