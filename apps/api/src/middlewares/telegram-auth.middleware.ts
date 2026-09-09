import type { NextFunction, Request, Response } from 'express';
import CONFIG from '../config/config';
import { redisSecurityStore } from '../services/security/store';
import {
  TelegramAuthenticationError,
  verifyTelegramInitData,
} from '../services/security/telegram-auth';

/**
 * Telegram Mini App authentication middleware.
 *
 * Mutation authentication claims signed init data for replay protection, while
 * read authentication verifies identity without consuming the replay claim.
 *
 * @module telegramAuthMiddleware
 */

/** Header containing the raw Telegram Web App `initData` string. */
export const TELEGRAM_INIT_DATA_HEADER = 'x-telegram-init-data';

/** Authenticates a customer mutation and attaches the verified Telegram user. */
export const authenticateTelegramMutation = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.get(TELEGRAM_INIT_DATA_HEADER) ?? '';
    req.telegramUser = await verifyTelegramInitData(header, {
      botToken: CONFIG.BOT_TOKEN,
      maxAgeSeconds: CONFIG.TELEGRAM_AUTH_MAX_AGE_SECONDS,
      store: redisSecurityStore,
    });
    next();
  } catch (error) {
    const authError =
      error instanceof TelegramAuthenticationError
        ? error
        : new TelegramAuthenticationError('Telegram authentication failed');
    res.status(authError.status).json({
      success: false,
      message: authError.message,
      data: null,
    });
  }
};

/** Authenticates read-only Mini App requests without consuming the signed payload's replay claim. */
export const authenticateTelegramRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.get(TELEGRAM_INIT_DATA_HEADER) ?? '';
    req.telegramUser = await verifyTelegramInitData(header, {
      botToken: CONFIG.BOT_TOKEN,
      maxAgeSeconds: CONFIG.TELEGRAM_AUTH_MAX_AGE_SECONDS,
      store: redisSecurityStore,
      claimReplay: false,
    });
    next();
  } catch (error) {
    const authError = error instanceof TelegramAuthenticationError
      ? error
      : new TelegramAuthenticationError('Telegram authentication failed');
    res.status(authError.status).json({
      success: false,
      message: authError.message,
      data: null,
    });
  }
};
