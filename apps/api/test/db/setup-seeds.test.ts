import bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, db, disconnectDatabase } from '../../src/database';
import { admins } from '../../src/db/schema/admin.schema';
import { bankCatalog } from '../../src/db/schema/bank-catalog.schema';
import { platformFeeAudits, platformFees } from '../../src/db/schema/platform-fee.schema';
import { runSetupSeeds } from '../../src/db/seeds';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl && testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL');
}
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase.sequential('PostgreSQL database setup seeds', () => {
  beforeAll(async () => {
    await connectDatabase();
    await migrate(db, { migrationsFolder: 'drizzle' });
  }, 30_000);

  beforeEach(async () => {
    await db.execute(sql.raw(
      'TRUNCATE TABLE platform_fee_audit, platform_fee, admin_sessions, admins, bank_catalog CASCADE',
    ));
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('creates the full atomic setup and refuses to run over existing setup data', async () => {
    const password = 'a-safe-test-password';
    const counts = await runSetupSeeds({
      administratorEmail: '  OWNER@Example.COM ',
      administratorPassword: password,
    });

    expect(counts).toEqual({
      bankCatalog: 247,
      administrators: 1,
      platformFees: 2,
      platformFeeAudits: 2,
    });
    expect(await db.select().from(bankCatalog)).toHaveLength(247);

    const administrator = (await db.select().from(admins))[0]!;
    expect(administrator.email).toBe('owner@example.com');
    expect(administrator.passwordHash).not.toContain(password);
    expect(await bcrypt.compare(password, administrator.passwordHash)).toBe(true);

    const fees = await db.select().from(platformFees);
    expect(fees.map((fee) => fee.context).sort()).toEqual(['swap', 'withdrawal']);
    expect(fees.every((fee) => fee.type === 'flat' && Number(fee.amount) === 0 && fee.enabled))
      .toBe(true);

    const audits = await db.select().from(platformFeeAudits);
    expect(audits).toHaveLength(2);
    expect(audits.every((audit) => (
      audit.action === 'created' && audit.adminId === administrator.id && audit.before === null
    ))).toBe(true);

    await expect(runSetupSeeds({
      administratorEmail: 'another@example.com',
      administratorPassword: 'another-safe-password',
    })).rejects.toThrow('Setup can only run once');
    expect(await db.select().from(admins)).toHaveLength(1);
  });

  it('serializes concurrent attempts so exactly one commits', async () => {
    const attempts = await Promise.allSettled([
      runSetupSeeds({
        administratorEmail: 'first@example.com',
        administratorPassword: 'first-safe-password',
      }),
      runSetupSeeds({
        administratorEmail: 'second@example.com',
        administratorPassword: 'second-safe-password',
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(await db.select().from(bankCatalog)).toHaveLength(247);
    expect(await db.select().from(admins)).toHaveLength(1);
    expect(await db.select().from(platformFees)).toHaveLength(2);
    expect(await db.select().from(platformFeeAudits)).toHaveLength(2);
  });
});
