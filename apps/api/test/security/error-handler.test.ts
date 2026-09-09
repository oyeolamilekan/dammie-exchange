import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CONFIG from '../../src/config/config';
import { errorHandler } from '../../src/middlewares/errorHandler';

describe('production error responses', () => {
  const originalEnvironment = CONFIG.NODE_ENV;

  afterEach(() => {
    CONFIG.NODE_ENV = originalEnvironment;
    vi.restoreAllMocks();
  });

  it('sanitizes downstream 500 errors without a stack trace', () => {
    CONFIG.NODE_ENV = 'production';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });

    errorHandler(
      new Error('database password leaked in stack'),
      {} as Request,
      { status } as unknown as Response,
      vi.fn() as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ message: 'Internal Server Error' });
    expect(JSON.stringify(json.mock.calls)).not.toContain('database password');
  });
});
