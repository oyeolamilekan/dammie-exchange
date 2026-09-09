import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { currencies } from '../../src/db/schema/currency.schema';
import { currencyNetworks } from '../../src/db/schema/currency-network.schema';
import { networks } from '../../src/db/schema/network.schema';
import { walletAddresses, wallets } from '../../src/db/schema/wallet.schema';

const columnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name);

describe('currency catalog schema', () => {
  it('uses singular catalog table names, UUID identity, normalized unique codes, and timestamps', () => {
    const currency = getTableConfig(currencies);
    const network = getTableConfig(networks);

    expect(currency.name).toBe('currency');
    expect(network.name).toBe('network');
    expect(columnNames(currencies)).toEqual([
      'id', 'name', 'code', 'enabled', 'is_crypto', 'created_at', 'updated_at',
    ]);
    expect(columnNames(networks)).toEqual([
      'id', 'name', 'code', 'created_at', 'updated_at',
    ]);
    expect(currency.columns.find((column) => column.name === 'id')?.columnType).toBe('PgUUID');
    expect(network.columns.find((column) => column.name === 'id')?.columnType).toBe('PgUUID');
    expect(currency.indexes.find((index) => index.config.name === 'currency_code_unique')?.config.unique).toBe(true);
    expect(network.indexes.find((index) => index.config.name === 'network_code_unique')?.config.unique).toBe(true);
    expect(currency.checks).toHaveLength(1);
    expect(network.checks).toHaveLength(1);
  });

  it('uses the relationship pair as the composite primary key with restricted UUID FKs', () => {
    const config = getTableConfig(currencyNetworks);
    expect(config.name).toBe('currency_network');
    expect(columnNames(currencyNetworks)).toEqual(['currency_id', 'network_id']);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'currency_id', 'network_id',
    ]);
    expect(config.foreignKeys).toHaveLength(2);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual(['restrict', 'restrict']);
  });

  it('stores wallet and address catalog identities as non-null restricted UUID FKs', () => {
    const wallet = getTableConfig(wallets);
    const address = getTableConfig(walletAddresses);

    expect(wallet.columns.find((column) => column.name === 'currency_id')?.columnType).toBe('PgUUID');
    expect(wallet.columns.find((column) => column.name === 'currency_id')?.notNull).toBe(true);
    expect(address.columns.find((column) => column.name === 'network_id')?.columnType).toBe('PgUUID');
    expect(address.columns.find((column) => column.name === 'network_id')?.notNull).toBe(true);
    expect(wallet.foreignKeys.find((foreignKey) => foreignKey.getName() === 'wallets_currency_id_currency_id_fk')?.onDelete).toBe('restrict');
    expect(address.foreignKeys.find((foreignKey) => foreignKey.getName() === 'wallet_addresses_network_id_network_id_fk')?.onDelete).toBe('restrict');
    expect(wallet.indexes.find((index) => index.config.name === 'wallets_user_currency_id_unique')?.config.unique).toBe(true);
    expect(address.indexes.find((index) => index.config.name === 'wallet_addresses_wallet_network_id_unique')?.config.unique).toBe(true);
    expect(columnNames(wallets)).not.toContain('currency');
    expect(columnNames(wallets)).not.toContain('is_crypto');
    expect(columnNames(walletAddresses)).not.toContain('network');
  });
});
