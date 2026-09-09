export const standardDecimal = (value: string | number): string => {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('Invalid stored decimal value');
  const [, sign, integer, fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  if (scale > 0 && digits.length <= scale) {
    digits = `${'0'.repeat(scale - digits.length + 1)}${digits}`;
  }
  const split = digits.length - scale;
  const rendered = scale === 0
    ? digits
    : `${digits.slice(0, split)}.${digits.slice(split)}`;
  const normalized = rendered
    .replace(/^0+(?=\d)/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return `${sign && normalized !== '0' ? '-' : ''}${normalized || '0'}`;
};

/** Formats an exact decimal for display without converting through a floating point number. */
export const formatFinancialAmount = (value: string | number): string => {
  const normalized = standardDecimal(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split('.');
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedInteger}${fraction ? `.${fraction}` : ''}`;
};

const decimalParts = (value: string | number) => {
  const normalized = standardDecimal(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = unsigned.split('.');
  return {
    coefficient: BigInt(`${negative ? '-' : ''}${integer}${fraction}`),
    scale: fraction.length,
  };
};

const renderDecimalParts = (coefficient: bigint, scale: number): string => {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0 && digits.length <= scale) {
    digits = `${'0'.repeat(scale - digits.length + 1)}${digits}`;
  }
  const split = digits.length - scale;
  return standardDecimal(
    `${negative ? '-' : ''}${scale ? `${digits.slice(0, split)}.${digits.slice(split)}` : digits}`,
  );
};

export const addStoredDecimals = (
  left: string | number,
  right: string | number,
): string => {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const coefficient =
    a.coefficient * (10n ** BigInt(scale - a.scale))
    + b.coefficient * (10n ** BigInt(scale - b.scale));
  return renderDecimalParts(coefficient, scale);
};

/** Exact decimal subtraction backed by the same integer representation as addition. */
export const subtractStoredDecimals = (
  left: string | number,
  right: string | number,
): string => addStoredDecimals(left, `-${standardDecimal(right)}`);

/** Exact decimal multiplication without converting either operand to a floating point number. */
export const multiplyStoredDecimals = (
  left: string | number,
  right: string | number,
): string => {
  const a = decimalParts(left);
  const b = decimalParts(right);
  return renderDecimalParts(a.coefficient * b.coefficient, a.scale + b.scale);
};

/** Divides an exact decimal by 10^power by shifting its decimal scale. */
export const divideStoredDecimalByPowerOfTen = (
  value: string | number,
  power: number,
): string => {
  if (!Number.isInteger(power) || power < 0) throw new Error('Decimal power must be a nonnegative integer');
  const parts = decimalParts(value);
  return renderDecimalParts(parts.coefficient, parts.scale + power);
};

/** Exact comparison for normalized decimal values. */
export const compareStoredDecimals = (
  left: string | number,
  right: string | number,
): -1 | 0 | 1 => {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftCoefficient = a.coefficient * (10n ** BigInt(scale - a.scale));
  const rightCoefficient = b.coefficient * (10n ** BigInt(scale - b.scale));
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;
};

/** Rounds an exact decimal half away from zero to a fixed maximum scale. */
export const roundStoredDecimal = (value: string | number, targetScale: number): string => {
  if (!Number.isInteger(targetScale) || targetScale < 0) throw new Error('Decimal scale must be a nonnegative integer');
  const parts = decimalParts(value);
  if (parts.scale <= targetScale) return standardDecimal(value);
  const divisor = 10n ** BigInt(parts.scale - targetScale);
  const negative = parts.coefficient < 0n;
  const absolute = negative ? -parts.coefficient : parts.coefficient;
  let rounded = absolute / divisor;
  if (absolute % divisor * 2n >= divisor) rounded += 1n;
  return renderDecimalParts(negative ? -rounded : rounded, targetScale);
};
