import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '../database';
import {
  currencies,
  networks,
  currencyNetworks,
} from '../db/schema';
import {
  walletAddresses,
  wallets,
  type NewWallet,
  type NewWalletAddress,
  type Wallet,
  type WalletAddress,
} from '../db/schema/wallet.schema';
import { users, type User } from '../db/schema/user.schema';
import { normalizeCurrency, normalizeNetwork } from '../utils/currency';

/**
 * Wallet and wallet-address persistence queries.
 *
 * Currency and network codes are resolved through the catalog tables here so
 * callers can work with stable codes instead of catalog UUIDs. Balance fields
 * are intentionally protected from direct updates; financial services must
 * record balance changes through account-version transactions.
 *
 * @module walletQuery
 */

/** Wallet balance projection used by portfolio reads. */
export interface PortfolioWalletRecord {
  /** Currency code. */
  currency: string;
  /** Available balance. */
  balance: string;
  /** Balance reserved by an in-flight transaction. */
  lockedBalance: string;
  /** Last wallet update timestamp. */
  updatedAt: Date;
}

/** Application-facing wallet input. Catalog UUID resolution stays in this query layer. */
export type CreateWalletInput = Omit<NewWallet, 'currencyId'> & { currency: string };

/** Application-facing wallet update input. */
export type UpdateWalletInput = Omit<Partial<NewWallet>, 'currencyId'> & { currency?: string };

/** Application-facing wallet-address input. */
export type WalletAddressInput = Omit<NewWalletAddress, 'walletId' | 'networkId'> & { network: string };

/** Wallet DTO returned to application callers with a catalog code instead of a UUID. */
export type WalletRecord = Omit<Wallet, 'currencyId'> & { currency: string; isCrypto: boolean };

/** Wallet-address DTO returned to application callers with a catalog code instead of a UUID. */
export type WalletAddressRecord = Omit<WalletAddress, 'networkId'> & { network: string };

/** Optional fields used to filter wallets. */
export interface WalletCondition {
  /** Wallet record identifier. */
  id?: string;
  /** Owning user identifier. */
  userId?: string;
  /** Currency code resolved through the catalog. */
  currency?: string;
  /** Provider wallet identifier. */
  walletId?: string;
  /** Whether the related currency is crypto. */
  isCrypto?: boolean;
}

/** Wallet projection with addresses and an optional safe user projection. */
export type WalletWithRelations = WalletRecord & {
  addresses: WalletAddressRecord[];
  user?: Omit<User, 'bvnNumber' | 'hashedPin'>;
};

/** Options for listing wallets. @internal */
interface FindWalletsOptions {
  limit?: number;
  skip?: number;
  direction?: 'asc' | 'desc';
  populate?: boolean;
  /** Include disabled currencies when this is an operational/admin lookup. */
  enabledOnly?: boolean;
}

/** Options controlling whether a wallet lookup includes disabled currencies. */
export interface WalletLookupOptions {
  /** Wallet selection defaults to enabled catalog currencies. */
  enabledOnly?: boolean;
}

const safeUserColumns = {
  id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName,
  telegramId: users.telegramId, subUserId: users.subUserId, intentId: users.intentId,
  chatId: users.chatId, isActive: users.isActive, createdAt: users.createdAt, updatedAt: users.updatedAt,
};

const walletSelection = {
  id: wallets.id,
  userId: wallets.userId,
  walletId: wallets.walletId,
  inProgress: wallets.inProgress,
  currency: currencies.code,
  balance: wallets.balance,
  lockedBalance: wallets.lockedBalance,
  isCrypto: currencies.isCrypto,
  createdAt: wallets.createdAt,
  updatedAt: wallets.updatedAt,
};

const addressSelection = {
  id: walletAddresses.id,
  walletId: walletAddresses.walletId,
  network: networks.code,
  destinationTag: walletAddresses.destinationTag,
  address: walletAddresses.address,
  createdAt: walletAddresses.createdAt,
  updatedAt: walletAddresses.updatedAt,
};

/** Combines optional wallet predicates into one SQL expression. @internal */
const combineClauses = (clauses: SQL[]): SQL | undefined => (
  clauses.length ? and(...clauses) : undefined
);

