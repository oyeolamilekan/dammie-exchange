import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../database';
import { currencies } from '../db/schema/currency.schema';
import { currencyNetworks } from '../db/schema/currency-network.schema';
import { networks } from '../db/schema/network.schema';
import { walletAddresses, wallets } from '../db/schema/wallet.schema';
import { normalizeCurrency, normalizeNetwork } from '../utils/currency';

/**
 * Currency, network, and currency/network relationship queries.
 *
 * Customer-facing catalog reads return only enabled crypto currencies, while
 * admin reads and mutations can manage the complete catalog.
 *
 * @module catalogQuery
 */

/** Network available for a supported cryptocurrency. */
export interface SupportedCryptoNetwork {
  id: string;
  name: string;
  code: string;
}

/** Enabled crypto currency with its supported networks. */
export interface SupportedCrypto {
  id: string;
  name: string;
  code: string;
  networks: SupportedCryptoNetwork[];
}

/** Currency catalog entry returned to the administrator console. */
export interface AdminCurrencyCatalogEntry extends SupportedCrypto {
  enabled: boolean;
  isCrypto: boolean;
}

/** Currency/network relationship returned to the administrator console. */
export interface AdminCurrencyNetworkEntry {
  currencyId: string;
  currencyName: string;
  currencyCode: string;
  networkId: string;
  networkName: string;
  networkCode: string;
}

/** Error carrying an HTTP-friendly status for catalog mutations. */
export class CatalogAdminError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CatalogAdminError';
  }
}

const hasDatabaseCode = (error: unknown, code: string): boolean => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: unknown }).code === code
);

const rethrowCatalogMutationError = (
  error: unknown,
  duplicateMessage: string,
  restrictedMessage: string,
): never => {
  if (hasDatabaseCode(error, '23505')) throw new CatalogAdminError(409, duplicateMessage);
  if (hasDatabaseCode(error, '23503')) throw new CatalogAdminError(409, restrictedMessage);
  throw error;
};

const adminCurrencySelection = {
  id: currencies.id,
  name: currencies.name,
  code: sql<string>`lower(${currencies.code})`,
  enabled: currencies.enabled,
  isCrypto: currencies.isCrypto,
};

const adminNetworkSelection = {
  id: networks.id,
  name: networks.name,
  code: sql<string>`lower(${networks.code})`,
};

/**
 * Reads the current enabled currency catalog and its network relationships.
 *
 * The query intentionally has no process-level cache. Every caller observes
 * catalog changes on its next relevant operation.
 */
export const findSupportedCryptos = async (): Promise<SupportedCrypto[]> => {
  const rows = await db.select({
    currencyId: currencies.id,
    currencyName: currencies.name,
    currencyCode: sql<string>`lower(${currencies.code})`,
    networkId: networks.id,
    networkName: networks.name,
    networkCode: sql<string>`lower(${networks.code})`,
  }).from(currencyNetworks)
    .innerJoin(currencies, eq(currencyNetworks.currencyId, currencies.id))
    .innerJoin(networks, eq(currencyNetworks.networkId, networks.id))
    .where(and(eq(currencies.enabled, true), eq(currencies.isCrypto, true)))
    .orderBy(asc(currencies.code), asc(networks.code));

  const grouped = new Map<string, SupportedCrypto>();
  for (const row of rows) {
    const code = normalizeCurrency(row.currencyCode);
    let currency = grouped.get(row.currencyId);
    if (!currency) {
      currency = {
        id: row.currencyId,
        name: row.currencyName,
        code,
        networks: [],
      };
      grouped.set(row.currencyId, currency);
    }
    currency.networks.push({
      id: row.networkId,
      name: row.networkName,
      code: normalizeCurrency(row.networkCode),
    });
  }
  return [...grouped.values()]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((currency) => ({
      ...currency,
      networks: [...currency.networks].sort((left, right) => left.code.localeCompare(right.code)),
    }));
};

/** Reads the complete catalog for the admin console, including disabled entries. */
export const findAdminCurrencyCatalog = async (): Promise<AdminCurrencyCatalogEntry[]> => {
  const rows = await db.select({
    currencyId: currencies.id,
    currencyName: currencies.name,
    currencyCode: sql<string>`lower(${currencies.code})`,
    currencyEnabled: currencies.enabled,
    currencyIsCrypto: currencies.isCrypto,
    networkId: networks.id,
    networkName: networks.name,
    networkCode: sql<string | null>`lower(${networks.code})`,
  }).from(currencies)
    .leftJoin(currencyNetworks, eq(currencyNetworks.currencyId, currencies.id))
    .leftJoin(networks, eq(currencyNetworks.networkId, networks.id))
    .orderBy(asc(currencies.code), asc(networks.code), asc(networks.id));

  const grouped = new Map<string, AdminCurrencyCatalogEntry>();
  for (const row of rows) {
    let currency = grouped.get(row.currencyId);
    if (!currency) {
      currency = {
        id: row.currencyId,
        name: row.currencyName,
        code: normalizeCurrency(row.currencyCode),
        enabled: row.currencyEnabled,
        isCrypto: row.currencyIsCrypto,
        networks: [],
      };
      grouped.set(row.currencyId, currency);
    }
    if (row.networkId && row.networkName && row.networkCode) {
      currency.networks.push({
        id: row.networkId,
        name: row.networkName,
        code: normalizeNetwork(row.networkCode),
      });
    }
  }

  return [...grouped.values()]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((currency) => ({
      ...currency,
      networks: [...currency.networks].sort((left, right) => left.code.localeCompare(right.code)),
    }));
};

/** Lists every network in the administrator catalog. */
export const findAdminNetworks = async () => db.select(adminNetworkSelection)
  .from(networks)
  .orderBy(asc(networks.code), asc(networks.id));

