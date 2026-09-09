import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIntentByCompleteSignupId: vi.fn(),
  createUser: vi.fn(),
  getUserByIntentId: vi.fn(),
  getUserByTelegramId: vi.fn(),
  getUserByTelegramIdForAuthentication: vi.fn(),
  createSubUser: vi.fn(),
  validateBankAccount: vi.fn(),
  createWalletJob: vi.fn(),
  processSwap: vi.fn(),
  processNgnWithdrawal: vi.fn(),
  createBank: vi.fn(),
  findBank: vi.fn(),
  findBanksForUser: vi.fn(),
  removeBankForUser: vi.fn(),
  findSwapByIdForUser: vi.fn(),
  sendMessage: vi.fn(),
  bcryptCompare: vi.fn(),
  securityGetNumber: vi.fn(),
  securityIncrement: vi.fn(),
  securityDelete: vi.fn(),
  securityTtl: vi.fn(),
}));

vi.mock('../../src/queries/intent.query', () => ({
  getIntentByCompleteSignupId: mocks.getIntentByCompleteSignupId,
}));
vi.mock('../../src/queries/user.query', () => ({
  createUser: mocks.createUser,
  getUserByIntentId: mocks.getUserByIntentId,
  getUserByTelegramId: mocks.getUserByTelegramId,
  getUserByTelegramIdForAuthentication:
    mocks.getUserByTelegramIdForAuthentication,
}));
vi.mock('../../src/services/integrations/quidax', () => ({
  quidax: {
    createSubUser: mocks.createSubUser,
    validateBankAccount: mocks.validateBankAccount,
  },
}));
vi.mock('../../src/jobs/event.job', () => ({
  createWalletJob: mocks.createWalletJob,
  processSwap: mocks.processSwap,
  processNgnWithdrawal: mocks.processNgnWithdrawal,
}));
vi.mock('../../src/queries/bank.query', () => ({
  createBank: mocks.createBank,
  findBank: mocks.findBank,
  findBanksForUser: mocks.findBanksForUser,
  removeBankForUser: mocks.removeBankForUser,
}));
vi.mock('../../src/queries/swap.query', () => ({
  findSwapByIdForUser: mocks.findSwapByIdForUser,
}));
vi.mock('../../src/plugins/bot', () => ({
  telegramClient: { sendMessage: mocks.sendMessage },
}));
vi.mock('bcrypt', () => ({
  default: {
    compare: mocks.bcryptCompare,
    genSalt: vi.fn(),
    hash: vi.fn(),
  },
}));
vi.mock('../../src/services/security/store', () => ({
  redisSecurityStore: {
    claimOnce: vi.fn(),
    getNumber: mocks.securityGetNumber,
    incrementWithTtl: mocks.securityIncrement,
    delete: mocks.securityDelete,
    ttl: mocks.securityTtl,
  },
}));

import {
  addBankAccountController,
  approveTransactionController,
  createUserController,
  removeBankAccountController,
} from '../../src/controllers/user.controller';

interface ControllerResult {
  status: number;
  body: unknown;
}

const invoke = (
  controller: (req: Request, res: Response, next: NextFunction) => void,
  request: Partial<Request>,
): Promise<ControllerResult> =>
  new Promise((resolve, reject) => {
    let status = 200;
    const response = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body });
        return this;
      },
      set: vi.fn().mockReturnThis(),
    } as unknown as Response;

    controller(
      request as Request,
      response,
      reject as NextFunction,
    );
  });

describe('authenticated mutation ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.securityGetNumber.mockResolvedValue(0);
    mocks.securityIncrement.mockResolvedValue(1);
    mocks.securityDelete.mockResolvedValue(undefined);
    mocks.securityTtl.mockResolvedValue(60);
  });

  it('does not let a legacy route userId override the signed bank owner', async () => {
    const userA = {
      id: 'user-a',
      firstName: 'Ada',
      lastName: 'Nwosu',
      chatId: '42',
    };
    mocks.getUserByTelegramId.mockResolvedValue(userA);
    mocks.findBank.mockResolvedValue(null);
    mocks.validateBankAccount.mockResolvedValue({ account_name: 'Ada Nwosu' });
    mocks.createBank.mockResolvedValue({ id: 'bank-a' });

    const result = await invoke(addBankAccountController, {
      params: { userId: 'user-b' },
      body: { bankCode: '001', accountNumber: '0123456789' },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(200);
    expect(mocks.getUserByTelegramId).toHaveBeenCalledWith('42');
    expect(mocks.createBank).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a' }),
    );
  });

  it('cannot remove another customer\'s saved bank account', async () => {
    const bankId = '018f7d22-7c3d-7a9e-8f6b-123456789abc';
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-a' });
    mocks.removeBankForUser.mockResolvedValue(null);

    const result = await invoke(removeBankAccountController, {
      params: { bankId },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result).toEqual({
      status: 404,
      body: { success: false, message: 'Bank account not found', data: null },
    });
    expect(mocks.removeBankForUser).toHaveBeenCalledWith(bankId, 'user-a');
  });

  it('returns 404 without processing when User A requests User B swap', async () => {
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a',
      hashedPin: 'hash',
    });
    mocks.findSwapByIdForUser.mockResolvedValue(null);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-b' },
      body: { code: '1234' },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(404);
    expect(mocks.findSwapByIdForUser).toHaveBeenCalledWith('swap-b', 'user-a');
    expect(mocks.processSwap).not.toHaveBeenCalled();
  });

  it('resets PIN failures after a valid owner approval', async () => {
    const user = { id: 'user-a', hashedPin: 'hash', chatId: '42' };
    const swap = { fromAmount: '1', fromCurrency: 'btc' };
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue(user);
    mocks.findSwapByIdForUser.mockResolvedValue(swap);
    mocks.bcryptCompare.mockResolvedValue(true);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: '1234' },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(200);
    expect(mocks.securityDelete).toHaveBeenCalled();
    expect(mocks.processSwap).toHaveBeenCalledWith(swap);
  });

  it('locks at the configured failed-PIN threshold', async () => {
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a',
      hashedPin: 'hash',
    });
    mocks.findSwapByIdForUser.mockResolvedValue({ id: 'swap-a' });
    mocks.bcryptCompare.mockResolvedValue(false);
    mocks.securityIncrement.mockResolvedValue(5);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: 'wrong' },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(429);
    expect(mocks.processSwap).not.toHaveBeenCalled();
  });

  it('fails approval closed when Redis is unavailable', async () => {
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a',
      hashedPin: 'hash',
    });
    mocks.findSwapByIdForUser.mockResolvedValue({ id: 'swap-a' });
    mocks.securityGetNumber.mockRejectedValue(new Error('redis unavailable'));

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: '1234' },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(503);
    expect(mocks.bcryptCompare).not.toHaveBeenCalled();
    expect(mocks.processSwap).not.toHaveBeenCalled();
  });

  it('returns 404 when signup intent belongs to another Telegram user', async () => {
    mocks.getIntentByCompleteSignupId.mockResolvedValue({
      telegramId: '99',
    });

    const result = await invoke(createUserController, {
      params: { id: 'intent-b' },
      body: {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Nwosu',
      },
      telegramUser: { id: '42', firstName: 'Ada' },
    });

    expect(result.status).toBe(404);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
