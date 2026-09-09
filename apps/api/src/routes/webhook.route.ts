import express from "express";
import { protectCryptoWebhook } from "../middlewares/webhook.middleware";
import { cryptoWebhookController } from "../controllers/webhook.controller";
import { protectTelegramWebhook } from '../middlewares/telegram-webhook.middleware';
import { telegramWebhookController } from '../controllers/telegram-webhook.controller';

const router = express.Router();

router.post("/crypto", protectCryptoWebhook, cryptoWebhookController);
router.post('/telegram', protectTelegramWebhook, telegramWebhookController);

export default router;
