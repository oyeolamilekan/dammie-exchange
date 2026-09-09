import Bull from 'bull';
import { opts } from './redis.job';
import { QUEUE_NAMES } from './queueNames.job';

/**
 * Typed Bull queue registry and payload contracts.
 *
 * Producers use `QueuePayloadByName` to ensure each queue receives the payload
 * expected by its worker. Queue instances are created lazily and closed by the
 * application shutdown path.
 *
 * @module queueRegistry
 */

/** Payload for provisioning all wallets for a newly registered user. */
export interface CreateWalletJobPayload {
  userId: string;
  subUserId: string;
  email: string;
}

/** Payload containing a provider wallet identifier for address assignment. */
export interface WalletAddressAssignmentJobPayload {
  data: { id: string };
}

/** Provider deposit data consumed by confirmation and credit workers. */
export interface DepositWebhookData {
  user: { id: string };
  amount: string | number;
  currency: string;
  txid: string;
  id: string;
  payment_address?: { network?: string | null } | null;
}

/** Provider deposit webhook payload placed on a deposit queue. */
export interface DepositWebhookJobPayload {
  event?: string;
  data: DepositWebhookData;
}

/** Provider data required to settle a completed swap. */
export interface SuccessfulSwapWebhookData {
  id: string;
  received_amount: string | number;
  execution_price?: string | number;
  price?: string | number;
  completed_at?: string | Date;
}

/** Provider successful-swap webhook payload. */
export interface SuccessfulSwapJobPayload {
  event?: string;
  data: SuccessfulSwapWebhookData;
}

/** Provider data required to settle an NGN payout webhook. */
export interface SuccessfulWithdrawWebhookData {
  user: { id: string };
  id: string;
  amount: string | number;
  fee?: string | number;
  total?: string | number;
  total_amount?: string | number;
}

/** Provider withdrawal webhook payload. */
export interface SuccessfulWithdrawJobPayload {
  event?: string;
  data: SuccessfulWithdrawWebhookData;
}

/** Payload identifying a customer-approved swap. */
export interface SwapApprovalJobPayload {
  id: string;
}

/** Payload identifying a customer-approved NGN withdrawal. */
export interface NgnWithdrawalJobPayload {
  id: string;
}

/** Payload for a failed or reversed swap recovery event. */
export interface SwapRecoveryJobPayload {
  event: 'swap_transaction.failed' | 'swap_transaction.reversed';
  data: { id: string };
}

/** Maps every queue name to the payload shape written to that queue. */
export interface QueuePayloadByName {
  [QUEUE_NAMES.CREATE_WALLET]: CreateWalletJobPayload;
  [QUEUE_NAMES.ASSIGN_WALLET_ADDRESS]: WalletAddressAssignmentJobPayload;
  [QUEUE_NAMES.DEPOSIT_CONFIRMATION]: DepositWebhookJobPayload;
  [QUEUE_NAMES.DEPOSIT_SUCCESSFUL]: DepositWebhookJobPayload;
  [QUEUE_NAMES.PENDING_SWAP]: SwapApprovalJobPayload;
  [QUEUE_NAMES.SUCCESSFUL_SWAP]: SuccessfulSwapJobPayload;
  [QUEUE_NAMES.FINALIZE_SWAP]: SuccessfulWithdrawJobPayload;
  [QUEUE_NAMES.SWAP_RECOVERY]: SwapRecoveryJobPayload;
  [QUEUE_NAMES.PENDING_WITHDRAWAL]: NgnWithdrawalJobPayload;
}

/** Union of queue names supported by the registry. */
export type QueueName = keyof QueuePayloadByName;

/** Minimal queue interface used by the registry and its tests. */
export interface QueueLike<T> {
  add(data: T, options?: Bull.JobOptions): Promise<unknown>;
  close(): Promise<void>;
}

/** Factory used to lazily construct a typed queue. */
export type QueueFactory = <T>(name: QueueName) => QueueLike<T>;

const defaultQueueFactory: QueueFactory = <T>(name: QueueName) =>
  new Bull<T>(name, opts);

/**
 * Lazily creates, caches, enqueues to, and closes typed Bull queues.
 */
export class QueueRegistry {
  private readonly queues = new Map<QueueName, QueueLike<unknown>>();

  /** Creates a registry with an optional injectable queue factory. */
  constructor(private readonly factory: QueueFactory = defaultQueueFactory) {}

  /** Adds a payload to the queue associated with its queue name. */
  enqueue<K extends QueueName>(
    name: K,
    data: QueuePayloadByName[K],
    options?: Bull.JobOptions,
  ): Promise<unknown> {
    return this.get<K>(name).add(data, options);
  }

  /** Number of queue instances currently held by the registry. */
  get size(): number {
    return this.queues.size;
  }

  /** Closes and removes every lazily created queue. */
  async close(): Promise<void> {
    const queues = [...this.queues.values()];
    this.queues.clear();
    for (const queue of queues) {
      await queue.close();
    }
  }

  /** Returns an existing queue or creates it through the configured factory. @internal */
  private get<K extends QueueName>(name: K): QueueLike<QueuePayloadByName[K]> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = this.factory<QueuePayloadByName[K]>(name) as QueueLike<unknown>;
      this.queues.set(name, queue);
    }
    return queue as QueueLike<QueuePayloadByName[K]>;
  }
}

/** Shared queue registry used by job producers. */
export const queueRegistry = new QueueRegistry();
