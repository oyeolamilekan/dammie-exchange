import { describe, expect, it } from 'vitest';
import { formatFinancialAmount } from '../../src/utils/decimal';

describe('formatFinancialAmount', () => {
  it.each([
    ['0', '0'],
    ['1000', '1,000'],
    ['1234567890.5000', '1,234,567,890.5'],
    ['0.00000001', '0.00000001'],
    ['-1234567.00', '-1,234,567'],
    ['9007199254740993.123400', '9,007,199,254,740,993.1234'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatFinancialAmount(value)).toBe(expected);
  });

  it('supports the scientific notation accepted by standardDecimal', () => {
    expect(formatFinancialAmount('1e6')).toBe('1,000,000');
  });

  it('rejects invalid decimal values', () => {
    expect(() => formatFinancialAmount('not-a-number')).toThrow('Invalid stored decimal value');
  });
});
