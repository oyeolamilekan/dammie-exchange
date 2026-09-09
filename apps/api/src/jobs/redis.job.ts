/**
 * Shared Redis connection configuration for Bull queues.
 *
 * Producer and subscriber clients are shared across queues, while blocking
 * clients are tracked individually and all clients are closed during runtime
 * shutdown.
 *
 * @module redisJobs
 */
import Redis, { type RedisOptions } from "ioredis";
import { setMaxListeners } from 'node:events';
import type Bull from 'bull';
import CONFIG from "../config/config";
import Logging from "../library/logging.utils";
import { QUEUE_NAMES } from './queueNames.job';

const { REDIS_URL } = CONFIG

let client: Redis | undefined; // This variable holds the main Redis client connection.
let subscriber: Redis | undefined; // This variable holds the Redis subscriber connection, used for listening to events.
const blockingClients = new Set<Redis>();

type BullRedisClient = ReturnType<
    NonNullable<Bull.QueueOptions['createClient']>
>;

const asBullRedisClient = (redisClient: Redis): BullRedisClient =>
    redisClient as unknown as BullRedisClient;

const queueNameCount = Object.keys(QUEUE_NAMES).length;

/**
 * Bull installs an error listener for every queue that shares a Redis client and
 * may install a second listener while waiting for that client to become ready.
 * Keep the limit local and bounded to the number of queue consumers owned here.
 */
const configureSharedClient = (
    redisClient: Redis,
    queueConsumerCount: number,
    bullListenersPerConsumer = 2,
): Redis => {
    const loggingListenerCount = 1;
    setMaxListeners(
        (queueConsumerCount * bullListenersPerConsumer) + loggingListenerCount,
        redisClient,
    );
    return redisClient;
};

const contOpts = {
    tls: null, // No TLS (Transport Layer Security) is used for the connection.
    lazyConnect: false, // The client will try to connect to Redis immediately.
    showFriendlyErrorStack: true, // Shows more readable error messages if something goes wrong.
    maxRetriesPerRequest: null, // No limit on how many times a request will be retried.
    enableReadyCheck: false // Disables checking if Redis is ready before sending commands.
} as unknown as RedisOptions;

/** Bull queue options with shared client/subscriber creation and retry settings. */
export const opts: Bull.QueueOptions = {
    // redisOpts here will contain at least a property of connectionName which will identify the queue based on its name
    /**
     * This function creates and provides different types of Redis client connections.
     * It ensures that only one main client and one subscriber client are created.
     * @param type The type of Redis client to create ('client', 'subscriber', or 'bclient').
     * @returns A Redis client instance.
     */
    createClient: function (type: 'client' | 'subscriber' | 'bclient'): BullRedisClient {
        switch (type) {
            case 'client':
                if (!client) {
                    // A worker and producer can each exist for every queue name.
                    client = configureSharedClient(
                        new Redis(REDIS_URL as string, contOpts),
                        queueNameCount * 2,
                    );
                    client.on('ready', () => {
                        Logging.info('Redis client ready');
                    });
                    client.on('error', (error: Error) => {
                        Logging.error(`Redis client error: ${error.message}`);
                    });
                }
                return asBullRedisClient(client);
            case 'subscriber':
                if (!subscriber) {
                    // Only worker queues subscribe to Bull events.
                    subscriber = configureSharedClient(
                        new Redis(REDIS_URL as string, contOpts),
                        queueNameCount,
                        // One persistent listener plus concurrent readiness
                        // listeners for Bull's delayed and completed events.
                        3,
                    );
                    subscriber.on('ready', () => {
                        Logging.info('Redis subscriber ready');
                    });
                    subscriber.on('error', (error: Error) => {
                        Logging.error(`Redis subscriber error: ${error.message}`);
                    });
                }
                return asBullRedisClient(subscriber);
            case 'bclient':
                const blockingClient = new Redis(
                    REDIS_URL as string,
                    contOpts,
                );
                blockingClients.add(blockingClient);
                blockingClient.once('end', () => {
                    blockingClients.delete(blockingClient);
                });
                return asBullRedisClient(blockingClient);
            default:
                throw new Error('Unexpected connection type: '); // Throws an error if an unknown connection type is requested.
        }
    }
}

/** Closes shared and blocking Redis clients, falling back to disconnect on failure. */
export const closeQueueRedisClients = async (): Promise<void> => {
    const clients = [client, subscriber, ...blockingClients].filter(
        (redisClient): redisClient is Redis => Boolean(redisClient),
    );
    client = undefined;
    subscriber = undefined;
    blockingClients.clear();

    await Promise.all(
        clients.map(async (redisClient) => {
            if (redisClient.status === 'end') return;
            try {
                await redisClient.quit();
            } catch {
                redisClient.disconnect();
            }
        }),
    );
};
