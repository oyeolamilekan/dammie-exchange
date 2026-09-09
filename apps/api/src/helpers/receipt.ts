/**
 * Typed transaction receipt rendering.
 *
 * The receipt is authored as escaped SVG so it remains lightweight and
 * deterministic, then rasterized in memory for Telegram's photo API.
 *
 * @module receiptHelper
 */

import sharp from 'sharp';
import { formatFinancialAmount } from '../utils/decimal';

/** Values displayed on a completed swap receipt. */
export interface SwapReceiptData {
  sourceAmount: string | number;
  sourceCurrency: string;
  receivedAmount: string | number;
  receivedCurrency: string;
  grossAmount: string | number;
  platformFee: string | number;
  executionPrice: string | number;
  providerTransactionId?: string | null;
  custodySweepId?: string | null;
  reference?: string | null;
  completedAt: Date;
}

/** Values displayed on a successful NGN withdrawal receipt. */
export interface WithdrawalReceiptData {
  amount: string | number;
  platformFee: string | number;
  totalDebit: string | number;
  /** Retained for callers using the original receipt contract; no longer rendered. */
  bankCode: string;
  bankName?: string | null;
  accountNumber: string;
  reference: string;
  providerWithdrawalId?: string | null;
  completedAt: Date;
}

/** Escapes all dynamic values before inserting them into XML text nodes. */
export const escapeXml = (value: string | number): string => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/** Masks an identifier while retaining only its final four characters. */
export const maskIdentifier = (value: string | null | undefined): string => {
  const normalized = value?.trim() ?? '';
  if (!normalized) return '—';
  return `••••${normalized.slice(-4)}`;
};

/** Masks a bank account number, leaving only the last four digits visible. */
export const maskAccountNumber = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '—';
  return `${'•'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
};

const displayAmount = (value: string | number): string => formatFinancialAmount(value);
const displayCurrency = (value: string): string => value.trim().toUpperCase();

const displayDate = (value: Date): string => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(value);
};

type ReceiptRow = readonly [label: string, value: string];

interface ReceiptSection {
  label: string;
  rows: readonly ReceiptRow[];
  highlighted?: boolean;
}

interface ReceiptLayout {
  title: string;
  heroLabel: string;
  heroAmount: string;
  summary: ReceiptSection;
  details: ReceiptSection;
  completedAt: Date;
}

const receiptRow = (label: string, value: string, y: number, highlighted = false): string => `
    <text x="96" y="${y}" class="${highlighted ? 'summary-label' : 'row-label'}">${escapeXml(label)}</text>
    <text x="704" y="${y}" class="${highlighted ? 'summary-value' : 'row-value'}" text-anchor="end">${escapeXml(value)}</text>`;

const sectionMarkup = (section: ReceiptSection, headingY: number): { markup: string; bottomY: number } => {
  const firstRowY = headingY + 50;
  const rowsMarkup = section.rows.map(([label, value], index) => {
    const y = firstRowY + index * 58;
    const divider = index === section.rows.length - 1 || section.highlighted
      ? ''
      : `<line x1="96" y1="${y + 22}" x2="704" y2="${y + 22}" class="dotted-rule" />`;
    return `${receiptRow(label, value, y, section.highlighted)}${divider}`;
  }).join('');

  if (section.highlighted) {
    return {
      markup: `
    <text x="80" y="${headingY}" class="section-label">${escapeXml(section.label)}</text>
    <rect x="80" y="${headingY + 20}" width="640" height="78" rx="16" fill="#F5F5F5" />
    ${rowsMarkup}`,
      bottomY: headingY + 98,
    };
  }

  return {
    markup: `
    <text x="80" y="${headingY}" class="section-label">${escapeXml(section.label)}</text>
    ${rowsMarkup}`,
    bottomY: firstRowY + (section.rows.length - 1) * 58 + 24,
  };
};

const receiptSvg = ({
  title,
  heroLabel,
  heroAmount,
  summary,
  details,
  completedAt,
}: ReceiptLayout): string => {
  const summarySection = sectionMarkup(summary, 452);
  const detailsSection = sectionMarkup(details, summarySection.bottomY + 66);
  const dateHeadingY = detailsSection.bottomY + 64;
  const dateRowY = dateHeadingY + 50;
  const footerY = dateRowY + 104;
  const canvasHeight = footerY + 96;
  const cardHeight = canvasHeight - 64;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${canvasHeight}" viewBox="0 0 800 ${canvasHeight}">
  <defs>
    <clipPath id="amount-panel-clip">
      <rect x="72" y="202" width="656" height="198" rx="24" />
    </clipPath>
  </defs>
  <rect width="800" height="${canvasHeight}" fill="#F5F5F5" />
  <rect x="32" y="32" width="736" height="${cardHeight}" rx="30" fill="#FFFFFF" stroke="#E5E5E5" stroke-width="2" />

  <text x="400" y="100" class="brand" text-anchor="middle">DAMMIE</text>
  <circle cx="400" cy="126" r="3" fill="#000000" />
  <text x="400" y="166" class="title" text-anchor="middle">${escapeXml(title)}</text>

  <rect x="72" y="202" width="656" height="198" rx="24" fill="#000000" />
  <g clip-path="url(#amount-panel-clip)" fill="none" stroke="#FFFFFF" opacity="0.10" stroke-width="3">
    <path d="M548 171 L682 301 L548 431 L414 301 Z" />
    <path d="M632 171 L766 301 L632 431 L498 301 Z" />
    <path d="M590 213 L682 301 L590 389 L498 301 Z" />
    <circle cx="682" cy="301" r="176" />
  </g>
  <text x="400" y="268" class="hero-label" text-anchor="middle">${escapeXml(heroLabel)}</text>
  <text x="400" y="342" class="hero-amount" text-anchor="middle">${escapeXml(heroAmount)}</text>
  <rect x="360" y="368" width="80" height="4" rx="2" fill="#FFFFFF" opacity="0.55" />

  ${summarySection.markup}
  ${detailsSection.markup}

  <text x="80" y="${dateHeadingY}" class="section-label">DATE</text>
  ${receiptRow('Completed', displayDate(completedAt), dateRowY)}
  <line x1="80" y1="${dateRowY + 30}" x2="720" y2="${dateRowY + 30}" class="solid-rule" />

  <text x="400" y="${footerY}" class="footer-title" text-anchor="middle">Thank you for choosing Dammie</text>
  <text x="400" y="${footerY + 28}" class="footer-note" text-anchor="middle">Your transaction is complete.</text>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; }
    .brand { font-size: 28px; font-weight: 800; letter-spacing: 7px; fill: #171717; }
    .title { font-size: 20px; font-weight: 700; letter-spacing: 3px; fill: #737373; }
    .hero-label { font-size: 17px; font-weight: 700; letter-spacing: 2px; fill: #E5E5E5; }
    .hero-amount { font-size: 52px; font-weight: 800; fill: #FFFFFF; }
    .section-label { font-size: 14px; font-weight: 800; letter-spacing: 2px; fill: #171717; }
    .summary-label { font-size: 18px; font-weight: 500; fill: #737373; }
    .summary-value { font-size: 21px; font-weight: 800; fill: #171717; }
    .row-label { font-size: 17px; font-weight: 400; fill: #737373; }
    .row-value { font-size: 17px; font-weight: 700; fill: #171717; }
    .dotted-rule { stroke: #D4D4D4; stroke-width: 2; stroke-dasharray: 2 9; stroke-linecap: round; }
    .solid-rule { stroke: #E5E5E5; stroke-width: 2; }
    .footer-title { font-size: 17px; font-weight: 700; fill: #171717; }
    .footer-note { font-size: 14px; font-weight: 400; fill: #737373; }
  </style>
</svg>`;
};

