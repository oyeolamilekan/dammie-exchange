import { describe, expect, it, vi } from 'vitest';
import Logging from '../../src/library/logging.utils';
import type { TelegramClient } from '../../src/services/telegram/client';
import {
  buildSwapReceiptSvg,
  buildWithdrawalReceiptSvg,
  maskAccountNumber,
  maskIdentifier,
  renderSwapReceipt,
  renderWithdrawalReceipt,
} from '../../src/helpers/receipt';
import { sendTelegramReceipt } from '../../src/services/telegram/receipts';

const date = new Date('2026-09-07T10:30:00.000Z');

const createClient = (sendPhoto: TelegramClient['sendPhoto']): TelegramClient => ({
  onMessage: vi.fn(),
  onError: vi.fn(),
  sendMessage: vi.fn(),
  sendChatAction: vi.fn(),
  sendPhoto,
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn(),
});

describe('transaction receipts', () => {
  it('renders the portrait swap hierarchy with escaped and masked values', async () => {
    const data = {
      sourceAmount: '2.5',
      sourceCurrency: 'us<dt',
      receivedAmount: '3,000',
      receivedCurrency: 'ngn',
      grossAmount: '3,050',
      platformFee: '50',
      executionPrice: '1,220',
      providerTransactionId: 'provider-123456789',
      custodySweepId: 'sweep-987654321',
      reference: 'reference-123456789',
      completedAt: date,
    };
    const svg = buildSwapReceiptSvg({ ...data, receivedAmount: '3000', grossAmount: '3050', executionPrice: '1220' });
    const heroMarkup = svg.slice(svg.indexOf('<rect x="72" y="202"'), svg.indexOf('SUMMARY'));
    expect(svg).toContain('width="800"');
    expect(svg).toMatch(/height="1\d{3}"/);
    expect(svg).toContain('DAMMIE');
    expect(svg).toContain('SWAP RECEIPT');
    expect(svg).toContain('You received');
    expect(svg).toContain('3,000 NGN');
    expect(svg).toContain('SUMMARY');
    expect(svg).toContain('Amount paid');
    expect(svg).toContain('TRANSACTION DETAILS');
    expect(svg).toContain('DATE');
    expect(svg).toContain('Thank you for choosing Dammie');
    expect(svg).toContain('#000000');
    expect(svg).toContain('#171717');
    expect(svg).toContain('#F5F5F5');
    expect(svg).not.toMatch(/#2457D6|#14213D|#EEF4FF/);
    expect(heroMarkup.match(/NGN/g)).toHaveLength(1);
    expect(svg).not.toContain('amount-currency');
    expect(svg).toContain('US&lt;DT');
    expect(svg).not.toContain('US<DT');
    expect(svg).not.toContain(data.providerTransactionId);
    expect(svg).toContain(maskIdentifier(data.providerTransactionId));
    expect(svg).not.toContain('Custody sweep');
    expect(svg).not.toContain(maskIdentifier(data.custodySweepId));
    expect(svg).toContain('2.5');
    expect(svg).toMatch(/07 Sept 2026.+11:30 am/);

    const png = await renderSwapReceipt({ ...data, receivedAmount: '3000', grossAmount: '3050', executionPrice: '1220' });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('renders the portrait withdrawal hierarchy with masked account and references', async () => {
    const data = {
      amount: '1000',
      platformFee: '50',
      totalDebit: '1050',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank',
      accountNumber: '0123456789',
      reference: 'withdrawal-123456789',
      providerWithdrawalId: 'provider-987654321',
      completedAt: date,
    };
    const svg = buildWithdrawalReceiptSvg(data);
    const heroMarkup = svg.slice(svg.indexOf('<rect x="72" y="202"'), svg.indexOf('SUMMARY'));
    expect(svg).toContain('BANK WITHDRAWAL RECEIPT');
    expect(svg).toContain('You withdrew');
    expect(svg).toContain('₦1,000');
    expect(svg).toContain('SUMMARY');
    expect(svg).toContain('Total wallet debit');
    expect(svg).toContain('₦1,050');
    expect(svg).toContain('TRANSACTION DETAILS');
    expect(svg).toContain('DATE');
    expect(svg).toContain('#000000');
    expect(svg).toContain('#F5F5F5');
    expect(svg).not.toMatch(/#2457D6|#14213D|#EEF4FF/);
    expect(heroMarkup.match(/₦1,000/g)).toHaveLength(1);
    expect(svg).not.toContain('amount-currency');
    expect(svg).toContain('Bank name');
    expect(svg).toContain('Guaranty Trust Bank');
    expect(svg).not.toContain('Bank code');
    expect(svg).not.toContain('>058<');
    expect(svg).toContain(maskAccountNumber(data.accountNumber));
    expect(svg).not.toContain(data.accountNumber);
    expect(svg).toContain(maskIdentifier(data.reference));
    expect(svg).not.toContain(data.reference);
    expect(Array.from((await renderWithdrawalReceipt(data)).slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });

  it('contains photo delivery failures and logs no payload data', async () => {
    const warning = vi.spyOn(Logging, 'warning').mockImplementation(() => undefined);
    const client = createClient(vi.fn().mockRejectedValue(new Error('private telegram response')));

    await expect(sendTelegramReceipt(client, 'private-chat', new Uint8Array([1]), 'receipt'))
      .resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith('Telegram receipt delivery failed');
    expect(warning.mock.calls.flat().join(' ')).not.toContain('private-chat');
    expect(warning.mock.calls.flat().join(' ')).not.toContain('private');
    warning.mockRestore();
  });
});
