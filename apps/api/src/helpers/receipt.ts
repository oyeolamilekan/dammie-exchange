/**
 * Typed transaction receipt rendering.
 *
 * The receipt is authored as escaped SVG so it remains lightweight and
 * deterministic, then rasterized in memory for Telegram's photo API.
 *
 * @module receiptHelper
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import opentype, { type Font, type Glyph } from 'opentype.js';
import sharp from 'sharp';
import { formatFinancialAmount } from '../utils/decimal';

/**
 * Loads the bundled font for converting every receipt label into SVG paths.
 * Sharp uses librsvg, which does not reliably honour embedded `@font-face`
 * rules, so keeping SVG `<text>` nodes would still depend on host fonts.
 */
const loadReceiptFont = (): Font => {
  const paths = [
    resolve(__dirname, '../assets/NotoSans-Regular.ttf'),
    resolve(__dirname, '../../assets/NotoSans-Regular.ttf'),
    resolve(process.cwd(), 'apps/api/assets/NotoSans-Regular.ttf'),
    resolve(process.cwd(), 'assets/NotoSans-Regular.ttf'),
  ];

  for (const path of paths) {
    try {
      const file = readFileSync(path);
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      return opentype.parse(buffer);
    } catch {
      // Try the next source or deployment layout.
    }
  }

  throw new Error('Receipt font asset was not found');
};

let receiptFont: Font | undefined;

const getReceiptFont = (): Font => {
  receiptFont ??= loadReceiptFont();
  return receiptFont;
};

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

/** Escapes all dynamic values before inserting them into XML attributes. */
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

interface ReceiptTextStyle {
  fill: string;
  fontSize: number;
  fontWeight: 400 | 500 | 700 | 800;
  letterSpacing?: number;
  anchor?: 'start' | 'middle' | 'end';
}

interface ReceiptGlyph {
  glyph: Glyph;
  isNaira: boolean;
}

const textStyles = {
  brand: { fontSize: 28, fontWeight: 800, letterSpacing: 7, fill: '#171717', anchor: 'middle' },
  title: { fontSize: 20, fontWeight: 700, letterSpacing: 3, fill: '#737373', anchor: 'middle' },
  heroLabel: { fontSize: 17, fontWeight: 700, letterSpacing: 2, fill: '#E5E5E5', anchor: 'middle' },
  heroAmount: { fontSize: 52, fontWeight: 800, fill: '#FFFFFF', anchor: 'middle' },
  sectionLabel: { fontSize: 14, fontWeight: 800, letterSpacing: 2, fill: '#171717' },
  summaryLabel: { fontSize: 18, fontWeight: 500, fill: '#737373' },
  summaryValue: { fontSize: 21, fontWeight: 800, fill: '#171717', anchor: 'end' },
  rowLabel: { fontSize: 17, fontWeight: 400, fill: '#737373' },
  rowValue: { fontSize: 17, fontWeight: 700, fill: '#171717', anchor: 'end' },
  footerTitle: { fontSize: 17, fontWeight: 700, fill: '#171717', anchor: 'middle' },
  footerNote: { fontSize: 14, fontWeight: 400, fill: '#737373', anchor: 'middle' },
} as const satisfies Record<string, ReceiptTextStyle>;

const glyphForCharacter = (font: Font, character: string): ReceiptGlyph => {
  if (character === '₦') {
    return { glyph: font.charToGlyph('N'), isNaira: true };
  }

  const supportedCharacter = font.hasChar(character) ? character : '?';
  return { glyph: font.charToGlyph(supportedCharacter), isNaira: false };
};

/**
 * Converts text to vector outlines before Sharp sees the SVG. This makes the
 * PNG independent of Fontconfig and of any fonts installed in its container.
 */
