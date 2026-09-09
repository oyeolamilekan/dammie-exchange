/**
 * Owner-scoped NGN withdrawal approval service.
 *
 * Verifies the transaction PIN and selected bank account before atomically
 * locking the withdrawal and enqueueing provider payout processing.
 *
 * @module approveWithdrawalService
 */

import bcrypt from 'bcrypt';
import { getUserByTelegramIdForAuthentication } from '../../queries/user.query';
import {
  getConfiguredNgnWithdrawalFee,
  getNgnWithdrawalReview,
  lockNgnWithdrawal,
} from '../financial/ngn-withdrawals';
import type { PinAttemptLimiter } from '../security/pin-attempts';
import { standardDecimal } from '../../utils/decimal';

/** Side effects injected into the withdrawal approval workflow. */
export interface ApproveWithdrawalDependencies {
  pinAttempts: PinAttemptLimiter;
  enqueueWithdrawal(data: { id: string }): Promise<void>;
  notify(chatId: string, text: string): Promise<unknown>;
}

/** Authenticated withdrawal approval input. */
export interface ApproveWithdrawalInput {
  withdrawalId: string;
  telegramId: string;
  bankId?: string;
  code?: string;
}

/** Expected withdrawal approval outcomes. */
export type ApproveWithdrawalResult =
  | { outcome: 'unavailable' | 'invalid-input' | 'withdrawal-not-found' | 'bank-not-found' | 'invalid-state' | 'wallet-unavailable' }
  | { outcome: 'rate-limited'; retryAfterSeconds: number }
  | { outcome: 'invalid-pin' }
  | { outcome: 'insufficient-balance'; balance: string; total: string }
  | { outcome: 'approved'; duplicate: boolean };

/** Verifies the transaction PIN before atomically locking and queueing an NGN payout. */
export const createApproveWithdrawalService = (dependencies: ApproveWithdrawalDependencies) =>
  async (input: ApproveWithdrawalInput): Promise<ApproveWithdrawalResult> => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!input.code || !/^\d{4}$/.test(input.code) || !input.bankId
      || !uuid.test(input.bankId) || !uuid.test(input.withdrawalId)) {
      return { outcome: 'invalid-input' };
    }
    const user = await getUserByTelegramIdForAuthentication(input.telegramId);
    if (!user?.isActive) return { outcome: 'withdrawal-not-found' };
    const review = await getNgnWithdrawalReview(input.withdrawalId, input.telegramId);
    if (!review) return { outcome: 'withdrawal-not-found' };
    // This compatibility reader returns null only when the payout account is absent;
    // a missing database rule resolves to zero and remains available.
    if ((await getConfiguredNgnWithdrawalFee()) === null) return { outcome: 'unavailable' };

    const attemptState = await dependencies.pinAttempts.getState(
      input.telegramId,
      input.withdrawalId,
      'withdrawal',
    );
    if (attemptState.locked) {
      return { outcome: 'rate-limited', retryAfterSeconds: attemptState.retryAfterSeconds };
    }
    if (!(await bcrypt.compare(input.code, user.hashedPin))) {
      const failed = await dependencies.pinAttempts.recordFailure(
        input.telegramId,
        input.withdrawalId,
        'withdrawal',
      );
      return failed.locked
        ? { outcome: 'rate-limited', retryAfterSeconds: failed.retryAfterSeconds }
        : { outcome: 'invalid-pin' };
    }

    const locked = await lockNgnWithdrawal(input.withdrawalId, user.id, input.bankId);
    switch (locked.outcome) {
      case 'not-found': return { outcome: 'withdrawal-not-found' };
      case 'bank-not-found': return { outcome: 'bank-not-found' };
      case 'invalid-state': return { outcome: 'invalid-state' };
      case 'wallet-unavailable': return { outcome: 'wallet-unavailable' };
      case 'insufficient-balance': return locked;
      case 'locked':
      case 'already-locked': {
        await dependencies.pinAttempts.reset(input.telegramId, input.withdrawalId, 'withdrawal');
        await dependencies.enqueueWithdrawal({ id: input.withdrawalId });
        if (locked.outcome === 'locked') {
          void dependencies.notify(
            user.chatId,
            `🏦 Your ₦${standardDecimal(locked.withdrawal.amount)} withdrawal has been approved and is processing.`,
          );
        }
        return { outcome: 'approved', duplicate: locked.outcome === 'already-locked' };
      }
    }
  };

/** Constructed owner-scoped withdrawal approval service contract. */
export type ApproveWithdrawalService = ReturnType<typeof createApproveWithdrawalService>;
