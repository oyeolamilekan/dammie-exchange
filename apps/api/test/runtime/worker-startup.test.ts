import type Bull from 'bull';
import { describe, expect, it, vi } from 'vitest';
import { initializeWorker } from '../../src/jobs/workers/runtime';

describe('worker startup', () => {
  it('waits for Redis readiness without awaiting the worker lifetime', async () => {
    const processing = new Promise<void>(() => undefined);
    const queue = {
      process: vi.fn(() => processing),
      isReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    } as unknown as Bull.Queue<{ id: string }>;
    const processor = vi.fn(async () => undefined);

    await expect(
      initializeWorker(queue, 'Test Queue', processor),
    ).resolves.toBeUndefined();

    expect(queue.process).toHaveBeenCalledWith(processor);
    expect(queue.isReady).toHaveBeenCalledOnce();
    expect(queue.on).toHaveBeenCalledTimes(2);
  });
});