/** Builds escaped SVG markup for a completed swap receipt. */
export const buildSwapReceiptSvg = (data: SwapReceiptData): string => {
  const sourceCurrency = displayCurrency(data.sourceCurrency);
  const receivedCurrency = displayCurrency(data.receivedCurrency);
  return receiptSvg({
    title: 'SWAP RECEIPT',
    heroLabel: 'You received',
    heroAmount: `${displayAmount(data.receivedAmount)} ${receivedCurrency}`,
    summary: {
      label: 'SUMMARY',
      highlighted: true,
      rows: [['Amount paid', `${displayAmount(data.sourceAmount)} ${sourceCurrency}`]],
    },
    details: {
      label: 'TRANSACTION DETAILS',
      rows: [
        ['Gross amount', `${displayAmount(data.grossAmount)} ${receivedCurrency}`],
        ['Platform fee', `${displayAmount(data.platformFee)} ${receivedCurrency}`],
        ['Execution price', displayAmount(data.executionPrice)],
        ['Provider transaction', maskIdentifier(data.providerTransactionId)],
        ['Reference', maskIdentifier(data.reference)],
      ],
    },
    completedAt: data.completedAt,
  });
};

/** Builds escaped SVG markup for a successful NGN withdrawal receipt. */
export const buildWithdrawalReceiptSvg = (data: WithdrawalReceiptData): string => receiptSvg({
  title: 'BANK WITHDRAWAL RECEIPT',
  heroLabel: 'You withdrew',
  heroAmount: `₦${displayAmount(data.amount)}`,
  summary: {
    label: 'SUMMARY',
    highlighted: true,
    rows: [['Total wallet debit', `₦${displayAmount(data.totalDebit)}`]],
  },
  details: {
    label: 'TRANSACTION DETAILS',
    rows: [
      ['Platform fee', `₦${displayAmount(data.platformFee)}`],
      ['Bank name', data.bankName?.trim() || '—'],
      ['Account number', maskAccountNumber(data.accountNumber)],
      ['Withdrawal reference', maskIdentifier(data.reference)],
      ['Provider reference', maskIdentifier(data.providerWithdrawalId)],
    ],
  },
  completedAt: data.completedAt,
});

/** Renders a completed swap receipt to PNG bytes in memory. */
export const renderSwapReceipt = async (data: SwapReceiptData): Promise<Uint8Array> =>
  sharp(Buffer.from(buildSwapReceiptSvg(data))).png().toBuffer();

/** Renders a successful NGN withdrawal receipt to PNG bytes in memory. */
export const renderWithdrawalReceipt = async (data: WithdrawalReceiptData): Promise<Uint8Array> =>
  sharp(Buffer.from(buildWithdrawalReceiptSvg(data))).png().toBuffer();
