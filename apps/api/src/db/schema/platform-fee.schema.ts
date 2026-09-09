import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { admins } from './admin.schema';
import { currencies } from './currency.schema';
import { idColumn, timestampColumns } from './common';

/**
 * Platform-fee configuration and audit schema.
 *
 * Current fee rules are mutable, while every operator mutation is represented
 * in the append-only audit table. Fee values use numeric(36,18).
 *
 * @module platformFeeSchema
 */

/** Supported fee calculation methods. */
export const platformFeeTypeEnum = pgEnum('platform_fee_type', ['flat', 'percentage']);

/** Financial workflow contexts that can have a platform fee. */
export const platformFeeContextEnum = pgEnum('platform_fee_context', ['swap', 'withdrawal']);

/** TypeScript union of supported fee calculation methods. */
export type PlatformFeeType = typeof platformFeeTypeEnum.enumValues[number];

/** TypeScript union of supported fee contexts. */
export type PlatformFeeContext = typeof platformFeeContextEnum.enumValues[number];

/** The values copied into a transaction when a fee is resolved. */
export interface PlatformFeeSnapshotValues {
  /** Current fee-rule identifier. */
  platformFeeId: string;
  /** Fee calculation method at transaction creation. */
  platformFeeType: PlatformFeeType;
  /** Configured fee amount at transaction creation. */
  platformFeeConfiguredAmount: string;
  /** Lower fee cap for percentage rules. */
  platformFeeMinimumFee: string | null;
  /** Upper fee cap for percentage rules. */
  platformFeeMaximumFee: string | null;
}

/** One mutable current rule. Historical versions live in platform_fee_audit. */
export const platformFees = pgTable('platform_fee', {
  id: idColumn(),
  currencyId: uuid('currency_id').notNull().references(() => currencies.id, { onDelete: 'restrict' }),
  context: platformFeeContextEnum('context').notNull(),
  type: platformFeeTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
  minimumFee: numeric('minimum_fee', { precision: 36, scale: 18 }),
  maximumFee: numeric('maximum_fee', { precision: 36, scale: 18 }),
  enabled: boolean('enabled').default(true).notNull(),
  createdByAdminId: uuid('created_by_admin_id').notNull().references(() => admins.id, { onDelete: 'restrict' }),
  updatedByAdminId: uuid('updated_by_admin_id').notNull().references(() => admins.id, { onDelete: 'restrict' }),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('platform_fee_currency_context_unique').on(table.currencyId, table.context),
  index('platform_fee_context_enabled_idx').on(table.context, table.enabled),
  check('platform_fee_amount_nonnegative', sql`${table.amount} >= 0`),
  check('platform_fee_percentage_at_most_100', sql`${table.type} <> 'percentage' OR ${table.amount} <= 100`),
  check('platform_fee_caps_nonnegative', sql`
    (${table.minimumFee} IS NULL OR ${table.minimumFee} >= 0) AND
    (${table.maximumFee} IS NULL OR ${table.maximumFee} >= 0)
  `),
  check('platform_fee_minimum_at_most_maximum', sql`
    ${table.minimumFee} IS NULL OR ${table.maximumFee} IS NULL OR ${table.minimumFee} <= ${table.maximumFee}
  `),
  check('platform_fee_caps_match_type', sql`
    (${table.type} = 'flat' AND ${table.minimumFee} IS NULL AND ${table.maximumFee} IS NULL) OR
    ${table.type} = 'percentage'
  `),
]);

/** Current platform-fee row returned from the database. */
export type PlatformFee = typeof platformFees.$inferSelect;

/** Platform-fee values accepted for insertion. */
export type NewPlatformFee = typeof platformFees.$inferInsert;

/** Append-only operator history for every create and update mutation. */
export const platformFeeAudits = pgTable('platform_fee_audit', {
  id: idColumn(),
  platformFeeId: uuid('platform_fee_id').notNull().references(() => platformFees.id, { onDelete: 'restrict' }),
  adminId: uuid('admin_id').notNull().references(() => admins.id, { onDelete: 'restrict' }),
  action: varchar('action', { length: 32 }).notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('platform_fee_audit_rule_created_idx').on(table.platformFeeId, desc(table.createdAt), desc(table.id)),
  index('platform_fee_audit_admin_created_idx').on(table.adminId, desc(table.createdAt), desc(table.id)),
]);

/** Singular alias retained for callers that use a singular table name. */
export const platformFee = platformFees;

/** Singular alias retained for callers that use a singular table name. */
export const platformFeeAudit = platformFeeAudits;

/** Fee-audit row returned from the database. */
export type PlatformFeeAudit = typeof platformFeeAudits.$inferSelect;

/** Fee-audit values accepted for insertion. */
export type NewPlatformFeeAudit = typeof platformFeeAudits.$inferInsert;
