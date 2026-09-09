import type { Request, Response } from 'express';
import { z } from 'zod';
import asyncHandler from '../helpers/async-handler.helper';
import {
  createAdminCurrency,
  createAdminCurrencyNetwork,
  createAdminNetwork,
  deleteAdminCurrency,
  deleteAdminCurrencyNetwork,
  deleteAdminNetwork,
  findAdminCurrencyNetworks,
  findAdminCurrencyCatalog,
  findAdminNetworks,
  updateAdminCurrency,
  updateAdminNetwork,
} from '../queries/catalog.query';
import { decodeTransactionCursor } from '../queries/cursor-pagination';
import {
  findAdminAccountVersions,
  findAdminConversationTurns,
  findAdminTransactionPage,
  findAdminUserDetail,
  findAdminUsersPage,
  findUserIntentId,
  getAdminOverview,
} from '../queries/admin-data.query';
import {
  createAdminFee,
  findAdminFeeAudit,
  findAdminFees,
  updateAdminFee,
} from '../queries/platform-fee.query';

/**
 * Administrator dashboard, catalog, fee, and customer-detail controllers.
 *
 * Request schemas are enforced at the controller boundary. The handlers then
 * delegate persistence and business rules to query/service modules and return
 * projections suitable for the admin web application.
 *
 * @module adminDataController
 */

