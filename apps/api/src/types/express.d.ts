import type { AuthenticatedTelegramUser } from '../services/security/telegram-auth';

declare global {
  namespace Express {
    interface Request {
      telegramUser?: AuthenticatedTelegramUser;
      rawBody?: Buffer;
      admin?: {
        id: string;
        email: string;
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
      };
    }
  }
}

export {};
