import express from "express";
import { addBankAccountController, approveTransactionController, approveWithdrawalController, createUserController, getWithdrawalReviewController, listBankAccountsController, removeBankAccountController } from "../controllers/user.controller";
import { authenticateTelegramMutation, authenticateTelegramRead } from "../middlewares/telegram-auth.middleware";

const router = express.Router();

router.post("/create_user/:id", authenticateTelegramMutation, createUserController)
router.post("/add_bank_account", authenticateTelegramMutation, addBankAccountController)
// Compatibility path: the legacy userId segment is deliberately ignored.
router.post("/add_bank_account/:userId", authenticateTelegramMutation, addBankAccountController)
router.get("/bank_accounts", authenticateTelegramRead, listBankAccountsController)
router.delete("/bank_accounts/:bankId", authenticateTelegramMutation, removeBankAccountController)
router.post("/approve_transaction/:swapId", authenticateTelegramMutation, approveTransactionController)
router.get("/withdrawals/:withdrawalId", authenticateTelegramRead, getWithdrawalReviewController)
router.post("/approve_withdrawal/:withdrawalId", authenticateTelegramMutation, approveWithdrawalController)

export default router;
