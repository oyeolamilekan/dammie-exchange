import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminSession: vi.fn(),
  deleteAdminSessionByHash: vi.fn(),
  findAdminCredentialsByEmail: vi.fn(),
  findActiveAdminBySessionHash: vi.fn(),
  compare: vi.fn(),
  getNumber: vi.fn(),
  incrementWithTtl: vi.fn(),
  deleteRateKey: vi.fn(),
  ttl: vi.fn(),
}));

vi.mock('../../src/queries/admin-auth.query', async () => {
  const actual = await vi.importActual<typeof import('../../src/queries/admin-auth.query')>(
    '../../src/queries/admin-auth.query',
  );
  return {
    ...actual,
    createAdminSession: mocks.createAdminSession,
    deleteAdminSessionByHash: mocks.deleteAdminSessionByHash,
    findAdminCredentialsByEmail: mocks.findAdminCredentialsByEmail,
    findActiveAdminBySessionHash: mocks.findActiveAdminBySessionHash,
  };
});
vi.mock('bcrypt', () => ({ default: { compare: mocks.compare } }));
vi.mock('../../src/services/security/store', () => ({
  redisSecurityStore: {
    getNumber: mocks.getNumber,
    incrementWithTtl: mocks.incrementWithTtl,
    delete: mocks.deleteRateKey,
    ttl: mocks.ttl,
  },
}));

import { isAllowedCorsOrigin, rejectDisallowedPreflight } from '../../src/app';
import CONFIG from '../../src/config/config';
import {
  loginAdminController,
  logoutAdminController,
} from '../../src/controllers/admin-auth.controller';
import {
  authenticateAdmin,
  validateAdminMutationOrigin,
} from '../../src/middlewares/admin-auth.middleware';
import { sanitizeAdminResponse, sanitizeAdminResponses } from '../../src/middlewares/admin-response.middleware';
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  adminSessionExpiry,
  createAdminSessionToken,
  hashAdminSessionToken,
  readCookie,
} from '../../src/services/security/admin-session';
import adminRouter from '../../src/routes/admin.routes';

