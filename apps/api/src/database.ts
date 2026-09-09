import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import CONFIG from './config/config';
import Logging from './library/logging.utils';
import * as schema from './db/schema';

const connectionString = CONFIG.NODE_ENV === 'test' && CONFIG.TEST_DATABASE_URL
  ? CONFIG.TEST_DATABASE_URL
  : CONFIG.DATABASE_URL;

const pool = new Pool({
  // Construction is intentionally side-effect free so unit tests can import the
  // application without a database. Startup validates the real configuration.
  connectionString: connectionString
    ?? 'postgresql://127.0.0.1/__database_url_required__',
});

export const db = drizzle({ client: pool, schema });

export const connectDatabase = async (): Promise<void> => {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  await pool.query('select 1');
  Logging.info('PostgreSQL connected successfully.');
};

export const disconnectDatabase = async (): Promise<void> => {
  await pool.end();
  Logging.info('PostgreSQL connection pool closed.');
};
