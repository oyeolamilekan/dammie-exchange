import { describe, expect, it } from 'vitest';
import { createNgnWithdrawalReference } from '../../src/services/financial/ngn-withdrawals';

describe('NGN withdrawal references', () => {
  it('uses the compact ngn-withdrawal prefix and ten lowercase letters', () => {
    expect(createNgnWithdrawalReference()).toMatch(/^ngn-withdrawal-[a-z]{10}$/);
  });

  it('generates a new suffix for each withdrawal', () => {
    const references = Array.from({ length: 20 }, createNgnWithdrawalReference);
    expect(new Set(references)).toHaveLength(references.length);
  });
});
