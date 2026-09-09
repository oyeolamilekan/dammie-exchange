/**
 * Aggregate-only metrics for portfolio snapshot requests.
 *
 * @module portfolioMetrics
 */

/** Bounded outcomes recorded for portfolio snapshot requests. */
export type PortfolioOutcome = 'success' | 'empty' | 'error';

/** Aggregate-only recorder contract for portfolio request metrics. */
export interface PortfolioMetricsRecorder {
  /** Records one bounded outcome and nonnegative request latency. */
  record(outcome: PortfolioOutcome, latencyMs: number): void;
}

/** Immutable aggregate snapshot exposed for diagnostics and tests. */
export interface PortfolioMetricsSnapshot {
  /** Counts by bounded portfolio outcome. */
  counts: Record<PortfolioOutcome, number>;
  /** Aggregate latency counters without request identities or payloads. */
  latency: { count: number; totalMs: number };
}

/** In-memory aggregate-only portfolio metrics implementation. */
export class InMemoryPortfolioMetrics implements PortfolioMetricsRecorder {
  private readonly counts: Record<PortfolioOutcome, number> = {
    success: 0,
    empty: 0,
    error: 0,
  };
  private latencyCount = 0;
  private latencyTotalMs = 0;

  /**
   * Records one bounded outcome and clamps negative latency to zero.
   *
   * @param outcome - One of the supported aggregate outcome labels.
   * @param latencyMs - Request latency in milliseconds.
   * @returns Nothing; only aggregate counters are updated.
   * @sideEffects Mutates in-memory counters without storing identities, balances, or request data.
   */
  record(outcome: PortfolioOutcome, latencyMs: number): void {
    this.counts[outcome] += 1;
    this.latencyCount += 1;
    this.latencyTotalMs += Math.max(0, latencyMs);
  }

  /**
   * Returns a copy of the aggregate counters.
   *
   * @returns Bounded outcome counts and total latency counters.
   */
  snapshot(): PortfolioMetricsSnapshot {
    return {
      counts: { ...this.counts },
      latency: {
        count: this.latencyCount,
        totalMs: this.latencyTotalMs,
      },
    };
  }
}

/** Shared aggregate-only recorder used by the portfolio snapshot service. */
export const portfolioMetrics = new InMemoryPortfolioMetrics();
