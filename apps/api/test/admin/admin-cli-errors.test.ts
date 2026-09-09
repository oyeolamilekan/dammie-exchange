import { describe, expect, it } from 'vitest';
import { adminCreationErrorMessage } from '../../src/services/admin/admin-cli-errors';

const wrapped = (code: string, message: string) => ({
  message: 'Failed query: insert into admins params: sensitive-password-hash',
  cause: { code, message },
});

describe('admin creation CLI errors', () => {
  it('explains missing migrations without printing the generated hash', () => {
    const message = adminCreationErrorMessage(wrapped('42P01', 'relation "admins" does not exist'));
    expect(message).toContain('db:migrate');
    expect(message).not.toContain('sensitive-password-hash');
  });

  it('distinguishes duplicate email and offline database failures', () => {
    expect(adminCreationErrorMessage(wrapped('23505', 'duplicate key'))).toContain('already exists');
    expect(adminCreationErrorMessage(wrapped('ECONNREFUSED', 'connect ECONNREFUSED'))).toContain('not accepting connections');
  });
});

