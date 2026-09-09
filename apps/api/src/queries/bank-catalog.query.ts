import { asc, eq } from 'drizzle-orm';
import { db } from '../database';
import { bankCatalog } from '../db/schema/bank-catalog.schema';

/** Public projection returned to customer-facing bank selectors. */
export interface PublicBankCatalogEntry {
  code: string;
  name: string;
  country: string;
  currency: string;
}

/** Reads the provider bank directory in stable display order. */
export const findBankCatalog = (): Promise<PublicBankCatalogEntry[]> => db.select({
  code: bankCatalog.code,
  name: bankCatalog.name,
  country: bankCatalog.country,
  currency: bankCatalog.currency,
}).from(bankCatalog).orderBy(asc(bankCatalog.name), asc(bankCatalog.code));

/** Resolves one stable display name for a provider bank code. */
export const findBankNameByCode = async (code: string): Promise<string | null> => {
  const normalized = code.trim();
  if (!normalized) return null;
  return (await db.select({ name: bankCatalog.name })
    .from(bankCatalog)
    .where(eq(bankCatalog.code, normalized))
    .orderBy(asc(bankCatalog.name))
    .limit(1))[0]?.name ?? null;
};