const admin = {
  id: '19e10f5d-9d7e-4d2e-ae7f-2f178b608c9e',
  email: 'admin@example.com',
  passwordHash: 'stored-hash',
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const invoke = (
  controller: (req: Request, res: Response, next: NextFunction) => void,
  request: Partial<Request>,
) => new Promise<{ status: number; body: unknown; cookie?: { name: string; value: string; options: unknown }; retryAfter?: string }>((resolve, reject) => {
  let status = 200;
  let cookie: { name: string; value: string; options: unknown } | undefined;
  let retryAfter: string | undefined;
  const response = {
    status(code: number) { status = code; return this; },
    set(name: string, value: string) { if (name === 'Retry-After') retryAfter = value; return this; },
    cookie(name: string, value: string, options: unknown) { cookie = { name, value, options }; return this; },
    clearCookie() { return this; },
    json(body: unknown) { resolve({ status, body, cookie, retryAfter }); return this; },
    send(body?: unknown) { resolve({ status, body, cookie, retryAfter }); return this; },
  } as unknown as Response;
  controller(request as Request, response, reject as NextFunction);
});

describe('admin session security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNumber.mockResolvedValue(0);
    mocks.incrementWithTtl.mockResolvedValue(1);
    mocks.deleteRateKey.mockResolvedValue(undefined);
    mocks.ttl.mockResolvedValue(120);
  });

  it('creates a 256-bit opaque token and stores only its SHA-256 digest', () => {
    const token = createAdminSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashAdminSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAdminSessionToken(token)).not.toContain(token);
  });

  it('uses a 12-hour expiry and permits production cross-site API requests', () => {
    const start = new Date('2026-09-05T10:00:00Z');
    expect(adminSessionExpiry(start).getTime() - start.getTime()).toBe(12 * 60 * 60 * 1000);
    const original = CONFIG.NODE_ENV;
    CONFIG.NODE_ENV = 'production';
    expect(adminSessionCookieOptions()).toEqual(expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/admin',
      maxAge: 12 * 60 * 60 * 1000,
    }));
    CONFIG.NODE_ENV = 'development';
    expect(adminSessionCookieOptions()).toEqual(expect.objectContaining({
      secure: false,
      sameSite: 'lax',
    }));
    CONFIG.NODE_ENV = original;
  });

  it('parses only the requested cookie', () => {
    expect(readCookie(`other=1; ${ADMIN_SESSION_COOKIE}=secret%20token`, ADMIN_SESSION_COOKIE)).toBe('secret token');
  });

  it('creates a session for valid credentials without serializing the password hash', async () => {
    mocks.findAdminCredentialsByEmail.mockResolvedValue(admin);
    mocks.compare.mockResolvedValue(true);
    mocks.createAdminSession.mockResolvedValue({
      session: { id: 'session-id', expiresAt: new Date() },
      admin: { ...admin, lastLoginAt: new Date() },
    });
    const result = await invoke(loginAdminController, {
      body: { email: '  ADMIN@example.com ', password: 'correct-password' },
      ip: '127.0.0.1',
    });
    expect(result.status).toBe(200);
    expect(result.cookie).toEqual(expect.objectContaining({ name: ADMIN_SESSION_COOKIE }));
    expect(JSON.stringify(result.body)).not.toContain('stored-hash');
    expect(mocks.createAdminSession).toHaveBeenCalledWith(
      admin.id,
      hashAdminSessionToken(result.cookie!.value),
      expect.any(Date),
    );
  });

  it('rejects inactive admins with the same generic credential error', async () => {
    mocks.findAdminCredentialsByEmail.mockResolvedValue({ ...admin, isActive: false });
    mocks.compare.mockResolvedValue(true);
    const result = await invoke(loginAdminController, {
      body: { email: admin.email, password: 'correct-password' },
      ip: '127.0.0.1',
    });
    expect(result).toEqual(expect.objectContaining({
      status: 401,
      body: { message: 'Invalid email or password' },
    }));
    expect(mocks.incrementWithTtl).toHaveBeenCalledOnce();
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
  });

  it('rate-limits before doing password work', async () => {
    mocks.getNumber.mockResolvedValue(CONFIG.ADMIN_LOGIN_MAX_ATTEMPTS);
    const result = await invoke(loginAdminController, {
      body: { email: admin.email, password: 'anything' },
      ip: '127.0.0.1',
    });
    expect(result.status).toBe(429);
    expect(result.retryAfter).toBe('120');
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it('revokes the presented session on logout', async () => {
    mocks.deleteAdminSessionByHash.mockResolvedValue(undefined);
    const result = await invoke(logoutAdminController, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=opaque-token` },
    });
    expect(result.status).toBe(204);
    expect(mocks.deleteAdminSessionByHash).toHaveBeenCalledWith(hashAdminSessionToken('opaque-token'));
  });
});

describe('admin request boundaries', () => {
  it('allows credentialed CORS only from the configured frontend', () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true);
    expect(isAllowedCorsOrigin(new URL(CONFIG.FRONTEND_URL).origin)).toBe(true);
    expect(isAllowedCorsOrigin(new URL(CONFIG.ADMIN_FRONTEND_URL).origin)).toBe(true);
    expect(isAllowedCorsOrigin('https://attacker.example')).toBe(false);
  });

  it('returns an explicit 403 for disallowed preflights instead of readiness 503', async () => {
    const result = await invoke(rejectDisallowedPreflight, {
      method: 'OPTIONS',
      get: vi.fn(() => 'https://attacker.example'),
    });
    expect(result).toEqual(expect.objectContaining({
      status: 403,
      body: { message: 'Origin is not allowed' },
    }));
  });

  it('rejects missing and invalid sessions', async () => {
    const missing = await invoke(authenticateAdmin, { headers: {} });
    expect(missing).toEqual(expect.objectContaining({ status: 401 }));
    mocks.findActiveAdminBySessionHash.mockResolvedValue(null);
    const expired = await invoke(authenticateAdmin, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=expired` },
    });
    expect(expired).toEqual(expect.objectContaining({ status: 401 }));
  });

  it('requires the configured origin on mutations', async () => {
    const call = (origin?: string) => invoke(validateAdminMutationOrigin, {
      method: 'POST',
      get: vi.fn((name: string) => name === 'origin' ? origin : undefined),
    });
    expect((await call()).status).toBe(403);
    expect((await call('https://attacker.example')).status).toBe(403);
    let continued = false;
    await new Promise<void>((resolve) => validateAdminMutationOrigin({
      method: 'POST',
      get: vi.fn(() => new URL(CONFIG.FRONTEND_URL).origin),
    } as unknown as Request, {} as Response, () => { continued = true; resolve(); }));
    expect(continued).toBe(true);
  });

  it('removes sensitive fields recursively from every admin response', () => {
    const response = sanitizeAdminResponse({
      user: { id: 'safe', bvnNumber: 'secret', hashedPin: 'hash', wallets: [{ id: 'wallet', walletId: 'provider-id' }] },
      passwordHash: 'admin-hash',
    });
    expect(response).toEqual({ user: { id: 'safe', wallets: [{ id: 'wallet' }] } });
  });

  it('preserves subUserId and nested deposit addresses through the JSON response middleware', () => {
    const json = vi.fn();
    const res = { json } as unknown as Response;
    const next = vi.fn();
    sanitizeAdminResponses({} as Request, res, next);
    const addresses = [
      { id: 'address-1', network: 'trc20', address: 'test-tron-address', destinationTag: null },
      { id: 'address-2', network: 'bep20', address: 'test-evm-address', destinationTag: '0' },
    ];
    res.json({
      user: {
        id: 'user-1', subUserId: 'quidax-sub-user-1', hashedPin: 'private-pin',
        bvnNumber: 'private-bvn', chatId: 'private-chat', intentId: 'private-intent',
        wallets: [{ id: 'wallet-1', currency: 'USDT', walletId: 'private-provider-id', addresses }],
      },
      passwordHash: 'private-password', tokenHash: 'private-token',
    });
    expect(next).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({
      user: {
        id: 'user-1', subUserId: 'quidax-sub-user-1',
        wallets: [{ id: 'wallet-1', currency: 'USDT', addresses }],
      },
    });
  });
});

