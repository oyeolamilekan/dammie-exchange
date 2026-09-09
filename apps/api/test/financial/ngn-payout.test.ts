import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  save: vi.fn(),
  complete: vi.fn(),
  restore: vi.fn(),
  owner: vi.fn(),
  findByProviderId: vi.fn(),
}));

vi.mock('../../src/config/config', () => ({ default: { MAIN_ACCOUNT_ID: 'main-1' } }));
vi.mock('../../src/services/financial/ngn-withdrawals', () => ({
  claimApprovedNgnWithdrawal: mocks.claim,
  saveNgnProviderWithdrawal: mocks.save,
  completeNgnWithdrawal: mocks.complete,
  restoreNgnWithdrawal: mocks.restore,
  findNgnWithdrawalOwner: mocks.owner,
}));
vi.mock('../../src/services/financial/withdrawals', () => ({
  findWithdrawalByProviderId: mocks.findByProviderId,
}));

import { processApprovedNgnWithdrawal, settleNgnPayoutWebhook } from '../../src/services/financial/ngn-payouts';
import { QuidaxWithdrawalNotFoundError } from '../../src/services/integrations/quidax';

const withdrawal = {
  id: 'withdrawal-1',
  amount: '1000',
  fee: '50',
  status: 'processing',
  reference: 'ngn-withdrawal-ref',
  bankId: 'bank-1',
  accountNumber: '0123456789',
  accountName: 'Ada Nwosu',
  bankCode: '058',
  approvedAt: new Date(),
  providerWithdrawalId: null,
};
const providerRecord = {
  id: 'provider-1',
  reference: 'ngn-withdrawal-ref',
  currency: 'NGN',
  amount: '1000.00',
  fee: '10',
  total: '1010',
  status: 'Processing',
  user: { id: 'main-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claim.mockResolvedValue(withdrawal);
  mocks.save.mockResolvedValue(withdrawal);
  mocks.owner.mockResolvedValue({ chatId: '42', withdrawal, bankName: 'Guaranty Trust Bank' });
  mocks.complete.mockResolvedValue({ changed: true, withdrawal, total: '1050' });
  mocks.restore.mockResolvedValue({ changed: true, withdrawal, total: '1050' });
});

