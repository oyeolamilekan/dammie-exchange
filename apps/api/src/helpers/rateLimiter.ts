import CONFIG from "../config/config";

// Types
interface UserLimit {
  count: number;
  resetTime: number;
}

// Rate limiting class
export class RateLimiter {
  private userLimits = new Map<number, UserLimit>();

  isLimited(userId: number): boolean {
    const now = Date.now();
    const userLimit = this.userLimits.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.userLimits.set(userId, {
        count: 1,
        resetTime: now + CONFIG.RATE_LIMIT.WINDOW
      });
      return false;
    }

    if (userLimit.count >= CONFIG.RATE_LIMIT.MAX_REQUESTS) {
      return true;
    }

    userLimit.count++;
    return false;
  }
}