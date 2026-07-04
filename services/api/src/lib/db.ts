/**
 * PostgreSQL access. A thin pool wrapper; later phases extend query surface.
 *
 * If DATABASE_URL is unset, the pool is not created and `isDatabaseEnabled()`
 * returns false — callers fall back to the file-backed store for local dev.
 */
import pg from "pg";
import { loadConfig } from "./env.js";

let pool: pg.Pool | null = null;

export function isDatabaseEnabled(): boolean {
  return loadConfig().databaseUrl.trim() !== "";
}

export function getPool(): pg.Pool {
  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadConfig().databaseUrl });
  }
  return pool;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<R>> {
  return getPool().query<R>(text, params as never[]);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
