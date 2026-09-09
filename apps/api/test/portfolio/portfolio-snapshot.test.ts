import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import {
  createCryptoTools,
  runCryptoAgent,
} from '../../src/agents/crypto.agent';
import type { PortfolioMetricsRecorder } from '../../src/services/portfolio/metrics';
import {
  createPortfolioSnapshotService,
  type PortfolioSnapshotReader,
} from '../../src/services/portfolio/snapshot';
import { addStoredDecimals } from '../../src/utils/decimal';
import { renderPortfolioSnapshot } from '../../src/tools/get-portfolio-snapshot';
import { TELEGRAM_MESSAGE_LIMIT } from '../../src/tools/transaction-history';
import { catalogFixture } from '../fixtures/catalog';

const fixedTime = new Date('2026-08-29T08:00:00.000Z');
const userId = '018f7d22-7c3d-7a9e-8f6b-123456789abc';

const createReader = (
  overrides: Partial<PortfolioSnapshotReader> = {},
): PortfolioSnapshotReader => ({
  resolveUserId: vi.fn().mockResolvedValue({ id: userId }),
  readWallets: vi.fn().mockResolvedValue([]),
  readDeposits: vi.fn().mockResolvedValue([]),
  readSwaps: vi.fn().mockResolvedValue([]),
  ...overrides,
});

const metrics = (): PortfolioMetricsRecorder => ({ record: vi.fn() });

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: undefined,
  },
};

describe('portfolio snapshot', () => {
  it('serializes a stable empty snapshot with explicit UTC time', async () => {
    const recorder = metrics();
    const service = createPortfolioSnapshotService({
      reader: createReader(), metrics: recorder, clock: () => fixedTime,
    });

    await expect(service.getSnapshot('42')).resolves.toEqual({
      asOf: '2026-08-29T08:00:00.000Z',
      balances: [],
      activity: { deposits: [], swaps: [] },
    });
    expect(recorder.record).toHaveBeenCalledWith('empty', expect.any(Number));
  });

  it('preserves stored precision, locked funds, configured order, and partial summaries', async () => {
    const reader = createReader({
      readWallets: vi.fn().mockResolvedValue([
        {
          currency: 'usdt',
          balance: '0.1',
          lockedBalance: '0.2',
          updatedAt: new Date('2026-08-29T07:00:00.000Z'),
        },
        {
          currency: 'usdc',
          balance: '12.3456789',
          lockedBalance: '0',
          updatedAt: new Date('2026-08-29T07:30:00.000Z'),
        },
      ]),
      readDeposits: vi.fn().mockResolvedValue([
        { currency: 'USDC', amount: '0.4', transactionCount: 2 },
      ]),
    });
    const service = createPortfolioSnapshotService({
      reader, metrics: metrics(), clock: () => fixedTime,
    });
    const snapshot = await service.getSnapshot('42');

    expect(snapshot?.balances).toEqual([
      {
        currency: 'USDC',
        available: '12.3456789',
        locked: '0',
        total: '12.3456789',
        updatedAt: '2026-08-29T07:30:00.000Z',
      },
      {
        currency: 'USDT',
        available: '0.1',
        locked: '0.2',
        total: '0.3',
        updatedAt: '2026-08-29T07:00:00.000Z',
      },
    ]);
    expect(addStoredDecimals(1e-8, 2e-8)).toBe('0.00000003');
  });

  it('uses a fixed four-query read shape regardless of activity size', async () => {
    const reader = createReader({
      readDeposits: vi.fn().mockResolvedValue(
        Array.from({ length: 1_000 }, (_, index) => ({
          currency: `C${index}`,
          amount: '1',
          transactionCount: 1,
        })),
      ),
    });
    const service = createPortfolioSnapshotService({
      reader, metrics: metrics(), clock: () => fixedTime,
    });

    await service.getSnapshot('42');

    expect(reader.resolveUserId).toHaveBeenCalledTimes(1);
    expect(reader.readWallets).toHaveBeenCalledTimes(1);
    expect(reader.readDeposits).toHaveBeenCalledTimes(1);
    expect(reader.readSwaps).toHaveBeenCalledTimes(1);
    expect(reader.readWallets).toHaveBeenCalledWith(userId);
  });

  it('renders deterministic Telegram-safe output without identifiers or valuation claims', async () => {
    const service = createPortfolioSnapshotService({
      reader: createReader({
        readWallets: vi.fn().mockResolvedValue([{
          currency: 'usdc',
          balance: '1234567.25',
          lockedBalance: '500000.5',
          updatedAt: fixedTime,
        }]),
        readDeposits: vi.fn().mockResolvedValue([
          { currency: 'USDC', amount: '2.5', transactionCount: 3 },
        ]),
        readSwaps: vi.fn().mockResolvedValue([
          {
            currency: 'USDC',
            amount: '0.25',
            transactionCount: 1,
            netNairaAmount: '350000',
          },
        ]),
      }),
      metrics: metrics(),
      clock: () => fixedTime,
    });
    const output = renderPortfolioSnapshot(await service.getSnapshot('42'));

    expect(output).toContain('Available: 1,234,567.25 USDC');
    expect(output).toContain('Locked: 500,000.5 USDC');
    expect(output).toContain('Total: 1,734,567.75 USDC');
    expect(output).toContain('No current fiat valuation or recommendation');
    expect(output).not.toContain(userId.toString());
    expect(output.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it('binds identity outside the empty model input schema', async () => {
    const dependency = vi.fn().mockResolvedValue({
      message: 'trusted portfolio',
      deterministic: true as const,
    });
    const tools = createCryptoTools(
      { userId: 42, username: 'ada' },
      { getPortfolioSnapshot: dependency },
    );

    await expect(
      tools.getPortfolioSnapshot.execute!({ userId: 999 }, {} as never),
    ).rejects.toThrow();
    await expect(
      tools.getPortfolioSnapshot.execute!({}, {} as never),
    ).resolves.toEqual({ message: 'trusted portfolio', deterministic: true });
    expect(dependency).toHaveBeenCalledWith({ userId: 42, username: 'ada' });
  });

  it('uses trusted snapshot text even when the model tries to alter balances', async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        call += 1;
        return call === 1
          ? {
              content: [{
                type: 'tool-call' as const,
                toolCallId: 'portfolio-1',
                toolName: 'getPortfolioSnapshot',
                input: '{}',
              }],
              finishReason: { unified: 'tool-calls' as const, raw: undefined },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: 'text' as const, text: 'You have 999 USDC' }],
              finishReason: { unified: 'stop' as const, raw: undefined },
              usage,
              warnings: [],
            };
      },
    });

    const response = await runCryptoAgent(
      {
        prompt: 'show portfolio',
        instructions: 'Use the portfolio tool',
        userId: 42,
        username: 'ada',
      },
      {
        model,
        supportedCryptos: catalogFixture,
        dependencies: {
          getPortfolioSnapshot: vi.fn().mockResolvedValue({
            message: 'Available: 0.3 USDC',
            deterministic: true,
          }),
        },
      },
    );

    expect(response.text).toBe('Available: 0.3 USDC');
  });

  it('records errors with bounded labels and no payload', async () => {
    const recorder = metrics();
    const service = createPortfolioSnapshotService({
      reader: createReader({
        readWallets: vi.fn().mockRejectedValue(new Error('balance=123 user=42')),
      }),
      metrics: recorder,
      clock: () => fixedTime,
    });

    await expect(service.getSnapshot('42')).rejects.toThrow();
    expect(recorder.record).toHaveBeenCalledWith('error', expect.any(Number));
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(recorder.record).mock.calls)).not.toContain('balance');
  });
});
