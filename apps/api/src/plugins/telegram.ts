import { randomUUID } from 'node:crypto';
import CONFIG from "../config/config";
import { MESSAGES } from "../helpers/messages";
import { SYSTEM_PROMPT } from "../helpers/prompt";
import { RateLimiter } from "../helpers/rateLimiter";
import { findOrCreateIntent } from "../queries/intent.query";
import type { Intent } from '../db/schema/intent.schema';
import { telegramClient } from "./bot";
import { getUserByIntentId } from "../queries/user.query";
import { findSupportedCryptos } from '../queries/catalog.query';
import Logging from "../library/logging.utils";
import QRCode from "qrcode";
import {
  runCryptoAgent,
  type CryptoAgentResponse,
} from "../agents/crypto.agent";
import {
  type TelegramClient,
  type TelegramMessage,
  type TelegramMessageOptions,
} from "../services/telegram/client";
import {
  chatHistoryStore,
  MODEL_CONTEXT_MESSAGE_LIMIT,
  type ChatHistoryStore,
} from '../services/telegram/history';
import { assertTelegramWebhookConfiguration } from '../middlewares/telegram-webhook.middleware';

interface ConversationTurn {
  intentId: string;
  turnId: string;
}

const TYPING_REFRESH_INTERVAL_MS = 4_000;

/** Maintains one best-effort Telegram progress signal for an AI turn. */
class TelegramResponseProgress {
  private timer?: ReturnType<typeof setTimeout>;
  private refreshPromise: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly bot: TelegramClient,
    private readonly chatId: number,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.scheduleRefresh();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.refreshPromise;
  }

  private scheduleRefresh(): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      const refreshPromise = this.refresh();
      this.refreshPromise = refreshPromise;
      void refreshPromise.then(() => this.scheduleRefresh());
    }, TYPING_REFRESH_INTERVAL_MS);
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;

    try {
      await this.bot.sendChatAction(this.chatId, 'typing');
    } catch (error) {
      Logging.warning('Telegram typing progress failed', error);
    }
  }
}

/**
 * @class DammieCryptoBot
 * @description Implements a Telegram bot for cryptocurrency transactions and information,
 * integrating with OpenAI for AI-driven responses and various tools for wallet operations.
 */
export class DammieCryptoBot {

  /**
   * @constructor
   * @description Initializes the Telegram bot, rate limiter, and sets up event handlers.
   */
  constructor(
    private readonly bot: TelegramClient,
    private readonly rateLimiter = new RateLimiter(),
    private readonly history: ChatHistoryStore = chatHistoryStore,
  ) {
    this.setupEventHandlers();
  }

  /**
   * @private
   * @method setupEventHandlers
   * @description Sets up event listeners for incoming messages and update errors.
   */
  private setupEventHandlers(): void {
    this.bot.onMessage(this.handleMessage.bind(this));
    this.bot.onError(this.handleUpdateError.bind(this));
  }

