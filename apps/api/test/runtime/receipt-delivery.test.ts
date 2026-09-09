import type Bull from 'bull';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NgnWithdrawalJobPayload,
  SuccessfulWithdrawJobPayload,
} from '../../src/jobs/queue-registry.job';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  findSwap: vi.fn(),
  verify: vi.fn(),
  finalize: vi.fn(),
  settlePayout: vi.fn(),
  processWithdrawal: vi.fn(),
  findOwner: vi.fn(),
  sendNotification: vi.fn(),
  sendSwapReceipt: vi.fn(),
  sendWithdrawalReceipt: vi.fn(),
  total: vi.fn(),
}));

vi.mock('../../src/jobs/workers/runtime', () => ({
  createWorkerQueue: vi.fn(),
  initializeWorker: mocks.initialize,
}));
vi.mock('../../src/queries/swap.query', () => ({ findSwap: mocks.findSwap }));
vi.mock('../../src/services/financial/provider-verification', () => ({ verifyWithdrawal: mocks.verify }));
vi.mock('../../src/services/financial/swaps/settlement', () => ({
  finalizeSuccessfulCustodySweep: mocks.finalize,
}));
vi.mock('../../src/services/financial/ngn-payouts', () => ({
  settleNgnPayoutWebhook: mocks.settlePayout,
  processApprovedNgnWithdrawal: mocks.processWithdrawal,
}));
vi.mock('../../src/services/financial/ngn-withdrawals', () => ({
  findNgnWithdrawalOwner: mocks.findOwner,
  getNgnWithdrawalTotal: mocks.total,
}));
vi.mock('../../src/services/integrations/quidax', () => ({ quidax: {} }));
vi.mock('../../src/plugins/bot', () => ({ telegramClient: {} }));
vi.mock('../../src/services/telegram/notifications', () => ({
  sendTelegramNotification: mocks.sendNotification,
}));
vi.mock('../../src/services/telegram/receipts', () => ({
  sendSwapReceipt: mocks.sendSwapReceipt,
  sendWithdrawalReceipt: mocks.sendWithdrawalReceipt,
}));
vi.mock('../../src/library/logging.utils', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

import { initializeFinalizeSwapWorker } from '../../src/jobs/workers/finalize-swap.worker';
import { initializePendingWithdrawalWorker } from '../../src/jobs/workers/pending-withdrawal.worker';

const swapBefore = {
  sweepReference: 'sweep-ref',
  executedReceivedAmount: '3000',
  user: { subUserId: 'sub-1', chatId: '42' },
};
const settledSwap = {
  id: 'swap-1',
  fromAmount: '2',
  fromCurrency: 'usdt',
  toAmount: '2950',
  grossToAmount: '3000',
  platformFeeAmount: '50',
  toCurrency: 'ngn',
  executionPrice: '1500',
  quotedPrice: '1490',
  swapTransactionId: 'swap-provider-1234',
  sweepId: 'sweep-provider-1234',
  sweepReference: 'sweep-ref-1234',
  completedAt: new Date('2026-09-07T10:30:00.000Z'),
  user: { subUserId: 'sub-1', chatId: '42' },
};
const withdrawal = {
  id: 'withdrawal-1',
  amount: '1000',
  fee: '50',
  total: '1050',
  reference: 'withdrawal-ref',
  bankCode: '058',
  accountNumber: '0123456789',
  providerWithdrawalId: 'provider-withdrawal-1234',
  completedAt: new Date('2026-09-07T10:30:00.000Z'),
};
const bankName = 'Guaranty Trust Bank';

const run = <T>(index = 0) => (mocks.initialize.mock.calls[index][2] as (job: Bull.Job<T>) => Promise<void>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendNotification.mockResolvedValue(true);
  mocks.sendSwapReceipt.mockResolvedValue(true);
  mocks.sendWithdrawalReceipt.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({
    id: 'sweep-1', status: 'done', amount: '3000', fee: '0', total: '3000', reference: 'sweep-ref',
  });
  mocks.total.mockReturnValue('1050');
  mocks.findOwner.mockResolvedValue({ chatId: '42', withdrawal, bankName });
});

