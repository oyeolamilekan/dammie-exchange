/**
 * Names of the Bull queues used by the API and financial workers.
 *
 * Keep these values stable: queue names are persisted in Redis and are shared
 * by producers, consumers, and deployment instances.
 *
 * @module queueNames
 */

/** Typed queue-name registry for wallet, deposit, swap, and withdrawal jobs. */
export const QUEUE_NAMES = {
  CREATE_WALLET: "create-wallet-queue",
  ASSIGN_WALLET_ADDRESS: "assign-wallet-address-queue",
  DEPOSIT_CONFIRMATION: "deposit-confirmation-queue",
  DEPOSIT_SUCCESSFUL: "deposit-successful-queue",
  PENDING_SWAP: "pending-swap-queue",
  SUCCESSFUL_SWAP: "successful-swap-queue",
  FINALIZE_SWAP: "finalize-swap-queue",
  SWAP_RECOVERY: "swap-recovery-queue",
  PENDING_WITHDRAWAL: "pending-withdrawal-queue",
} as const;
