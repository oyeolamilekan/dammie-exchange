import CONFIG from "../config/config";

export const ACTIONS = {
  'ACTION: ADD_BANK_ACCOUNT': {
    buttonText: "🏦 Add Bank Account",
    url: `${CONFIG.FRONTEND_URL}/bank/`
  },
  'ACTION: REMOVE_BANK_ACCOUNT': {
    buttonText: "🗑️ Remove Bank Account",
    url: `${CONFIG.FRONTEND_URL}/banks/`
  },
  'ACTION: APPROVE_SWAP_ACTION': {
    buttonText: "🏦 Approve Transaction", 
    url: `${CONFIG.FRONTEND_URL}/transaction/`
  },
  'ACTION: APPROVE_WITHDRAWAL_ACTION': {
    buttonText: "🏦 Approve Withdrawal",
    url: `${CONFIG.FRONTEND_URL}/withdrawal/`
  },
};