  /**
   * @private
   * @method handleMessage
   * @description Processes incoming Telegram messages. It handles rate limiting, distinguishes
   * between commands and regular messages, and dispatches them to appropriate handlers.
   * @param {BotMessage} message - The incoming message object from Telegram.
   */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    let conversation: ConversationTurn | undefined;
    try {
      const userId = message.from?.id as number;
      const chatId = message.chat.id;
      const username = this.getUsername(message);

      // Rate limiting check
      if (userId && this.rateLimiter.isLimited(userId)) {
        await this.sendMessage(chatId, MESSAGES.RATE_LIMITED);
        return;
      }

      // Only text messages participate in persisted conversation history.
      if (!message.text) {
        await this.sendMessage(chatId, MESSAGES.INVALID_MESSAGE);
        return;
      }

      const intent = await findOrCreateIntent({
        telegramId: userId.toString(),
        chatId: chatId.toString(),
      });
      const turnId = randomUUID();
      const claimed = await this.history.claimUserMessage({
        intentId: intent.id,
        turnId,
        telegramMessageId: message.message_id,
        content: message.text,
      });
      if (!claimed) {
        Logging.info(`Duplicate Telegram message ignored: ${message.message_id}`);
        return;
      }
      conversation = { intentId: intent.id, turnId };

      if (message.text.startsWith("/")) {
        await this.handleCommand(
          message.text,
          chatId,
          username,
          intent,
          conversation,
        );
        return;
      }

      await this.processUserMessage(
        message.text,
        userId,
        chatId,
        username,
        conversation,
        {
          id: claimed.id,
          createdAt: claimed.createdAt,
        },
      );
    } catch (error) {
      await this.handleError(
        message.chat.id,
        error,
        "message handler",
        conversation,
      );
    }
  }

  /**
   * @private
   * @method handleCommand
   * @description Handles specific bot commands like /start, /rates, and /help.
   * It provides welcome messages, displays crypto rates, or offers help information.
   * @param {string} command - The command string (e.g., "/start").
   * @param {number} chatId - The Telegram chat ID.
   * @param {string} username - The username of the sender.
   */
  private async handleCommand(
    command: string,
    chatId: number,
    username: string,
    intent: Intent,
    conversation: ConversationTurn,
  ): Promise<void> {
    switch (command) {
      case "/start":
        const [user, supportedCryptos] = await Promise.all([
          getUserByIntentId(intent.id),
          findSupportedCryptos(),
        ]);

        Logging.info(`Intent created or found: ${intent.completeSignupId}`);

        await this.sendAssistantMessage(
          chatId,
          MESSAGES.WELCOME(username, supportedCryptos),
          conversation,
          {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            reply_markup: !user
              ? {
                  inline_keyboard: [
                    [
                      {
                        text: "Complete Signup",
                        web_app: {
                          url: `${CONFIG.FRONTEND_URL}/auth/${intent.completeSignupId}`,
                        },
                      },
                    ],
                  ],
                }
              : undefined,
          },
        );
        break;
      case "/help":
        await this.sendAssistantMessage(
          chatId,
          MESSAGES.HELP(),
          conversation,
          { parse_mode: "Markdown" },
        );
        break;
      default:
        await this.sendAssistantMessage(
          chatId,
          MESSAGES.UNKNOWN_REQUEST,
          conversation,
        );
    }
  }

  /**
   * @private
   * @method processUserMessage
   * @description Processes a regular user message by sending it to the OpenAI model
   * and utilizing available tools to generate a relevant AI response.
   * @param {string} text - The text content of the user's message.
   * @param {number} userId - The Telegram user ID.
   * @param {number} chatId - The Telegram chat ID.
   * @param {string} username - The username of the sender.
   */
  private async processUserMessage(
    text: string,
    userId: number,
    chatId: number,
    username: string,
    conversation: ConversationTurn,
    claimedMessage: { id: string; createdAt: Date },
  ): Promise<void> {
    const progress = new TelegramResponseProgress(this.bot, chatId);
    await progress.start();

    let aiResponse: CryptoAgentResponse;
    try {
      const recentMessages = await this.history.getRecentMessagesBefore({
        intentId: conversation.intentId,
        before: claimedMessage,
        limit: MODEL_CONTEXT_MESSAGE_LIMIT,
      });
      const [supportedCryptos, registeredUser] = await Promise.all([
        findSupportedCryptos(),
        getUserByIntentId(conversation.intentId),
      ]);
      const prompt = SYSTEM_PROMPT({
        userId,
        supportedCryptos,
        recentMessages,
        isRegistered: Boolean(registeredUser?.firstName),
      });
      aiResponse = await runCryptoAgent({
        prompt: text,
        instructions: prompt,
        userId,
        username,
      }, { supportedCryptos });
    } finally {
      await progress.stop();
    }

    await this.sendAIResponse(chatId, aiResponse, conversation);
  }

  /**
   * @private
   * @method sendAIResponse
   * @description Sends the AI-generated response back to the user. It checks for
   * typed tool actions within the response to include interactive buttons.
   * @param {number} chatId - The Telegram chat ID to send the response to.
   * @param {CryptoAgentResponse} response - The typed AI response.
   */
  private async sendAIResponse(
    chatId: number,
    response: CryptoAgentResponse,
    conversation: ConversationTurn,
  ): Promise<void> {
    const responseText = response.text.trim();

    if (!responseText) {
      await this.sendAssistantMessage(
        chatId,
        MESSAGES.UNKNOWN_REQUEST,
        conversation,
      );
      return;
    }

    Logging.info("AI response generated successfully");

    if (response.action?.kind === "wallet_address") {
      await this.sendImageAndCaption(
        chatId,
        response.action.address,
        responseText,
      );
      await this.recordAssistantMessage(conversation, responseText);
      return;
    }

    if (response.action?.kind === "web_app") {
      const actionConfig =
        response.action.name === "ADD_BANK_ACCOUNT"
          ? {
              buttonText: "🏦 Add Bank Account",
              url: `${CONFIG.FRONTEND_URL}/bank/`,
            }
          : response.action.name === "REMOVE_BANK_ACCOUNT"
          ? {
              buttonText: "🗑️ Remove Bank Account",
              url: `${CONFIG.FRONTEND_URL}/banks/`,
            }
          : response.action.name === "APPROVE_WITHDRAWAL_ACTION"
          ? {
              buttonText: "🏦 Approve Withdrawal",
              url: `${CONFIG.FRONTEND_URL}/withdrawal/`,
            }
          : {
              buttonText: "🏦 Approve Transaction",
              url: `${CONFIG.FRONTEND_URL}/transaction/`,
            };
      const fullUrl = `${actionConfig.url}${response.action.param}`;

      Logging.info(`Sending typed action: ${response.action.name}`);

      await this.sendAssistantMessage(
        chatId,
        responseText,
        conversation,
        {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: actionConfig.buttonText,
                  web_app: { url: fullUrl },
                },
              ],
            ],
          },
        },
      );
      return;
    }

    // Send regular message
    await this.sendAssistantMessage(
      chatId,
      responseText,
      conversation,
      {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      },
    );
  }

  /** Delivers text and then records the exact user-visible assistant content. */
  private async sendAssistantMessage(
    chatId: number,
    text: string,
    conversation: ConversationTurn,
    options?: TelegramMessageOptions,
  ): Promise<void> {
    await this.sendMessage(chatId, text, options);
    await this.recordAssistantMessage(conversation, text);
  }

  /** Keeps successful delivery independent from a subsequent history-write failure. */
  private async recordAssistantMessage(
    conversation: ConversationTurn,
    content: string,
  ): Promise<void> {
    try {
      await this.history.appendAssistantMessage({
        ...conversation,
        content,
      });
    } catch (error) {
      Logging.error('Unable to persist assistant chat history:', error);
    }
  }

  /**
   * @private
   * @method sendMessage
   * @description A utility method to send a message to a specific chat ID, with optional Telegram API options.
   * @param {number} chatId - The Telegram chat ID.
   * @param {string} text - The text message to send.
   * @param {any} [options] - Optional settings for the message (e.g., parse_mode, reply_markup).
   */
  private async sendMessage(
    chatId: number,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<void> {
    await this.bot.sendMessage(chatId, text, options);
  }

  private async sendImageAndCaption(
    chatId: number,
    address: string,
    caption: string,
  ): Promise<void> {
    const qrBuffer = await QRCode.toBuffer(address, {
      type: "png",
      width: 512,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
      errorCorrectionLevel: "M",
    });

    await this.bot.sendPhoto(chatId, qrBuffer, {
      caption: "\n" + caption,
      parse_mode: "Markdown",
    });
  }

  /**
   * @private
   * @method handleError
   * @description Centralized error handling method for sending error messages to the user and logging errors.
   * @param {number} chatId - The Telegram chat ID where the error occurred.
   * @param {any} error - The error object.
   * @param {string} context - A string describing the context where the error occurred (e.g., "message handler").
   */
  private async handleError(
    chatId: number,
    error: unknown,
    context: string,
    conversation?: ConversationTurn,
  ): Promise<void> {
    Logging.error(`Error in ${context}:`, error);

    const errorMessage = error instanceof Error && error.message.includes("rate limit")
      ? MESSAGES.RATE_LIMIT_ERROR
      : MESSAGES.ERROR;

    try {
      if (conversation) {
        await this.sendAssistantMessage(chatId, errorMessage, conversation);
      } else {
        await this.sendMessage(chatId, errorMessage);
      }
    } catch (sendError) {
      Logging.error('Unable to deliver error response:', sendError);
    }
  }

  /**
   * @private
   * @method handleUpdateError
   * @description Handles errors that occur while processing a Telegram update.
   * @param {unknown} error - The update-processing error.
   */
  private handleUpdateError(error: unknown): void {
    Logging.error("Telegram update handler error", error);
  }

  /**
   * @private
   * @method getUsername
   * @description Extracts the username or first name from a Telegram message object for personalized greetings.
   * Defaults to 'there' if no name is available.
   * @param {BotMessage} message - The incoming message object.
   * @returns {string} The username or 'there'.
   */
  private getUsername(message: TelegramMessage): string {
    return message.from?.username || message.from?.first_name || "there";
  }

  /**
   * @public
   * @method start
   * @description Registers the Telegram webhook and logs startup information.
   */
  public start(): Promise<void> {
    return this.bot.start().then(() => {
      Logging.info("Telegram webhook registered");
    });
  }

  public stop(): Promise<void> {
    return this.bot.stop();
  }
}

let bot: DammieCryptoBot | undefined;

export const createTelegramBot = (
  client: TelegramClient = telegramClient,
  history: ChatHistoryStore = chatHistoryStore,
): DammieCryptoBot => new DammieCryptoBot(client, new RateLimiter(), history);

export const startTelegramBot = (): Promise<void> => {
  if (
    !CONFIG.BOT_TOKEN
    || !CONFIG.AI_GATEWAY_API_KEY
    || !CONFIG.TELEGRAM_WEBHOOK_URL
    || !CONFIG.TELEGRAM_WEBHOOK_SECRET
  ) {
    throw new Error(
      "Missing required environment variables: TELEGRAM_BOT_TOKEN, AI_GATEWAY_API_KEY, TELEGRAM_WEBHOOK_URL, and TELEGRAM_WEBHOOK_SECRET",
    );
  }

  assertTelegramWebhookConfiguration(
    CONFIG.TELEGRAM_WEBHOOK_URL,
    CONFIG.TELEGRAM_WEBHOOK_SECRET,
  );

  bot ??= createTelegramBot();
  return bot.start();
};

export const stopTelegramBot = async (): Promise<void> => {
  await bot?.stop();
};
