import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserByTelegramId: vi.fn(),
  findBanksForUser: vi.fn(),
}));

vi.mock('../../src/queries/user.query', () => ({
  getUserByTelegramId: mocks.getUserByTelegramId,
}));
vi.mock('../../src/queries/bank.query', () => ({
  findBanksForUser: mocks.findBanksForUser,
}));

import { removeBankAccount } from '../../src/tools/remove-bank-account';

describe('removeBankAccount tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a management action when the customer has saved accounts', async () => {
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-a' });
    mocks.findBanksForUser.mockResolvedValue([{ id: 'bank-a' }]);

    const output = await removeBankAccount({ userId: 42 });

    expect(mocks.getUserByTelegramId).toHaveBeenCalledWith('42');
    expect(output).toContain('ACTION: REMOVE_BANK_ACCOUNT');
    expect(output).toContain('PARAM: user-a');
  });

  it('does not create an action when no account is saved', async () => {
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-a' });
    mocks.findBanksForUser.mockResolvedValue([]);

    const output = await removeBankAccount({ userId: 42 });

    expect(output).toBe('You do not have any saved bank accounts to remove.');
    expect(output).not.toContain('ACTION:');
  });

  it('does not reveal a management action for an unknown user', async () => {
    mocks.getUserByTelegramId.mockResolvedValue(null);

    const output = await removeBankAccount({ userId: 42 });

    expect(output).toContain('User not found');
    expect(mocks.findBanksForUser).not.toHaveBeenCalled();
  });
});
