import { MESSAGES } from '../helpers/messages';
import type { SupportedCrypto } from '../queries/catalog.query';
import type { CryptoToolOutput, CryptoUserContext } from '../agents/crypto.types';

/**
 * Builds the trusted signup response for the crypto agent.
 *
 * The caller supplies context captured from the authenticated Telegram intent;
 * no part of the signup URL or registration state comes from model input.
 */
export const completeSignUp = (
  context: CryptoUserContext,
  supportedCryptos: readonly SupportedCrypto[],
): CryptoToolOutput => {
  if (context.isRegistered) {
    return {
      message: MESSAGES.ALREADY_REGISTERED(context.username, supportedCryptos),
      deterministic: true,
    };
  }

  return {
    message: MESSAGES.WELCOME(context.username, supportedCryptos),
    action: {
      kind: 'web_app',
      name: 'COMPLETE_SIGNUP',
      param: context.completeSignupId,
    },
    deterministic: true,
  };
};
