import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TelegramClient,
  TelegramMessage,
} from '../../src/services/telegram/client';
import type { ChatHistoryStore } from '../../src/services/telegram/history';
import { catalogFixture } from '../fixtures/catalog';

const mocks = vi.hoisted(() => ({
  findOrCreateIntent: vi.fn(),
  getUserByIntentId: vi.fn(),
  runCryptoAgent: vi.fn(),
  systemPrompt: vi.fn(),
  claimUserMessage: vi.fn(),
  appendAssistantMessage: vi.fn(),
  getRecentMessagesBefore: vi.fn(),
  findSupportedCryptos: vi.fn(),
}));

vi.mock('../../src/queries/intent.query', () => ({
  findOrCreateIntent: mocks.findOrCreateIntent,
}));
vi.mock('../../src/queries/user.query', () => ({
  getUserByIntentId: mocks.getUserByIntentId,
}));
vi.mock('../../src/queries/catalog.query', () => ({
  findSupportedCryptos: mocks.findSupportedCryptos,
}));
vi.mock('../../src/agents/crypto.agent', () => ({
  runCryptoAgent: mocks.runCryptoAgent,
}));
vi.mock('../../src/helpers/prompt', () => ({
  SYSTEM_PROMPT: mocks.systemPrompt,
}));

import { DammieCryptoBot } from '../../src/plugins/telegram';
import { MESSAGES } from '../../src/helpers/messages';
import Logging from '../../src/library/logging.utils';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createClient = () => {
  let handler: ((message: TelegramMessage) => Promise<void>) | undefined;
  const client: TelegramClient = {
    onMessage: vi.fn((nextHandler) => {
      handler = nextHandler;
    }),
    onError: vi.fn(),
    handleUpdate: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendPhoto: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockReturnValue(new Promise<void>(() => undefined)),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
  };
  return { client, getHandler: () => handler! };
};

const message = (text?: string): TelegramMessage => ({
  message_id: 1,
  date: 1,
  chat: { id: 42, type: 'private' },
  from: { id: 7, is_bot: false, first_name: 'Ada', username: 'ada' },
  ...(text === undefined ? {} : { text }),
});

const historyWriter: ChatHistoryStore = {
  claimUserMessage: mocks.claimUserMessage,
  appendAssistantMessage: mocks.appendAssistantMessage,
  getRecentMessagesBefore: mocks.getRecentMessagesBefore,
};

const createBot = (client: TelegramClient) =>
  new DammieCryptoBot(client, undefined, historyWriter);

