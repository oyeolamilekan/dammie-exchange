import Logging from '../library/logging.utils';
import { closeWorkerQueues as closeTrackedWorkerQueues } from './workers/runtime';
import { initializeCreateWalletWorker } from './workers/create-wallet.worker';
import { initializeDepositConfirmationWorker } from './workers/deposit-confirmation.worker';
import { initializeDepositSuccessWorker } from './workers/deposit-success.worker';
import { initializeFinalizeSwapWorker } from './workers/finalize-swap.worker';
import { initializePendingSwapWorker } from './workers/pending-swap.worker';
import { initializeSuccessfulSwapWorker } from './workers/successful-swap.worker';
import { initializeSwapRecoveryWorker } from './workers/swap-recovery.worker';
import { initializePendingWithdrawalWorker } from './workers/pending-withdrawal.worker';

/**
 * Application-level worker lifecycle coordinator.
 *
 * Worker initialization is guarded so startup can be called more than once
 * safely, and a failed startup closes any workers that were already created.
 *
 * @module listenerJobs
 */

let queuesInitialized = false;

/** Initializes every queue consumer once, preserving the existing startup gate. */
export const initializeQueues = async (): Promise<void> => {
  if (queuesInitialized) return;
  try {
    await Promise.all([
      initializeCreateWalletWorker(),
      initializeDepositConfirmationWorker(),
      initializeDepositSuccessWorker(),
      initializePendingSwapWorker(),
      initializeSuccessfulSwapWorker(),
      initializeFinalizeSwapWorker(),
      initializeSwapRecoveryWorker(),
      initializePendingWithdrawalWorker(),
    ]);
    queuesInitialized = true;
    Logging.info('All job queues initialized successfully');
  } catch (error: unknown) {
    await closeWorkerQueues();
    Logging.error(
      `Error initializing job queues: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    throw error;
  }
};

/** Closes each worker sequentially and permits a later initialization. */
export const closeWorkerQueues = async (): Promise<void> => {
  queuesInitialized = false;
  await closeTrackedWorkerQueues();
};
