import { createInterface } from 'node:readline';
import { Writable, type Readable } from 'node:stream';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../database';
import { runSetupSeeds, SetupSeedError } from '../db/seeds';

const emailSchema = z.string().trim().email().max(250);

/** Expected input failure whose message is safe for CLI output. */
export class SetupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupInputError';
  }
}

/** Validates and normalizes the values collected by the setup prompt. */
export const validateAdministratorEmail = (email: string): string => {
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) throw new SetupInputError('Enter a valid administrator email address');
  return parsedEmail.data.toLowerCase();
};

/** Validates and normalizes all values collected by the setup prompt. */
export const validateSetupInput = (email: string, password: string, confirmation: string) => {
  const administratorEmail = validateAdministratorEmail(email);
  if (password.length < 12) throw new SetupInputError('Password must contain at least 12 characters');
  if (password !== confirmation) throw new SetupInputError('Passwords do not match');
  return { administratorEmail, administratorPassword: password };
};

/** Rejects redirected input/output before any credentials are requested. */
export const requireInteractiveTerminal = (stdinIsTTY?: boolean, stdoutIsTTY?: boolean): void => {
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new SetupInputError('Setup must be run from an interactive terminal');
  }
};

const visibleQuestion = (input: Readable, output: Writable, prompt: string): Promise<string> => (
  new Promise((resolve) => {
    const reader = createInterface({ input, output, terminal: true });
    reader.question(prompt, (answer) => {
      reader.close();
      resolve(answer);
    });
  })
);

const hiddenQuestion = (input: Readable, output: Writable, prompt: string): Promise<string> => (
  new Promise((resolve) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    output.write(prompt);
    const reader = createInterface({ input, output: muted, terminal: true });
    reader.question('', (answer) => {
      reader.close();
      output.write('\n');
      resolve(answer);
    });
  })
);

interface ErrorWithCause {
  code?: string;
  cause?: unknown;
}

const deepestError = (error: unknown): ErrorWithCause => {
  let current = error as ErrorWithCause;
  const visited = new Set<unknown>();
  while (current?.cause && !visited.has(current.cause)) {
    visited.add(current);
    current = current.cause as ErrorWithCause;
  }
  return current ?? {};
};

/** Converts setup failures into messages that cannot expose credentials or hashes. */
export const setupErrorMessage = (error: unknown): string => {
  if (error instanceof SetupInputError || error instanceof SetupSeedError) return error.message;
  if (error instanceof Error && error.message === 'DATABASE_URL is required') return error.message;

  switch (deepestError(error).code) {
    case '42P01':
      return 'Setup tables do not exist. Run `bun run db:migrate`, then retry';
    case 'ECONNREFUSED':
      return 'PostgreSQL is not accepting connections. Start PostgreSQL and verify DATABASE_URL, then retry';
    case '28P01':
      return 'PostgreSQL rejected the configured credentials. Check DATABASE_URL, then retry';
    case '3D000':
      return 'The configured PostgreSQL database does not exist. Create it or update DATABASE_URL, then retry';
    default:
      return 'Unable to complete setup. Check PostgreSQL and the latest migration, then retry';
  }
};

export const main = async (): Promise<void> => {
  requireInteractiveTerminal(process.stdin.isTTY, process.stdout.isTTY);

  const email = validateAdministratorEmail(
    await visibleQuestion(process.stdin, process.stdout, 'Administrator email: '),
  );
  const password = await hiddenQuestion(process.stdin, process.stdout, 'Password (12+ characters): ');
  const confirmation = await hiddenQuestion(process.stdin, process.stdout, 'Confirm password: ');
  const input = validateSetupInput(email, password, confirmation);

  await connectDatabase();
  const counts = await runSetupSeeds(input);
  process.stdout.write(
    `Setup complete: ${counts.bankCatalog} banks, ${counts.administrators} administrator, `
    + `${counts.platformFees} platform fees, ${counts.platformFeeAudits} audit records.\n`,
  );
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${setupErrorMessage(error)}\n`);
    process.exitCode = 1;
  }).finally(disconnectDatabase);
}
