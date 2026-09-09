/**
 * Financial reconciliation report service.
 *
 * The report compares provider events, swap workflow state, wallet balances,
 * immutable account versions, and custody-transfer stages for operations review.
 *
 * @module financialReconciliationService
 */

import { and, asc, eq, lte, or, sql } from 'drizzle-orm';
import { db } from '../../database';
import { providerEvents } from '../../db/schema/provider-event.schema';
import { swaps } from '../../db/schema/swap.schema';
import { addStoredDecimals, standardDecimal } from '../../utils/decimal';

/** Public report of provider, swap, wallet, and account-version exceptions. */
export interface FinancialReconciliationReport {
  /** Time at which the concurrent report reads were started. */
  generatedAt: string;
  /** Provider events that failed or have remained in transient states too long. */
  providerEvents: Array<{
    correlationId: string;
    eventType: string;
    status: string;
    attempts: number;
    updatedAt: string;
  }>;
  /** Swaps that are processing or explicitly require reconciliation. */
  swaps: Array<{
    id: string;
    status: string;
    swapStatus: string;
    approvalStatus: string;
    reconciliationRequired: boolean;
    updatedAt: string;
  }>;
  /** Wallet balances compared with their most recent immutable account version. */
  walletBalances: Array<{
    walletId: string;
    currency: string;
    available: string;
    locked: string;
    latestVersionId: string | null;
    latestAvailable: string | null;
    latestLocked: string | null;
    latestBalance: string | null;
    latestLockedBalance: string | null;
    availableDrift: string;
    lockedDrift: string;
    hasVersions: boolean;
  }>;
  /** Expected account-version actions whose stored count is not exactly one. */
  missingExpectedVersions: Array<{ action: string; transactionId: string; versionCount: number }>;
  /** Legacy report key retained as part of the reconciliation JSON contract. */
  missingAccountVersions: Array<{ action: string; transactionId: string; versionCount: number }>;
  /** Swap settlement stages that may require custody-provider reconciliation. */
  staleCustodyTransfers: Array<{ swapId: string; stage: string; updatedAt: string }>;
}

type SqlScalar = string | number | boolean | null;
type SqlRow = Record<string, SqlScalar>;

/** Raw wallet row returned by the account-version reconciliation SQL query. */
interface WalletReconciliationRow extends SqlRow {
  wallet_id: string;
  currency: string;
  available: string;
  locked: string;
  latest_version_id: string | null;
  latest_available: string | null;
  latest_locked: string | null;
}

/** Raw missing-version row returned by the expected-action SQL query. */
interface MissingVersionRow extends SqlRow {
  action: string;
  transaction_id: string;
  version_count: number;
}

/** Provider-event row selected for the reconciliation report. */
interface ProviderEventReportRow {
  correlationId: string;
  eventType: string;
  status: string;
  attempts: number;
  updatedAt: Date;
}

/** Swap row selected for the reconciliation and stale-transfer report. */
interface SwapReportRow {
  id: string;
  status: string;
  swapStatus: string;
  approvalStatus: string;
  reconciliationRequired: boolean;
  updatedAt: Date;
}

/**
 * Safely extracts object rows from a Drizzle raw SQL result.
 *
 * @param result - Raw result returned by db.execute.
 * @returns Typed object rows, or an empty array when the driver returned no rows.
 */
const rowsOf = <T extends SqlRow>(result: unknown): T[] => {
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown[] }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is T => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
};

/**
 * Converts a database date to the report's ISO timestamp format.
 *
 * @param value - Database timestamp.
 * @returns ISO-8601 timestamp string.
 */
const toIsoString = (value: Date): string => value.toISOString();

/**
 * Maps a raw wallet row to normalized public balances and decimal drift.
 *
 * @param row - Raw wallet and latest-version values.
 * @returns Public wallet reconciliation record with compatibility fields.
 */
const mapWalletBalanceRow = (
  row: WalletReconciliationRow,
): FinancialReconciliationReport['walletBalances'][number] => {
  const hasVersions = Boolean(row.latest_version_id);
  const latestAvailable = row.latest_available === null ? null : standardDecimal(row.latest_available);
  const latestLocked = row.latest_locked === null ? null : standardDecimal(row.latest_locked);
  return {
    walletId: row.wallet_id,
    currency: row.currency,
    available: standardDecimal(row.available),
    locked: standardDecimal(row.locked),
    latestVersionId: row.latest_version_id,
    latestAvailable,
    latestLocked,
    latestBalance: latestAvailable,
    latestLockedBalance: latestLocked,
    availableDrift: hasVersions ? addStoredDecimals(row.available, `-${row.latest_available!}`) : '0',
    lockedDrift: hasVersions ? addStoredDecimals(row.locked, `-${row.latest_locked!}`) : '0',
    hasVersions,
  };
};

/**
 * Maps a raw expected-version row to the public missing-version shape.
 *
 * @param row - Raw expected action and count.
 * @returns Public missing account-version record.
 */
const mapMissingVersionRow = (
  row: MissingVersionRow,
): FinancialReconciliationReport['missingExpectedVersions'][number] => ({
  action: row.action,
  transactionId: row.transaction_id,
  versionCount: Number(row.version_count),
});

/**
 * Maps a provider-event query row to its ISO report representation.
 *
 * @param event - Provider-event report row.
 * @returns Public provider-event report row.
 */
const mapProviderEventRow = (
  event: ProviderEventReportRow,
): FinancialReconciliationReport['providerEvents'][number] => ({
  correlationId: event.correlationId,
  eventType: event.eventType,
  status: event.status,
  attempts: event.attempts,
  updatedAt: toIsoString(event.updatedAt),
});

