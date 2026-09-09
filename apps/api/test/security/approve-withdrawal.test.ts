import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getFee: vi.fn(),
  getReview: vi.fn(),
  lock: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('../../src/queries/user.query', () => ({
  getUserByTelegramIdForAuthentication: mocks.getUser,
}));
vi.mock('../../src/services/financial/ngn-withdrawals', () => ({
  getConfiguredNgnWithdrawalFee: mocks.getFee,
  getNgnWithdrawalReview: mocks.getReview,
  lockNgnWithdrawal: mocks.lock,
}));
vi.mock('bcrypt', () => ({ default: { compare: mocks.compare } }));

import { createApproveWithdrawalService } from '../../src/services/users/approve-withdrawal';

const pinAttempts = {
  getState: vi.fn(),
  recordFailure: vi.fn(),
  reset: vi.fn(),
};
const enqueueWithdrawal = vi.fn();
const notify = vi.fn();
const approve = createApproveWithdrawalService({ pinAttempts, enqueueWithdrawal, notify });
const withdrawalId = '018f7d22-7c3d-4a9e-8f6b-123456789a01';
const bankId = '018f7d22-7c3d-4a9e-8f6b-123456789a02';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFee.mockReturnValue('50');
  mocks.getUser.mockResolvedValue({ id: 'user-1', isActive: true, hashedPin: 'hash', chatId: '42' });
  mocks.getReview.mockResolvedValue({ id: withdrawalId });
  pinAttempts.getState.mockResolvedValue({ locked: false, attempts: 0, retryAfterSeconds: 0 });
  pinAttempts.recordFailure.mockResolvedValue({ locked: false, attempts: 1, retryAfterSeconds: 60 });
  mocks.lock.mockResolvedValue({
    outcome: 'locked', total: '1050', withdrawal: { id: withdrawalId, amount: '1000' },
  });
});

describe('NGN withdrawal PIN approval', () => {
  it('does not lock or enqueue when the PIN is invalid', async () => {
    mocks.compare.mockResolvedValue(false);
    await expect(approve({
      withdrawalId, telegramId: '42', bankId, code: '0000',
    })).resolves.toEqual({ outcome: 'invalid-pin' });
    expect(pinAttempts.recordFailure).toHaveBeenCalledWith('42', withdrawalId, 'withdrawal');
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(enqueueWithdrawal).not.toHaveBeenCalled();
  });

  it('locks funds and queues the owned withdrawal after a valid PIN', async () => {
    mocks.compare.mockResolvedValue(true);
    await expect(approve({
      withdrawalId, telegramId: '42', bankId, code: '1234',
    })).resolves.toEqual({ outcome: 'approved', duplicate: false });
    expect(mocks.lock).toHaveBeenCalledWith(withdrawalId, 'user-1', bankId);
    expect(pinAttempts.reset).toHaveBeenCalledWith('42', withdrawalId, 'withdrawal');
    expect(enqueueWithdrawal).toHaveBeenCalledWith({ id: withdrawalId });
  });

  it('fails closed when the fee configuration is missing', async () => {
    mocks.getFee.mockReturnValue(null);
    await expect(approve({
      withdrawalId, telegramId: '42', bankId, code: '1234',
    })).resolves.toEqual({ outcome: 'unavailable' });
    expect(mocks.compare).not.toHaveBeenCalled();
  });
});
