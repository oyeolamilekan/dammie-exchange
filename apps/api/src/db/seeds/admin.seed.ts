import bcrypt from 'bcrypt';
import { db } from '../../database';
import { admins } from '../schema/admin.schema';

type SeedTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Safe administrator fields returned by the seed. */
export interface SeededAdministrator {
  id: string;
  email: string;
}

/** Creates the one initial administrator owned by database setup. */
export const seedAdministrator = async (
  tx: SeedTransaction,
  email: string,
  password: string,
): Promise<SeededAdministrator> => {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const administrator = (await tx.insert(admins).values({
    email: normalizedEmail,
    passwordHash,
  }).returning({ id: admins.id, email: admins.email }))[0];

  if (!administrator) throw new Error('Administrator seed did not create a row');
  return administrator;
};
