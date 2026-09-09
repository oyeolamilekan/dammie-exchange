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

import { getWalletAddress } from '../../src/tools/get-wallet-address';

describe('getWalletAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-1' });
    mocks.findOneWallet.mockResolvedValue({
      addresses: [
        { network: 'erc20', address: '0x-erc', destinationTag: null },
        { network: 'base', address: '0x-base', destinationTag: null },
      ],
    });
  });

  it('returns only the requested currency-network address', async () => {
    const output = await getWalletAddress(
      'USDC',
      'BASE',
      { userId: 42, username: 'ada' },
      catalogFixture,
    );

    expect(mocks.findOneWallet).toHaveBeenCalledWith({
      userId: 'user-1',
      currency: 'usdc',
    });
    expect(output).toContain('0x-base');
    expect(output).not.toContain('0x-erc');
    expect(output).toContain('PARAM: 0x-base');
  });

  it('rejects a network that is not configured for the currency', async () => {
    await expect(
      getWalletAddress('CNGN', 'CELO', { userId: 42 }, catalogFixture),
    ).resolves.toContain('CELO is not supported for CNGN');
    expect(mocks.getUserByTelegramId).not.toHaveBeenCalled();
  });
});
