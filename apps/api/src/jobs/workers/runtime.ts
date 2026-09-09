import Bull from 'bull';
import Logging from '../../library/logging.utils';
import {
  markProviderEventFailed,
  markProviderEventSucceeded,
} from '../../queries/provider-event.query';
import { opts } from '../redis.job';
import {
  type QueueName,
  type QueuePayloadByName,
} from '../queue-registry.job';

/**
 * Shared Bull worker lifecycle helpers.
 *
 * Workers are tracked for orderly shutdown, wait for their Redis connection to
 * become ready before startup completes, and share provider-event completion
 * and failure bookkeeping.
 *
 * @module workerRuntime
 */

const workerQueues: Array<Bull.Queue<unknown>> = [];

/** Creates and tracks one typed Bull worker queue for orderly shutdown. */
export const createWorkerQueue = <K extends QueueName>(
  name: K,
): Bull.Queue<QueuePayloadByName[K]> => {
  const queue = new Bull<QueuePayloadByName[K]>(name, opts);
  workerQueues.push(queue as unknown as Bull.Queue<unknown>);
  return queue;
};

/** Installs the common provider-event bookkeeping for one worker queue. */
export const setupQueueEvents = (
  queue: Bull.Queue<unknown>,
  queueLabel: string,
): void => {
  queue.on('global:completed', (job: Bull.JobId, result: unknown) => {
    void queue.clean(0, 'completed');
    void markProviderEventSucceeded(String(job)).catch((error: unknown) => {
      Logging.error(`Unable to mark provider event complete: ${error}`);
    });
    Logging.info(`${queueLabel} job completed: ${job} Result: ${result}`);
  });

  queue.on('failed', (job: Bull.Job<unknown>, error: Error) => {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void markProviderEventFailed(String(job.id), error).catch((markError: unknown) => {
        Logging.error(`Unable to mark provider event failed: ${markError}`);
      });
    }
    Logging.error(`${queueLabel} job failed: ${job.id} - ${error.message}`);
  });
};

/**
 * Registers a long-running Bull processor and waits only for its Redis queue to
 * become ready. `queue.process()` intentionally remains pending for the life of
 * the worker, so awaiting it would prevent application startup from completing.
 */
export const initializeWorker = async <T>(
  queue: Bull.Queue<T>,
  queueLabel: string,
  processor: (job: Bull.Job<T>) => Promise<unknown>,
): Promise<void> => {
  // Bull accepts processor result values at runtime, although this version's
  // type declaration incorrectly narrows promise processors to Promise<void>.
  const processing = queue.process(
    processor as Bull.ProcessPromiseFunction<T>,
  );
  void processing.catch((error: unknown) => {
    Logging.error(
      `${queueLabel} worker stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  await queue.isReady();
  setupQueueEvents(queue as unknown as Bull.Queue<unknown>, queueLabel);
};

/** Closes worker queues sequentially because Bull shares Redis connections. */
export const closeWorkerQueues = async (): Promise<void> => {
  const queues = workerQueues.splice(0);
  for (const queue of queues) {
    await queue.close();
  }
};
