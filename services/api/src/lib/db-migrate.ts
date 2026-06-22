/**
 * Migration runner. Applies db/migrations/*.sql in lexical order, tracking
 * applied files in a schema_migrations table. Idempotent.
 *
 * Run: npm run migrate -w @commons-board/api
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, isDatabaseEnabled, closePool } from "./db.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations");

export async function runMigrations(): Promise<string[]> {
  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL is not configured; cannot run migrations");
  }
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const { rowCount } = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (rowCount && rowCount > 0) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

// Allow direct execution: `node --import tsx src/lib/db-migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `applied: ${applied.join(", ")}` : "no pending migrations");
      return closePool();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
