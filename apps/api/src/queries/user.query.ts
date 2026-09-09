import { and, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../database';
import { intents } from '../db/schema/intent.schema';
import { users, type NewUser, type User } from '../db/schema/user.schema';

/**
 * User persistence queries and safe application-facing projections.
 *
 * Most reads intentionally omit BVN and transaction-PIN fields. The
 * authentication-specific lookup is the only exported query that includes the
 * stored PIN hash.
 *
 * @module userQuery
 */

/** User projection that excludes financial identity secrets. */
export type UserRecord = Omit<User, 'bvnNumber' | 'hashedPin'>;

/** User projection used by PIN-authentication flows. */
export type AuthenticationUser = UserRecord & { hashedPin: string };

const safeUserColumns = {
  id: users.id, email: users.email, firstName: users.firstName,
  lastName: users.lastName, telegramId: users.telegramId,
  subUserId: users.subUserId, intentId: users.intentId, chatId: users.chatId,
  isActive: users.isActive, createdAt: users.createdAt, updatedAt: users.updatedAt,
};

/** Optional fields used to filter users. */
export interface UserCondition {
  /** User record identifier. */
  id?: string;
  /** Email address. */
  email?: string;
  /** Telegram user identifier. */
  telegramId?: string;
  /** Provider sub-user identifier. */
  subUserId?: string;
  /** Telegram chat identifier. */
  chatId?: string;
  /** Signup intent identifier. */
  intentId?: string;
  /** Account active state. */
  isActive?: boolean;
}

/** Builds an AND predicate from user filter fields. @internal */
const whereUser = (condition: UserCondition): SQL | undefined => {
  const clauses: SQL[] = [];
  if (condition.id !== undefined) clauses.push(eq(users.id, condition.id));
  if (condition.email !== undefined) clauses.push(eq(users.email, condition.email));
  if (condition.telegramId !== undefined) clauses.push(eq(users.telegramId, condition.telegramId));
  if (condition.subUserId !== undefined) clauses.push(eq(users.subUserId, condition.subUserId));
  if (condition.chatId !== undefined) clauses.push(eq(users.chatId, condition.chatId));
  if (condition.intentId !== undefined) clauses.push(eq(users.intentId, condition.intentId));
  if (condition.isActive !== undefined) clauses.push(eq(users.isActive, condition.isActive));
  return clauses.length ? and(...clauses) : undefined;
};

/** Returns the first row or `null` for an empty result. @internal */
const first = <T>(rows: T[]): T | null => rows[0] ?? null;

/** Reads a user using the safe projection. @internal */
const findSafe = async (condition: UserCondition) =>
  first(await db.select(safeUserColumns).from(users).where(whereUser(condition)).limit(1));

/** Creates a user and returns its safe projection. */
export const createUser = async (newUser: NewUser): Promise<UserRecord> =>
  (await db.insert(users).values(newUser).returning(safeUserColumns))[0];

/** Lists all users using the safe projection. */
export const getAllUsers = () => db.select(safeUserColumns).from(users);

/** Finds a user by record ID. */
export const getUserById = (id: string) => findSafe({ id });

/** Finds a user by email address. */
export const getUserByEmail = (email: string) => findSafe({ email });

/** Finds a user by Telegram ID. */
export const getUserByTelegramId = (telegramId: string) => findSafe({ telegramId });

/** Finds only the internal user ID for a Telegram ID. */
export const getUserIdentityByTelegramId = async (telegramId: string) =>
  first(await db.select({ id: users.id }).from(users).where(eq(users.telegramId, telegramId)).limit(1));

/** Finds a Telegram user with the hashed transaction PIN for authentication. */
export const getUserByTelegramIdForAuthentication = async (telegramId: string): Promise<AuthenticationUser | null> =>
  first(await db.select({ ...safeUserColumns, hashedPin: users.hashedPin }).from(users).where(eq(users.telegramId, telegramId)).limit(1));

/** Finds a user by provider sub-user ID. */
export const getUserBySubUserId = (subUserId: string) => findSafe({ subUserId });

/** Finds a user by Telegram chat ID. */
export const getUserByChatId = (chatId: string) => findSafe({ chatId });

/** Finds a user by signup intent ID. */
export const getUserByIntentId = (intentId: string) => findSafe({ intentId });

/** Finds the first user matching arbitrary supported filter fields. */
export const getUserBy = (condition: UserCondition) => findSafe(condition);

/** Updates one user and returns its safe projection. */
export const updateUser = async (id: string, updates: Partial<NewUser>) =>
  first(await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, id)).returning(safeUserColumns));