/**
 * Maps a swap query row to its ISO report representation.
 *
 * @param swap - Swap report row.
 * @returns Public swap report row.
 */
const mapSwapReportRow = (
  swap: SwapReportRow,
): FinancialReconciliationReport['swaps'][number] => ({
  id: swap.id,
  status: swap.status,
  swapStatus: swap.swapStatus,
  approvalStatus: swap.approvalStatus,
  reconciliationRequired: swap.reconciliationRequired,
  updatedAt: toIsoString(swap.updatedAt),
});

/**
 * Maps a processing or flagged swap to the stale settlement stage report.
 *
 * @param swap - Swap report row to classify.
 * @returns Public stale custody-transfer record.
 */
const mapStaleCustodyTransfer = (
  swap: SwapReportRow,
): FinancialReconciliationReport['staleCustodyTransfers'][number] => ({
  swapId: swap.id,
  stage: swap.reconciliationRequired
    ? 'reconciliation-required'
    : 'custody-transfer',
  updatedAt: toIsoString(swap.updatedAt),
});

/**
 * Reads and assembles financial reconciliation exceptions.
 *
 * @param now - Report clock used for generation and the stuck-event threshold.
 * @param stuckAfterMinutes - Age after which received/processing events are reported.
 * @returns Reconciliation report with compatibility aliases and exact decimal drift.
 * @sideEffects Performs four read-only database queries concurrently; it does not mutate financial state.
 */
export const getFinancialReconciliationReport = async (
  now = new Date(),
  stuckAfterMinutes = 15,
): Promise<FinancialReconciliationReport> => {
  const stuckBefore = new Date(now.getTime() - stuckAfterMinutes * 60_000);
  const [events, swapRows, walletResult, missingResult] = await Promise.all([
    db.select({
      correlationId: providerEvents.correlationId,
      eventType: providerEvents.eventType,
      status: providerEvents.status,
      attempts: providerEvents.attempts,
      updatedAt: providerEvents.updatedAt,
    }).from(providerEvents).where(or(
      eq(providerEvents.status, 'failed'),
      and(eq(providerEvents.status, 'received'), lte(providerEvents.updatedAt, stuckBefore)),
      and(eq(providerEvents.status, 'processing'), lte(providerEvents.updatedAt, stuckBefore)),
    )).orderBy(asc(providerEvents.updatedAt)),
    db.select({
      id: swaps.id,
      approvalStatus: swaps.approvalStatus,
      status: swaps.status,
      swapStatus: swaps.swapStatus,
      reconciliationRequired: swaps.reconciliationRequired,
      updatedAt: swaps.updatedAt,
    }).from(swaps).where(or(
      eq(swaps.reconciliationRequired, true),
      eq(swaps.approvalStatus, 'processing'),
      eq(swaps.status, 'processing'),
      eq(swaps.swapStatus, 'processing'),
    )).orderBy(asc(swaps.updatedAt)),
    db.execute(sql`
      SELECT w.id AS wallet_id, upper(c.code) AS currency,
        w.balance::text AS available, w.locked_balance::text AS locked,
        latest.id::text AS latest_version_id,
        latest.balance::text AS latest_available,
        latest.locked_balance::text AS latest_locked
      FROM wallets w
      INNER JOIN currency c ON c.id = w.currency_id
      LEFT JOIN LATERAL (
        SELECT av.id, av.balance, av.locked_balance
        FROM account_versions av
        WHERE av.wallet_id = w.id
        ORDER BY av.created_at DESC, av.id DESC
        LIMIT 1
      ) latest ON true
      ORDER BY c.code, w.id
    `),
    db.execute(sql`
      SELECT expected.action, expected.transaction_id::text, count(av.id)::int AS version_count
      FROM (
        SELECT 'deposit'::text AS transaction_type, 'deposit_credit'::text AS action, d.id AS transaction_id
        FROM deposits d WHERE d.status = 'success'
        UNION ALL
        SELECT 'swap', 'swap_lock', s.id FROM swaps s WHERE s.approval_status = 'success'
        UNION ALL
        SELECT 'swap', 'swap_complete', s.id FROM swaps s WHERE s.executed_received_amount IS NOT NULL
        UNION ALL
        SELECT 'swap', 'swap_credit', s.id FROM swaps s WHERE s.status = 'success'
        UNION ALL
        SELECT 'swap', 'swap_restore', s.id FROM swaps s WHERE s.recovery_event IS NOT NULL AND s.status = 'failed'
      ) expected
      LEFT JOIN account_versions av ON av.transaction_type::text = expected.transaction_type
        AND av.transaction_id = expected.transaction_id AND av.action::text = expected.action
      GROUP BY expected.action, expected.transaction_id
      HAVING count(av.id) <> 1
      ORDER BY expected.action, expected.transaction_id
    `),
  ]);

  const walletBalances = rowsOf<WalletReconciliationRow>(walletResult).map(mapWalletBalanceRow);
  const missingExpectedVersions = rowsOf<MissingVersionRow>(missingResult).map(mapMissingVersionRow);
  const reportSwaps = swapRows as SwapReportRow[];
  const staleCustodyTransfers = reportSwaps
    .filter((swap) => swap.swapStatus === 'processing' || swap.reconciliationRequired)
    .map(mapStaleCustodyTransfer);

  return {
    generatedAt: toIsoString(now),
    providerEvents: events.map(mapProviderEventRow),
    swaps: reportSwaps.map(mapSwapReportRow),
    walletBalances,
    missingExpectedVersions,
    missingAccountVersions: missingExpectedVersions,
    staleCustodyTransfers,
  };
};