/** Builds the wallet predicate, resolving currency through the caller. @internal */
const buildWalletWhere = (
  condition: WalletCondition,
  currencyId?: string,
): SQL | undefined => {
  const clauses: SQL[] = [];
  if (condition.id !== undefined) clauses.push(eq(wallets.id, condition.id));
  if (condition.userId !== undefined) clauses.push(eq(wallets.userId, condition.userId));
  if (condition.currency !== undefined && currencyId !== undefined) {
    clauses.push(eq(wallets['currencyId'], currencyId));
  }
  if (condition.walletId !== undefined) clauses.push(eq(wallets.walletId, condition.walletId));
  if (condition.isCrypto !== undefined) clauses.push(eq(currencies.isCrypto, condition.isCrypto));
  return combineClauses(clauses);
};

/** Resolves a normalized currency code to its enabled catalog ID. @internal */
const findCurrencyId = async (
  code: string,
  enabledOnly: boolean,
): Promise<string | null> => {
  const clauses: SQL[] = [eq(currencies.code, normalizeCurrency(code))];
  if (enabledOnly) clauses.push(eq(currencies.enabled, true));
  return (await db.select({ id: currencies.id }).from(currencies)
    .where(and(...clauses)).limit(1))[0]?.id ?? null;
};

/** Normalizes the currency code in a wallet DTO. @internal */
const toWalletRecord = (row: WalletRecord): WalletRecord => ({
  ...row,
  currency: normalizeCurrency(row.currency),
});

/** Normalizes the network code in a wallet-address DTO. @internal */
const toWalletAddressRecord = (row: WalletAddressRecord): WalletAddressRecord => ({
  ...row,
  network: normalizeNetwork(row.network),
});

/** Hydrates wallet rows with their network-specific addresses. @internal */
const loadAddresses = async (walletRows: WalletRecord[]): Promise<WalletWithRelations[]> => {
  if (!walletRows.length) return [];
  const rows = await db.select(addressSelection).from(walletAddresses)
    .innerJoin(networks, eq(walletAddresses['networkId'], networks.id))
    .where(inArray(walletAddresses.walletId, walletRows.map((wallet) => wallet.id)))
    .orderBy(asc(networks.code), asc(walletAddresses.id));
  const addressesByWallet = new Map<string, WalletAddressRecord[]>();
  for (const row of rows) {
    const address = toWalletAddressRecord(row);
    const addresses = addressesByWallet.get(address.walletId) ?? [];
    addresses.push(address);
    addressesByWallet.set(address.walletId, addresses);
  }
  return walletRows.map((wallet) => ({
    ...wallet,
    addresses: addressesByWallet.get(wallet.id) ?? [],
  }));
};

/** Reads wallet rows after resolving currency and enabled-catalog filters. @internal */
const readWalletRows = async (
  condition: WalletCondition,
  options: { enabledOnly: boolean; limit?: number; skip?: number; direction?: 'asc' | 'desc' },
): Promise<WalletRecord[]> => {
  const currencyId = condition.currency === undefined
    ? undefined
    : await findCurrencyId(condition.currency, options.enabledOnly);
  if (condition.currency !== undefined && !currencyId) return [];

  const walletWhere = buildWalletWhere(condition, currencyId ?? undefined);
  const clauses = [
    ...(walletWhere ? [walletWhere] : []),
    ...(options.enabledOnly ? [eq(currencies.enabled, true)] : []),
  ];
  const rows = await db.select(walletSelection).from(wallets)
    .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(combineClauses(clauses))
    .orderBy(options.direction === 'asc' ? asc(wallets.createdAt) : desc(wallets.createdAt))
    .offset(options.skip ?? 0).limit(options.limit ?? 100);
  return rows.map(toWalletRecord);
};