/** Shared cursor and page-size validation for admin list endpoints. @internal */
const cursorPageSchema = z.object({
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
const usersQuerySchema = cursorPageSchema.extend({
  search: z.string().trim().max(250).optional(),
  active: z.enum(['true', 'false']).optional(),
});
const transactionsQuerySchema = cursorPageSchema.extend({
  type: z.enum(['deposit', 'swap', 'withdrawal']).optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
const userParamsSchema = z.object({ userId: z.string().uuid() });
const catalogIdParamsSchema = z.object({ id: z.string().uuid() });
const currencyNetworkParamsSchema = z.object({
  currencyId: z.string().uuid(),
  networkId: z.string().uuid(),
});
const currencyCreateSchema = z.object({
  name: z.string().trim().min(1).max(250),
  code: z.string().trim().min(1).max(16),
  enabled: z.boolean().optional(),
  isCrypto: z.boolean().optional(),
}).strict();
const currencyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(250).optional(),
  enabled: z.boolean().optional(),
  isCrypto: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.enabled !== undefined || value.isCrypto !== undefined);
const networkCreateSchema = z.object({
  name: z.string().trim().min(1).max(250),
  code: z.string().trim().min(1).max(64),
}).strict();
const networkUpdateSchema = z.object({
  name: z.string().trim().min(1).max(250).optional(),
}).strict().refine((value) => value.name !== undefined);
const currencyNetworkCreateSchema = z.object({
  currencyId: z.string().uuid(),
  networkId: z.string().uuid(),
}).strict();
const decimalInputSchema = z.union([
  z.string().trim().min(1),
  z.number().finite(),
]);
const platformFeeCreateSchema = z.object({
  currencyId: z.string().uuid(),
  context: z.enum(['swap', 'withdrawal']),
  type: z.enum(['flat', 'percentage']),
  amount: decimalInputSchema,
  minimumFee: decimalInputSchema.nullable().optional(),
  maximumFee: decimalInputSchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();
const platformFeeUpdateSchema = z.object({
  type: z.enum(['flat', 'percentage']).optional(),
  amount: decimalInputSchema.optional(),
  minimumFee: decimalInputSchema.nullable().optional(),
  maximumFee: decimalInputSchema.nullable().optional(),
  enabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

/** Parses a request value and returns a consistent 400 response on failure. @internal */
const parseRequest = <T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  res: Response,
): z.infer<T> | null => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid admin request' });
    return null;
  }
  if ('cursor' in parsed.data && parsed.data.cursor) {
    try {
      decodeTransactionCursor(parsed.data.cursor);
    } catch {
      res.status(400).json({ message: 'Invalid pagination cursor' });
      return null;
    }
  }
  return parsed.data;
};

/** Validates and extracts a UUID user route parameter. @internal */
const parseUserId = (req: Request, res: Response): string | null => {
  const parsed = parseRequest(userParamsSchema, req.params, res);
  return parsed?.userId ?? null;
};

/** Ensures a user exists and has an associated Telegram intent. @internal */
const requireUserIntent = async (
  userId: string,
  res: Response,
): Promise<string | null> => {
  const intentId = await findUserIntentId(userId);
  if (!intentId) res.status(404).json({ message: 'User not found' });
  return intentId;
};

/** Returns dashboard counts, balances, recent activity, and reconciliation warnings. */
export const getAdminOverviewController = asyncHandler(async (_req, res) => {
  res.json(await getAdminOverview());
});

/** Returns the complete administrator currency/network catalog. */
export const getAdminCatalogController = asyncHandler(async (_req, res) => {
  res.json({ catalog: await findAdminCurrencyCatalog() });
});

/** Returns currency catalog entries for the admin currency view. */
export const getAdminCurrenciesController = asyncHandler(async (_req, res) => {
  res.json({ currencies: await findAdminCurrencyCatalog() });
});

/** Returns all network catalog entries for the admin network view. */
export const getAdminNetworksController = asyncHandler(async (_req, res) => {
  res.json({ networks: await findAdminNetworks() });
});

/** Returns configured currency/network relationships. */
export const getAdminCurrencyNetworksController = asyncHandler(async (_req, res) => {
  res.json({ currencyNetworks: await findAdminCurrencyNetworks() });
});

/** Returns current platform-fee rules. */
export const getAdminFeesController = asyncHandler(async (_req, res) => {
  res.json({ fees: await findAdminFees() });
});

/** Validates and creates a platform-fee rule for the authenticated administrator. */
export const createAdminFeeController = asyncHandler(async (req, res) => {
  const body = parseRequest(platformFeeCreateSchema, req.body, res);
  if (!body) return;
  res.status(201).json({ fee: await createAdminFee(body, req.admin!.id) });
});

/** Validates and updates a platform-fee rule by UUID. */
export const updateAdminFeeController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  const body = parseRequest(platformFeeUpdateSchema, req.body, res);
  if (!params || !body) return;
  res.json({ fee: await updateAdminFee(params.id, body, req.admin!.id) });
});

/** Returns immutable audit history for one platform-fee rule. */
export const getAdminFeeAuditController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  if (!params) return;
  res.json({ audit: await findAdminFeeAudit(params.id) });
});

/** Validates and creates a currency catalog entry. */
export const createAdminCurrencyController = asyncHandler(async (req, res) => {
  const body = parseRequest(currencyCreateSchema, req.body, res);
  if (!body) return;
  res.status(201).json({ currency: await createAdminCurrency(body) });
});

/** Validates and updates mutable fields on a currency catalog entry. */
export const updateAdminCurrencyController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  const body = parseRequest(currencyUpdateSchema, req.body, res);
  if (!params || !body) return;
  const currency = await updateAdminCurrency(params.id, body);
  if (!currency) {
    res.status(404).json({ message: 'Currency not found' });
    return;
  }
  res.json({ currency });
});

/** Deletes a currency catalog entry when no related records prevent removal. */
export const deleteAdminCurrencyController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  if (!params) return;
  if (!await deleteAdminCurrency(params.id)) {
    res.status(404).json({ message: 'Currency not found' });
    return;
  }
  res.status(204).send();
});

/** Validates and creates a network catalog entry. */
export const createAdminNetworkController = asyncHandler(async (req, res) => {
  const body = parseRequest(networkCreateSchema, req.body, res);
  if (!body) return;
  res.status(201).json({ network: await createAdminNetwork(body) });
});

