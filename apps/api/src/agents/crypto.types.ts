/** Authenticated identity bound to every crypto-agent tool call. */
export interface CryptoUserContext {
  userId: number;
  username: string;
  /** Trusted signup intent identifier; never supplied by model tool arguments. */
  completeSignupId: string;
  /** Trusted registration state from the users table; never supplied by model tool arguments. */
  isRegistered: boolean;
}

export type CryptoAction =
  | {
      kind: 'web_app';
      name: 'ADD_BANK_ACCOUNT' | 'REMOVE_BANK_ACCOUNT' | 'APPROVE_SWAP_ACTION' | 'APPROVE_WITHDRAWAL_ACTION' | 'COMPLETE_SIGNUP';
      param: string;
    }
  | {
      kind: 'wallet_address';
      address: string;
    };

/** Trusted response returned by an application tool. */
export interface CryptoToolOutput {
  message: string;
  action?: CryptoAction;
  deterministic?: boolean;
}

/** Response consumed by the Telegram integration. */
export interface CryptoAgentResponse {
  text: string;
  action?: CryptoAction;
}
