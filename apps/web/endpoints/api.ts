import { axiosInstance } from "@/config/api";

export interface BankCatalogEntry {
  code: string;
  name: string;
  country: string;
  currency: string;
}

export interface SavedBankAccount {
  id: string;
  accountName: string;
  accountNumberMasked: string;
  bankCode: string;
  isDefault: boolean;
}

interface CompleteAccountBody {
  email: string;
  firstName: string;
  lastName: string;
  bvnNumber: string;
  transactionPin: string;
  slug: string;
}

interface BankAccountBody {
  bankCode: string;
  accountNumber: string;
  slug: string;
}

interface ApproveInstantSwapBody {
  code: string;
  slug: string;
}

export interface WithdrawalReview {
  id: string;
  amount: string;
  fee: string;
  total: string;
  status: "pending" | "processing" | "success" | "failed";
  approved: boolean;
  balance: string;
  bankAccounts: Array<{
    id: string;
    accountName: string;
    accountNumberMasked: string;
    bankCode: string;
    isDefault: boolean;
  }>;
}

interface ApproveNgnWithdrawalBody {
  code: string;
  bankId: string;
  slug: string;
}

export const getBankCatalog = async (): Promise<BankCatalogEntry[]> => {
    const { data } = await axiosInstance.get<{ data: BankCatalogEntry[] }>("banks");
    return data.data;
}

export const completeAccount = async (body: CompleteAccountBody) => {
    const { data } = await axiosInstance.post(`users/create_user/${body.slug}`, body);
    return data;
}

export const addBankAccount = async (body: BankAccountBody) => {
    const { data } = await axiosInstance.post(`users/add_bank_account/${body.slug}`, body);
    return data;
}

export const getSavedBankAccounts = async (): Promise<SavedBankAccount[]> => {
    const { data } = await axiosInstance.get<{ data: SavedBankAccount[] }>("users/bank_accounts");
    return data.data;
}

export const removeSavedBankAccount = async (bankId: string) => {
    const { data } = await axiosInstance.delete(`users/bank_accounts/${bankId}`);
    return data;
}

export const approveInstantSwap = async (body: ApproveInstantSwapBody) => {
    const { data } = await axiosInstance.post(`users/approve_transaction/${body.slug}`, body);
    return data;
}

export const getNgnWithdrawalReview = async (slug: string): Promise<WithdrawalReview> => {
    const { data } = await axiosInstance.get(`users/withdrawals/${slug}`);
    return data.data;
}

export const approveNgnWithdrawal = async (body: ApproveNgnWithdrawalBody) => {
    const { data } = await axiosInstance.post(`users/approve_withdrawal/${body.slug}`, {
      code: body.code,
      bankId: body.bankId,
    });
    return data;
}
