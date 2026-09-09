import { describe, expect, it, vi } from 'vitest';
import {
  QueueRegistry,
  type QueueFactory,
  type QueueLike,
} from '../../src/jobs/queue-registry.job';
import { QUEUE_NAMES } from '../../src/jobs/queueNames.job';

describe('QueueRegistry', () => {
  it('keeps producer and listener counts constant across 1,000 enqueues', async () => {
    const queues = new Map<string, QueueLike<unknown>>();
    const factory = vi.fn(((name: string) => {
      const queue: QueueLike<unknown> = {
        add: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      queues.set(name, queue);
      return queue;
    }) as QueueFactory);
    const registry = new QueueRegistry(factory);

    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        registry.enqueue(QUEUE_NAMES.DEPOSIT_SUCCESSFUL, {
          data: { id: `event-${index}` },
        }),
      ),
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
    expect(queues.get(QUEUE_NAMES.DEPOSIT_SUCCESSFUL)?.add).toHaveBeenCalledTimes(1_000);

    await registry.close();
    expect(queues.get(QUEUE_NAMES.DEPOSIT_SUCCESSFUL)?.close).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('creates one producer per queue name and preserves deterministic job ids', async () => {
    const adds: Array<{ data: unknown; options: unknown }> = [];
    const factory = ((name: string) => ({
      add: vi.fn(async (data, options) => {
        adds.push({ data: { name, data }, options });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })) as QueueFactory;
    const registry = new QueueRegistry(factory);

    await registry.enqueue(
      QUEUE_NAMES.ASSIGN_WALLET_ADDRESS,
      { data: { id: 'evt-1' } },
      { jobId: 'quidax:event:evt-1' },
    );
    await registry.enqueue(
      QUEUE_NAMES.PENDING_SWAP,
      { _id: 'swap-1' },
      { jobId: 'swap-approval:swap-1' },
    );

    expect(registry.size).toBe(2);
    expect(adds.map(({ options }) => options)).toEqual([
      { jobId: 'quidax:event:evt-1' },
      { jobId: 'swap-approval:swap-1' },
    ]);
  });
});