const outlinedText = (value: string, x: number, y: number, style: ReceiptTextStyle): string => {
  const font = getReceiptFont();
  const glyphs = Array.from(value, (character) => glyphForCharacter(font, character));
  const scale = style.fontSize / font.unitsPerEm;
  const letterSpacing = style.letterSpacing ?? 0;
  const advance = (glyph: Glyph): number => (glyph.advanceWidth ?? font.unitsPerEm) * scale;

  const textWidth = glyphs.reduce((width, item, index) => {
    const next = glyphs[index + 1];
    const kerning = next ? font.getKerningValue(item.glyph, next.glyph) * scale : 0;
    return width + advance(item.glyph) + kerning + (next ? letterSpacing : 0);
  }, 0);

  let cursor = style.anchor === 'middle'
    ? x - textWidth / 2
    : style.anchor === 'end'
      ? x - textWidth
      : x;

  const paths: string[] = [];
  glyphs.forEach((item, index) => {
    const pathData = item.glyph.getPath(cursor, y, style.fontSize).toPathData(2);
    if (pathData) paths.push(`<path d="${pathData}" />`);

    const glyphAdvance = advance(item.glyph);
    if (item.isNaira) {
      const startX = cursor + glyphAdvance * 0.06;
      const endX = cursor + glyphAdvance * 0.94;
      const upperY = y - style.fontSize * 0.48;
      const lowerY = y - style.fontSize * 0.34;
      const barWidth = Math.max(1.5, style.fontSize * 0.045);
      paths.push(
        `<path d="M${startX.toFixed(2)} ${upperY.toFixed(2)}H${endX.toFixed(2)} M${startX.toFixed(2)} ${lowerY.toFixed(2)}H${endX.toFixed(2)}" fill="none" stroke="${style.fill}" stroke-width="${barWidth.toFixed(2)}" />`,
      );
    }

    const next = glyphs[index + 1];
    cursor += glyphAdvance;
    if (next) cursor += font.getKerningValue(item.glyph, next.glyph) * scale + letterSpacing;
  });

  const syntheticBold = style.fontWeight >= 800 ? 0.8 : style.fontWeight >= 700 ? 0.55 : style.fontWeight >= 500 ? 0.15 : 0;
  const stroke = syntheticBold > 0
    ? ` stroke="${style.fill}" stroke-width="${syntheticBold}" stroke-linejoin="round" paint-order="stroke fill"`
    : '';

  return `<g role="img" aria-label="${escapeXml(value)}" fill="${style.fill}"${stroke}>${paths.join('')}</g>`;
};

const receiptRow = (label: string, value: string, y: number, highlighted = false): string => `
    ${outlinedText(label, 96, y, highlighted ? textStyles.summaryLabel : textStyles.rowLabel)}
    ${outlinedText(value, 704, y, highlighted ? textStyles.summaryValue : textStyles.rowValue)}`;

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
    ${outlinedText(section.label, 80, headingY, textStyles.sectionLabel)}
    <rect x="80" y="${headingY + 20}" width="640" height="78" rx="16" fill="#F5F5F5" />
    ${rowsMarkup}`,
      bottomY: headingY + 98,
    };
  }

  return {
    markup: `
    ${outlinedText(section.label, 80, headingY, textStyles.sectionLabel)}
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

  ${outlinedText('DAMMIE', 400, 100, textStyles.brand)}
  <circle cx="400" cy="126" r="3" fill="#000000" />
  ${outlinedText(title, 400, 166, textStyles.title)}

  <rect x="72" y="202" width="656" height="198" rx="24" fill="#000000" />
  <g clip-path="url(#amount-panel-clip)" fill="none" stroke="#FFFFFF" opacity="0.10" stroke-width="3">
    <path d="M548 171 L682 301 L548 431 L414 301 Z" />
    <path d="M632 171 L766 301 L632 431 L498 301 Z" />
    <path d="M590 213 L682 301 L590 389 L498 301 Z" />
    <circle cx="682" cy="301" r="176" />
  </g>
  ${outlinedText(heroLabel, 400, 268, textStyles.heroLabel)}
  ${outlinedText(heroAmount, 400, 342, textStyles.heroAmount)}
  <rect x="360" y="368" width="80" height="4" rx="2" fill="#FFFFFF" opacity="0.55" />

  ${summarySection.markup}
  ${detailsSection.markup}

  ${outlinedText('DATE', 80, dateHeadingY, textStyles.sectionLabel)}
  ${receiptRow('Completed', displayDate(completedAt), dateRowY)}
  <line x1="80" y1="${dateRowY + 30}" x2="720" y2="${dateRowY + 30}" class="solid-rule" />

  ${outlinedText('Thank you for choosing Dammie', 400, footerY, textStyles.footerTitle)}
  ${outlinedText('Your transaction is complete.', 400, footerY + 28, textStyles.footerNote)}
  <style>
    .dotted-rule { stroke: #D4D4D4; stroke-width: 2; stroke-dasharray: 2 9; stroke-linecap: round; }
    .solid-rule { stroke: #E5E5E5; stroke-width: 2; }
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