/** Creates a wallet for an enabled catalog currency. */
export const createWallet = async (data: CreateWalletInput): Promise<WalletRecord | undefined> => {
  const currencyId = await findCurrencyId(data.currency, true);
  if (!currencyId) throw new Error(`Unknown or disabled currency code: ${data.currency}`);
  const { currency: _currency, ...persistenceData } = data;
  const row = (await db.insert(wallets).values({ ...persistenceData, currencyId }).returning())[0];
  if (!row) return undefined;
  const { currencyId: _storedCurrencyId, ...wallet } = row;
  const currency = (await db.select({ code: currencies.code, isCrypto: currencies.isCrypto })
    .from(currencies).where(eq(currencies.id, currencyId)).limit(1))[0];
  if (!currency) return undefined;
  return toWalletRecord({ ...wallet, currency: currency.code, isCrypto: currency.isCrypto });
};

/**
 * Creates a wallet once and returns the existing row on concurrent retries.
 *
 * @returns The wallet with hydrated addresses and whether this call inserted it.
 */
export const ensureWallet = async (
  data: CreateWalletInput,
): Promise<{ wallet: WalletWithRelations; created: boolean }> => {
  const currencyId = await findCurrencyId(data.currency, true);
  if (!currencyId) throw new Error(`Unknown or disabled currency code: ${data.currency}`);
  const { currency: _currency, ...persistenceData } = data;
  const inserted = await db.insert(wallets).values({ ...persistenceData, currencyId }).onConflictDoNothing({
    target: [wallets.userId, wallets['currencyId']],
  }).returning({ id: wallets.id });
  const wallet = await findOneWallet({ userId: data.userId, currency: data.currency });
  if (!wallet) throw new Error(`Unable to ensure ${normalizeCurrency(data.currency)} wallet`);
  return { wallet, created: inserted.length > 0 };
};

/** Finds one wallet by its internal ID, including addresses and safe owner data. */
export const findWalletById = async (
  id: string,
  options: WalletLookupOptions = {},
): Promise<WalletWithRelations | null> => {
  const clauses: SQL[] = [eq(wallets.id, id)];
  if (options.enabledOnly ?? true) clauses.push(eq(currencies.enabled, true));
  const row = (await db.select(walletSelection).from(wallets)
    .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(and(...clauses)).limit(1))[0];
  if (!row) return null;
  const wallet = (await loadAddresses([toWalletRecord(row)]))[0];
  const user = (await db.select(safeUserColumns).from(users).where(eq(users.id, wallet.userId)).limit(1))[0];
  return { ...wallet, user };
};

/**
 * Lists wallets using optional catalog, pagination, ordering, and hydration
 * options.
 */
export const findWallets = async (
  condition: WalletCondition = {},
  options: FindWalletsOptions = {},
): Promise<WalletWithRelations[]> => {
  const rows = await readWalletRows(condition, {
    enabledOnly: options.enabledOnly ?? true,
    limit: options.limit,
    skip: options.skip,
    direction: options.direction,
  });
  const hydrated = await loadAddresses(rows);
  if (options.populate === false) return hydrated;
  return Promise.all(hydrated.map(async (wallet) => ({
    ...wallet,
    user: (await db.select(safeUserColumns).from(users).where(eq(users.id, wallet.userId)).limit(1))[0],
  })));
};

/** Lists enabled portfolio wallets for one user in currency order. */
export const findPortfolioWallets = (userId: string): Promise<PortfolioWalletRecord[]> =>
  db.select({
    currency: currencies.code,
    balance: wallets.balance,
    lockedBalance: wallets.lockedBalance,
    updatedAt: wallets.updatedAt,
  }).from(wallets)
    .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(and(eq(wallets.userId, userId), eq(currencies.enabled, true)))
    .orderBy(asc(currencies.code));

/** Finds the first wallet matching the supplied condition. */
export const findOneWallet = async (
  condition: WalletCondition,
  options: WalletLookupOptions = {},
): Promise<WalletWithRelations | null> => {
  const rows = await readWalletRows(condition, {
    enabledOnly: options.enabledOnly ?? true,
    limit: 1,
    direction: 'asc',
  });
  const wallet = rows[0];
  return wallet ? (await loadAddresses([wallet]))[0] : null;
};

/**
 * Updates wallet metadata while rejecting direct balance changes.
 *
 * Balance mutations must be performed by a financial transaction that also
 * writes an account-version record.
 */
