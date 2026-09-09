import { count, sql } from 'drizzle-orm';
import { db } from '../../database';
import { admins } from '../schema/admin.schema';
import { bankCatalog } from '../schema/bank-catalog.schema';
import { platformFeeAudits, platformFees } from '../schema/platform-fee.schema';
import { seedAdministrator } from './admin.seed';
import { seedBankCatalog } from './bank-catalog.seed';
import { seedPlatformFees } from './platform-fee.seed';

const SETUP_LOCK_NAME = 'dammie-ai:database-setup:v1';

/** Input collected by the interactive setup command. */
export interface SetupSeedInput {
  administratorEmail: string;
  administratorPassword: string;
}

/** Non-sensitive setup result safe to print to a terminal. */
export interface SetupSeedCounts {
  bankCatalog: number;
  administrators: number;
  platformFees: number;
  platformFeeAudits: number;
}

/** Expected setup failure whose message is safe for CLI output. */
export class SetupSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupSeedError';
  }
}

type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const tableCount = async (tx: SeedTransaction, table: typeof bankCatalog | typeof admins | typeof platformFees | typeof platformFeeAudits) => {
  const row = (await tx.select({ value: count() }).from(table))[0];
  return row?.value ?? 0;
};

const requireSetupTablesEmpty = async (tx: SeedTransaction): Promise<void> => {
  const populated: string[] = [];
  if (await tableCount(tx, bankCatalog)) populated.push('bank_catalog');
  if (await tableCount(tx, admins)) populated.push('admins');
  if (await tableCount(tx, platformFees)) populated.push('platform_fee');
  if (await tableCount(tx, platformFeeAudits)) populated.push('platform_fee_audit');

  if (populated.length > 0) {
    throw new SetupSeedError(
      `Setup can only run once and requires empty setup tables. Data already exists in: ${populated.join(', ')}`,
    );
  }
};

/** Runs every initial-data seed atomically after serializing setup attempts. */
export const runSetupSeeds = async (input: SetupSeedInput): Promise<SetupSeedCounts> => (
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${SETUP_LOCK_NAME}, 0))`);
    await requireSetupTablesEmpty(tx);

    try {
      const bankCatalogCount = await seedBankCatalog(tx);
      const administrator = await seedAdministrator(
        tx,
        input.administratorEmail,
        input.administratorPassword,
      );
      const feeCounts = await seedPlatformFees(tx, administrator.id);

      return {
        bankCatalog: bankCatalogCount,
        administrators: 1,
        platformFees: feeCounts.feeCount,
        platformFeeAudits: feeCounts.auditCount,
      };
    } catch (error) {
      if (error instanceof SetupSeedError) throw error;
      if (error instanceof Error && error.message === 'Setup requires an enabled, non-crypto ngn currency') {
        throw new SetupSeedError(error.message);
      }
      throw error;
    }
  })
);
