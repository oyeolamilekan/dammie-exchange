import { asc, inArray } from 'drizzle-orm';
import { db, disconnectDatabase } from '../database';
import { withdrawals } from '../db/schema/withdrawal.schema';
import { processApprovedNgnWithdrawal } from '../services/financial/ngn-payouts';
import { quidax } from '../services/integrations/quidax';

/** Re-checks pending and processing NGN withdrawals and resumes safe provider reconciliation. */
const reconcileNgnWithdrawals = async (): Promise<void> => {
  const rows = await db.select({
    id: withdrawals.id,
    reference: withdrawals.reference,
    status: withdrawals.status,
    approvedAt: withdrawals.approvedAt,
    createdAt: withdrawals.createdAt,
  }).from(withdrawals)
    .where(inArray(withdrawals.status, ['pending', 'processing']))
    .orderBy(asc(withdrawals.createdAt), asc(withdrawals.id));

  console.log(`Found ${rows.length} pending or processing NGN withdrawal(s).`);
  let failures = 0;
  for (const row of rows) {
    try {
      const outcome = await processApprovedNgnWithdrawal(row.id, quidax, {
        cancelMissingProviderWithdrawal: true,
      });
      console.log(`${row.id} ${row.reference} ${row.createdAt.toISOString()} -> ${outcome}`);
    } catch (error: unknown) {
      failures += 1;
      console.error(`${row.id} ${row.reference} -> failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures > 0) {
    throw new Error(`${failures} withdrawal(s) could not be reconciled`);
  }
};

const main = async (): Promise<void> => {
  try {
    await reconcileNgnWithdrawals();
  } finally {
    await disconnectDatabase();
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Withdrawal reconciliation failed');
  process.exitCode = 1;
});
