import { EventEmitter, getMaxListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES } from '../../src/jobs/queueNames.job';

const redisMocks = vi.hoisted(() => ({
  instances: [] as EventEmitter[],
}));

vi.mock('ioredis', async () => {
  const { EventEmitter } = await vi.importActual<typeof import('node:events')>(
    'node:events',
  );

  return {
    default: class RedisMock extends EventEmitter {
      status = 'wait';
      options = {};

      constructor() {
        super();
        redisMocks.instances.push(this);
      }

      async quit(): Promise<'OK'> {
        this.status = 'end';
        return 'OK';
      }

      disconnect(): void {
        this.status = 'end';
      }

      defineCommand(name: string): void {
        Object.defineProperty(this, name, {
          configurable: true,
          value: () => new Promise<never>(() => undefined),
        });
      }

      async info(): Promise<string> {
        return 'redis_version:7.0.0\r\n';
      }
    },
  };
});

import Bull from 'bull';
import { closeQueueRedisClients, opts } from '../../src/jobs/redis.job';

describe('Bull Redis listener limits', () => {
  afterEach(async () => {
    await closeQueueRedisClients();
    redisMocks.instances.length = 0;
  });

  it('uses bounded per-client limits for all worker and producer queues', () => {
    const createClient = opts.createClient!;
    const queueCount = Object.keys(QUEUE_NAMES).length;
    const client = createClient('client', {}) as unknown as EventEmitter;
    const subscriber = createClient(
      'subscriber',
      {},
    ) as unknown as EventEmitter;

    expect(getMaxListeners(client)).toBe((queueCount * 2 * 2) + 1);
    expect(getMaxListeners(subscriber)).toBe((queueCount * 3) + 1);
    expect(createClient('client', {})).toBe(client);
    expect(createClient('subscriber', {})).toBe(subscriber);
  });

  it('covers Bull listener peaks while all queues are connecting', async () => {
    const queues = Object.values(QUEUE_NAMES).map((name) => {
      const queue = new Bull(name, opts);
      queue.process(async () => undefined);
      queue.on('global:completed', () => undefined);
      return queue;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    const [client, subscriber] = redisMocks.instances;
    expect(client.listenerCount('error')).toBeLessThanOrEqual(
      getMaxListeners(client),
    );
    expect(subscriber.listenerCount('error')).toBe(
      (Object.keys(QUEUE_NAMES).length * 3) + 1,
    );
    expect(subscriber.listenerCount('error')).toBeLessThanOrEqual(
      getMaxListeners(subscriber),
    );

    for (const queue of queues) queue.emit('close');
  });

  it('owns and closes every custom blocking client', async () => {
    const createClient = opts.createClient!;
    const first = createClient('bclient', {}) as unknown as RedisClientMock;
    const second = createClient('bclient', {}) as unknown as RedisClientMock;

    expect(first).not.toBe(second);
    await closeQueueRedisClients();
    expect(first.status).toBe('end');
    expect(second.status).toBe('end');
  });
});

interface RedisClientMock extends EventEmitter {
  status: string;
}
