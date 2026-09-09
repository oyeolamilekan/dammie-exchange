import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';

const mocks = vi.hoisted(() => ({
  getUserByTelegramId: vi.fn(),
  findOneWallet: vi.fn(),
}));

vi.mock('../../src/queries/user.query', () => ({
  getUserByTelegramId: mocks.getUserByTelegramId,
}));
vi.mock('../../src/queries/wallet.query', () => ({
  findOneWallet: mocks.findOneWallet,
}));

import { fetchWallet } from '../../src/tools/fetch-wallet';

describe('fetchWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-1' });
  });

  it('fetches one owner-scoped crypto wallet with balances and all addresses', async () => {
    mocks.findOneWallet.mockResolvedValue({
      balance: '1250.25',
      lockedBalance: '49.75',
      isCrypto: true,
      inProgress: false,
      updatedAt: new Date('2026-09-08T08:00:00.000Z'),
      addresses: [
        { network: 'base', address: '0xabc', destinationTag: null },
        { network: 'sol', address: 'wallet-address', destinationTag: '42' },
      ],
    });

    const output = await fetchWallet('USDC', { userId: 42 }, catalogFixture);

    expect(mocks.findOneWallet).toHaveBeenCalledWith({
      userId: 'user-1',
      currency: 'usdc',
    });
    expect(output).toContain('Available: 1,250.25 USDC');
    expect(output).toContain('Locked: 49.75 USDC');
    expect(output).toContain('Total: 1,300 USDC');
    expect(output).toContain('• BASE: `0xabc`');
    expect(output).toContain('• SOL: `wallet-address` · Memo/tag: `42`');
    expect(output).not.toContain('user-1');
  });

  it('supports an NGN wallet without deposit addresses', async () => {
    mocks.findOneWallet.mockResolvedValue({
      balance: '50000',
      lockedBalance: '0',
      isCrypto: false,
      inProgress: false,
      updatedAt: new Date('2026-09-08T08:00:00.000Z'),
      addresses: [],
    });

    const output = await fetchWallet('NGN', { userId: 42 }, catalogFixture);

    expect(output).toContain('*NGN Wallet*');
    expect(output).toContain('Deposit addresses: Not applicable');
  });

  it('returns a safe message when the wallet does not exist', async () => {
    mocks.findOneWallet.mockResolvedValue(null);

    await expect(fetchWallet('USDC', { userId: 42 }, catalogFixture))
      .resolves.toBe('❌ No USDC wallet was found for your account.');
  });

  it('does not query wallets when the authenticated user is missing', async () => {
    mocks.getUserByTelegramId.mockResolvedValue(null);

    await expect(fetchWallet('USDC', { userId: 42 }, catalogFixture))
      .resolves.toBe('❌ User not found. Please ensure you are registered.');
    expect(mocks.findOneWallet).not.toHaveBeenCalled();
  });

  it('rejects unsupported currencies before querying the user', async () => {
    await expect(fetchWallet('DOGE', { userId: 42 }, catalogFixture))
      .resolves.toBe('❌ DOGE is not a supported wallet currency.');
    expect(mocks.getUserByTelegramId).not.toHaveBeenCalled();
  });
});
