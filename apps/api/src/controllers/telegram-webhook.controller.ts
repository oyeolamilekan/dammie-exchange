import type { Request, Response } from 'express';
import type { Update } from 'node-telegram-bot-api';
import asyncHandler from '../helpers/async-handler.helper';
import { telegramClient } from '../plugins/bot';

/** Checks the minimum Telegram update envelope before SDK dispatch. */
export const isTelegramUpdate = (value: unknown): value is Update => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && Number.isSafeInteger((value as { update_id?: unknown }).update_id)
);

/** Dispatches one authenticated Telegram webhook update to the bot workflow. */
export const telegramWebhookController = asyncHandler(async (
  req: Request,
  res: Response,
) => {
  if (!isTelegramUpdate(req.body)) {
    return res.status(400).json({ message: 'Invalid Telegram update' });
  }

  await telegramClient.handleUpdate(req.body);
  return res.status(200).json({});
});
