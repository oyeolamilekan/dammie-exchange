import type Bull from 'bull';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SuccessfulWithdrawJobPayload } from '../../src/jobs/queue-registry.job';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  findSwap: vi.fn(),
  verify: vi.fn(),
  finalize: vi.fn(),
  markReconciliation: vi.fn(),
  send: vi.fn(),
  settlePayout: vi.fn(),
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
vi.mock('../../src/services/financial/swaps/settlement-store', () => ({
  markSwapAsReconciliationRequired: mocks.markReconciliation,
}));
vi.mock('../../src/services/financial/ngn-payouts', () => ({
  settleNgnPayoutWebhook: mocks.settlePayout,
}));
vi.mock('../../src/services/integrations/quidax', () => ({ quidax: {} }));
vi.mock('../../src/plugins/bot', () => ({ telegramClient: {} }));
vi.mock('../../src/services/telegram/notifications', () => ({ sendTelegramNotification: mocks.send }));
vi.mock('../../src/library/logging.utils', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

import { initializeFinalizeSwapWorker } from '../../src/jobs/workers/finalize-swap.worker';

const verified = {
  id: 'sweep-1', status: 'done', amount: '3000', fee: '0', total: '3000', reference: 'sweep-ref',
};
const swap = {
  id: 'swap-1',
  sweepReference: 'sweep-ref',
  executedReceivedAmount: '3000',
  user: { subUserId: 'sub-1', chatId: '42' },
};
const job = {
  data: { data: { id: 'sweep-1', user: { id: 'untrusted' }, amount: '999999' } },
} as Bull.Job<SuccessfulWithdrawJobPayload>;
const run = () => (mocks.initialize.mock.calls[0][2] as (
  job: Bull.Job<SuccessfulWithdrawJobPayload>,
) => Promise<void>)(job);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findSwap.mockResolvedValue(swap);
  mocks.verify.mockResolvedValue(verified);
  mocks.finalize.mockResolvedValue({ credited: true, amount: '3000' });
  mocks.markReconciliation.mockResolvedValue(true);
});

it('verifies the custody withdrawal from local state and credits the NGN wallet', async () => {
  await initializeFinalizeSwapWorker();
  await run();
  expect(mocks.findSwap).toHaveBeenCalledWith({ sweepId: 'sweep-1' });
  expect(mocks.verify).toHaveBeenCalledWith({}, {
    id: 'sweep-1',
    reference: 'sweep-ref',
    expectedAmount: '3000',
    ownerId: 'sub-1',
  });
  expect(mocks.finalize).toHaveBeenCalledWith('sweep-1', verified);
  expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('NGN wallet'));
});

it('does not notify again when the wallet credit is a duplicate', async () => {
  mocks.finalize.mockResolvedValue({ credited: false, amount: '3000' });
  await initializeFinalizeSwapWorker();
  await run();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('never credits or notifies when withdrawal verification fails', async () => {
  mocks.verify.mockRejectedValue(new Error('not done'));
  await initializeFinalizeSwapWorker();
  await expect(run()).rejects.toThrow('not done');
  expect(mocks.finalize).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('notifies the customer once when Quidax reports a custody withdrawal as failed', async () => {
  const error = new Error('Quidax withdrawal failed: failed');
  error.name = 'QuidaxWithdrawalFailedError';
  mocks.verify.mockRejectedValue(error);
  await initializeFinalizeSwapWorker();
  await run();

  expect(mocks.markReconciliation).toHaveBeenCalledWith('swap-1');
  expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('payout failed'));
  expect(mocks.finalize).not.toHaveBeenCalled();

  mocks.markReconciliation.mockResolvedValue(false);
  await run();
  expect(mocks.send).toHaveBeenCalledOnce();
});

it('dispatches customer bank payouts without entering the swap-sweep path', async () => {
  mocks.settlePayout.mockResolvedValue({
    changed: true,
    status: 'done',
    total: '1050',
    chatId: '42',
    withdrawal: { amount: '1000' },
  });
  await initializeFinalizeSwapWorker();
  const payoutJob = {
    data: {
      event: 'withdraw.successful',
      data: { id: 'payout-1', user: { id: 'main-1' }, amount: '1000' },
    },
  } as Bull.Job<SuccessfulWithdrawJobPayload>;
  await (mocks.initialize.mock.calls[0][2] as (
    job: Bull.Job<SuccessfulWithdrawJobPayload>,
  ) => Promise<void>)(payoutJob);
  expect(mocks.settlePayout).toHaveBeenCalledWith('payout-1', 'withdraw.successful', {});
  expect(mocks.findSwap).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('successful'));
});