/** Lists every configured currency/network relationship for administrators. */
export const findAdminCurrencyNetworks = async (): Promise<AdminCurrencyNetworkEntry[]> => db.select({
  currencyId: currencies.id,
  currencyName: currencies.name,
  currencyCode: sql<string>`lower(${currencies.code})`,
  networkId: networks.id,
  networkName: networks.name,
  networkCode: sql<string>`lower(${networks.code})`,
}).from(currencyNetworks)
  .innerJoin(currencies, eq(currencyNetworks.currencyId, currencies.id))
  .innerJoin(networks, eq(currencyNetworks.networkId, networks.id))
  .orderBy(asc(currencies.code), asc(networks.code), asc(currencies.id), asc(networks.id));

/** Creates a currency catalog entry after normalizing its code. */
export const createAdminCurrency = async (input: {
  name: string;
  code: string;
  enabled?: boolean;
  isCrypto?: boolean;
}) => {
  try {
    return (await db.insert(currencies).values({
      name: input.name.trim(),
      code: normalizeCurrency(input.code),
      enabled: input.enabled ?? true,
      isCrypto: input.isCrypto ?? true,
    }).returning(adminCurrencySelection))[0] ?? null;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'A currency with that code already exists',
      'Currency cannot be created because it is referenced by existing records',
    );
  }
};

/** Updates mutable currency catalog fields by currency ID. */
export const updateAdminCurrency = async (
  id: string,
  input: { name?: string; enabled?: boolean; isCrypto?: boolean },
) => {
  try {
    return (await db.update(currencies).set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.isCrypto !== undefined ? { isCrypto: input.isCrypto } : {}),
      updatedAt: new Date(),
    }).where(eq(currencies.id, id)).returning(adminCurrencySelection))[0] ?? null;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'A currency with that code already exists',
      'Currency cannot be updated because it is referenced by existing records',
    );
  }
};

/** Deletes a currency when no database relationship prevents removal. */
export const deleteAdminCurrency = async (id: string): Promise<boolean> => {
  try {
    return (await db.delete(currencies).where(eq(currencies.id, id)).returning({ id: currencies.id })).length > 0;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'Currency could not be deleted because its code conflicts with another currency',
      'Currency cannot be deleted while it has wallet or network relationships',
    );
  }
};

/** Creates a network catalog entry after normalizing its code. */
export const createAdminNetwork = async (input: { name: string; code: string }) => {
  try {
    return (await db.insert(networks).values({
      name: input.name.trim(),
      code: normalizeNetwork(input.code),
    }).returning(adminNetworkSelection))[0] ?? null;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'A network with that code already exists',
      'Network cannot be created because it is referenced by existing records',
    );
  }
};

/** Updates the display name of a network catalog entry. */
export const updateAdminNetwork = async (
  id: string,
  input: { name?: string },
) => {
  try {
    return (await db.update(networks).set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(networks.id, id)).returning(adminNetworkSelection))[0] ?? null;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'A network with that code already exists',
      'Network cannot be updated because it is referenced by existing records',
    );
  }
};

/** Deletes a network when no wallet-address or currency relationship uses it. */
export const deleteAdminNetwork = async (id: string): Promise<boolean> => {
  try {
    return (await db.delete(networks).where(eq(networks.id, id)).returning({ id: networks.id })).length > 0;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'Network could not be deleted because its code conflicts with another network',
      'Network cannot be deleted while it has wallet-address or currency relationships',
    );
  }
};

/** Links an existing currency to an existing network. */
export const createAdminCurrencyNetwork = async (input: {
  currencyId: string;
  networkId: string;
}) => {
  const currency = (await db.select({ id: currencies.id }).from(currencies)
    .where(eq(currencies.id, input.currencyId)).limit(1))[0];
  if (!currency) throw new CatalogAdminError(404, 'Currency not found');
  const network = (await db.select({ id: networks.id }).from(networks)
    .where(eq(networks.id, input.networkId)).limit(1))[0];
  if (!network) throw new CatalogAdminError(404, 'Network not found');

  try {
    return (await db.insert(currencyNetworks).values(input)
      .returning({ currencyId: currencyNetworks.currencyId, networkId: currencyNetworks.networkId }))[0] ?? null;
  } catch (error) {
    return rethrowCatalogMutationError(
      error,
      'That currency/network relationship already exists',
      'Currency or network no longer exists',
    );
  }
};

/** Removes a currency/network link when no wallet address uses the pair. */
export const deleteAdminCurrencyNetwork = async (
  currencyId: string,
  networkId: string,
): Promise<boolean> => {
  const inUse = (await db.select({ id: walletAddresses.id }).from(walletAddresses)
    .innerJoin(wallets, eq(walletAddresses.walletId, wallets.id))
    .where(and(
      eq(wallets['currencyId'], currencyId),
      eq(walletAddresses['networkId'], networkId),
    )).limit(1))[0];
  if (inUse) {
    throw new CatalogAdminError(409, 'Currency/network relationship cannot be removed while wallet addresses use it');
  }
  return (await db.delete(currencyNetworks).where(and(
    eq(currencyNetworks.currencyId, currencyId),
    eq(currencyNetworks.networkId, networkId),
  )).returning({
    currencyId: currencyNetworks.currencyId,
  })).length > 0;
};

/** Descriptive aliases for callers that refer to the result as a catalog. */
export const getSupportedCryptoCatalog = findSupportedCryptos;

/** Alias for {@link findSupportedCryptos}. */
export const findSupportedCryptoCatalog = findSupportedCryptos;

/** Alias for {@link findSupportedCryptos}. */
export const getSupportedCryptos = findSupportedCryptos;
