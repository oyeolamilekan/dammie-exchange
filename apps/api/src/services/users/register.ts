/**
 * Customer registration and provider-wallet provisioning services.
 *
 * Registration validates the authenticated signup intent, creates the local
 * user/provider sub-user, and queues wallet provisioning. Provisioning then
 * creates configured wallets and network addresses with customer notifications.
 *
 * @module registerUserService
 */

import bcrypt from 'bcrypt';
import { getIntentByCompleteSignupId } from '../../queries/intent.query';
import {
  createUser,
  getUserByIntentId,
  getUserBy,
  type UserRecord,
} from '../../queries/user.query';
import {
  assignWalletAddress,
  createWallet,
  ensureWallet,
  findOneWallet,
} from '../../queries/wallet.query';
import type { QuidaxClient } from '../integrations/quidax';
import { MESSAGES } from '../../helpers/messages';
import { transformEmail } from '../../utils';
import { findSupportedCryptos, type SupportedCrypto } from '../../queries/catalog.query';

const SALT_ROUNDS = 10;

/** Minimal provider operation required by registration. @internal */
type RegistrationQuidaxClient = Pick<QuidaxClient, 'createSubUser'>;
/** Wallet-provisioning job payload emitted after registration. @internal */
type WalletJob = { userId: string; subUserId: string; email: string };

/** Side effects supplied by the HTTP composition root for user registration. */
export interface RegisterUserDependencies {
  quidax: RegistrationQuidaxClient;
  enqueueWalletJob(data: WalletJob): Promise<void>;
  notify(chatId: string, text: string): Promise<unknown>;
  /** Fresh catalog used to render the account-created notification. */
  getSupportedCryptos?(): Promise<SupportedCrypto[]>;
}

/** Input extracted from the authenticated signup request. */
export interface RegisterUserInput {
  completeSignupId: string;
  authenticatedTelegramId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  bvnNumber?: string;
  transactionPin?: string;
}

/** Expected registration outcomes kept separate from provider/database failures. */
export type RegisterUserResult =
  | { outcome: 'intent-not-found' }
  | { outcome: 'intent-not-owned' }
  | { outcome: 'invalid-input'; message: string }
  | { outcome: 'user-exists' }
  | { outcome: 'created'; user: UserRecord };

const validateInput = (input: RegisterUserInput): string | null => {
  if (!input.email || !input.firstName || !input.lastName) {
    return 'Email, first name, and last name are required';
  }
  if (!input.transactionPin || !/^\d{4}$/.test(input.transactionPin)) {
    return 'Transaction PIN must be exactly four digits';
  }
  return null;
};

/** Creates the registration workflow and binds provider, queue, and notification adapters. */
export const createRegisterUserService = (dependencies: RegisterUserDependencies) =>
  async (input: RegisterUserInput): Promise<RegisterUserResult> => {
    const intent = await getIntentByCompleteSignupId(input.completeSignupId);
    if (!intent) return { outcome: 'intent-not-found' };
    if (intent.telegramId !== input.authenticatedTelegramId) {
      return { outcome: 'intent-not-owned' };
    }

    const validationError = validateInput(input);
    if (validationError) return { outcome: 'invalid-input', message: validationError };

    const existingUser = await getUserByIntentId(intent.id);
    if (existingUser) return { outcome: 'user-exists' };

    const quidaxResponse = await dependencies.quidax.createSubUser({
      email: transformEmail(input.email!),
      first_name: input.firstName!,
      last_name: input.lastName!,
    });
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    const hashedPin = await bcrypt.hash(input.transactionPin!, salt);
    const user = await createUser({
      email: input.email!,
      firstName: input.firstName!,
      lastName: input.lastName!,
      bvnNumber: input.bvnNumber!,
      hashedPin,
      intentId: intent.id,
      telegramId: intent.telegramId,
      chatId: intent.chatId,
      subUserId: quidaxResponse.id,
    });

    await dependencies.enqueueWalletJob({
      userId: user.id,
      subUserId: user.subUserId,
      email: user.email,
    });
    void (async () => {
      const supportedCryptos = await (dependencies.getSupportedCryptos ?? findSupportedCryptos)();
      await dependencies.notify(
        user.chatId,
        MESSAGES.ACCOUNT_CREATED(user.firstName, supportedCryptos),
      );
    })().catch(() => undefined);
    return { outcome: 'created', user };
  };

