import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export function createDatabase(databaseUrl: string, poolMax = 10): {
  db: Database;
  close: () => Promise<void>;
} {
  const client = postgres(databaseUrl, {
    max: poolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