/** Deletes one user and returns its safe projection. */
export const deleteUser = async (id: string) => first(await db.delete(users).where(eq(users.id, id)).returning(safeUserColumns));

/** Finds a Telegram user or creates it when no matching user exists. */
export const findOrCreateUser = async (newUser: NewUser) => (await getUserByTelegramId(newUser.telegramId)) ?? createUser(newUser);

/** Lists active users using the safe projection. */
export const getActiveUsers = () => db.select(safeUserColumns).from(users).where(eq(users.isActive, true));

/** Lists inactive users using the safe projection. */
export const getInactiveUsers = () => db.select(safeUserColumns).from(users).where(eq(users.isActive, false));

/** Updates all users matching a filter and returns the number changed. */
export const updateManyUsers = async (filter: UserCondition, updates: Partial<NewUser>) => ({
  modifiedCount: (await db.update(users).set({ ...updates, updatedAt: new Date() }).where(whereUser(filter)).returning({ id: users.id })).length,
});

/** Deletes all users matching a filter and returns the number deleted. */
export const deleteManyUsers = async (filter: UserCondition) => ({
  deletedCount: (await db.delete(users).where(whereUser(filter)).returning({ id: users.id })).length,
});

/** Counts users matching the supplied filter. */
export const countUsers = async (filter: UserCondition = {}) => Number(
  (await db.select({ value: count() }).from(users).where(whereUser(filter)))[0]?.value ?? 0,
);

/** Reads a page-number-paginated user directory, optionally with intent rows. */
export const getUsersPaginated = async (page = 1, limit = 10, filter: UserCondition = {}, populate = false) => {
  const where = whereUser(filter);
  const [rows, total] = await Promise.all([
    populate
      ? db.select({ user: safeUserColumns, intent: intents }).from(users)
        .innerJoin(intents, eq(users.intentId, intents.id)).where(where)
        .orderBy(desc(users.createdAt)).offset((page - 1) * limit).limit(limit)
      : db.select(safeUserColumns).from(users).where(where)
        .orderBy(desc(users.createdAt)).offset((page - 1) * limit).limit(limit),
    countUsers(filter),
  ]);
  return { users: rows, total, page, totalPages: Math.ceil(total / limit) };
};

/** Returns whether at least one user matches the supplied filter. */
export const userExists = async (condition: UserCondition) => (await countUsers(condition)) > 0;

/** Lists users created within an inclusive date range. */
export const getUsersByDateRange = (startDate: Date, endDate: Date) =>
  db.select(safeUserColumns).from(users).where(and(gte(users.createdAt, startDate), lte(users.createdAt, endDate)));

/** Updates the Telegram user matching a filter or creates it when absent. */
export const upsertUser = async (filter: Pick<UserCondition, 'telegramId'>, updates: NewUser) => {
  if (!filter.telegramId) throw new Error('telegramId is required for user upsert');
  const existing = await getUserByTelegramId(filter.telegramId);
  return existing ? (await updateUser(existing.id, updates))! : createUser(updates);
};

/** Lists safe user projections for a set of Telegram IDs. */
export const getUsersByTelegramIds = (telegramIds: string[]) => db.select(safeUserColumns).from(users).where(inArray(users.telegramId, telegramIds));

/** Lists safe user projections for a set of email addresses. */
export const getUsersByEmails = (emails: string[]) => db.select(safeUserColumns).from(users).where(inArray(users.email, emails));

/** Searches safe user projections by first name, last name, or both. */
export const searchUsersByName = (searchTerm: string) => db.select(safeUserColumns).from(users)
  .where(or(ilike(users.firstName, `%${searchTerm}%`), ilike(users.lastName, `%${searchTerm}%`)));

/** Returns total, active, and inactive user counts. */
export const getUserStats = async () => {
  const [total, active, inactive] = await Promise.all([
    countUsers(), countUsers({ isActive: true }), countUsers({ isActive: false }),
  ]);
  return { total, active, inactive };
};

/** Flips a user's active state and returns the updated safe projection. */
export const toggleUserStatus = async (id: string) => {
  const user = await getUserById(id);
  return user ? updateUser(id, { isActive: !user.isActive }) : null;
};
