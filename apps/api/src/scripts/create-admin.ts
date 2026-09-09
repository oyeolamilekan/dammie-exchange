import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../database';
import { createAdmin, normalizeAdminEmail } from '../queries/admin-auth.query';
import { adminCreationErrorMessage } from '../services/admin/admin-cli-errors';

const emailSchema = z.string().trim().email().max(250);

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const hiddenQuestion = (prompt: string): Promise<string> => new Promise((resolve) => {
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const input = process.stdin;
  const output = process.stdout;
  output.write(prompt);
  const reader = createInterface({ input, output: muted, terminal: true });
  reader.question('', (answer) => {
    reader.close();
    output.write('\n');
    resolve(answer);
  });
});

const main = async (): Promise<void> => {
  const parsedEmail = emailSchema.safeParse(argumentValue('--email'));
  if (!parsedEmail.success) {
    throw new Error('Usage: bun run admin:create --email <email>');
  }
  if (!process.stdin.isTTY) {
    throw new Error('Admin passwords must be entered from an interactive terminal');
  }

  // Fail before collecting a password when PostgreSQL is offline or misconfigured.
  await connectDatabase();

  const password = await hiddenQuestion('Password (12+ characters): ');
  const confirmation = await hiddenQuestion('Confirm password: ');
  if (password.length < 12) throw new Error('Password must contain at least 12 characters');
  if (password !== confirmation) throw new Error('Passwords do not match');

  const email = normalizeAdminEmail(parsedEmail.data);
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await createAdmin({ email, passwordHash });
  process.stdout.write(`Created admin ${admin.email}\n`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error && [
    'Usage: bun run admin:create --email <email>',
    'Admin passwords must be entered from an interactive terminal',
    'Password must contain at least 12 characters',
    'Passwords do not match',
  ].includes(error.message)
    ? error.message
    : adminCreationErrorMessage(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}).finally(disconnectDatabase);
