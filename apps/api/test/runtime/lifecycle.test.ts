import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startupErrorMessage,
  startApplication,
  type RuntimeDependencies,
} from '../../src/server';
import Logging from '../../src/library/logging.utils';

const createRuntimeDependencies = () => {
  const server = {
    listening: true,
    close: vi.fn((callback: (error?: Error) => void) => {
      server.listening = false;
      callback();
      return server;
    }),
  } as unknown as Server;

  const dependencies: RuntimeDependencies = {
    assertConfiguration: vi.fn(),
    connectDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectDatabase: vi.fn().mockResolvedValue(undefined),
    initializeQueues: vi.fn().mockResolvedValue(undefined),
    closeWorkerQueues: vi.fn().mockResolvedValue(undefined),
    closeProducerQueues: vi.fn().mockResolvedValue(undefined),
    closeQueueRedisClients: vi.fn().mockResolvedValue(undefined),
    closeSecurityStore: vi.fn().mockResolvedValue(undefined),
    startTelegram: vi.fn().mockResolvedValue(undefined),
    stopTelegram: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn().mockResolvedValue(server),
  };

  return { dependencies, server };
};

describe('application lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts each runtime adapter once and closes every resource once', async () => {
    const { dependencies, server } = createRuntimeDependencies();
    const info = vi.spyOn(Logging, 'info').mockImplementation(() => undefined);
    const runtime = await startApplication(dependencies);

    expect(dependencies.assertConfiguration).toHaveBeenCalledTimes(1);
    expect(dependencies.connectDatabase).toHaveBeenCalledTimes(1);
    expect(dependencies.startTelegram).toHaveBeenCalledTimes(1);
    expect(dependencies.initializeQueues).toHaveBeenCalledTimes(1);
    expect(dependencies.listen).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(
      /^API listening on http:\/\/localhost:\d+ \(port \d+\); initializing services$/,
    ));
    expect(info).toHaveBeenCalledWith(expect.stringMatching(
      /^API ready on http:\/\/localhost:\d+ \(port \d+\)$/,
    ));

    await Promise.all([runtime.close(), runtime.close()]);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(dependencies.stopTelegram).toHaveBeenCalledTimes(1);
    expect(dependencies.closeWorkerQueues).toHaveBeenCalledTimes(1);
    expect(dependencies.closeProducerQueues).toHaveBeenCalledTimes(1);
    expect(dependencies.closeQueueRedisClients).toHaveBeenCalledTimes(1);
    expect(dependencies.closeSecurityStore).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  it('cleans up already-started resources when startup fails', async () => {
    const { dependencies } = createRuntimeDependencies();
    vi.mocked(dependencies.initializeQueues).mockRejectedValueOnce(
      new Error('queue startup failed'),
    );

    await expect(startApplication(dependencies)).rejects.toThrow(
      'queue startup failed',
    );

    expect(dependencies.stopTelegram).toHaveBeenCalledTimes(1);
    expect(dependencies.closeWorkerQueues).not.toHaveBeenCalled();
    expect(dependencies.closeProducerQueues).toHaveBeenCalledTimes(1);
    expect(dependencies.closeQueueRedisClients).toHaveBeenCalledTimes(1);
    expect(dependencies.closeSecurityStore).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnectDatabase).toHaveBeenCalledTimes(1);
  });

  it('fails on an occupied port before starting external resources', async () => {
    const { dependencies } = createRuntimeDependencies();
    const addressError = Object.assign(new Error('address already in use'), {
      code: 'EADDRINUSE',
    });
    vi.mocked(dependencies.listen).mockRejectedValueOnce(addressError);

    await expect(startApplication(dependencies)).rejects.toBe(addressError);

    expect(dependencies.connectDatabase).not.toHaveBeenCalled();
    expect(dependencies.startTelegram).not.toHaveBeenCalled();
    expect(dependencies.initializeQueues).not.toHaveBeenCalled();
    expect(dependencies.stopTelegram).not.toHaveBeenCalled();
    expect(dependencies.closeWorkerQueues).not.toHaveBeenCalled();
    expect(dependencies.disconnectDatabase).not.toHaveBeenCalled();
  });

  it('formats an occupied-port failure as one actionable message', () => {
    const addressError = Object.assign(new Error('address already in use'), {
      code: 'EADDRINUSE',
    });

    expect(startupErrorMessage(addressError)).toMatch(
      /^Cannot start API: http:\/\/localhost:\d+ is already in use\. Stop the existing API process or configure a different PORT\.$/,
    );
    expect(startupErrorMessage(new Error('unexpected'))).toBeUndefined();
  });

  it('does not install signal handlers when modules are imported', async () => {
    const beforeInt = process.listenerCount('SIGINT');
    const beforeTerm = process.listenerCount('SIGTERM');

    await import('../../src/app');
    await import('../../src/plugins/telegram');

    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
  });
});
