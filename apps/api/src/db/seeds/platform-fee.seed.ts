import { and, eq } from 'drizzle-orm';
import { db } from '../../database';
import { currencies } from '../schema/currency.schema';
import {
  platformFeeAudits,
  platformFees,
  type PlatformFee,
  type PlatformFeeContext,
} from '../schema/platform-fee.schema';

type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const contexts: readonly PlatformFeeContext[] = ['swap', 'withdrawal'];

const auditSnapshot = (fee: PlatformFee) => ({
  id: fee.id,
  currencyId: fee.currencyId,
  context: fee.context,
  type: fee.type,
  amount: '0',
  minimumFee: null,
  maximumFee: null,
  enabled: fee.enabled,
  createdByAdminId: fee.createdByAdminId,
  updatedByAdminId: fee.updatedByAdminId,
  createdAt: fee.createdAt.toISOString(),
  updatedAt: fee.updatedAt.toISOString(),
});

/** Creates the default zero-cost NGN fee rules and their creation audits. */
export const seedPlatformFees = async (
  tx: SeedTransaction,
  administratorId: string,
): Promise<{ feeCount: number; auditCount: number }> => {
  const ngn = (await tx.select({ id: currencies.id }).from(currencies).where(and(
    eq(currencies.code, 'ngn'),
    eq(currencies.enabled, true),
    eq(currencies.isCrypto, false),
  )).limit(1))[0];

  if (!ngn) {
    throw new Error('Setup requires an enabled, non-crypto ngn currency');
  }

  const fees = await tx.insert(platformFees).values(contexts.map((context) => ({
    currencyId: ngn.id,
    context,
    type: 'flat' as const,
    amount: '0',
    minimumFee: null,
    maximumFee: null,
    enabled: true,
    createdByAdminId: administratorId,
    updatedByAdminId: administratorId,
  }))).returning();

  if (fees.length !== contexts.length) {
    throw new Error('Platform fee seed did not create every default rule');
  }

  const audits = await tx.insert(platformFeeAudits).values(fees.map((fee) => ({
    platformFeeId: fee.id,
    adminId: administratorId,
    action: 'created',
    before: null,
    after: auditSnapshot(fee),
  }))).returning({ id: platformFeeAudits.id });

  if (audits.length !== fees.length) {
    throw new Error('Platform fee seed did not create every audit record');
  }

  return { feeCount: fees.length, auditCount: audits.length };
};
