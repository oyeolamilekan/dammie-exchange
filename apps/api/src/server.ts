import type { Server } from 'node:http';
import app, { setApplicationReady } from './app';
import config from './config/config';
import { connectDatabase, disconnectDatabase } from './database';
import {
  closeWorkerQueues,
  initializeQueues,
} from './jobs/listener.job';
import { closeQueueRedisClients } from './jobs/redis.job';
import { queueRegistry } from './jobs/queue-registry.job';
import Logging from './library/logging.utils';
import { assertWebhookConfiguration } from './middlewares/webhook.middleware';
import { assertTelegramWebhookConfiguration } from './middlewares/telegram-webhook.middleware';
import { startTelegramBot, stopTelegramBot } from './plugins/telegram';
import { closeSecurityStore } from './services/security/store';

export interface ApplicationRuntime {
  close(): Promise<void>;
}

export interface RuntimeDependencies {
  assertConfiguration(): void;
  connectDatabase(): Promise<void>;
  disconnectDatabase(): Promise<void>;
  initializeQueues(): Promise<void>;
  closeWorkerQueues(): Promise<void>;
  closeProducerQueues(): Promise<void>;
  closeQueueRedisClients(): Promise<void>;
  closeSecurityStore(): Promise<void>;
  startTelegram(): Promise<void>;
  stopTelegram(): Promise<void>;
  listen(): Promise<Server>;
}

const listen = (): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = app.listen(config.PORT);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });

const apiUrl = (): string => `http://localhost:${config.PORT}`;

export const isAddressInUseError = (
  error: unknown,
): error is NodeJS.ErrnoException => (
  error instanceof Error
  && 'code' in error
  && error.code === 'EADDRINUSE'
);

export const startupErrorMessage = (error: unknown): string | undefined => {
  if (!isAddressInUseError(error)) return undefined;
  return `Cannot start API: ${apiUrl()} is already in use. Stop the existing API process or configure a different PORT.`;
};

const defaultDependencies: RuntimeDependencies = {
  assertConfiguration: () => {
    assertWebhookConfiguration(config.CRYPTO_WEBHOOK_KEY);
    assertTelegramWebhookConfiguration(
      config.TELEGRAM_WEBHOOK_URL,
      config.TELEGRAM_WEBHOOK_SECRET,
    );
  },
  connectDatabase,
  disconnectDatabase,
  initializeQueues,
  closeWorkerQueues,
  closeProducerQueues: () => queueRegistry.close(),
  closeQueueRedisClients,
  closeSecurityStore,
  startTelegram: startTelegramBot,
  stopTelegram: stopTelegramBot,
  listen,
};

const closeHttpServer = (server: Server | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });

export const startApplication = async (
  dependencies: RuntimeDependencies = defaultDependencies,
): Promise<ApplicationRuntime> => {
  dependencies.assertConfiguration();
  setApplicationReady(false);

  let server: Server | undefined;
  let closePromise: Promise<void> | undefined;
  let databaseConnected = false;
  let queuesStarted = false;
  let telegramStarted = false;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      setApplicationReady(false);
      await Promise.allSettled([
        closeHttpServer(server),
        telegramStarted
          ? dependencies.stopTelegram()
          : Promise.resolve(),
      ]);
      if (queuesStarted) await dependencies.closeWorkerQueues();
      await dependencies.closeProducerQueues();
      await dependencies.closeQueueRedisClients();
      await dependencies.closeSecurityStore();
      if (databaseConnected) await dependencies.disconnectDatabase();
    })();
    return closePromise;
  };

  try {
    // Reserve the HTTP address before starting external resources. This makes
    // port conflicts fail without briefly starting Telegram or Bull workers.
    server = await dependencies.listen();
    Logging.info(`API listening on ${apiUrl()} (port ${config.PORT}); initializing services`);

    await dependencies.connectDatabase();
    databaseConnected = true;

    await dependencies.startTelegram();
    telegramStarted = true;
    await dependencies.initializeQueues();
    queuesStarted = true;

    setApplicationReady(true);
    Logging.info(`API ready on ${apiUrl()} (port ${config.PORT})`);
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      Logging.error('Application cleanup failed', cleanupError);
    }
    throw error;
  }

  return { close };
};

if (require.main === module) {
  void startApplication().then((runtime) => {
    const shutdown = async (signal: NodeJS.Signals) => {
      Logging.info(`Received ${signal}; shutting down`);
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
      try {
        await runtime.close();
      } catch (error) {
        Logging.error('Application shutdown failed', error);
        process.exitCode = 1;
      } finally {
        process.exit(process.exitCode ?? 0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    const message = startupErrorMessage(error);
    if (message) {
      Logging.error(message);
    } else {
      Logging.error('Application startup failed', error);
    }
    process.exit(1);
  });
}
