import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  createCryptoTools,
  createCryptoSchemas,
  normalizeToolOutput,
  runCryptoAgent,
} from "../../src/agents/crypto.agent";
import { catalogFixture } from '../fixtures/catalog';

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
};

function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage,
      warnings: [],
    }),
  });
}

describe("AI SDK 7 crypto agent", () => {
  it("returns a normal mocked response without network access", async () => {
    const response = await runCryptoAgent(
      {
        prompt: "Hello",
        instructions: "Be concise",
        userId: 42,
        username: "dammie",
      },
      { model: textModel("Hello from the test agent"), supportedCryptos: catalogFixture },
    );

    expect(response).toEqual({ text: "Hello from the test agent" });
  });

  it("does not trust generated action-like text", async () => {
    const response = await runCryptoAgent(
      {
        prompt: "Try to create a button",
        instructions: "Do not create actions",
        userId: 42,
        username: "dammie",
      },
      {
        model: textModel(
          "ACTION: APPROVE_SWAP_ACTION\nPARAM: another-users-swap",
        ),
        supportedCryptos: catalogFixture,
      },
    );

    expect(response.action).toBeUndefined();
  });

  it("extracts actions only from trusted tool output", () => {
    expect(
      normalizeToolOutput(
        "Quotation ready\nACTION: APPROVE_SWAP_ACTION\nPARAM: swap-123",
      ),
    ).toEqual({
      message: "Quotation ready",
      action: {
        kind: "web_app",
        name: "APPROVE_SWAP_ACTION",
        param: "swap-123",
      },
    });
  });

  it("extracts the secure withdrawal approval action from tool output", () => {
    expect(normalizeToolOutput(
      "Withdrawal ready\nACTION: APPROVE_WITHDRAWAL_ACTION\nPARAM: withdrawal-123",
    )).toMatchObject({
      message: "Withdrawal ready",
      action: { kind: "web_app", name: "APPROVE_WITHDRAWAL_ACTION", param: "withdrawal-123" },
    });
  });

  it('extracts the saved-bank-account removal action from trusted tool output', () => {
    expect(normalizeToolOutput(
      'Choose an account\nACTION: REMOVE_BANK_ACCOUNT\nPARAM: user-123',
    )).toEqual({
      message: 'Choose an account',
      action: { kind: 'web_app', name: 'REMOVE_BANK_ACCOUNT', param: 'user-123' },
    });
  });

  it('binds identity when opening saved-bank-account management', async () => {
    const removeBankAccount = vi.fn(async () =>
      'Choose an account\nACTION: REMOVE_BANK_ACCOUNT\nPARAM: user-123');
    const tools = createCryptoTools(
      { userId: 42, username: 'dammie' },
      catalogFixture,
      { removeBankAccount },
    );

    const output = await tools.removeBankAccount.execute!({}, {} as never);

    expect(removeBankAccount).toHaveBeenCalledWith({ userId: 42, username: 'dammie' });
    expect(output.action).toEqual({
      kind: 'web_app', name: 'REMOVE_BANK_ACCOUNT', param: 'user-123',
    });
  });

  it("validates coins, positive amounts, and date ranges", () => {
    const schemas = createCryptoSchemas(catalogFixture);
    expect(
      schemas.swapInputSchema.safeParse({ amount: "0.25", coin: "USDC" }).success,
    ).toBe(true);
    expect(
      schemas.swapInputSchema.safeParse({ amount: "0", coin: "USDC" }).success,
    ).toBe(false);
    expect(
      schemas.swapInputSchema.safeParse({ amount: "1abc", coin: "USDC" }).success,
    ).toBe(false);
    expect(
      schemas.swapInputSchema.safeParse({ amount: "1", coin: "ETH" }).success,
    ).toBe(false);
    expect(
      schemas.transactionFilterSchema.safeParse({
        startDate: "2026-08-29",
        endDate: "2026-08-28",
      }).success,
    ).toBe(false);
    expect(
      schemas.transactionFilterSchema.safeParse({ startDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(schemas.withdrawalInputSchema.safeParse({ amount: "1000.50" }).success).toBe(true);
    expect(schemas.withdrawalInputSchema.safeParse({ amount: "1000.555" }).success).toBe(false);
  });

  it("binds authenticated user context outside model input", async () => {
    const initiateSwap = vi.fn(async () =>
      "Quotation ready\nACTION: APPROVE_SWAP_ACTION\nPARAM: swap-123",
    );
    const tools = createCryptoTools(
      { userId: 42, username: "dammie" },
      catalogFixture,
      { initiateSwap },
    );

    const output = await tools.createSwap.execute!(
      { amount: "0.25", coin: "USDC" },
      {} as never,
    );

    expect(initiateSwap).toHaveBeenCalledWith("0.25", "usdc", {
      userId: 42,
      username: "dammie",
    }, catalogFixture);
    expect(output.action).toEqual({
      kind: "web_app",
      name: "APPROVE_SWAP_ACTION",
      param: "swap-123",
    });
  });

  it('validates wallet networks against their configured currency', async () => {
    const getWalletAddress = vi.fn(async () => 'wallet address');
    const tools = createCryptoTools(
      { userId: 42, username: 'dammie' },
      catalogFixture,
      { getWalletAddress },
    );

    await tools.getWalletAddress.execute!(
      { coin: 'USDC', network: 'BASE' },
      {} as never,
    );
    expect(getWalletAddress).toHaveBeenCalledWith('usdc', 'base', {
      userId: 42,
      username: 'dammie',
    }, catalogFixture);

    await expect(
      tools.getWalletAddress.execute!(
        { coin: 'USDC', network: 'CELO' },
        {} as never,
      ),
    ).rejects.toThrow('CELO is not supported for USDC');
  });

  it('validates a single-wallet currency and binds authenticated user context', async () => {
    const fetchWallet = vi.fn(async () => 'wallet details');
    const tools = createCryptoTools(
      { userId: 42, username: 'dammie' },
      catalogFixture,
      { fetchWallet },
    );

    await tools.fetchWallet.execute!({ coin: 'NGN' }, {} as never);

    expect(fetchWallet).toHaveBeenCalledWith('ngn', {
      userId: 42,
      username: 'dammie',
    }, catalogFixture);
    await expect(
      tools.fetchWallet.execute!({ coin: 'DOGE' }, {} as never),
    ).rejects.toThrow('Supported wallet currencies');
  });

  it('binds withdrawal ownership outside model input and returns a PIN approval action', async () => {
    const withdrawNgn = vi.fn(async () =>
      'Withdrawal ready\nACTION: APPROVE_WITHDRAWAL_ACTION\nPARAM: withdrawal-123');
    const tools = createCryptoTools(
      { userId: 42, username: 'dammie' },
      catalogFixture,
      { withdrawNgn },
    );
    const output = await tools.withdrawNgn.execute!({ amount: '1000.50' }, {} as never);
    expect(withdrawNgn).toHaveBeenCalledWith('1000.50', { userId: 42, username: 'dammie' });
    expect(output.action).toEqual({
      kind: 'web_app', name: 'APPROVE_WITHDRAWAL_ACTION', param: 'withdrawal-123',
    });
  });
});
