import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, connectDatabase, disconnectDatabase } from '../../src/database';
import { banks } from '../../src/db/schema/bank.schema';
import { accountVersions } from '../../src/db/schema/account-version.schema';
import { chatMessages } from '../../src/db/schema/chat-message.schema';
import { currencies } from '../../src/db/schema/currency.schema';
import { deposits } from '../../src/db/schema/deposit.schema';
import { intents } from '../../src/db/schema/intent.schema';
import { providerEvents } from '../../src/db/schema/provider-event.schema';
import { swaps } from '../../src/db/schema/swap.schema';
import { users } from '../../src/db/schema/user.schema';
import { wallets } from '../../src/db/schema/wallet.schema';
import { withdrawals } from '../../src/db/schema/withdrawal.schema';
import {
  createBank,
  findBanksForUser,
  findDefaultBankForUser,
  removeBankForUser,
} from '../../src/queries/bank.query';
import { aggregateDepositSummary, findDepositPage } from '../../src/queries/deposit.query';
import { claimProviderEventForEnqueue, getQuidaxEventIdentity, persistProviderEvent } from '../../src/queries/provider-event.query';
import {
  appendAssistantChatMessage,
  claimUserChatMessage,
  findChatHistoryPage,
} from '../../src/queries/chat-history.query';
import { aggregateSwapSummary, findSwapPage } from '../../src/queries/swap.query';
import { creditSuccessfulDeposit, recordDepositConfirmation } from '../../src/services/financial/deposits';
import { processApprovedSwap, type ApprovalQuidaxClient } from '../../src/services/financial/swaps/approval';
import { recoverFailedOrReversedSwap } from '../../src/services/financial/swaps/recovery';
import {
  finalizeSuccessfulCustodySweep,
  processCompletedSwapWithdrawal,
  type SettlementQuidaxClient,
} from '../../src/services/financial/swaps/settlement';
import {
  completeNgnWithdrawal,
  lockNgnWithdrawal,
  restoreNgnWithdrawal,
} from '../../src/services/financial/ngn-withdrawals';
import { createWithdrawal } from '../../src/services/financial/withdrawals';

