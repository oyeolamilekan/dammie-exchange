/** Canonical currency code for persistence and provider lookups. */
export const normalizeCurrency = (currency: string): string => currency.trim().toLowerCase();

/** Canonical network code for persistence and provider lookups. */
export const normalizeNetwork = (network: string): string => network.trim().toLowerCase();
