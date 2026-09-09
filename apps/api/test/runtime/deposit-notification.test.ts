import type Bull from 'bull';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepositWebhookJobPayload } from '../../src/jobs/queue-registry.job';

const mocks = vi.hoisted(() => ({
  initializeWorker: vi.fn(), credit: vi.fn(), record: vi.fn(), send: vi.fn(), verify: vi.fn(),
}));
vi.mock('../../src/jobs/workers/runtime', () => ({
  createWorkerQueue: vi.fn(), initializeWorker: mocks.initializeWorker,
}));
vi.mock('../../src/services/financial/provider-verification', () => ({ verifyDeposit: mocks.verify }));
vi.mock('../../src/services/integrations/quidax', () => ({ quidax: {} }));
vi.mock('../../src/plugins/bot', () => ({ telegramClient: {} }));
vi.mock('../../src/services/financial/deposits', () => ({
  creditSuccessfulDeposit: mocks.credit, recordDepositConfirmation: mocks.record,
}));
vi.mock('../../src/services/telegram/notifications', () => ({ sendTelegramNotification: mocks.send }));
vi.mock('../../src/library/logging.utils', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

import { initializeDepositSuccessWorker } from '../../src/jobs/workers/deposit-success.worker';
import { initializeDepositConfirmationWorker } from '../../src/jobs/workers/deposit-confirmation.worker';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credit.mockResolvedValue({ credited: true, user: { chatId: '42' } });
  mocks.record.mockResolvedValue({ recorded: true, user: { chatId: '42' } });
  mocks.send.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ id: 'deposit-1', user: { id: 'sub-1' }, amount: '2', currency: 'usdt', txid: 'tx-1', status: 'accepted', payment_address: null });
});

const job = (paymentAddress: DepositWebhookJobPayload['data']['payment_address']) => ({
  data: { data: { id: 'deposit-1', amount: '2', currency: 'USDT', txid: 'tx-1', user: { id: 'sub-1' }, payment_address: paymentAddress } },
}) as Bull.Job<DepositWebhookJobPayload>;
const handler = () => mocks.initializeWorker.mock.calls[0][2] as (job: Bull.Job<DepositWebhookJobPayload>) => Promise<void>;

for (const [name, initialize] of [
  ['success', initializeDepositSuccessWorker],
  ['confirmation', initializeDepositConfirmationWorker],
] as const) {
  describe(`deposit ${name} notifications`, () => {
    it.each([null, undefined, {}, { network: null }, { network: '' }, { network: '  ' }])(
      'completes with a missing network: %j', async (address) => {
        mocks.verify.mockResolvedValueOnce({ id: 'deposit-1', user: { id: 'sub-1' }, amount: '2', currency: 'usdt', txid: 'tx-1', status: 'accepted', payment_address: address });
        await initialize();
        await expect(handler()(job(address))).resolves.toBeUndefined();
        expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('Blockchain: Not provided'));
      },
    );
    it('keeps the provided network in the message', async () => {
      await initialize();
      mocks.verify.mockResolvedValueOnce({ id: 'deposit-1', user: { id: 'sub-1' }, amount: '2', currency: 'usdt', txid: 'tx-1', status: 'accepted', payment_address: { network: ' celo ' } });
      await handler()(job({ network: 'wrong-webhook-network' }));
      expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('Blockchain: CELO'));
    });
  });
}

it('keeps duplicate success handling idempotent', async () => {
  mocks.credit.mockResolvedValue({ credited: false });
  await initializeDepositSuccessWorker();
  await expect(handler()(job({ network: null }))).resolves.toBeUndefined();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('uses requery amounts and status, even on the confirmation queue', async () => {
  mocks.verify.mockResolvedValue({ id: 'deposit-1', user: { id: 'sub-1' }, status: 'accepted', amount: '7', currency: 'usdc', txid: 'verified-tx', payment_address: { network: 'base' } });
  await initializeDepositConfirmationWorker();
  await handler()(job({ network: 'trc20' }));
  expect(mocks.credit).toHaveBeenCalledWith(expect.objectContaining({ amount: '7', currency: 'usdc', txid: 'verified-tx' }));
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.send).toHaveBeenCalledWith({}, '42', expect.stringContaining('7 USDC'));
});

it('does not credit a pending deposit and leaves the job retryable', async () => {
  mocks.verify.mockResolvedValue({ id: 'deposit-1', user: { id: 'sub-1' }, status: 'submitted', amount: '2', currency: 'usdt', txid: 'tx-1' });
  await initializeDepositSuccessWorker();
  await expect(handler()(job(null))).rejects.toThrow('still pending');
  expect(mocks.credit).not.toHaveBeenCalled();
  expect(mocks.record).toHaveBeenCalledOnce();
});

it.each(['failed', 'rejected', 'canceled', 'unknown'])('does not credit provider status %s', async (status) => {
  mocks.verify.mockResolvedValue({ id: 'deposit-1', user: { id: 'sub-1' }, status });
  await initializeDepositSuccessWorker();
  await expect(handler()(job(null))).rejects.toThrow('not accepted');
  expect(mocks.credit).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('does not mutate or notify when requery fails', async () => {
  mocks.verify.mockRejectedValue(new Error('Provider unavailable'));
  await initializeDepositSuccessWorker();
  await expect(handler()(job(null))).rejects.toThrow('Provider unavailable');
  expect(mocks.credit).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
