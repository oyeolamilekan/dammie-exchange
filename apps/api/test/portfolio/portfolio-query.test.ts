import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deposits } from '../../src/db/schema/deposit.schema';
import { swaps } from '../../src/db/schema/swap.schema';
import { users } from '../../src/db/schema/user.schema';
import { walletAddresses, wallets } from '../../src/db/schema/wallet.schema';

describe('PostgreSQL portfolio schema', () => {
  it('uses UUID relations and exact numeric balance columns', () => {
    const wallet = getTableColumns(wallets);
    expect(wallet.id.dataType).toBe('string');
    expect(wallet.userId.dataType).toBe('string');
    expect(wallet.balance.columnType).toBe('PgNumeric');
    expect(wallet.lockedBalance.columnType).toBe('PgNumeric');
  });

  it('normalizes wallet addresses and corrected deposit identifiers', () => {
    expect(Object.keys(getTableColumns(walletAddresses))).toContain('walletId');
    expect(Object.keys(getTableColumns(wallets))).not.toContain('address');
    expect(Object.keys(getTableColumns(deposits))).toContain('depositId');
    expect(Object.keys(getTableColumns(deposits))).not.toContain('despoitId');
  });

  it('keeps sensitive user fields out of financial tables', () => {
    const sensitive = ['bvnNumber', 'hashedPin'];
    expect(Object.keys(getTableColumns(users))).toEqual(expect.arrayContaining(sensitive));
    expect(Object.keys(getTableColumns(deposits))).not.toEqual(expect.arrayContaining(sensitive));
    expect(Object.keys(getTableColumns(swaps))).not.toEqual(expect.arrayContaining(sensitive));
  });
});
