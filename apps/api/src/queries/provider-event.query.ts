import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../database';
import { providerEvents } from '../db/schema/provider-event.schema';

/**
 * Provider-event persistence used to make webhook processing idempotent.
 *
 * Events are inserted before queueing. State transitions are conditional on
 * the current status so duplicate provider deliveries cannot create duplicate
 * processing claims.
 *
 * @module providerEventQuery
 */

/** Idempotency identity extracted from a Quidax webhook payload. */
export interface QuidaxEventIdentity {
  /** Provider discriminator for the event. */
  provider: 'quidax'; eventType: string; resourceId: string; correlationId: string;
}

/**
 * Validates the minimum Quidax webhook shape and builds its correlation key.
 *
 * @param payload Untrusted webhook body.
 * @returns Normalized provider, event, resource, and correlation identity.
 * @throws If `event` or `data.id` is missing or has the wrong type.
 */
export const getQuidaxEventIdentity = (payload: unknown): QuidaxEventIdentity => {
  if (!payload || typeof payload !== 'object') throw new Error('Webhook payload must be an object');
  const event = (payload as { event?: unknown }).event;
  const data = (payload as { data?: { id?: unknown } }).data;
  if (typeof event !== 'string' || !event || typeof data?.id !== 'string' || !data.id) {
    throw new Error('Webhook payload requires event and data.id');
  }
  return { provider: 'quidax', eventType: event, resourceId: data.id, correlationId: `quidax:${event}:${data.id}` };
};

/** Persists a webhook identity once and returns its stored event record. */
export const persistProviderEvent = async (identity: QuidaxEventIdentity) => {
  await db.insert(providerEvents).values({ ...identity, status: 'received', attempts: 0 })
    .onConflictDoNothing();
  return (await db.select().from(providerEvents)
    .where(eq(providerEvents.correlationId, identity.correlationId)).limit(1))[0] ?? null;
};

/** Claims a received or failed event for queue processing and increments attempts. */
export const claimProviderEventForEnqueue = async (correlationId: string) =>
  (await db.update(providerEvents).set({
    status: 'processing', lastError: null, processedAt: null,
    attempts: sql`${providerEvents.attempts} + 1`, updatedAt: new Date(),
  }).where(and(
    eq(providerEvents.correlationId, correlationId),
    inArray(providerEvents.status, ['received', 'failed']),
  )).returning())[0] ?? null;

/** Marks a processing event as successfully completed. */
export const markProviderEventSucceeded = (correlationId: string) =>
  db.update(providerEvents).set({ status: 'succeeded', processedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(and(eq(providerEvents.correlationId, correlationId), eq(providerEvents.status, 'processing')));

/** Marks a processing event as failed with a bounded diagnostic message. */
export const markProviderEventFailed = (correlationId: string, error: unknown) =>
  db.update(providerEvents).set({
    status: 'failed', updatedAt: new Date(),
    lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown processing error',
  }).where(and(eq(providerEvents.correlationId, correlationId), eq(providerEvents.status, 'processing')));

/** Releases a processing claim so the event can be retried. */
export const releaseProviderEventClaim = (correlationId: string) =>
  db.update(providerEvents).set({ status: 'received', updatedAt: new Date() })
    .where(and(eq(providerEvents.correlationId, correlationId), eq(providerEvents.status, 'processing')));
