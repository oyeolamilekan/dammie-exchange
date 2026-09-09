import { connectDatabase, disconnectDatabase } from '../database';
import { getFinancialReconciliationReport } from '../services/financial/reconciliation';

const run = async () => {
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await getFinancialReconciliationReport(), null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
};

void run().catch((error) => {
  process.stderr.write(`Financial reconciliation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