describe('admin route protection', () => {
  it('registers authentication ahead of every protected endpoint', () => {
    type RouterLayer = {
      name: string;
      route?: { path: string; stack: Array<{ name: string }> };
    };
    const layers = (adminRouter as unknown as { stack: RouterLayer[] }).stack;
    const globalAuthIndex = layers.findIndex((layer) => layer.name === 'authenticateAdmin');
    expect(globalAuthIndex).toBeGreaterThan(-1);

    const dataPaths = [
      '/overview',
      '/users',
      '/users/:userId',
      '/users/:userId/transactions',
      '/users/:userId/account-versions',
      '/users/:userId/conversations',
      '/catalog',
      '/catalog/currencies',
      '/catalog/currencies/:id',
      '/catalog/networks',
      '/catalog/networks/:id',
      '/catalog/currency-networks',
      '/catalog/currency-networks/:currencyId/:networkId',
    ];
    for (const path of dataPaths) {
      const routeIndex = layers.findIndex((layer) => layer.route?.path === path);
      expect(routeIndex, path).toBeGreaterThan(globalAuthIndex);
    }
    for (const path of ['/auth/me', '/auth/logout']) {
      const route = layers.find((layer) => layer.route?.path === path)?.route;
      expect(route?.stack.map((handler) => handler.name), path).toContain('authenticateAdmin');
    }
  });
});
