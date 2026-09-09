import { and, asc, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { intents, type Intent, type NewIntent } from '../db/schema/intent.schema';

/**
 * Telegram intent persistence queries.
 *
 * Intents connect Telegram users/chats to signup state and conversation
 * processing. The query functions support both legacy page-number reads and
 * targeted lookups used by the bot.
 *
 * @module intentQuery
 */

/** Optional fields used to filter Telegram intents. */
export interface IntentCondition {
  /** Intent record identifier. */
  id?: string;
  /** Telegram user identifier. */
  telegramId?: string;
  /** Telegram chat identifier. */
  chatId?: string;
  /** Signup completion identifier. */
  completeSignupId?: string;
  /** Whether the intent has completed signup. */
  isCompleted?: boolean;
}

/** Builds an AND predicate from intent filter fields. @internal */
const whereIntent = (condition: IntentCondition): SQL | undefined => {
  const clauses: SQL[] = [];
  if (condition.id !== undefined) clauses.push(eq(intents.id, condition.id));
  if (condition.telegramId !== undefined) clauses.push(eq(intents.telegramId, condition.telegramId));
  if (condition.chatId !== undefined) clauses.push(eq(intents.chatId, condition.chatId));
  if (condition.completeSignupId !== undefined) clauses.push(eq(intents.completeSignupId, condition.completeSignupId));
  if (condition.isCompleted !== undefined) clauses.push(eq(intents.isCompleted, condition.isCompleted));
  return clauses.length ? and(...clauses) : undefined;
};

/** Returns the first row or `null` for an empty result. @internal */
const first = <T>(rows: T[]): T | null => rows[0] ?? null;

/** Checks the UUID format before querying the signup identifier. @internal */
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Creates and returns a Telegram intent. */
export const createIntent = async (newIntent: NewIntent): Promise<Intent> =>
  (await db.insert(intents).values(newIntent).returning())[0];

/** Lists every stored Telegram intent. */
export const getAllIntents = (): Promise<Intent[]> => db.select().from(intents);

/** Finds an intent by its record ID. */
export const getIntentById = async (id: string) => first(await db.select().from(intents).where(eq(intents.id, id)).limit(1));

/** Finds an intent by Telegram user ID. */
export const getIntentByTelegramId = async (telegramId: string) => first(await db.select().from(intents).where(eq(intents.telegramId, telegramId)).limit(1));

/** Finds an intent by Telegram chat ID. */
export const getIntentByChatId = async (chatId: string) => first(await db.select().from(intents).where(eq(intents.chatId, chatId)).limit(1));

/** Finds an intent by a valid signup-completion UUID. */
export const getIntentByCompleteSignupId = async (completeSignupId: string) =>
  isUuid(completeSignupId)
    ? first(await db.select().from(intents).where(eq(intents.completeSignupId, completeSignupId)).limit(1))
    : null;

/** Finds the first intent matching arbitrary supported filter fields. */
export const getIntentBy = async (condition: IntentCondition) => first(await db.select().from(intents).where(whereIntent(condition)).limit(1));

/** Updates one intent and refreshes its update timestamp. */
export const updateIntent = async (id: string, updates: Partial<NewIntent>) =>
  first(await db.update(intents).set({ ...updates, updatedAt: new Date() }).where(eq(intents.id, id)).returning());

/** Deletes one intent and returns the deleted row. */
export const deleteIntent = async (id: string) => first(await db.delete(intents).where(eq(intents.id, id)).returning());

/**
 * Finds an intent by Telegram ID or safely creates it under the unique key.
 *
 * The conflict-safe insert handles concurrent Telegram updates.
 */
export const findOrCreateIntent = async (newIntent: NewIntent): Promise<Intent> => {
  const existing = await getIntentByTelegramId(newIntent.telegramId);
  if (existing) return existing;
  const inserted = (await db.insert(intents).values(newIntent)
    .onConflictDoNothing({ target: intents.telegramId }).returning())[0];
  return inserted ?? (await getIntentByTelegramId(newIntent.telegramId))!;
};

/** Lists completed signup intents. */
export const getCompletedIntents = () => db.select().from(intents).where(eq(intents.isCompleted, true));

/** Lists intents with incomplete signup state. */
export const getIncompleteIntents = () => db.select().from(intents).where(eq(intents.isCompleted, false));

/** Updates all intents matching a filter and returns the number modified. */
export const updateManyIntents = async (filter: IntentCondition, updates: Partial<NewIntent>) => ({
  modifiedCount: (await db.update(intents).set({ ...updates, updatedAt: new Date() }).where(whereIntent(filter)).returning({ id: intents.id })).length,
});

/** Deletes all intents matching a filter and returns the number deleted. */
export const deleteManyIntents = async (filter: IntentCondition) => ({
  deletedCount: (await db.delete(intents).where(whereIntent(filter)).returning({ id: intents.id })).length,
});

/** Counts intents matching the supplied filter. */
export const countIntents = async (filter: IntentCondition = {}) =>
  Number((await db.select({ value: count() }).from(intents).where(whereIntent(filter)))[0]?.value ?? 0);

/** Reads a page-number-paginated intent list with the total count. */
export const getIntentsPaginated = async (
  page = 1,
  limit = 10,
  filter: IntentCondition = {},
  direction: 'asc' | 'desc' = 'desc',
) => {
  const [rows, total] = await Promise.all([
    db.select().from(intents).where(whereIntent(filter))
      .orderBy(direction === 'asc' ? asc(intents.createdAt) : desc(intents.createdAt))
      .offset((page - 1) * limit).limit(limit),
    countIntents(filter),
  ]);
  return { intents: rows, total, page, totalPages: Math.ceil(total / limit) };
};

/** Returns whether at least one intent matches the supplied filter. */
export const intentExists = async (condition: IntentCondition) => (await countIntents(condition)) > 0;

/** Lists intents created within an inclusive date range. */
export const getIntentsByDateRange = (startDate: Date, endDate: Date) =>
  db.select().from(intents).where(and(gte(intents.createdAt, startDate), lte(intents.createdAt, endDate)));

/** Updates the Telegram intent if present, otherwise creates it. */
export const upsertIntent = async (filter: Pick<IntentCondition, 'telegramId'>, updates: Partial<NewIntent>): Promise<Intent> => {
  if (!filter.telegramId) throw new Error('telegramId is required for intent upsert');
  const existing = await getIntentByTelegramId(filter.telegramId);
  if (existing) return (await updateIntent(existing.id, updates))!;
  return createIntent({ telegramId: filter.telegramId, chatId: updates.chatId!, ...updates });
};
