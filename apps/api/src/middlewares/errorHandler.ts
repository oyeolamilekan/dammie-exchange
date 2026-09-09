import { Request, Response, NextFunction } from 'express';
import CONFIG from '../config/config';

/**
 * Express error middleware and application error contract.
 *
 * @module errorHandlerMiddleware
 */

/** Optional HTTP status attached to an application error. */
export interface AppError extends Error {
  status?: number;
}

/**
 * Converts an application error into a JSON response.
 * Production responses hide messages for server errors while preserving
 * client-error messages and non-production diagnostics.
 */
export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(err);
  const status = err.status || 500;
  const message =
    CONFIG.NODE_ENV === 'production' && status >= 500
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(status).json({
    message,
  });
};
