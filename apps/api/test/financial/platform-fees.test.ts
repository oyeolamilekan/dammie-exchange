import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { platformFeeAudits, platformFees } from '../../src/db/schema/platform-fee.schema';
import {
  calculateNetPlatformProceeds,
  calculatePlatformFee,
  calculatePlatformFeeFromSnapshot,
  feeConsumesProceeds,
} from '../../src/services/financial/platform-fees';

describe('platform fee schema', () => {
  it('stores one current rule identity with admin attribution and constraints', () => {
    const config = getTableConfig(platformFees);
    expect(config.name).toBe('platform_fee');
    expect(config.columns.map((column) => column.name)).toEqual([
      'id', 'currency_id', 'context', 'type', 'amount', 'minimum_fee', 'maximum_fee',
      'enabled', 'created_by_admin_id', 'updated_by_admin_id', 'created_at', 'updated_at',
    ]);
    expect(config.indexes.find((index) => index.config.name === 'platform_fee_currency_context_unique')?.config.unique).toBe(true);
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'platform_fee_amount_nonnegative',
      'platform_fee_percentage_at_most_100',
      'platform_fee_minimum_at_most_maximum',
      'platform_fee_caps_match_type',
    ]));
    expect(getTableConfig(platformFeeAudits).name).toBe('platform_fee_audit');
  });
});

describe('platform fee calculator', () => {
  it('calculates flat fees exactly and rounds NGN to two places', () => {
    expect(calculatePlatformFee('1000.005', {
      type: 'flat', amount: '10.005', minimumFee: null, maximumFee: null,
    })).toBe('10.01');
  });

  it('calculates percentage fees with optional min/max clamps', () => {
    const rule = { type: 'percentage' as const, amount: '1.5', minimumFee: '20', maximumFee: '100' };
    expect(calculatePlatformFee('1000', rule)).toBe('20');
    expect(calculatePlatformFee('10000', rule)).toBe('100');
    expect(calculatePlatformFee('2000', rule)).toBe('30');
  });

  it('uses the immutable snapshot and returns zero without a rule', () => {
    const snapshot = {
      platformFeeId: 'fee-1',
      platformFeeType: 'percentage' as const,
      platformFeeConfiguredAmount: '2.5',
      platformFeeMinimumFee: null,
      platformFeeMaximumFee: '100',
    };
    expect(calculatePlatformFeeFromSnapshot('1234.56', snapshot)).toBe('30.86');
    expect(calculatePlatformFeeFromSnapshot('1234.56', null)).toBe('0');
  });

  it('protects customer proceeds when the fee is equal to or greater than gross', () => {
    expect(calculateNetPlatformProceeds('100', '25.50')).toBe('74.5');
    expect(feeConsumesProceeds('100', '100')).toBe(true);
    expect(feeConsumesProceeds('100', '100.01')).toBe(true);
    expect(feeConsumesProceeds('100', '99.99')).toBe(false);
  });
});
