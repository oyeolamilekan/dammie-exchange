import { describe, expect, it, vi } from 'vitest';
import { validateNgnPayoutRecord, verifyDeposit, verifySwap, verifyWithdrawal } from '../../src/services/financial/provider-verification';
import { buildExecutionDetails } from '../../src/services/financial/swaps/settlement-values';

const deposit = { id: 'dep-1', status: 'accepted', amount: '2.0', currency: 'USDT', txid: 'tx-1', user: { id: 'sub-1' }, payment_address: { network: 'CELO' } };
const local = { user: { subUserId: 'sub-1' }, fromCurrency: 'usdt', toCurrency: 'ngn', fromAmount: '2', quotationId: 'q-1' };
const swap = { id: 'swap-1', status: 'completed', from_currency: 'USDT', to_currency: 'NGN', from_amount: '2', received_amount: '3000', execution_price: '1500', user: { id: 'sub-1' } };
const withdrawal = { id: 'w-1', status: 'Done', reference: 'ref-1', currency: 'NGN', amount: '2800', fee: '0', total: '2800', user: { id: 'sub-1' } };
const withdrawalInput = { id: 'w-1', reference: 'ref-1', ownerId: 'sub-1', expectedAmount: '2800' };

describe('authoritative Quidax requery', () => {
  it('normalizes a deposit using only returned data, including the network', async () => {
    const client = { findDepositById: vi.fn().mockResolvedValue(deposit) };
    expect(await verifyDeposit(client, 'dep-1', 'sub-1')).toMatchObject({ amount: '2', currency: 'usdt', payment_address: { network: 'celo' } });
    expect(client.findDepositById).toHaveBeenCalledWith('sub-1', 'dep-1');
  });
  it.each([null, { ...deposit, id: 'wrong' }, { ...deposit, user: { id: 'wrong' } }, { ...deposit, amount: '-2' }, { ...deposit, status: undefined }])('rejects missing or invalid deposit verification: %j', async (record) => {
    await expect(verifyDeposit({ findDepositById: vi.fn().mockResolvedValue(record) }, 'dep-1', 'sub-1')).rejects.toThrow();
  });
  it('verifies swap identity and normalizes returned amounts', async () => {
    const verified = await verifySwap({ findSwapTransactionById: vi.fn().mockResolvedValue(swap) }, 'swap-1', local);
    expect(buildExecutionDetails(verified)).toMatchObject({ gross: '3000', price: '1500' });
  });
  it.each([{ id: 'wrong' }, { from_amount: '9' }, { to_currency: 'BTC' }, { user: { id: 'wrong' } }, { swap_quotation: { id: 'wrong' } }])('rejects mismatched swap details: %j', async (change) => {
    await expect(verifySwap({ findSwapTransactionById: vi.fn().mockResolvedValue({ ...swap, ...change }) }, 'swap-1', local)).rejects.toThrow();
  });
  it('never falls back to webhook amounts or quoted prices when execution data is missing', () => {
    expect(() => buildExecutionDetails({ status: 'completed' })).toThrow();
    expect(() => buildExecutionDetails({ received_amount: '3000' })).toThrow();
  });
  it('verifies completed withdrawals by the stored reference and accepts a zero fee', async () => {
    const client = { findWithdrawalByReference: vi.fn().mockResolvedValue(withdrawal) };
    expect(await verifyWithdrawal(client, withdrawalInput)).toMatchObject({ amount: '2800', fee: '0', status: 'done' });
    expect(client.findWithdrawalByReference).toHaveBeenCalledWith('sub-1', 'ref-1', 'ngn');
  });
  it('recognizes the provider failed status as a terminal non-successful withdrawal', async () => {
    const client = { findWithdrawalByReference: vi.fn().mockResolvedValue({ ...withdrawal, status: 'Failed' }) };
    await expect(verifyWithdrawal(client, withdrawalInput)).rejects.toThrow('Quidax withdrawal failed: failed');
  });
  it.each([{ status: 'processing' }, { status: 'rejected' }, { id: 'wrong' }, { reference: 'wrong' }, { amount: '9' }, { currency: 'BTC' }, { user: { id: 'wrong' } }, { fee: undefined }, { total: undefined }])('blocks unverified withdrawals: %j', async (change) => {
    await expect(verifyWithdrawal({ findWithdrawalByReference: vi.fn().mockResolvedValue({ ...withdrawal, ...change }) }, withdrawalInput)).rejects.toThrow();
  });

  it('validates processing NGN payouts against the master account and local amount', () => {
    expect(validateNgnPayoutRecord({
      ...withdrawal, status: 'Processing', user: { id: 'main-1' }, fee: '10', total: '2810',
    }, {
      reference: 'ref-1', expectedAmount: '2800', expectedOwnerId: 'main-1', expectedId: 'w-1',
    })).toMatchObject({ status: 'processing', amount: '2800', fee: '10' });
  });

  it('accepts the provider failed status for NGN payout recovery', () => {
    expect(validateNgnPayoutRecord({
      ...withdrawal, status: 'Failed', user: { id: 'main-1' }, fee: '10', total: '2810',
    }, {
      reference: 'ref-1', expectedAmount: '2800', expectedOwnerId: 'main-1', expectedId: 'w-1',
    })).toMatchObject({ status: 'failed', amount: '2800', fee: '10' });
  });

  it.each([
    { user: { id: 'wrong' } },
    { reference: 'wrong' },
    { amount: '9' },
    { status: 'cancelled' },
    { total: '9999' },
  ])('rejects unrelated or inconsistent NGN payout records: %j', (change) => {
    expect(() => validateNgnPayoutRecord({
      ...withdrawal, status: 'Processing', user: { id: 'main-1' }, fee: '10', total: '2810', ...change,
    }, {
      reference: 'ref-1', expectedAmount: '2800', expectedOwnerId: 'main-1', expectedId: 'w-1',
    })).toThrow();
  });
});