/** Validates and updates a network catalog entry by UUID. */
export const updateAdminNetworkController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  const body = parseRequest(networkUpdateSchema, req.body, res);
  if (!params || !body) return;
  const network = await updateAdminNetwork(params.id, body);
  if (!network) {
    res.status(404).json({ message: 'Network not found' });
    return;
  }
  res.json({ network });
});

/** Deletes a network catalog entry when no related records prevent removal. */
export const deleteAdminNetworkController = asyncHandler(async (req, res) => {
  const params = parseRequest(catalogIdParamsSchema, req.params, res);
  if (!params) return;
  if (!await deleteAdminNetwork(params.id)) {
    res.status(404).json({ message: 'Network not found' });
    return;
  }
  res.status(204).send();
});

/** Creates a currency/network relationship after validating both catalog IDs. */
export const createAdminCurrencyNetworkController = asyncHandler(async (req, res) => {
  const body = parseRequest(currencyNetworkCreateSchema, req.body, res);
  if (!body) return;
  res.status(201).json({ currencyNetwork: await createAdminCurrencyNetwork(body) });
});

/** Deletes a currency/network relationship when no wallet address uses it. */
export const deleteAdminCurrencyNetworkController = asyncHandler(async (req, res) => {
  const params = parseRequest(currencyNetworkParamsSchema, req.params, res);
  if (!params) return;
  if (!await deleteAdminCurrencyNetwork(params.currencyId, params.networkId)) {
    res.status(404).json({ message: 'Currency/network relationship not found' });
    return;
  }
  res.status(204).send();
});

/** Returns a cursor-paginated administrator user directory. */
export const getAdminUsersController = asyncHandler(async (req, res) => {
  const query = parseRequest(usersQuerySchema, req.query, res);
  if (!query) return;
  res.json(await findAdminUsersPage({
    ...(query.search ? { search: query.search } : {}),
    ...(query.active ? { isActive: query.active === 'true' } : {}),
  }, { cursor: query.cursor, limit: query.limit }));
});

/** Returns one administrator user profile with wallets and addresses. */
export const getAdminUserController = asyncHandler(async (req, res) => {
  const userId = parseUserId(req, res);
  if (!userId) return;
  const user = await findAdminUserDetail(userId);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json({ user });
});

/** Returns a cursor-paginated unified transaction feed for one user. */
export const getAdminUserTransactionsController = asyncHandler(async (req, res) => {
  const userId = parseUserId(req, res);
  const query = parseRequest(transactionsQuerySchema, req.query, res);
  if (!userId || !query || !(await requireUserIntent(userId, res))) return;
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    res.status(400).json({ message: 'The from date must be before the to date' });
    return;
  }
  res.json(await findAdminTransactionPage({
    userId,
    type: query.type,
    status: query.status,
    createdAfter: query.from ? new Date(query.from) : undefined,
    createdBefore: query.to ? new Date(query.to) : undefined,
  }, { cursor: query.cursor, limit: query.limit }));
});

/** Returns immutable account-version history for one administrator-selected user. */
export const getAdminUserAccountVersionsController = asyncHandler(async (req, res) => {
  const userId = parseUserId(req, res);
  const query = parseRequest(cursorPageSchema, req.query, res);
  if (!userId || !query || !(await requireUserIntent(userId, res))) return;
  res.json(await findAdminAccountVersions(userId, {
    cursor: query.cursor,
    limit: query.limit,
  }));
});

/** Returns cursor-paginated Telegram conversation turns for one user. */
export const getAdminUserConversationsController = asyncHandler(async (req, res) => {
  const userId = parseUserId(req, res);
  const query = parseRequest(cursorPageSchema, req.query, res);
  if (!userId || !query) return;
  const intentId = await requireUserIntent(userId, res);
  if (!intentId) return;
  res.json(await findAdminConversationTurns(intentId, {
    cursor: query.cursor,
    limit: query.limit,
  }));
});
