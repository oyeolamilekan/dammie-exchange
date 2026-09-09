// Keep admin requests same-origin and let Next.js proxy /api/v1 to the API.
// This guarantees the version prefix and preserves credentialed cookies.
const API_ROOT = "/api/v1/admin";

export interface AdminIdentity {
  id: string;
  email: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminTransaction {
  id: string;
  type: "deposit" | "swap" | "withdrawal";
  status: "pending" | "processing" | "success" | "failed";
  createdAt: string;
  sourceAmount: string;
  sourceCurrency: string;
  network: string | null;
  destinationAmount: string | null;
  destinationCurrency: string | null;
  grossAmount?: string | null;
  grossToAmount?: string | null;
  platformFeeAmount?: string | null;
  providerResponse?: unknown | null;
  reference: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AdminOverview {
  users: { total: number; active: number; inactive: number };
  transactions: Record<AdminTransaction["type"], Partial<Record<AdminTransaction["status"], number>>>;
  balances: Array<{ currency: string; balance: string; lockedBalance: string; walletCount: number }>;
  recentTransactions: AdminTransaction[];
  reconciliation: {
    count: number;
    items: Array<{ id: string; status: string; createdAt: string; reference: string }>;
  };
}

export interface AdminCatalogNetwork {
  id: string;
  name: string;
  code: string;
}

export interface AdminCatalogCurrencyNetwork {
  currencyId: string;
  currencyName: string;
  currencyCode: string;
  networkId: string;
  networkName: string;
  networkCode: string;
}

export interface AdminCatalogCurrency {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  isCrypto: boolean;
  networks: AdminCatalogNetwork[];
}

export type AdminFeeContext = "swap" | "withdrawal";
export type AdminFeeType = "flat" | "percentage";

export interface AdminPlatformFee {
  id: string;
  currencyId: string;
  context: AdminFeeContext;
  type: AdminFeeType;
  amount: string;
  minimumFee: string | null;
  maximumFee: string | null;
  enabled: boolean;
  createdByAdminId: string;
  updatedByAdminId: string;
  createdAt: string;
  updatedAt: string;
  currency: { id: string; name: string; code: string };
  updatedBy: { id: string; email: string };
}

export interface AdminPlatformFeeAudit {
  id: string;
  ruleId: string;
  adminId: string;
  adminEmail: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  telegramId: string;
  isActive: boolean;
  createdAt: string;
  walletCount: number;
}

export interface AdminWallet {
  id: string;
  currency: string;
  balance: string;
  lockedBalance: string;
  isCrypto: boolean;
  createdAt: string;
  updatedAt: string;
  addresses: Array<{
    id: string;
    network: string;
    address: string;
    destinationTag: string | null;
  }>;
}

export interface AdminUserDetail extends Omit<AdminUserListItem, "walletCount"> {
  subUserId: string;
  updatedAt: string;
  wallets: AdminWallet[];
}

export interface AccountVersion {
  id: string;
  transactionType: AdminTransaction["type"];
  action: string;
  timestamp: string;
  createdAt: string;
  currency: string;
  amount: string;
  previousBalance: string;
  balance: string;
  lockedBalance: string;
  transactionReference: string;
}

export interface ConversationMessage {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationTurn {
  turnId: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const messageFromResponse = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Use the status fallback for non-JSON failures.
  }
  return `Request failed (${response.status})`;
};

export async function adminRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { redirectOnUnauthorized?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    if (
      response.status === 401
      && options.redirectOnUnauthorized !== false
      && typeof window !== "undefined"
      && window.location.pathname !== "/admin/login"
    ) {
      window.location.assign("/admin/login?expired=1");
    }
    throw new AdminApiError(await messageFromResponse(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const queryString = (values: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};