type TestProviderClient = SettlementQuidaxClient;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl && testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL');
}
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('PostgreSQL financial persistence', () => {
  beforeAll(async () => {
    await connectDatabase();
    await migrate(db, { migrationsFolder: 'drizzle' });
  }, 30_000);

  beforeEach(async () => {
    await db.execute(sql.raw(
      'TRUNCATE TABLE provider_events, deposits, swaps, wallet_addresses, wallets, banks, users, intents CASCADE',
    ));
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('classifies the current currency catalog and NGN correctly', async () => {
    const catalog = await db.select({ code: currencies.code, isCrypto: currencies.isCrypto })
      .from(currencies);
    const classification = Object.fromEntries(catalog.map((currency) => [currency.code, currency.isCrypto]));
    expect(classification).toMatchObject({
      cngn: true,
      ngn: false,
      usdc: true,
      usdt: true,
    });
  });

  const fixture = async (walletBalance = '0', lockedBalance = '0') => {
    const currency = (await db.insert(currencies).values({ name: 'Bitcoin', code: 'btc' })
      .onConflictDoUpdate({ target: currencies.code, set: { name: 'Bitcoin' } }).returning())[0];
    const intent = (await db.insert(intents).values({ telegramId: '42', chatId: '42' }).returning())[0];
    const user = (await db.insert(users).values({
      email: 'ada@example.com', firstName: 'Ada', lastName: 'Nwosu',
      bvnNumber: '00000000000', hashedPin: 'hash', telegramId: '42',
      subUserId: 'quidax-user-1', intentId: intent.id, chatId: '42',
    }).returning())[0];
    const wallet = (await db.insert(wallets).values({
      userId: user.id, walletId: 'wallet-1', currencyId: currency.id,
      balance: walletBalance, lockedBalance,
    }).returning())[0];
    const deposit = (await db.insert(deposits).values({
      userId: user.id, walletId: wallet.id, depositId: 'deposit-1',
      txid: 'tx-1', currency: 'btc', amount: '0.25',
    }).returning())[0];
    return { intent, user, wallet, deposit };
  };

  const swapFixture = async (overrides: Partial<typeof swaps.$inferInsert> = {}) => {
    const { user, wallet } = await fixture('0.75', '0.25');
    const ngnCurrency = (await db.select().from(currencies).where(eq(currencies.code, 'ngn')).limit(1))[0];
    const ngnWallet = (await db.insert(wallets).values({
      userId: user.id, currencyId: ngnCurrency.id,
    }).returning())[0];
    const swap = (await db.insert(swaps).values({
      userId: user.id, quotationId: 'quote-1', swapTransactionId: 'swap-transaction-1',
      fromCurrency: 'btc', quotedPrice: '100000', toCurrency: 'ngn',
      fromAmount: '0.25', toAmount: '25000', ...overrides,
    }).returning())[0];
    return { user, wallet, ngnWallet, swap };
  };

  const ngnWithdrawalFixture = async () => {
    const { user } = await fixture();
    const ngnCurrency = (await db.select().from(currencies).where(eq(currencies.code, 'ngn')).limit(1))[0];
    const wallet = (await db.insert(wallets).values({
      userId: user.id,
      currencyId: ngnCurrency.id,
      balance: '1100',
    }).returning())[0];
    const bank = await createBank({
      userId: user.id,
      accountNumber: '0123456789',
      accountName: 'Ada Nwosu',
      bankCode: '058',
    });
    const withdrawal = await createWithdrawal({
      userId: user.id,
      walletId: wallet.id,
      amount: '1000',
      fee: '50',
      reference: `withdrawal-${user.id}`,
    });
    return { user, wallet, bank, withdrawal };
  };

  it('soft-removes a saved bank and promotes the newest remaining account', async () => {
    const { user } = await fixture();
    const first = await createBank({
      userId: user.id,
      accountNumber: '0123456789',
      accountName: 'Ada Nwosu',
      bankCode: '058',
    });
    const second = await createBank({
      userId: user.id,
      accountNumber: '9876543210',
      accountName: 'Ada Nwosu',
      bankCode: '044',
    });

    expect((await findDefaultBankForUser(user.id))?.id).toBe(second.id);
    await expect(removeBankForUser(second.id, user.id)).resolves.toMatchObject({ id: second.id });

    const active = await findBanksForUser(user.id);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: first.id, isDefault: true });
    const removed = (await db.select().from(banks).where(eq(banks.id, second.id)))[0];
    expect(removed.deletedAt).toBeInstanceOf(Date);

    await expect(createBank({
      userId: user.id,
      accountNumber: '9876543210',
      accountName: 'Ada Nwosu',
      bankCode: '044',
    })).resolves.toMatchObject({ isDefault: true });
  });

  it('does not approve a pending withdrawal with a removed bank account', async () => {
    const { user, bank, withdrawal } = await ngnWithdrawalFixture();

    await removeBankForUser(bank.id, user.id);

    await expect(lockNgnWithdrawal(withdrawal.id, user.id, bank.id)).resolves.toEqual({
      outcome: 'bank-not-found',
    });
  });

  it('locks amount plus fee and consumes the hold exactly once on payout success', async () => {
    const { user, wallet, bank, withdrawal } = await ngnWithdrawalFixture();
    await expect(lockNgnWithdrawal(withdrawal.id, user.id, bank.id)).resolves.toMatchObject({
      outcome: 'locked', total: '1050',
    });
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '50.000000000000000000',
      lockedBalance: '1050.000000000000000000',
    });
    await db.update(withdrawals).set({ status: 'processing' }).where(eq(withdrawals.id, withdrawal.id));
    expect((await completeNgnWithdrawal(withdrawal.id, '10'))?.changed).toBe(true);
    expect((await completeNgnWithdrawal(withdrawal.id, '10'))?.changed).toBe(false);
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '50.000000000000000000',
      lockedBalance: '0.000000000000000000',
    });
    const actions = (await db.select().from(accountVersions))
      .filter((version) => version.transactionId === withdrawal.id)
      .map((version) => version.action);
    expect(actions).toHaveLength(2);
    expect(actions).toEqual(expect.arrayContaining(['withdrawal_lock', 'withdrawal_complete']));
  });

  it('restores amount plus fee exactly once after a rejected payout', async () => {
    const { user, wallet, bank, withdrawal } = await ngnWithdrawalFixture();
    const providerResponse = {
      status: 'error',
      data: { code: '110112', message: 'Withdrawal does not exist' },
    };
    await lockNgnWithdrawal(withdrawal.id, user.id, bank.id);
    await db.update(withdrawals).set({ status: 'processing' }).where(eq(withdrawals.id, withdrawal.id));
    expect((await restoreNgnWithdrawal(withdrawal.id, '10', 'Rejected', providerResponse))?.changed).toBe(true);
    expect((await restoreNgnWithdrawal(withdrawal.id, '10', 'Rejected', providerResponse))?.changed).toBe(false);
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '1100.000000000000000000',
      lockedBalance: '0.000000000000000000',
    });
    expect((await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id)))[0])
      .toMatchObject({
        status: 'failed',
        failureReason: 'Rejected',
        providerResponse: { payoutVerification: providerResponse },
      });
  });

  it('restores a legacy pending withdrawal when its lock record exists', async () => {
    const { user, wallet, bank, withdrawal } = await ngnWithdrawalFixture();
    await lockNgnWithdrawal(withdrawal.id, user.id, bank.id);
    await db.update(withdrawals).set({
      approvedAt: null,
      bankId: null,
      accountNumber: null,
      accountName: null,
      bankCode: null,
    }).where(eq(withdrawals.id, withdrawal.id));

    expect((await restoreNgnWithdrawal(
      withdrawal.id,
      '0',
      'Withdrawal does not exist',
      { status: 'error', data: { code: '110112' } },
    ))?.changed).toBe(true);
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '1100.000000000000000000',
      lockedBalance: '0.000000000000000000',
    });
    expect((await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id)))[0])
      .toMatchObject({ status: 'failed', failureReason: 'Withdrawal does not exist' });
  });

  it('fails an unlocked pending withdrawal without crediting the wallet', async () => {
    const { wallet, withdrawal } = await ngnWithdrawalFixture();
    expect((await restoreNgnWithdrawal(
      withdrawal.id,
      '0',
      'Withdrawal does not exist',
      { status: 'error', data: { code: '110112' } },
    ))?.changed).toBe(true);
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '1100.000000000000000000',
      lockedBalance: '0.000000000000000000',
    });
    expect((await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id)))[0])
      .toMatchObject({
        status: 'failed',
        failureReason: 'Withdrawal does not exist',
        providerResponse: {
          payoutVerification: { status: 'error', data: { code: '110112' } },
        },
      });
  });

  it('credits a deposit exactly once across concurrent deliveries', async () => {
    const { wallet } = await fixture();
    const results = await Promise.all(Array.from({ length: 20 }, () => creditSuccessfulDeposit({
      id: 'deposit-1', amount: '0.25', currency: 'btc', user: { id: 'quidax-user-1' },
    })));
    expect(results.filter((result) => result.credited)).toHaveLength(1);
    expect((await db.select().from(deposits).where(eq(deposits.depositId, 'deposit-1')))[0].status).toBe('success');
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0].balance).toBe('0.250000000000000000');
  });

  it('creates and credits a missing deposit once across concurrent uppercase success deliveries', async () => {
    const { wallet, deposit } = await fixture();
    await db.delete(deposits).where(eq(deposits.id, deposit.id));
    const payload = { id: 'deposit-1', txid: 'tx-1', amount: '0.25', currency: ' BTC ', user: { id: 'quidax-user-1' } };
    const results = await Promise.all(Array.from({ length: 10 }, () => creditSuccessfulDeposit(payload)));
    expect(results.filter((result) => result.credited)).toHaveLength(1);
    expect(await db.select().from(deposits)).toEqual([expect.objectContaining({ currency: 'btc', status: 'success', txid: 'tx-1' })]);
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0].balance).toBe('0.250000000000000000');
    expect(await db.select().from(accountVersions)).toHaveLength(1);
    expect(await recordDepositConfirmation({ ...payload, payment_address: { network: 'bitcoin' } })).toEqual({ recorded: false });
  });

  it('handles confirmation and success racing to create the same deposit', async () => {
    const { deposit } = await fixture();
    await db.delete(deposits).where(eq(deposits.id, deposit.id));
    const payload = { id: 'deposit-1', txid: 'tx-1', amount: '0.25', currency: 'BTC', user: { id: 'quidax-user-1' }, payment_address: { network: 'bitcoin' } };
    await Promise.all([recordDepositConfirmation(payload), creditSuccessfulDeposit(payload)]);
    expect(await db.select().from(deposits)).toEqual([expect.objectContaining({ status: 'success' })]);
    expect(await db.select().from(accountVersions)).toHaveLength(1);
  });

  it.each([
    { amount: '0.5' }, { currency: 'USDT' }, { txid: 'different-tx' },
    { user: { id: 'unknown-user' } },
  ])('rejects conflicting success data without crediting or replacing the deposit: %j', async (override) => {
    const { wallet } = await fixture();
    await expect(creditSuccessfulDeposit({
      id: 'deposit-1', txid: 'tx-1', amount: '0.25', currency: 'BTC', user: { id: 'quidax-user-1' }, ...override,
    })).rejects.toThrow();
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0].balance).toBe('0.000000000000000000');
    expect(await db.select().from(accountVersions)).toHaveLength(0);
    expect(await db.select().from(deposits)).toEqual([expect.objectContaining({ status: 'pending' })]);
  });

  it('saves a verified network on an existing credited deposit without a second credit', async () => {
    const { wallet } = await fixture();
    const payload = { id: 'deposit-1', txid: 'tx-1', amount: '0.25', currency: 'BTC', user: { id: 'quidax-user-1' } };
    await creditSuccessfulDeposit(payload);
    expect(await creditSuccessfulDeposit({ ...payload, network: 'bitcoin' })).toEqual({ credited: false });
    expect((await db.select().from(deposits))[0].network).toBe('bitcoin');
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0].balance).toBe('0.250000000000000000');
    expect(await db.select().from(accountVersions)).toHaveLength(1);
    await expect(creditSuccessfulDeposit({ ...payload, network: 'different-network' })).rejects.toThrow('network conflicts');
  });

  it('does not create a missing deposit without a transaction ID', async () => {
    const { deposit } = await fixture();
    await db.delete(deposits).where(eq(deposits.id, deposit.id));
    await expect(creditSuccessfulDeposit({ id: 'deposit-1', amount: '0.25', currency: 'BTC', user: { id: 'quidax-user-1' } }))
      .rejects.toThrow('transaction ID');
    expect(await db.select().from(deposits)).toHaveLength(0);
    expect(await db.select().from(accountVersions)).toHaveLength(0);
  });

  it('rolls back a deposit transition when the wallet belongs to another user', async () => {
    const { deposit, wallet } = await fixture();
    const otherIntent = (await db.insert(intents).values({ telegramId: '99', chatId: '99' }).returning())[0];
    const otherUser = (await db.insert(users).values({
      email: 'other@example.com', firstName: 'Other', lastName: 'User', bvnNumber: '1',
      hashedPin: 'hash', telegramId: '99', subUserId: 'quidax-other', intentId: otherIntent.id, chatId: '99',
    }).returning())[0];
    const otherWallet = (await db.insert(wallets).values({
      userId: otherUser.id, currencyId: wallet.currencyId,
    }).returning())[0];
    await db.update(deposits).set({ walletId: otherWallet.id }).where(eq(deposits.id, deposit.id));

    await expect(creditSuccessfulDeposit({
      id: 'deposit-1', amount: '0.25', currency: 'btc', user: { id: 'quidax-user-1' },
    })).rejects.toThrow('wallet relationship');
    expect((await db.select().from(deposits).where(eq(deposits.id, deposit.id)))[0].status).toBe('pending');
  });

  it('persists and atomically claims one provider event', async () => {
    const identity = getQuidaxEventIdentity({ event: 'deposit.successful', data: { id: 'deposit-1' } });
    await Promise.all(Array.from({ length: 20 }, () => persistProviderEvent(identity)));
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimProviderEventForEnqueue(identity.correlationId)));
    expect(await db.select().from(providerEvents)).toHaveLength(1);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.attempts).toBe(1);
  });

  it('claims a Telegram user message exactly once across concurrent deliveries', async () => {
    const intent = (await db.insert(intents).values({
      telegramId: 'chat-42',
      chatId: 'chat-42',
    }).returning())[0];
    const input = {
      intentId: intent.id,
      turnId: '018f7d22-7c3d-4a9e-8f6b-123456789abc',
      telegramMessageId: 7,
      content: 'show my balance',
    };

    const claims = await Promise.all(
      Array.from({ length: 20 }, () => claimUserChatMessage(input)),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(chatMessages)).toHaveLength(1);
  });

  it('reads isolated chat history with stable createdAt/id pagination and cascades with intent', async () => {
    const [intent, otherIntent] = await Promise.all([
      db.insert(intents).values({ telegramId: 'chat-a', chatId: 'chat-a' }).returning()
        .then((rows) => rows[0]),
      db.insert(intents).values({ telegramId: 'chat-b', chatId: 'chat-b' }).returning()
        .then((rows) => rows[0]),
    ]);
    const createdAt = new Date('2026-08-30T00:00:00.000Z');
    const rows = [
      '018f7d22-7c3d-4a9e-8f6b-123456789a03',
      '018f7d22-7c3d-4a9e-8f6b-123456789a02',
      '018f7d22-7c3d-4a9e-8f6b-123456789a01',
    ].map((id, index) => ({
      id,
      intentId: intent.id,
      turnId: `018f7d22-7c3d-4a9e-8f6b-123456789b0${index + 1}`,
      role: 'assistant' as const,
      content: `message-${index + 1}`,
      createdAt,
    }));
    await db.insert(chatMessages).values(rows);
    await appendAssistantChatMessage({
      intentId: otherIntent.id,
      turnId: '018f7d22-7c3d-4a9e-8f6b-123456789c01',
      content: 'other conversation',
    });

    const firstPage = await findChatHistoryPage(intent.id, { limit: 2 });
    expect(firstPage.items.map(({ id }) => id)).toEqual([
      '018f7d22-7c3d-4a9e-8f6b-123456789a03',
      '018f7d22-7c3d-4a9e-8f6b-123456789a02',
    ]);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await findChatHistoryPage(intent.id, {
      cursor: firstPage.nextCursor,
      limit: 2,
    });
    expect(secondPage.items.map(({ id }) => id)).toEqual([
      '018f7d22-7c3d-4a9e-8f6b-123456789a01',
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(firstPage.items.some(({ intentId }) => intentId === otherIntent.id))
      .toBe(false);

    await db.delete(intents).where(eq(intents.id, intent.id));
    expect(await db.select().from(chatMessages).where(
      eq(chatMessages.intentId, intent.id),
    )).toHaveLength(0);
  });

  it('restores locked funds exactly once for concurrent recovery events', async () => {
    const { wallet, swap } = await swapFixture();
    const payload = { event: 'swap_transaction.failed' as const, data: { id: 'swap-transaction-1' } };
    const results = await Promise.all(Array.from({ length: 20 }, () => recoverFailedOrReversedSwap(payload)));
    expect(results.filter((result) => result.outcome === 'restored')).toHaveLength(1);
    expect((await db.select().from(swaps).where(eq(swaps.id, swap.id)))[0].status).toBe('failed');
    const storedWallet = (await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0];
    expect(storedWallet.balance).toBe('1.000000000000000000');
    expect(storedWallet.lockedBalance).toBe('0.000000000000000000');
  });

  it('confirms and locks one swap across concurrent approval jobs', async () => {
    const { wallet, swap } = await swapFixture({ swapTransactionId: null });
    await db.update(wallets).set({ balance: '1', lockedBalance: '0' }).where(eq(wallets.id, wallet.id));
    let transaction: { id: string } | null = null;
    const client: ApprovalQuidaxClient = {
      refreshInstantSwap: vi.fn(async () => undefined),
      confirmInstantSwap: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        transaction = { id: 'confirmed-1' };
        return transaction;
      }),
      findSwapTransactionByQuotation: vi.fn(async () => {
        for (let attempt = 0; attempt < 20 && !transaction; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return transaction;
      }),
    };
    await Promise.all(Array.from({ length: 20 }, () => processApprovedSwap(swap.id, client)));
    expect(client.confirmInstantSwap).toHaveBeenCalledTimes(1);
    const storedWallet = (await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0];
    expect(storedWallet.balance).toBe('0.750000000000000000');
    expect(storedWallet.lockedBalance).toBe('0.250000000000000000');
  });

  if (testDatabaseUrl) {
  it('reconciles an approval already claimed by another worker', async () => {
    const { wallet, swap } = await swapFixture({
      approvalStatus: 'processing',
      swapTransactionId: null,
    });
    const client: ApprovalQuidaxClient = {
      refreshInstantSwap: vi.fn(),
      confirmInstantSwap: vi.fn(),
      findSwapTransactionByQuotation: vi.fn().mockResolvedValue({ id: 'reconciled-1' }),
    };

    await expect(processApprovedSwap(swap.id, client)).resolves.toBe('reconciled');
    expect(client.confirmInstantSwap).not.toHaveBeenCalled();
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '0.500000000000000000',
      lockedBalance: '0.500000000000000000',
    });
  });

  it('reconciles a custody sweep whose provider reference already exists', async () => {
    await swapFixture({
      swapStatus: 'processing',
      sweepReference: 'dammie-sweep-existing',
    });
    const client: TestProviderClient = {
      createWithdrawal: vi.fn(),
      findWithdrawalByReference: vi.fn().mockResolvedValue({ id: 'sweep-existing', reference: 'dammie-sweep-existing', status: 'done' }),
      findSwapTransactionById: vi.fn().mockResolvedValue({ id: 'swap-transaction-1', status: 'completed', from_currency: 'BTC', to_currency: 'NGN', from_amount: '0.25', received_amount: '25000', execution_price: '100000', user: { id: 'quidax-user-1' } }),
    };

    await expect(processCompletedSwapWithdrawal(
      { id: 'swap-transaction-1', received_amount: '25000' },
      client,
      'main',
    )).resolves.toBe('reconciled');
    expect(client.createWithdrawal).not.toHaveBeenCalled();
  });

  it('marks settlement conflicts for reconciliation without restoring funds', async () => {
    const { wallet, swap } = await swapFixture({
      status: 'success',
      sweepReference: 'dammie-sweep-started',
    });

    await expect(recoverFailedOrReversedSwap({
      event: 'swap_transaction.failed',
      data: { id: 'swap-transaction-1' },
    })).resolves.toEqual({ outcome: 'reconciliation-required' });
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '0.750000000000000000',
      lockedBalance: '0.250000000000000000',
    });
    expect((await db.select().from(swaps).where(eq(swaps.id, swap.id)))[0]).toMatchObject({
      reconciliationRequired: true,
      status: 'success',
    });
  });

  it('does not create a second custody operation for duplicate completion delivery', async () => {
    await swapFixture();
    const client: TestProviderClient = {
      createWithdrawal: vi.fn().mockResolvedValue({ id: 'sweep-duplicate' }),
      findWithdrawalByReference: vi.fn().mockResolvedValue({ id: 'sweep-duplicate' }),
      findSwapTransactionById: vi.fn().mockResolvedValue({ id: 'swap-transaction-1', status: 'completed', from_currency: 'BTC', to_currency: 'NGN', from_amount: '0.25', received_amount: '25000', execution_price: '100000', user: { id: 'quidax-user-1' } }),
    };

    await processCompletedSwapWithdrawal({ id: 'swap-transaction-1', received_amount: '25000' }, client, 'main');
    await processCompletedSwapWithdrawal({ id: 'swap-transaction-1', received_amount: '25000' }, client, 'main');

    expect(client.createWithdrawal).toHaveBeenCalledTimes(1);
  });

  it('rolls back an approval mutation when wallet validation fails inside its transaction', async () => {
    const { wallet, swap } = await swapFixture({ swapTransactionId: null });
    await db.update(wallets).set({ balance: '0', lockedBalance: '0' }).where(eq(wallets.id, wallet.id));
    const client: ApprovalQuidaxClient = {
      refreshInstantSwap: vi.fn().mockResolvedValue(undefined),
      confirmInstantSwap: vi.fn().mockResolvedValue({ id: 'confirmed-rollback' }),
      findSwapTransactionByQuotation: vi.fn(),
    };

    await expect(processApprovedSwap(swap.id, client)).rejects.toThrow('wallet state');
    expect((await db.select().from(swaps).where(eq(swaps.id, swap.id)))[0].approvalStatus).toBe('processing');
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0]).toMatchObject({
      balance: '0.000000000000000000',
      lockedBalance: '0.000000000000000000',
    });
    expect(await db.select().from(accountVersions)).toHaveLength(0);
  });
  }

  it('maintains one deterministic default bank per user', async () => {
    const { user } = await fixture();
    await createBank({ userId: user.id, accountNumber: '0123456789', accountName: 'Ada Nwosu', bankCode: '001' });
    await createBank({ userId: user.id, accountNumber: '9876543210', accountName: 'Ada Nwosu', bankCode: '002' });
    expect((await db.select().from(banks).where(eq(banks.userId, user.id))).filter((bank) => bank.isDefault)).toHaveLength(1);
    expect((await findDefaultBankForUser(user.id))?.accountNumber).toBe('9876543210');
  });

  it('creates one sweep, then credits the gross NGN proceeds exactly once', async () => {
    const { wallet, ngnWallet, swap } = await swapFixture();
    let providerRecord: { id: string } | null = null;
    const client: TestProviderClient = {
      createWithdrawal: vi.fn(async () => (providerRecord = { id: 'sweep-1' })),
      findWithdrawalByReference: vi.fn(async (_owner: string, reference: string) => providerRecord ? { ...providerRecord, reference, status: 'done' } : null),
      findSwapTransactionById: vi.fn().mockResolvedValue({ id: 'swap-transaction-1', status: 'completed', from_currency: 'BTC', to_currency: 'NGN', from_amount: '0.25', received_amount: '25000', execution_price: '100000', user: { id: 'quidax-user-1' } }),
    };
    await processCompletedSwapWithdrawal({ id: 'swap-transaction-1', received_amount: '25000' }, client, 'main');
    expect((await db.select().from(wallets).where(eq(wallets.id, ngnWallet.id)))[0].balance)
      .toBe('0.000000000000000000');
    const credits = await Promise.all(Array.from({ length: 10 }, () => finalizeSuccessfulCustodySweep('sweep-1')));
    expect(client.createWithdrawal).toHaveBeenCalledTimes(1);
    expect(credits.filter((result) => result.credited)).toHaveLength(1);
    expect((await db.select().from(wallets).where(eq(wallets.id, ngnWallet.id)))[0].balance)
      .toBe('25000.000000000000000000');
    expect((await db.select().from(wallets).where(eq(wallets.id, wallet.id)))[0].lockedBalance).toBe('0.000000000000000000');
    expect((await db.select().from(swaps).where(eq(swaps.id, swap.id)))[0].status).toBe('success');
  });

  it('paginates by timestamp and UUID and aggregates exact decimal strings', async () => {
    const { user, wallet } = await fixture();
    await db.delete(deposits).where(eq(deposits.userId, user.id));
    await db.insert(deposits).values(Array.from({ length: 25 }, (_, index) => ({
      userId: user.id, walletId: wallet.id, depositId: `deposit-${index}`, txid: `tx-${index}`,
      status: 'success' as const, currency: 'btc', amount: '0.1',
      createdAt: new Date('2026-08-29T12:00:00Z'), updatedAt: new Date('2026-08-29T12:00:00Z'),
    })));
    await db.insert(swaps).values([
      { userId: user.id, quotationId: 'q1', fromCurrency: 'btc', toCurrency: 'ngn', quotedPrice: '1', fromAmount: '0.25', toAmount: '1000', status: 'success' },
      { userId: user.id, quotationId: 'q2', fromCurrency: 'btc', toCurrency: 'ngn', quotedPrice: '1', fromAmount: '0.75', toAmount: '100', status: 'success' },
    ]);
    const first = await findDepositPage({ userId: user.id });
    const second = await findDepositPage({ userId: user.id }, { cursor: first.nextCursor });
    const third = await findDepositPage({ userId: user.id }, { cursor: second.nextCursor });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([10, 10, 5]);
    expect(new Set([...first.items, ...second.items, ...third.items].map((row) => row.id))).toHaveLength(25);
    expect(await aggregateDepositSummary({ userId: user.id, status: 'success' })).toMatchObject({ totalAmount: '2.5', transactionCount: 25 });
    expect(await aggregateSwapSummary({ userId: user.id, status: 'success' })).toMatchObject({
      totalFromAmount: '1', totalToAmount: '1100', totalNairaAmount: '1100', transactionCount: 2,
    });
    expect((await findSwapPage({ userId: user.id })).items).toHaveLength(2);
  });
});
