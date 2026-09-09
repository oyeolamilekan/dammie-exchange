import { type Request, type Response } from 'express';
import asyncHandler from '../helpers/async-handler.helper';
import { createWalletJob, processNgnWithdrawal, processSwap } from '../jobs/event.job';
import Logging from '../library/logging.utils';
import { telegramClient } from '../plugins/bot';
import { quidax } from '../services/integrations/quidax';
import { createApproveSwapService } from '../services/users/approve-swap';
import { createApproveWithdrawalService } from '../services/users/approve-withdrawal';
import {
  createBankAccountService,
  listSavedBankAccounts,
  removeSavedBankAccount,
} from '../services/users/bank-accounts';
import { createRegisterUserService } from '../services/users/register';
import { createPinAttemptLimiter } from '../services/security/pin-attempts';
import { redisSecurityStore } from '../services/security/store';
import { sendTelegramNotification } from '../services/telegram/notifications';
import CONFIG from '../config/config';
import { toPublicUserResponse } from './user.response';
import { findSupportedCryptos } from '../queries/catalog.query';
import { getNgnWithdrawalReview } from '../services/financial/ngn-withdrawals';

/**
 * Customer-facing Telegram Mini App controllers.
 *
 * These handlers trust the Telegram user attached by authentication middleware,
 * validate the relevant service outcome, and return the API's standard
 * `{ success, message, data }` envelope. Approval handlers enqueue financial
 * work only after ownership, PIN, and state checks complete.
 *
 * @module userController
 */

/** Request body for signup completion. */
type CreateUserBody = {
  email?: string;
  firstName?: string;
  lastName?: string;
  bvnNumber?: string;
  transactionPin?: string;
};

/** Request body for adding a verified bank account. */
type BankAccountBody = {
  bankCode?: string;
  accountNumber?: string;
};

/** Request body for swap approval. */
type ApproveSwapBody = { code?: string };

/** Request body for withdrawal approval. */
type ApproveWithdrawalBody = { code?: string; bankId?: string };

/** Standard customer-controller response envelope. */
type ApiResponse = {
  success: boolean;
  message: string;
  data: unknown;
};

/** Creates a successful customer API response. @internal */
const createSuccessResponse = (message: string, data: unknown = null): ApiResponse => ({
  success: true,
  message,
  data,
});

/** Creates a failed customer API response. @internal */
const createErrorResponse = (message: string, data: unknown = null): ApiResponse => ({
  success: false,
  message,
  data,
});

/** Sends a Telegram notification through the configured bot client. @internal */
const notify = (chatId: string, text: string): Promise<boolean> =>
  sendTelegramNotification(telegramClient, chatId, text);

const registerUser = createRegisterUserService({
  quidax,
  enqueueWalletJob: createWalletJob,
  notify,
  getSupportedCryptos: findSupportedCryptos,
});

const addBankAccount = createBankAccountService({ quidax, notify });

const pinAttempts = createPinAttemptLimiter({
  store: redisSecurityStore,
  maxAttempts: CONFIG.PIN_MAX_ATTEMPTS,
  windowSeconds: CONFIG.PIN_ATTEMPT_WINDOW_SECONDS,
});

const approveSwap = createApproveSwapService({
  pinAttempts,
  enqueueSwap: processSwap,
  notify,
});

const approveWithdrawal = createApproveWithdrawalService({
  pinAttempts,
  enqueueWithdrawal: processNgnWithdrawal,
  notify,
});

/** Sets the retry header used by rate-limited PIN responses. @internal */
const setRetryAfter = (res: Response, retryAfterSeconds: number): void => {
  res.set('Retry-After', String(retryAfterSeconds));
};

/**
 * Completes signup for a Telegram intent and queues wallet provisioning.
 *
 * Route: `POST /users/create_user/:id`.
 * The authenticated Telegram ID must own the signup intent identified by
 * `req.params.id`. Sensitive signup fields are passed to the registration
 * service and only the public user projection is returned.
 */
export const createUserController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateUserBody;
    const result = await registerUser({
      completeSignupId: req.params.id,
      authenticatedTelegramId: req.telegramUser?.id,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      bvnNumber: body.bvnNumber,
      transactionPin: body.transactionPin,
    });

    switch (result.outcome) {
      case 'intent-not-found':
      case 'intent-not-owned':
        return res.status(404).json(createErrorResponse('Intent not found'));
      case 'invalid-input':
        return res.status(400).json(createErrorResponse(result.message));
      case 'user-exists':
        return res.status(400).json(createErrorResponse('User already exists'));
      case 'created':
        return res.status(201).json(createSuccessResponse(
          'User successfully created',
          toPublicUserResponse(result.user),
        ));
    }
  } catch (error: unknown) {
    Logging.error('Error creating user:', error);
    return res.status(500).json(createErrorResponse('Failed to create user'));
  }
});

/**
 * Validates a customer's transaction PIN and queues an approved swap.
 *
 * Route: `POST /users/approve_transaction/:swapId`.
 * Failed PIN attempts are rate-limited per authenticated user and transaction.
 */
export const approveTransactionController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body as ApproveSwapBody;
    const result = await approveSwap({
      swapId: req.params.swapId,
      telegramId: req.telegramUser?.id ?? '',
      code: body.code,
    });

    switch (result.outcome) {
      case 'invalid-input':
        return res.status(400).json(createErrorResponse('PIN code is required'));
      case 'swap-not-found':
        return res.status(404).json(createErrorResponse('Swap does not exist'));
      case 'rate-limited':
        setRetryAfter(res, result.retryAfterSeconds);
        return res.status(429).json(createErrorResponse('Too many invalid PIN attempts'));
      case 'invalid-pin':
        return res.status(400).json(createErrorResponse('Invalid PIN'));
      case 'approved':
        return res.status(200).json(createSuccessResponse('Transaction approved successfully'));
    }
  } catch (error: unknown) {
    Logging.error('Error approving transaction:', error);
    return res.status(503).json(createErrorResponse('Transaction approval is temporarily unavailable'));
  }
});

