/**
 * Barrel exports for all Drizzle database schemas.
 *
 * Individual schema modules own table definitions; this file only provides a
 * convenient import surface.
 *
 * @module schema
 */
export * from './bank.schema';
export * from './bank-catalog.schema';
export * from './admin.schema';
export * from './account-version.schema';
export * from './chat-message.schema';
export * from './currency-network.schema';
export * from './currency.schema';
export * from './deposit.schema';
export * from './intent.schema';
export * from './provider-event.schema';
export * from './platform-fee.schema';
export * from './swap.schema';
export * from './user.schema';
export * from './network.schema';
export * from './wallet.schema';
export * from './withdrawal.schema';
