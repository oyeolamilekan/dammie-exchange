import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../../src/database', () => ({ db: mocks }));

import { getFinancialReconciliationReport } from '../../src/services/financial/reconciliation';

const selectResult = (rows: unknown[]) => {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockResolvedValue(rows);
  return builder;
};

describe('financial reconciliation output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select
      .mockReturnValueOnce(selectResult([{
        correlationId: 'quidax:deposit.successful:deposit-1',
        eventType: 'deposit.successful',
        status: 'failed',
        attempts: 2,
        updatedAt: new Date('2026-09-05T10:00:00.000Z'),
      }]))
      .mockReturnValueOnce(selectResult([{
        id: 'swap-1',
        status: 'processing',
        swapStatus: 'processing',
        approvalStatus: 'success',
        reconciliationRequired: false,
        updatedAt: new Date('2026-09-05T10:01:00.000Z'),
      }]));
    mocks.execute
      .mockResolvedValueOnce({ rows: [{
        wallet_id: 'wallet-1',
        currency: 'USDC',
        available: '1.250000000000000000',
        locked: '0.25',
        latest_version_id: 'version-1',
        latest_available: '1.25',
        latest_locked: '0.25',
      }] })
      .mockResolvedValueOnce({ rows: [{
        action: 'deposit_credit',
        transaction_id: 'deposit-1',
        version_count: 0,
      }] });
  });

  it('retains every reconciliation JSON section and legacy missing-version key', async () => {
    const report = await getFinancialReconciliationReport(
      new Date('2026-09-05T10:15:00.000Z'),
    );

    expect(Object.keys(report)).toEqual([
      'generatedAt',
      'providerEvents',
      'swaps',
      'walletBalances',
      'missingExpectedVersions',
      'missingAccountVersions',
      'staleCustodyTransfers',
    ]);
    expect(report).toEqual({
      generatedAt: '2026-09-05T10:15:00.000Z',
      providerEvents: [{
        correlationId: 'quidax:deposit.successful:deposit-1',
        eventType: 'deposit.successful',
        status: 'failed',
        attempts: 2,
        updatedAt: '2026-09-05T10:00:00.000Z',
      }],
      swaps: [{
        id: 'swap-1',
        status: 'processing',
        swapStatus: 'processing',
        approvalStatus: 'success',
        reconciliationRequired: false,
        updatedAt: '2026-09-05T10:01:00.000Z',
      }],
      walletBalances: [{
        walletId: 'wallet-1',
        currency: 'USDC',
        available: '1.25',
        locked: '0.25',
        latestVersionId: 'version-1',
        latestAvailable: '1.25',
        latestLocked: '0.25',
        latestBalance: '1.25',
        latestLockedBalance: '0.25',
        availableDrift: '0',
        lockedDrift: '0',
        hasVersions: true,
      }],
      missingExpectedVersions: [{
        action: 'deposit_credit',
        transactionId: 'deposit-1',
        versionCount: 0,
      }],
      missingAccountVersions: [{
        action: 'deposit_credit',
        transactionId: 'deposit-1',
        versionCount: 0,
      }],
      staleCustodyTransfers: [{
        swapId: 'swap-1',
        stage: 'custody-transfer',
        updatedAt: '2026-09-05T10:01:00.000Z',
      }],
    });
  });
});
