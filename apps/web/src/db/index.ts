import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { cfEnv } from '@/lib/cf';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __fsdDb?: Db; __fsdSql?: postgres.Sql };

/**
 * On Cloudflare, connect through Hyperdrive with a fresh client per request (Workers cannot share sockets
 * between requests; Hyperdrive does the pooling). On Node, keep one pooled client for the process.
 */
export function getDb(): Db {
  const hyperdrive = cfEnv()?.HYPERDRIVE;
  if (hyperdrive) {
    const client = postgres(hyperdrive.connectionString, { max: 5, fetch_types: false, onnotice: () => {} });
    return drizzle(client, { schema });
  }
  if (!globalForDb.__fsdDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalForDb.__fsdSql = postgres(url, { max: 10, onnotice: () => {} });
    globalForDb.__fsdDb = drizzle(globalForDb.__fsdSql, { schema });
  }
  return globalForDb.__fsdDb;
}

export { schema };
