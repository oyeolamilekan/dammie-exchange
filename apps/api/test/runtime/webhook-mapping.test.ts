import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  depositConfirmation: vi.fn().mockResolvedValue(undefined),
  creditDepositConfirmation: vi.fn().mockResolvedValue(undefined),
  processSuccessSwap: vi.fn().mockResolvedValue(undefined),
  processSwapRecovery: vi.fn().mockResolvedValue(undefined),
  processFinalizeSwap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/jobs/event.job', () => ({
  depositConfirmation: mocks.depositConfirmation,
  creditDepositConfirmation: mocks.creditDepositConfirmation,
  processSuccessSwap: mocks.processSuccessSwap,
  processSwapRecovery: mocks.processSwapRecovery,
  processFinalizeSwap: mocks.processFinalizeSwap,
}));

import { enqueueByEvent } from '../../src/controllers/webhook.controller';

describe('provider webhook queue mapping', () => {
  it.each([
    ['deposit.transaction.confirmation', 'depositConfirmation'],
    ['deposit.successful', 'creditDepositConfirmation'],
    ['swap_transaction.completed', 'processSuccessSwap'],
    ['swap_transaction.complete', 'processSuccessSwap'],
    ['swap_transaction.failed', 'processSwapRecovery'],
    ['swap_transaction.reversed', 'processSwapRecovery'],
    ['withdraw.successful', 'processFinalizeSwap'],
    ['withdraw.rejected', 'processFinalizeSwap'],
  ] as const)('routes %s to the compatible queue producer', async (event, producer) => {
    vi.clearAllMocks();
    const payload = { event, data: { id: `provider-${event}` } };

    await enqueueByEvent[event](payload, 'correlation-1');

    expect(mocks[producer]).toHaveBeenCalledWith(payload, 'correlation-1');
  });

  it('does not create an implicit queue for unknown provider events', () => {
    expect(enqueueByEvent['provider.event.unknown']).toBeUndefined();
  });
});
