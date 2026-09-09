import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn() }));
vi.mock('../../src/services/financial/ngn-withdrawals', () => ({
  createNgnWithdrawalIntent: mocks.create,
}));
vi.mock('../../src/queries/user.query', () => ({ getUserByTelegramId: mocks.getUser }));

import { withdrawNgn } from '../../src/tools/withdraw-ngn';

beforeEach(() => vi.clearAllMocks());

describe('withdrawNgn tool', () => {
  it('creates the trusted PIN-approval action with normalized amounts', async () => {
    mocks.create.mockResolvedValue({
      outcome: 'created',
      total: '1050000',
      withdrawal: {
        id: 'withdrawal-1', amount: '1000000.000000000000000000', fee: '50000.000000000000000000',
      },
    });
    const output = await withdrawNgn('1000000', { userId: 42 });
    expect(mocks.create).toHaveBeenCalledWith('42', '1000000');
    expect(output).toContain('Bank receives: ₦1,000,000');
    expect(output).toContain('Withdrawal fee: ₦50,000');
    expect(output).toContain('Total wallet debit: ₦1,050,000');
    expect(output).toContain('ACTION: APPROVE_WITHDRAWAL_ACTION');
    expect(output).toContain('PARAM: withdrawal-1');
  });

  it('does not create a withdrawal action when the total balance is insufficient', async () => {
    mocks.create.mockResolvedValue({ outcome: 'insufficient-balance', balance: '100000', total: '1050000' });
    const output = await withdrawNgn('1000000', { userId: 42 });
    expect(output).toContain('Insufficient NGN balance');
    expect(output).toContain('₦1,050,000');
    expect(output).toContain('₦100,000');
    expect(output).not.toContain('APPROVE_WITHDRAWAL_ACTION');
  });
});