describe('completion receipt triggers', () => {
  it('sends one swap receipt only after a new wallet credit', async () => {
    mocks.findSwap.mockResolvedValueOnce(swapBefore).mockResolvedValueOnce(settledSwap);
    mocks.finalize.mockResolvedValue({ credited: true, amount: '2950' });
    await initializeFinalizeSwapWorker();
    await run<SuccessfulWithdrawJobPayload>()({
      data: { data: { id: 'sweep-1' } },
    } as Bull.Job<SuccessfulWithdrawJobPayload>);

    expect(mocks.sendSwapReceipt).toHaveBeenCalledOnce();
    expect(mocks.sendSwapReceipt).toHaveBeenCalledWith({}, '42', expect.objectContaining({
      sourceAmount: '2', receivedAmount: '2950', grossAmount: '3000', platformFee: '50',
    }));

    mocks.findSwap.mockResolvedValue(swapBefore);
    mocks.finalize.mockResolvedValue({ credited: false, amount: '2950' });
    await run<SuccessfulWithdrawJobPayload>()({
      data: { data: { id: 'sweep-1' } },
    } as Bull.Job<SuccessfulWithdrawJobPayload>);
    expect(mocks.sendSwapReceipt).toHaveBeenCalledOnce();
  });

  it('sends one successful bank-withdrawal receipt only for a changed success', async () => {
    mocks.settlePayout.mockResolvedValue({
      changed: true,
      status: 'done',
      total: '1050',
      chatId: '42',
      bankName,
      withdrawal,
    });
    await initializeFinalizeSwapWorker();
    await run<SuccessfulWithdrawJobPayload>()({
      data: { event: 'withdraw.successful', data: { id: 'provider-1' } },
    } as Bull.Job<SuccessfulWithdrawJobPayload>);
    expect(mocks.sendWithdrawalReceipt).toHaveBeenCalledOnce();
    expect(mocks.sendWithdrawalReceipt).toHaveBeenCalledWith({}, '42', expect.objectContaining({
      amount: '1000', platformFee: '50', totalDebit: '1050', bankName,
    }));

    mocks.settlePayout.mockResolvedValue({ changed: false, status: 'done', total: '1050', chatId: '42', withdrawal });
    await run<SuccessfulWithdrawJobPayload>()({
      data: { event: 'withdraw.successful', data: { id: 'provider-1' } },
    } as Bull.Job<SuccessfulWithdrawJobPayload>);
    expect(mocks.sendWithdrawalReceipt).toHaveBeenCalledOnce();
  });

  it.each([
    ['rejected', 'rejected'],
    ['failed', 'failed'],
  ] as const)('keeps %s withdrawals on text notification only', async (status, expectedText) => {
    mocks.settlePayout.mockResolvedValue({
      changed: true,
      status,
      total: '1050',
      chatId: '42',
      withdrawal,
    });
    await initializeFinalizeSwapWorker();
    await run<SuccessfulWithdrawJobPayload>()({
      data: { event: status === 'failed' ? 'withdraw.rejected' : 'withdraw.rejected', data: { id: 'provider-1' } },
    } as Bull.Job<SuccessfulWithdrawJobPayload>);
    expect(mocks.sendNotification).toHaveBeenCalledWith({}, '42', expect.stringContaining(expectedText));
    expect(mocks.sendWithdrawalReceipt).not.toHaveBeenCalled();
  });
});

describe('approved withdrawal completion receipt trigger', () => {
  it('sends a receipt after the pending-withdrawal worker observes success', async () => {
    mocks.processWithdrawal.mockResolvedValue('success');
    await initializePendingWithdrawalWorker();
    await run<NgnWithdrawalJobPayload>()({
      data: { id: 'withdrawal-1' },
    } as Bull.Job<NgnWithdrawalJobPayload>);
    expect(mocks.findOwner).toHaveBeenCalledWith('withdrawal-1');
    expect(mocks.sendWithdrawalReceipt).toHaveBeenCalledWith({}, '42', expect.objectContaining({ bankName }));
  });

  it('does not send a success receipt for failed or duplicate settlement', async () => {
    mocks.processWithdrawal.mockResolvedValue('failed');
    await initializePendingWithdrawalWorker();
    await run<NgnWithdrawalJobPayload>()({ data: { id: 'withdrawal-1' } } as Bull.Job<NgnWithdrawalJobPayload>);
    expect(mocks.sendWithdrawalReceipt).not.toHaveBeenCalled();

    mocks.processWithdrawal.mockResolvedValue('duplicate');
    await run<NgnWithdrawalJobPayload>()({ data: { id: 'withdrawal-1' } } as Bull.Job<NgnWithdrawalJobPayload>);
    expect(mocks.sendWithdrawalReceipt).not.toHaveBeenCalled();
  });
});