export const updateWallet = async (
  id: string,
  data: UpdateWalletInput,
): Promise<WalletRecord | null> => {
  if (data.balance !== undefined || data.lockedBalance !== undefined) {
    throw new Error('Wallet balances must be changed through an account-version transaction');
  }
  const currencyId = data.currency === undefined ? undefined : await findCurrencyId(data.currency, true);
  if (data.currency !== undefined && !currencyId) {
    throw new Error(`Unknown or disabled currency code: ${data.currency}`);
  }
  const { currency: _currency, ...persistenceData } = data;
  const updated = (await db.update(wallets).set({
    ...persistenceData,
    ...(currencyId ? { currencyId } : {}),
    updatedAt: new Date(),
  }).where(eq(wallets.id, id)).returning())[0];
  if (!updated) return null;
  const currency = (await db.select({ code: currencies.code, isCrypto: currencies.isCrypto }).from(currencies)
    .where(eq(currencies.id, updated.currencyId)).limit(1))[0];
  if (!currency) return null;
  const { currencyId: _storedCurrencyId, ...wallet } = updated;
  return toWalletRecord({ ...wallet, currency: currency.code, isCrypto: currency.isCrypto });
};

/**
 * @deprecated Use `mutateWalletAndRecordVersion` inside the caller transaction.
 */
export const updateWalletBalance = (_id: string, _balance: string): never => {
  throw new Error('Wallet balances must be changed through an account-version transaction');
};

/**
 * Assigns an address only when the selected network is related to the
 * wallet's currency. The pair check and upsert share one transaction.
 *
 * @param condition Owner and currency used to locate the wallet.
 * @param address Network-specific address data.
 * @returns The updated wallet, or `null` when the owner/wallet is absent.
 */
export const assignWalletAddress = async (
  condition: Pick<WalletCondition, 'userId' | 'currency'>,
  address: WalletAddressInput,
): Promise<WalletRecord | null> => db.transaction(async (tx) => {
  if (!condition.userId || !condition.currency) return null;
  const currencyCode = normalizeCurrency(condition.currency);
  const networkCode = normalizeNetwork(address.network);
  const currency = (await tx.select({ id: currencies.id }).from(currencies).where(and(
    eq(currencies.code, currencyCode),
    eq(currencies.enabled, true),
    eq(currencies.isCrypto, true),
  )).limit(1))[0];
  if (!currency) throw new Error(`Unknown or disabled currency code: ${condition.currency}`);
  const network = (await tx.select({ id: networks.id }).from(networks)
    .where(eq(networks.code, networkCode)).limit(1))[0];
  if (!network) throw new Error(`Unknown network code: ${address.network}`);
  const pair = (await tx.select({ currencyId: currencyNetworks.currencyId })
    .from(currencyNetworks).where(and(
      eq(currencyNetworks.currencyId, currency.id),
      eq(currencyNetworks.networkId, network.id),
    )).limit(1))[0];
  if (!pair) {
    throw new Error(`${networkCode.toUpperCase()} is not supported for ${currencyCode.toUpperCase()}`);
  }

  const wallet = (await tx.select(walletSelection).from(wallets)
    .innerJoin(currencies, eq(wallets['currencyId'], currencies.id))
    .where(and(
      eq(wallets.userId, condition.userId),
      eq(wallets['currencyId'], currency.id),
      eq(currencies.enabled, true),
      eq(currencies.isCrypto, true),
    )).for('update').limit(1))[0];
  if (!wallet) return null;

  const { network: _network, ...addressData } = address;
  await tx.insert(walletAddresses).values({
    ...addressData,
    walletId: wallet.id,
    networkId: network.id,
  }).onConflictDoUpdate({
    target: [walletAddresses.walletId, walletAddresses['networkId']],
    set: {
      address: address.address,
      destinationTag: address.destinationTag,
      updatedAt: new Date(),
    },
  });
  await tx.update(wallets).set({ inProgress: false, updatedAt: new Date() })
    .where(eq(wallets.id, wallet.id));
  return toWalletRecord({
    ...wallet,
    currency: currencyCode,
    inProgress: false,
    updatedAt: new Date(),
  });
});
