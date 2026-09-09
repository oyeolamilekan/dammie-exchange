import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueue = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../src/jobs/queue-registry.job', () => ({
  queueRegistry: { enqueue },
}));

import {
  creditDepositConfirmation,
  processSwap,
  processSwapRecovery,
  processNgnWithdrawal,
} from '../../src/jobs/event.job';
import { QUEUE_NAMES } from '../../src/jobs/queueNames.job';

describe('queue producer compatibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps webhook retry, backoff, cleanup, and deterministic job options', async () => {
    const payload = {
      event: 'deposit.successful',
      data: {
        id: 'deposit-1',
        user: { id: 'sub-user-1' },
        amount: '10.5',
        currency: 'usdc',
        txid: 'tx-1',
        payment_address: { network: 'base' },
      },
    };

    await creditDepositConfirmation(payload, 'provider-correlation-1');

    expect(enqueue).toHaveBeenCalledWith(
      QUEUE_NAMES.DEPOSIT_SUCCESSFUL,
      payload,
      {
        jobId: 'provider-correlation-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('keeps approval and recovery queue names, IDs, and retry policy', async () => {
    await processSwap({ id: 'swap-1' });
    expect(enqueue).toHaveBeenCalledWith(
      QUEUE_NAMES.PENDING_SWAP,
      { id: 'swap-1' },
      {
        jobId: 'swap-approval:swap-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    await processSwapRecovery({ event: 'swap_transaction.failed', data: { id: 'swap-1' } }, 'recovery-1');
    expect(enqueue).toHaveBeenLastCalledWith(
      QUEUE_NAMES.SWAP_RECOVERY,
      { event: 'swap_transaction.failed', data: { id: 'swap-1' } },
      {
        jobId: 'recovery-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    await processNgnWithdrawal({ id: 'withdrawal-1' });
    expect(enqueue).toHaveBeenLastCalledWith(
      QUEUE_NAMES.PENDING_WITHDRAWAL,
      { id: 'withdrawal-1' },
      {
        jobId: 'ngn-withdrawal:withdrawal-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  });
});
