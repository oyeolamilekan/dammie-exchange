import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ find: vi.fn(), claim: vi.fn(), recover: vi.fn(), reconcile: vi.fn(), persist: vi.fn(), flag: vi.fn() }));
vi.mock('../../src/queries/swap.query', () => ({ findSwap: mocks.find }));
vi.mock('../../src/services/financial/swaps/recovery', () => ({ recoverFailedOrReversedSwap: mocks.recover }));
vi.mock('../../src/services/financial/swaps/settlement-store', () => ({
  commitVerifiedExecutionAndClaimSweep: mocks.claim,
  creditSuccessfulCustodySweep: vi.fn(),
  markSwapAsReconciliationRequired: mocks.flag,
  persistCreatedSweepWithdrawal: mocks.persist,
  persistReconciledSweepWithdrawal: mocks.reconcile,
}));
import { processCompletedSwapWithdrawal } from '../../src/services/financial/swaps/settlement';
const local = { id: 'local-1', user: { subUserId: 'sub-1' }, fromCurrency: 'usdt', toCurrency: 'ngn', fromAmount: '2', quotationId: 'quote-1', status: 'pending', swapStatus: 'pending' };
const transaction = { id: 'swap-1', status: 'completed', user: { id: 'sub-1' }, from_currency: 'usdt', to_currency: 'ngn', from_amount: '2', received_amount: '3000', execution_price: '1500' };
const client = { findSwapTransactionById: vi.fn(), findWithdrawalByReference: vi.fn(), createWithdrawal: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(local);
  client.findSwapTransactionById.mockResolvedValue(transaction);
  mocks.claim.mockResolvedValue({ outcome: 'claimed', gross: '3000', reference: 'ref-1' });
  mocks.persist.mockResolvedValue(true);
  client.createWithdrawal.mockResolvedValue({ id: 'sweep-1' });
  mocks.recover.mockResolvedValue({ outcome: 'restored' });
});
describe('swap processing from verified provider status', () => {
  it('ignores webhook execution amounts and re-queries on every attempt', async () => {
    await processCompletedSwapWithdrawal({ id: 'swap-1', received_amount: '999999', execution_price: '999' }, client, 'main');
    expect(mocks.claim).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({ gross: '3000', price: '1500' }),
      transaction,
    );
    expect(client.createWithdrawal).toHaveBeenCalledWith('sub-1', expect.objectContaining({ amount: '3000' }));
    await processCompletedSwapWithdrawal({ id: 'swap-1' }, client, 'main');
    expect(client.findSwapTransactionById).toHaveBeenCalledTimes(2);
  });
  it.each(['failed', 'reversed'])('uses verified %s status to recover instead of settling', async (status) => {
    client.findSwapTransactionById.mockResolvedValue({ ...transaction, status, received_amount: '0', execution_price: null });
    expect(await processCompletedSwapWithdrawal({ id: 'swap-1', received_amount: '999' }, client, 'main')).toBe('restored');
    expect(mocks.recover).toHaveBeenCalledWith({ event: `swap_transaction.${status}`, data: { id: 'swap-1' } });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(client.createWithdrawal).not.toHaveBeenCalled();
  });
  it.each(['pending', 'processing', 'unknown'])('leaves %s statuses retryable without mutation', async (status) => {
    client.findSwapTransactionById.mockResolvedValue({ ...transaction, status });
    await expect(processCompletedSwapWithdrawal({ id: 'swap-1' }, client, 'main')).rejects.toThrow('not completed');
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(client.createWithdrawal).not.toHaveBeenCalled();
  });
  it('does not reconcile an existing sweep unless the swap and withdrawal verify', async () => {
    mocks.find.mockResolvedValue({ ...local, swapStatus: 'processing', sweepReference: 'ref-1' });
    client.findWithdrawalByReference.mockResolvedValue({ id: 'sweep-1', reference: 'ref-1', status: 'rejected' });
    await expect(processCompletedSwapWithdrawal({ id: 'swap-1' }, client, 'main')).rejects.toThrow('reconciliation');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('never falls back to webhook values when the API omits execution details', async () => {
    client.findSwapTransactionById.mockResolvedValue({ ...transaction, received_amount: undefined });
    await expect(processCompletedSwapWithdrawal({ id: 'swap-1', received_amount: '999' }, client, 'main')).rejects.toThrow('amount');
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
