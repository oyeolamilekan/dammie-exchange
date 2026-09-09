import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';

const mocks = vi.hoisted(() => ({
  getIntentByCompleteSignupId: vi.fn(),
  getUserByIntentId: vi.fn(),
  createUser: vi.fn(),
  getUserByTelegramId: vi.fn(),
  getUserByTelegramIdForAuthentication: vi.fn(),
  createSubUser: vi.fn(),
  validateBankAccount: vi.fn(),
  createWalletJob: vi.fn(),
  processSwap: vi.fn(),
  processNgnWithdrawal: vi.fn(),
  findBank: vi.fn(),
  findBanksForUser: vi.fn(),
  removeBankForUser: vi.fn(),
  createBank: vi.fn(),
  findSwapByIdForUser: vi.fn(),
  sendMessage: vi.fn(),
  bcryptCompare: vi.fn(),
  bcryptGenSalt: vi.fn(),
  bcryptHash: vi.fn(),
  securityGetNumber: vi.fn(),
  securityIncrement: vi.fn(),
  securityDelete: vi.fn(),
  securityTtl: vi.fn(),
  findSupportedCryptos: vi.fn(),
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
vi.mock('../../src/queries/catalog.query', () => ({
  findSupportedCryptos: mocks.findSupportedCryptos,
}));
vi.mock('../../src/plugins/bot', () => ({
  telegramClient: { sendMessage: mocks.sendMessage },
}));
vi.mock('bcrypt', () => ({
  default: {
    compare: mocks.bcryptCompare,
    genSalt: mocks.bcryptGenSalt,
    hash: mocks.bcryptHash,
  },
}));
vi.mock('../../src/services/security/store', () => ({
  redisSecurityStore: {
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
  listBankAccountsController,
  removeBankAccountController,
} from '../../src/controllers/user.controller';

interface ControllerResult {
  status: number;
  body: unknown;
  retryAfter?: string;
}

const invoke = (
  controller: (req: Request, res: Response, next: NextFunction) => void,
  request: Partial<Request>,
): Promise<ControllerResult> => new Promise((resolve, reject) => {
  let status = 200;
  let retryAfter: string | undefined;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    set(name: string, value: string) {
      if (name === 'Retry-After') retryAfter = value;
      return this;
    },
    json(body: unknown) {
      resolve({ status, body, retryAfter });
      return this;
    },
  } as unknown as Response;

  controller(request as Request, response, reject as NextFunction);
});

describe('user controller compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bcryptGenSalt.mockResolvedValue('salt');
    mocks.bcryptHash.mockResolvedValue('hashed-pin');
    mocks.securityGetNumber.mockResolvedValue(0);
    mocks.securityIncrement.mockResolvedValue(1);
    mocks.securityDelete.mockResolvedValue(undefined);
    mocks.securityTtl.mockResolvedValue(60);
    mocks.createWalletJob.mockResolvedValue(undefined);
    mocks.processSwap.mockResolvedValue(undefined);
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.findSupportedCryptos.mockResolvedValue(catalogFixture);
  });

  it('keeps registration status, envelope, queued wallet job, and notification', async () => {
    const intent = {
      id: 'intent-1',
      telegramId: '42',
      chatId: 'chat-42',
    };
    const user = {
      id: 'user-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Nwosu',
      bvnNumber: '123',
      hashedPin: 'hashed-pin',
      telegramId: '42',
      subUserId: 'sub-1',
      intentId: 'intent-1',
      chatId: 'chat-42',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.getIntentByCompleteSignupId.mockResolvedValue(intent);
    mocks.getUserByIntentId.mockResolvedValue(null);
    mocks.createSubUser.mockResolvedValue({ id: 'sub-1' });
    mocks.createUser.mockResolvedValue(user);

    const result = await invoke(createUserController, {
      params: { id: 'signup-1' },
      body: {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Nwosu',
        bvnNumber: '123',
        transactionPin: '1234',
      },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 201,
      body: {
        success: true,
        message: 'User successfully created',
        data: {
          id: 'user-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Nwosu',
        },
      },
    });
    expect(mocks.createWalletJob).toHaveBeenCalledWith({
      userId: 'user-1',
      subUserId: 'sub-1',
      email: 'ada@example.com',
    });
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(
      'chat-42',
      expect.stringContaining('Account Created Successfully'),
      undefined,
    ));
  });

  it('rejects a non-four-digit transaction PIN before provider or password work', async () => {
    mocks.getIntentByCompleteSignupId.mockResolvedValue({
      id: 'intent-1', telegramId: '42', chatId: 'chat-42',
    });
    const result = await invoke(createUserController, {
      params: { id: 'signup-1' },
      body: {
        email: 'ada@example.com', firstName: 'Ada', lastName: 'Nwosu',
        bvnNumber: '123', transactionPin: '12ab',
      },
      telegramUser: { id: '42' },
    });
    expect(result).toMatchObject({
      status: 400,
      body: { success: false, message: 'Transaction PIN must be exactly four digits' },
    });
    expect(mocks.createSubUser).not.toHaveBeenCalled();
    expect(mocks.bcryptHash).not.toHaveBeenCalled();
  });

  it('preserves registration ownership rejection', async () => {
    mocks.getIntentByCompleteSignupId.mockResolvedValue({
      id: 'intent-1',
      telegramId: 'other-user',
      chatId: 'chat-other',
    });

    const result = await invoke(createUserController, {
      params: { id: 'signup-1' },
      body: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Nwosu' },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 404,
      body: { success: false, message: 'Intent not found', data: null },
    });
    expect(mocks.createSubUser).not.toHaveBeenCalled();
    expect(mocks.createWalletJob).not.toHaveBeenCalled();
  });

  it('keeps the legacy bank route owner-scoped and notifies on success', async () => {
    mocks.getUserByTelegramId.mockResolvedValue({
      id: 'user-a',
      firstName: 'Ada',
      lastName: 'Nwosu',
      chatId: 'chat-a',
    });
    mocks.findBank.mockResolvedValue(null);
    mocks.validateBankAccount.mockResolvedValue({ account_name: 'Ada Nwosu' });
    mocks.createBank.mockResolvedValue({
      id: 'bank-1',
      userId: 'user-a',
      accountNumber: '0123456789',
      accountName: 'Ada Nwosu',
      bankCode: '001',
    });

    const result = await invoke(addBankAccountController, {
      params: { userId: 'user-b' },
      body: { bankCode: '001', accountNumber: '0123456789' },
      telegramUser: { id: '42' },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      message: 'Bank account added successfully',
    }));
    expect(mocks.getUserByTelegramId).toHaveBeenCalledWith('42');
    expect(mocks.createBank).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('bank account details'),
      undefined,
    ));
  });

  it('preserves bank-account name mismatch mapping', async () => {
    mocks.getUserByTelegramId.mockResolvedValue({
      id: 'user-a', firstName: 'Ada', lastName: 'Nwosu', chatId: 'chat-a',
    });
    mocks.findBank.mockResolvedValue(null);
    mocks.validateBankAccount.mockResolvedValue({ account_name: 'Other Person' });

    const result = await invoke(addBankAccountController, {
      body: { bankCode: '001', accountNumber: '0123456789' },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 400,
      body: {
        success: false,
        message: 'Account name does not match your profile name',
        data: null,
      },
    });
    expect(mocks.createBank).not.toHaveBeenCalled();
  });

  it('lists only masked saved bank-account details', async () => {
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-a' });
    mocks.findBanksForUser.mockResolvedValue([{
      id: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
      accountName: 'Ada Nwosu',
      accountNumber: '0123456789',
      bankCode: '001',
      isDefault: true,
    }]);

    const result = await invoke(listBankAccountsController, {
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        message: 'Bank accounts retrieved successfully',
        data: [{
          id: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
          accountName: 'Ada Nwosu',
          accountNumberMasked: '••••••6789',
          bankCode: '001',
          isDefault: true,
        }],
      },
    });
  });

  it('removes a saved account using the authenticated owner', async () => {
    const bankId = '018f7d22-7c3d-7a9e-8f6b-123456789abc';
    mocks.getUserByTelegramId.mockResolvedValue({ id: 'user-a' });
    mocks.removeBankForUser.mockResolvedValue({ id: bankId });

    const result = await invoke(removeBankAccountController, {
      params: { bankId },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 200,
      body: { success: true, message: 'Bank account removed successfully', data: null },
    });
    expect(mocks.removeBankForUser).toHaveBeenCalledWith(bankId, 'user-a');
  });

  it('rejects an invalid bank account ID before any lookup', async () => {
    const result = await invoke(removeBankAccountController, {
      params: { bankId: 'not-a-bank-id' },
      telegramUser: { id: '42' },
    });

    expect(result.status).toBe(400);
    expect(mocks.getUserByTelegramId).not.toHaveBeenCalled();
    expect(mocks.removeBankForUser).not.toHaveBeenCalled();
  });

  it('preserves invalid PIN mapping and does not queue the swap', async () => {
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a', hashedPin: 'hash', chatId: 'chat-a',
    });
    mocks.findSwapByIdForUser.mockResolvedValue({
      fromAmount: '1.25', fromCurrency: 'usdc',
    });
    mocks.bcryptCompare.mockResolvedValue(false);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: 'wrong' },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 400,
      body: { success: false, message: 'Invalid PIN', data: null },
    });
    expect(mocks.processSwap).not.toHaveBeenCalled();
  });

  it('preserves PIN rate limiting and Retry-After', async () => {
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a', hashedPin: 'hash', chatId: 'chat-a',
    });
    mocks.findSwapByIdForUser.mockResolvedValue({ id: 'swap-a' });
    mocks.bcryptCompare.mockResolvedValue(false);
    mocks.securityIncrement.mockResolvedValue(5);
    mocks.securityTtl.mockResolvedValue(77);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: 'wrong' },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 429,
      body: { success: false, message: 'Too many invalid PIN attempts', data: null },
      retryAfter: '77',
    });
    expect(mocks.processSwap).not.toHaveBeenCalled();
  });

  it('preserves successful approval queueing, reset, and notification', async () => {
    const swap = {
      id: 'swap-a',
      fromAmount: '1.25',
      fromCurrency: 'usdc',
    };
    mocks.getUserByTelegramIdForAuthentication.mockResolvedValue({
      id: 'user-a', hashedPin: 'hash', chatId: 'chat-a',
    });
    mocks.findSwapByIdForUser.mockResolvedValue(swap);
    mocks.bcryptCompare.mockResolvedValue(true);

    const result = await invoke(approveTransactionController, {
      params: { swapId: 'swap-a' },
      body: { code: '1234' },
      telegramUser: { id: '42' },
    });

    expect(result).toEqual({
      status: 200,
      body: { success: true, message: 'Transaction approved successfully', data: null },
    });
    expect(mocks.securityDelete).toHaveBeenCalledWith('security:pin:42:swap:swap-a');
    expect(mocks.processSwap).toHaveBeenCalledWith(swap);
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(
      'chat-a',
      expect.stringContaining('Swap Approved'),
      undefined,
    ));
  });
});
