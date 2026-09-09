/**
 * Owner-scoped swap approval service.
 *
 * Verifies the transaction PIN, applies the failed-attempt limiter, and queues
 * the approved swap without exposing authentication details to the caller.
 *
 * @module approveSwapService
 */

import bcrypt from 'bcrypt';
import { MESSAGES } from '../../helpers/messages';
import {
  getUserByTelegramIdForAuthentication,
} from '../../queries/user.query';
import { findSwapByIdForUser } from '../../queries/swap.query';
import type { PinAttemptLimiter } from '../security/pin-attempts';

/** Swap projection passed to the approval queue. @internal */
type ApprovedSwap = NonNullable<Awaited<ReturnType<typeof findSwapByIdForUser>>>;

/** Side effects supplied by the HTTP composition root for PIN approval. */
export interface ApproveSwapServiceDependencies {
  pinAttempts: PinAttemptLimiter;
  enqueueSwap(swap: ApprovedSwap): Promise<void>;
  notify(chatId: string, text: string): Promise<unknown>;
}

/** Input extracted after Telegram mutation authentication. */
export interface ApproveSwapInput {
  swapId: string;
  telegramId: string;
  code?: string;
}

/** Expected approval outcomes; security/provider failures remain thrown errors. */
export type ApproveSwapResult =
  | { outcome: 'invalid-input' }
  | { outcome: 'swap-not-found' }
  | { outcome: 'rate-limited'; retryAfterSeconds: number }
  | { outcome: 'invalid-pin' }
  | { outcome: 'approved' };

/** Creates the owner-scoped, rate-limited PIN approval workflow. */
export const createApproveSwapService = (dependencies: ApproveSwapServiceDependencies) =>
  async (input: ApproveSwapInput): Promise<ApproveSwapResult> => {
    if (!input.code) return { outcome: 'invalid-input' };

    const user = await getUserByTelegramIdForAuthentication(input.telegramId);
    if (!user) return { outcome: 'swap-not-found' };

    const swap = await findSwapByIdForUser(input.swapId, user.id);
    if (!swap) return { outcome: 'swap-not-found' };

    const attemptState = await dependencies.pinAttempts.getState(
      input.telegramId,
      input.swapId,
    );
    if (attemptState.locked) {
      return {
        outcome: 'rate-limited',
        retryAfterSeconds: attemptState.retryAfterSeconds,
      };
    }

    const isPinValid = await bcrypt.compare(input.code, user.hashedPin);
    if (!isPinValid) {
      const failedState = await dependencies.pinAttempts.recordFailure(
        input.telegramId,
        input.swapId,
      );
      if (failedState.locked) {
        return {
          outcome: 'rate-limited',
          retryAfterSeconds: failedState.retryAfterSeconds,
        };
      }
      return { outcome: 'invalid-pin' };
    }

    await dependencies.pinAttempts.reset(input.telegramId, input.swapId);
    await dependencies.enqueueSwap(swap);
    void dependencies.notify(
      user.chatId,
      MESSAGES.SWAP_APPROVED(swap.fromAmount, swap.fromCurrency.toUpperCase()),
    );
    return { outcome: 'approved' };
  };

/** Constructed owner-scoped swap approval service contract. */
export type ApproveSwapService = ReturnType<typeof createApproveSwapService>;
