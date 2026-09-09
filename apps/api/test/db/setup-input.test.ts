import { describe, expect, it } from 'vitest';
import { BANK_CATALOG_RECORDS } from '../../src/db/seeds/bank-catalog.seed';
import { SetupSeedError } from '../../src/db/seeds';
import { seedPlatformFees } from '../../src/db/seeds/platform-fee.seed';
import {
  requireInteractiveTerminal,
  setupErrorMessage,
  validateSetupInput,
} from '../../src/scripts/setup';

describe('database setup input and seed catalog', () => {
  it('owns the complete provider bank directory without removing provider duplicates', () => {
    expect(BANK_CATALOG_RECORDS).toHaveLength(247);
    expect(BANK_CATALOG_RECORDS.every((bank) => (
      bank.country === 'Nigeria' && bank.currency === 'NGN'
    ))).toBe(true);
    expect(BANK_CATALOG_RECORDS.filter((bank) => bank.code === '090267')).toHaveLength(2);
    expect(BANK_CATALOG_RECORDS.filter((bank) => (
      bank.code === '000012' && bank.name === 'Stanbic IBTC Bank'
    ))).toHaveLength(2);
  });

  it('normalizes valid email and validates both password entries', () => {
    expect(validateSetupInput('  Admin@Example.COM ', 'long-enough-password', 'long-enough-password'))
      .toEqual({
        administratorEmail: 'admin@example.com',
        administratorPassword: 'long-enough-password',
      });

    expect(() => validateSetupInput('not-an-email', 'long-enough-password', 'long-enough-password'))
      .toThrow('valid administrator email');
    expect(() => validateSetupInput('admin@example.com', 'too-short', 'too-short'))
      .toThrow('at least 12 characters');
    expect(() => validateSetupInput('admin@example.com', 'long-enough-password', 'different-password'))
      .toThrow('Passwords do not match');
  });

  it('requires an interactive input and output terminal', () => {
    expect(() => requireInteractiveTerminal(true, true)).not.toThrow();
    expect(() => requireInteractiveTerminal(false, true)).toThrow('interactive terminal');
    expect(() => requireInteractiveTerminal(true, false)).toThrow('interactive terminal');
  });

  it('rejects setup when no enabled, non-crypto NGN currency exists', async () => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    };

    await expect(seedPlatformFees(tx as never, 'administrator-id'))
      .rejects.toThrow('enabled, non-crypto ngn currency');
  });

  it('never includes a password or hash from an unexpected database error', () => {
    const error = {
      message: 'Failed query params: plaintext-password, bcrypt-password-hash',
      cause: { code: 'XX000', message: 'plaintext-password bcrypt-password-hash' },
    };
    const message = setupErrorMessage(error);
    expect(message).not.toContain('plaintext-password');
    expect(message).not.toContain('bcrypt-password-hash');
    expect(setupErrorMessage(new SetupSeedError('Setup can only run once')))
      .toBe('Setup can only run once');
  });
});
