import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';

const mocks = vi.hoisted(() => ({
  ensureWallet: vi.fn(),
  findOneWallet: vi.fn(),
  createWallet: vi.fn(),
  assignWalletAddress: vi.fn(),
  getUserBy: vi.fn(),
}));

vi.mock('../../src/queries/wallet.query', () => ({
  ensureWallet: mocks.ensureWallet,
  findOneWallet: mocks.findOneWallet,
  createWallet: mocks.createWallet,
  assignWalletAddress: mocks.assignWalletAddress,
}));
vi.mock('../../src/queries/user.query', () => ({
  createUser: vi.fn(),
  getUserByIntentId: vi.fn(),
  getUserBy: mocks.getUserBy,
}));
vi.mock('../../src/queries/intent.query', () => ({ getIntentByCompleteSignupId: vi.fn() }));
vi.mock('../../src/queries/catalog.query', () => ({ findSupportedCryptos: vi.fn() }));

import { provisionUserWallets } from '../../src/services/users/register';

const input = { userId: 'user-1', subUserId: 'sub-1', email: 'ada@example.com' };

describe('user wallet provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureWallet.mockResolvedValue({ wallet: { id: 'wallet-ngn' }, created: true });
    mocks.findOneWallet.mockResolvedValue(null);
    mocks.createWallet.mockImplementation(async ({ currency }) => ({ id: `wallet-${currency}` }));
    mocks.getUserBy.mockResolvedValue(null);
  });

  it('creates an internal non-crypto NGN wallet without calling the provider', async () => {
    const quidax = {
      fetchCurrency: vi.fn(),
      createPaymentAddress: vi.fn(),
    };

    await expect(provisionUserWallets(input, {
      quidax,
      onAddressAssigned: vi.fn(),
    }, [])).resolves.toEqual([
      { currency: 'ngn', created: true, networks: [] },
    ]);

    expect(mocks.ensureWallet).toHaveBeenCalledWith({
      userId: 'user-1',
      currency: 'ngn',
      inProgress: false,
    });
    expect(quidax.fetchCurrency).not.toHaveBeenCalled();
    expect(quidax.createPaymentAddress).not.toHaveBeenCalled();
  });

  it('provisions NGN separately from provider-backed crypto wallets', async () => {
    const quidax = {
      fetchCurrency: vi.fn().mockResolvedValue({ id: 'provider-wallet-usdc' }),
      createPaymentAddress: vi.fn().mockResolvedValue({ address: '0xabc' }),
    };

    const results = await provisionUserWallets(input, {
      quidax,
      onAddressAssigned: vi.fn(),
    }, [catalogFixture[0]]);

    expect(results[0]).toEqual({ currency: 'ngn', created: true, networks: [] });
    expect(quidax.fetchCurrency).toHaveBeenCalledTimes(1);
    expect(quidax.fetchCurrency).toHaveBeenCalledWith('sub-1', 'usdc');
    expect(mocks.createWallet).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'usdc',
      walletId: 'provider-wallet-usdc',
    }));
  });
});