/**
 * Verifies and saves a customer's bank account.
 *
 * Route: `POST /users/add_bank_account` (with a compatibility path variant).
 * Ownership comes from authenticated Telegram init data, not from a URL user
 * identifier.
 */
export const addBankAccountController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body as BankAccountBody;
    const result = await addBankAccount({
      telegramId: req.telegramUser?.id ?? '',
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    });

    switch (result.outcome) {
      case 'user-not-found':
        return res.status(404).json(createErrorResponse('User not found'));
      case 'invalid-input':
        return res.status(400).json(createErrorResponse(result.message));
      case 'already-exists':
        return res.status(400).json(createErrorResponse('Bank account already exists'));
      case 'name-mismatch':
        return res.status(400).json(createErrorResponse('Account name does not match your profile name'));
      case 'created':
        return res.status(200).json(createSuccessResponse(
          'Bank account added successfully',
          result.bankAccount,
        ));
    }
  } catch (error: unknown) {
    Logging.error('Error adding bank account:', error);
    return res.status(500).json(createErrorResponse('Failed to add bank account'));
  }
});

/** Returns the authenticated customer's active saved bank accounts. */
export const listBankAccountsController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await listSavedBankAccounts(req.telegramUser?.id ?? '');
    if (result.outcome === 'user-not-found') {
      return res.status(404).json(createErrorResponse('User not found'));
    }
    return res.status(200).json(createSuccessResponse(
      'Bank accounts retrieved successfully',
      result.bankAccounts,
    ));
  } catch (error: unknown) {
    Logging.error('Error retrieving bank accounts:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve bank accounts'));
  }
});

/** Removes an owner-scoped saved account while preserving withdrawal history. */
export const removeBankAccountController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const result = await removeSavedBankAccount({
      telegramId: req.telegramUser?.id ?? '',
      bankId: req.params.bankId,
    });
    switch (result.outcome) {
      case 'invalid-input':
        return res.status(400).json(createErrorResponse('A valid bank account ID is required'));
      case 'user-not-found':
        return res.status(404).json(createErrorResponse('User not found'));
      case 'bank-not-found':
        return res.status(404).json(createErrorResponse('Bank account not found'));
      case 'removed':
        return res.status(200).json(createSuccessResponse('Bank account removed successfully'));
    }
  } catch (error: unknown) {
    Logging.error('Error removing bank account:', error);
    return res.status(500).json(createErrorResponse('Failed to remove bank account'));
  }
});

/**
 * Returns an owner-scoped NGN withdrawal review for the Mini App.
 *
 * Route: `GET /users/withdrawals/:withdrawalId`.
 * This read-only review does not consume the replay claim needed for the later
 * approval mutation.
 */
export const getWithdrawalReviewController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const review = await getNgnWithdrawalReview(
      req.params.withdrawalId,
      req.telegramUser?.id ?? '',
    );
    if (!review) return res.status(404).json(createErrorResponse('Withdrawal does not exist'));
    return res.status(200).json(createSuccessResponse('Withdrawal details retrieved', review));
  } catch (error: unknown) {
    Logging.error('Error retrieving withdrawal:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve withdrawal'));
  }
});

/**
 * Validates bank selection and transaction PIN, then queues an NGN payout.
 *
 * Route: `POST /users/approve_withdrawal/:withdrawalId`.
 * The approval service owns the atomic balance hold, duplicate handling, and
 * provider enqueue behavior.
 */
export const approveWithdrawalController = asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body as ApproveWithdrawalBody;
    const result = await approveWithdrawal({
      withdrawalId: req.params.withdrawalId,
      telegramId: req.telegramUser?.id ?? '',
      bankId: body.bankId,
      code: body.code,
    });
    switch (result.outcome) {
      case 'unavailable':
        return res.status(503).json(createErrorResponse('NGN withdrawals are temporarily unavailable'));
      case 'invalid-input':
        return res.status(400).json(createErrorResponse('Bank account and PIN code are required'));
      case 'withdrawal-not-found':
        return res.status(404).json(createErrorResponse('Withdrawal does not exist'));
      case 'bank-not-found':
        return res.status(400).json(createErrorResponse('Select one of your verified bank accounts'));
      case 'invalid-state':
        return res.status(409).json(createErrorResponse('Withdrawal can no longer be approved'));
      case 'wallet-unavailable':
        return res.status(409).json(createErrorResponse('NGN wallet is unavailable'));
      case 'rate-limited':
        setRetryAfter(res, result.retryAfterSeconds);
        return res.status(429).json(createErrorResponse('Too many invalid PIN attempts'));
      case 'invalid-pin':
        return res.status(400).json(createErrorResponse('Invalid PIN'));
      case 'insufficient-balance':
        return res.status(409).json(createErrorResponse(
          `Insufficient NGN balance. Required ₦${result.total}, available ₦${result.balance}`,
        ));
      case 'approved':
        return res.status(200).json(createSuccessResponse(
          result.duplicate ? 'Withdrawal is already processing' : 'Withdrawal approved successfully',
        ));
    }
  } catch (error: unknown) {
    Logging.error('Error approving withdrawal:', error);
    return res.status(503).json(createErrorResponse('Withdrawal approval is temporarily unavailable'));
  }
});
