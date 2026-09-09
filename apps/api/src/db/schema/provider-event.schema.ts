import { index, integer, pgEnum, pgTable, uniqueIndex, varchar, timestamp } from 'drizzle-orm/pg-core';
import { idColumn, timestampColumns } from './common';

/**
 * Provider webhook idempotency schema.
 *
 * Correlation and provider/resource uniqueness constraints ensure duplicate
 * webhook deliveries share one persisted event record.
 *
 * @module providerEventSchema
 */

/** Processing states for persisted provider events. */
export const providerEventStatusEnum = pgEnum('provider_event_status', [
  'received', 'processing', 'succeeded', 'failed',
]);

/** TypeScript union of provider-event processing states. */
export type ProviderEventStatus = typeof providerEventStatusEnum.enumValues[number];

/** Persisted provider webhook identity and queue-processing state. */
export const providerEvents = pgTable('provider_events', {
  id: idColumn(),
  provider: varchar('provider', { length: 32 }).notNull(),
  eventType: varchar('event_type', { length: 250 }).notNull(),
  resourceId: varchar('resource_id', { length: 250 }).notNull(),
  correlationId: varchar('correlation_id', { length: 600 }).notNull(),
  status: providerEventStatusEnum('status').default('received').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: varchar('last_error', { length: 500 }),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  ...timestampColumns(),
}, (table) => [
  uniqueIndex('provider_events_correlation_id_unique').on(table.correlationId),
  uniqueIndex('provider_events_resource_unique').on(table.provider, table.eventType, table.resourceId),
  index('provider_events_status_updated_idx').on(table.status, table.updatedAt),
]);

/** Provider-event row returned from the database. */
export type ProviderEvent = typeof providerEvents.$inferSelect;

/** Provider-event values accepted for insertion. */
export type NewProviderEvent = typeof providerEvents.$inferInsert;