describe('DammieCryptoBot behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.systemPrompt.mockReturnValue('system prompt');
    mocks.findSupportedCryptos.mockResolvedValue(catalogFixture);
    mocks.findOrCreateIntent.mockResolvedValue({
      id: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
      completeSignupId: 'complete-id',
    });
    mocks.claimUserMessage.mockResolvedValue({
      id: '0191ccec-61f4-7000-8000-000000000001',
      createdAt: new Date('2026-09-05T12:00:00Z'),
    });
    mocks.appendAssistantMessage.mockResolvedValue({ id: 'assistant-id' });
    mocks.getRecentMessagesBefore.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves the /start Mini App signup button', async () => {
    mocks.findOrCreateIntent.mockResolvedValue({
      id: 'intent-id',
      completeSignupId: 'complete-id',
    });
    mocks.getUserByIntentId.mockResolvedValue(null);
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('/start'));

    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      MESSAGES.WELCOME('ada', catalogFixture),
      expect.objectContaining({
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{
            text: 'Complete Signup',
            web_app: { url: expect.stringContaining('/auth/complete-id') },
          }]],
        },
      }),
    );
  });

  it('preserves help, unknown command, and non-text responses', async () => {
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('/help'));
    await fake.getHandler()(message('/unknown'));
    await fake.getHandler()(message());

    expect(fake.client.sendMessage).toHaveBeenNthCalledWith(
      1,
      42,
      MESSAGES.HELP(),
      { parse_mode: 'Markdown' },
    );
    expect(fake.client.sendMessage).toHaveBeenNthCalledWith(
      2,
      42,
      MESSAGES.UNKNOWN_REQUEST,
      undefined,
    );
    expect(fake.client.sendMessage).toHaveBeenNthCalledWith(
      3,
      42,
      MESSAGES.INVALID_MESSAGE,
      undefined,
    );
  });

  it('starts the typing indicator and preserves typed web-app responses', async () => {
    mocks.runCryptoAgent.mockResolvedValue({
      text: 'Approve this swap',
      action: { kind: 'web_app', name: 'APPROVE_TRANSACTION', param: 'swap-id' },
    });
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('swap 1 BTC'));

    expect(fake.client.sendChatAction).toHaveBeenCalledWith(42, 'typing');
    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      'Approve this swap',
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{
            text: '🏦 Approve Transaction',
            web_app: { url: expect.stringContaining('/transaction/swap-id') },
          }]],
        },
      }),
    );
    const userWrite = mocks.claimUserMessage.mock.calls[0][0];
    expect(userWrite).toMatchObject({
      intentId: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
      telegramMessageId: 1,
      content: 'swap 1 BTC',
    });
    expect(mocks.appendAssistantMessage).toHaveBeenCalledWith({
      intentId: userWrite.intentId,
      turnId: userWrite.turnId,
      content: 'Approve this swap',
    });
    expect(vi.mocked(fake.client.sendChatAction).mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getRecentMessagesBefore.mock.invocationCallOrder[0]);
  });

  it('refreshes typing every four seconds and waits for an in-flight refresh before delivery', async () => {
    vi.useFakeTimers();
    const agentResponse = deferred<{ text: string }>();
    const typingRefresh = deferred<void>();
    mocks.runCryptoAgent.mockReturnValue(agentResponse.promise);
    const fake = createClient();
    vi.mocked(fake.client.sendChatAction)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(typingRefresh.promise);
    createBot(fake.client);

    const handling = fake.getHandler()(message('take your time'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(2);

    agentResponse.resolve({ text: 'Finished response' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.client.sendMessage).not.toHaveBeenCalled();

    typingRefresh.resolve();
    await handling;
    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      'Finished response',
      expect.any(Object),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(2);
  });

  it('keeps typing progress failures non-fatal', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(Logging, 'warning').mockImplementation(() => undefined);
    const agentResponse = deferred<{ text: string }>();
    mocks.runCryptoAgent.mockReturnValue(agentResponse.promise);
    const fake = createClient();
    vi.mocked(fake.client.sendChatAction).mockRejectedValueOnce(
      new Error('typing unavailable'),
    ).mockResolvedValue(undefined);
    createBot(fake.client);

    const handling = fake.getHandler()(message('hello'));
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      'Telegram typing progress failed',
      expect.any(Error),
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(2);

    agentResponse.resolve({ text: 'Hello back' });
    await handling;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(2);
    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      'Hello back',
      expect.any(Object),
    );
  });

  it('injects the previous 20 messages into the model instructions', async () => {
    const recentMessages = Array.from({ length: 20 }, (_, index) => ({
      id: `0191ccec-61f4-7000-8000-${String(index).padStart(12, '0')}`,
      intentId: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
      turnId: `0191ccec-61f4-7000-9000-${String(index).padStart(12, '0')}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `message ${index + 1}`,
      telegramMessageId: index % 2 === 0 ? index + 1 : null,
      createdAt: new Date(`2026-09-05T11:${String(index).padStart(2, '0')}:00Z`),
    }));
    mocks.getRecentMessagesBefore.mockResolvedValue(recentMessages);
    mocks.runCryptoAgent.mockResolvedValue({ text: 'Context-aware answer' });
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('What did I say earlier?'));

    expect(mocks.getRecentMessagesBefore).toHaveBeenCalledWith({
      intentId: '018f7d22-7c3d-7a9e-8f6b-123456789abc',
      before: {
        id: '0191ccec-61f4-7000-8000-000000000001',
        createdAt: new Date('2026-09-05T12:00:00Z'),
      },
      limit: 20,
    });
    expect(mocks.systemPrompt).toHaveBeenCalledWith({
      userId: 7,
      supportedCryptos: catalogFixture,
      recentMessages,
      isRegistered: false,
    });
    expect(mocks.runCryptoAgent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'What did I say earlier?',
      instructions: 'system prompt',
    }), { supportedCryptos: catalogFixture });
  });

  it('opens the saved-bank-account management Mini App', async () => {
    mocks.runCryptoAgent.mockResolvedValue({
      text: 'Choose an account to remove',
      action: { kind: 'web_app', name: 'REMOVE_BANK_ACCOUNT', param: 'user-id' },
    });
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('remove my bank account'));

    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      'Choose an account to remove',
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [[{
            text: '🗑️ Remove Bank Account',
            web_app: { url: expect.stringContaining('/banks/user-id') },
          }]],
        },
      }),
    );
  });

  it('preserves in-memory QR delivery for wallet-address actions', async () => {
    mocks.runCryptoAgent.mockResolvedValue({
      text: 'Your BTC address',
      action: { kind: 'wallet_address', address: 'bc1qexample' },
    });
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('deposit BTC'));

    expect(fake.client.sendPhoto).toHaveBeenCalledWith(
      42,
      expect.any(Uint8Array),
      { caption: '\nYour BTC address', parse_mode: 'Markdown' },
    );
    expect(mocks.appendAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Your BTC address',
    }));
  });

  it('suppresses duplicate Telegram updates before invoking the agent', async () => {
    mocks.claimUserMessage.mockResolvedValueOnce(null);
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('hello'));

    expect(mocks.runCryptoAgent).not.toHaveBeenCalled();
    expect(fake.client.sendMessage).not.toHaveBeenCalled();
    expect(mocks.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it('stores the user-visible error when agent processing fails', async () => {
    vi.useFakeTimers();
    const agentResponse = deferred<{ text: string }>();
    const typingRefresh = deferred<void>();
    mocks.runCryptoAgent.mockReturnValue(agentResponse.promise);
    const fake = createClient();
    vi.mocked(fake.client.sendChatAction)
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(typingRefresh.promise);
    createBot(fake.client);

    const handling = fake.getHandler()(message('hello'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);
    agentResponse.reject(new Error('model unavailable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.client.sendMessage).not.toHaveBeenCalled();

    typingRefresh.resolve();
    await handling;

    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      MESSAGES.ERROR,
      undefined,
    );
    expect(mocks.appendAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: MESSAGES.ERROR,
    }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.client.sendChatAction).toHaveBeenCalledTimes(2);
  });

  it('does not store an assistant response when Telegram delivery fails', async () => {
    mocks.runCryptoAgent.mockResolvedValueOnce({ text: 'Hello' });
    const fake = createClient();
    vi.mocked(fake.client.sendMessage).mockRejectedValue(new Error('telegram down'));
    createBot(fake.client);

    await fake.getHandler()(message('hello'));

    expect(mocks.appendAssistantMessage).not.toHaveBeenCalled();
  });

  it('does not replace a delivered response when assistant persistence fails', async () => {
    mocks.runCryptoAgent.mockResolvedValueOnce({ text: 'Delivered response' });
    mocks.appendAssistantMessage.mockRejectedValueOnce(new Error('database down'));
    const fake = createClient();
    createBot(fake.client);

    await fake.getHandler()(message('hello'));

    expect(fake.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(fake.client.sendMessage).toHaveBeenCalledWith(
      42,
      'Delivered response',
      expect.any(Object),
    );
  });
});
