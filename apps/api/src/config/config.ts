import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const DEFAULT_FRONTEND_URL = 'http://localhost:3000';
const FRONTEND_URL = process.env.FRONTEND_URL?.trim() || DEFAULT_FRONTEND_URL;
const ADMIN_FRONTEND_URL = process.env.ADMIN_FRONTEND_URL?.trim() || FRONTEND_URL;

// Configuration interface
interface CONFIG {
  PORT: number;
  NODE_ENV: string;
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_URL: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  AI_GATEWAY_API_KEY: string;
  AI_MODEL: string;
  REDIS_URL: string;
  FRONTEND_URL: string;
  ADMIN_FRONTEND_URL: string;
  ADMIN_SESSION_HOURS: number;
  ADMIN_LOGIN_WINDOW_SECONDS: number;
  ADMIN_LOGIN_MAX_ATTEMPTS: number;
  TELEGRAM_AUTH_MAX_AGE_SECONDS: number;
  PIN_ATTEMPT_WINDOW_SECONDS: number;
  PIN_MAX_ATTEMPTS: number;
  RATE_LIMIT: {
    WINDOW: number;
    MAX_REQUESTS: number;
  };
  CURRENT_RATES: {
    BTC: number;
    ETH: number;
    USDT: number;
    QDX: number;
  };
}


const CONFIG = {
  FRONTEND_URL,
  ADMIN_FRONTEND_URL,
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN!,
  TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL!,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET!,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY!,
  AI_MODEL: process.env.AI_MODEL || 'deepseek/deepseek-v4-flash-0731',
  QUIDAX_API_URL: process.env.QUIDAX_API_URL,
  QUIDAX_API_KEY: process.env.QUIDAX_API_KEY,
  CRYPTO_WEBHOOK_KEY: process.env.CRYPTO_WEBHOOK_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  ADMIN_SESSION_HOURS: Number(process.env.ADMIN_SESSION_HOURS) || 12,
  ADMIN_LOGIN_WINDOW_SECONDS: Number(process.env.ADMIN_LOGIN_WINDOW_SECONDS) || 900,
  ADMIN_LOGIN_MAX_ATTEMPTS: Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS) || 5,
  TELEGRAM_AUTH_MAX_AGE_SECONDS: Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS) || 300,
  PIN_ATTEMPT_WINDOW_SECONDS: Number(process.env.PIN_ATTEMPT_WINDOW_SECONDS) || 900,
  PIN_MAX_ATTEMPTS: Number(process.env.PIN_MAX_ATTEMPTS) || 5,
  RATE_LIMIT: {
    WINDOW: 60000, // 1 minute
    MAX_REQUESTS: 10
  },
  PENDING: 'pending',
  FAILED: 'failed',
  SUCCESS: 'success',
  STATUS: ['pending', 'failed', 'success'],
  MAIN_ACCOUNT_ID: process.env.MAIN_ACCOUNT_ID as string
};

export default CONFIG;