export type RegisterUserService = ReturnType<typeof createRegisterUserService>;

type WalletProvisioningQuidaxClient = Pick<
  QuidaxClient,
  'fetchCurrency' | 'createPaymentAddress'
>;

/** Input for the provider-wallet provisioning workflow queued after signup. */
export interface WalletProvisioningInput {
  userId: string;
  subUserId: string;
  email: string;
}

/** Notification data supplied to the worker without coupling this workflow to Telegram. */
interface WalletAddressAssigned {
  chatId: string;
  address: string;
  currency: string;
  network: string;
}

/** Adapters needed by provider-wallet provisioning. */
export interface WalletProvisioningDependencies {
  quidax: WalletProvisioningQuidaxClient;
  onAddressAssigned(event: WalletAddressAssigned): Promise<void>;
  /** Fresh catalog loaded once at the start of a provisioning job. */
  getSupportedCryptos?(): Promise<SupportedCrypto[]>;
}

interface CreatedPaymentAddress {
  address: string;
  network: string;
  destination_tag?: string | null;
}

const readCreatedPaymentAddress = (
  response: Record<string, unknown>,
  requestedNetwork: string,
): CreatedPaymentAddress => {
  if (typeof response.address !== 'string') {
    throw new Error('Payment address response is missing an address');
  }
  if (response.network !== undefined && typeof response.network !== 'string') {
    throw new Error('Payment address response has an invalid network');
  }
  if (
    response.destination_tag !== undefined
    && response.destination_tag !== null
    && typeof response.destination_tag !== 'string'
  ) {
    throw new Error('Payment address response has an invalid destination tag');
  }
  return {
    address: response.address,
    network: requestedNetwork,
    destination_tag: response.destination_tag as string | null | undefined,
  };
};

/** Provisions each configured wallet and address while keeping provider calls outside transactions. */
export const provisionUserWallets = async (
  input: WalletProvisioningInput,
  dependencies: WalletProvisioningDependencies,
  supportedCryptos?: readonly SupportedCrypto[],
): Promise<Array<
  | { currency: string; created: boolean; networks: string[] }
  | { currency: string; created: false; reason: 'creation failed'; error: unknown }
>> => {
  const catalog = supportedCryptos
    ?? await (dependencies.getSupportedCryptos ?? findSupportedCryptos)();
  const ngnWallet = await ensureWallet({
    userId: input.userId,
    currency: 'ngn',
    inProgress: false,
  });
  const cryptoWallets = await Promise.all(catalog.map(async ({ code: currency, networks }) => {
    try {
      const response = await dependencies.quidax.fetchCurrency(input.subUserId, currency);
      const existingWallet = await findOneWallet({ userId: input.userId, currency });
      const wallet = existingWallet ?? await createWallet({
        userId: input.userId,
        currency,
        walletId: response.id,
      });
      if (!wallet) throw new Error(`Unable to create ${currency} wallet`);

      const userDetail = await getUserBy({ id: input.userId });
      const addresses = await Promise.all(networks.map(async ({ code: network }) => {
        const paymentAddress = readCreatedPaymentAddress(
          await dependencies.quidax.createPaymentAddress(input.subUserId, currency, network),
          network,
        );
        await assignWalletAddress(
          { userId: input.userId, currency },
          {
            address: paymentAddress.address,
            network: paymentAddress.network,
            destinationTag: paymentAddress.destination_tag ?? null,
          },
        );
        if (userDetail) {
          await dependencies.onAddressAssigned({
            chatId: userDetail.chatId,
            address: paymentAddress.address,
            currency,
            network: paymentAddress.network,
          });
        }
        return paymentAddress.network.toLowerCase();
      }));

      return { currency, created: !existingWallet, networks: addresses };
    } catch (error: unknown) {
      return {
        currency,
        created: false as const,
        reason: 'creation failed' as const,
        error,
      };
    }
  }));
  return [
    { currency: 'ngn', created: ngnWallet.created, networks: [] },
    ...cryptoWallets,
  ];
};
