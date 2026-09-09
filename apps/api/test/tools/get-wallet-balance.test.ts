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

import { getWalletBalance } from '../../src/tools/get-wallet-balance';

describe('getWalletBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-1' });
  });

  it('formats balances for display without changing the wallet values', async () => {
    mocks.findOneWallet.mockResolvedValue({
      balance: '1234567.25',
      lockedBalance: '500000.5',
      updatedAt: '2026-08-29T08:00:00.000Z',
    });

    const output = await getWalletBalance('USDC', { userId: 42 }, catalogFixture);

    expect(output).toContain('Available: 1,234,567.25 USDC');
    expect(output).toContain('Locked: 500,000.5 USDC');
    expect(output).toContain('Total: 1,734,567.75 USDC');
  });

  it('renders zero balances when the supported wallet does not exist', async () => {
    mocks.findOneWallet.mockResolvedValue(null);

    const output = await getWalletBalance('USDC', { userId: 42 }, catalogFixture);

    expect(output).toContain('Available: 0 USDC');
    expect(output).toContain('Locked: 0 USDC');
    expect(output).toContain('Total: 0 USDC');
  });
});