describe('NGN provider payout orchestration', () => {
  it('reconciles before creating and sends the saved bank snapshot from the master account', async () => {
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue(null),
      createWithdrawal: vi.fn().mockResolvedValue(providerRecord),
    };
    await expect(processApprovedNgnWithdrawal('withdrawal-1', client)).resolves.toBe('processing');
    expect(client.findWithdrawalByReference).toHaveBeenCalledWith('me', 'ngn-withdrawal-ref', 'ngn');
    expect(client.createWithdrawal).toHaveBeenCalledWith('me', expect.objectContaining({
      currency: 'ngn', amount: '1000', fund_uid: '0123456789', fund_uid2: '058',
      reference: 'ngn-withdrawal-ref',
    }));
    expect(mocks.save).toHaveBeenCalledWith(
      'withdrawal-1',
      'provider-1',
      '10',
      expect.objectContaining({ id: 'provider-1', reference: 'ngn-withdrawal-ref', status: 'processing' }),
      'payoutCreation',
    );
  });

  it('completes a reconciled successful payout without creating another transfer', async () => {
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue({ ...providerRecord, status: 'Done' }),
      createWithdrawal: vi.fn(),
    };
    await expect(processApprovedNgnWithdrawal('withdrawal-1', client)).resolves.toBe('success');
    expect(client.createWithdrawal).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith('withdrawal-1', '10');
  });

  it('restores funds when the provider reports the new failed status', async () => {
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue({ ...providerRecord, status: 'Failed' }),
      createWithdrawal: vi.fn(),
    };
    await expect(processApprovedNgnWithdrawal('withdrawal-1', client)).resolves.toBe('failed');
    expect(mocks.restore).toHaveBeenCalledWith('withdrawal-1', '10', undefined);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('fails and refunds a missing provider withdrawal in reconciliation mode', async () => {
    const providerResponse = {
      status: 'error',
      message: 'withdrawal with reference ngn-withdrawal-ref does not exist ',
      data: {
        code: '110112',
        message: 'withdrawal with reference ngn-withdrawal-ref does not exist ',
      },
    };
    const client = {
      findWithdrawalByReference: vi.fn().mockRejectedValue(new QuidaxWithdrawalNotFoundError(
        'withdrawal with reference ngn-withdrawal-ref does not exist',
        providerResponse,
      )),
      createWithdrawal: vi.fn(),
    };

    await expect(processApprovedNgnWithdrawal('withdrawal-1', client, {
      cancelMissingProviderWithdrawal: true,
    })).resolves.toBe('failed');
    expect(client.findWithdrawalByReference).toHaveBeenCalledWith(
      'me',
      'ngn-withdrawal-ref',
      'ngn',
      { surfaceMissingWithdrawal: true },
    );
    expect(client.createWithdrawal).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.restore).toHaveBeenCalledWith(
      'withdrawal-1',
      '0',
      'withdrawal with reference ngn-withdrawal-ref does not exist',
      providerResponse,
    );
  });

  it('does not report a second refund when missing-withdrawal reconciliation is repeated', async () => {
    mocks.restore.mockResolvedValue({ changed: false, withdrawal, total: '1050' });
    const client = {
      findWithdrawalByReference: vi.fn().mockRejectedValue(new QuidaxWithdrawalNotFoundError(
        'withdrawal with reference ngn-withdrawal-ref does not exist',
        { status: 'error', data: { code: '110112' } },
      )),
      createWithdrawal: vi.fn(),
    };

    await expect(processApprovedNgnWithdrawal('withdrawal-1', client, {
      cancelMissingProviderWithdrawal: true,
    })).resolves.toBe('duplicate');
    expect(client.createWithdrawal).not.toHaveBeenCalled();
  });

  it('fails and refunds a locked legacy pending withdrawal without an approval snapshot', async () => {
    mocks.claim.mockResolvedValue({
      ...withdrawal,
      status: 'pending',
      approvedAt: null,
      bankId: null,
      accountNumber: null,
      accountName: null,
      bankCode: null,
    });
    const providerResponse = {
      status: 'error',
      data: { code: '110112', message: 'Withdrawal does not exist' },
    };
    const client = {
      findWithdrawalByReference: vi.fn().mockRejectedValue(new QuidaxWithdrawalNotFoundError(
        'Withdrawal does not exist',
        providerResponse,
      )),
      createWithdrawal: vi.fn(),
    };

    await expect(processApprovedNgnWithdrawal('withdrawal-1', client, {
      cancelMissingProviderWithdrawal: true,
    })).resolves.toBe('failed');
    expect(mocks.restore).toHaveBeenCalledWith(
      'withdrawal-1', '0', 'Withdrawal does not exist', providerResponse,
    );
    expect(client.createWithdrawal).not.toHaveBeenCalled();
  });

  it('keeps the initial worker create-if-missing behavior', async () => {
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue(null),
      createWithdrawal: vi.fn().mockResolvedValue(providerRecord),
    };

    await expect(processApprovedNgnWithdrawal('withdrawal-1', client)).resolves.toBe('processing');
    expect(client.findWithdrawalByReference).toHaveBeenCalledWith(
      'me',
      'ngn-withdrawal-ref',
      'ngn',
    );
    expect(client.createWithdrawal).toHaveBeenCalledOnce();
  });

  it('restores customer funds only after a verified rejected webhook', async () => {
    mocks.findByProviderId.mockResolvedValue({ ...withdrawal, providerWithdrawalId: 'provider-1' });
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue({ ...providerRecord, status: 'Rejected' }),
    };
    await expect(settleNgnPayoutWebhook('provider-1', 'withdraw.rejected', client)).resolves.toMatchObject({
      changed: true, chatId: '42', bankName: 'Guaranty Trust Bank', status: 'rejected', total: '1050',
    });
    expect(mocks.restore).toHaveBeenCalledWith('withdrawal-1', '10', undefined);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('restores customer funds after a failed-status rejected webhook', async () => {
    mocks.findByProviderId.mockResolvedValue({ ...withdrawal, providerWithdrawalId: 'provider-1' });
    const client = {
      findWithdrawalByReference: vi.fn().mockResolvedValue({ ...providerRecord, status: 'Failed' }),
    };
    await expect(settleNgnPayoutWebhook('provider-1', 'withdraw.rejected', client)).resolves.toMatchObject({
      changed: true, chatId: '42', status: 'failed', total: '1050',
    });
    expect(mocks.restore).toHaveBeenCalledWith('withdrawal-1', '10', undefined);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
