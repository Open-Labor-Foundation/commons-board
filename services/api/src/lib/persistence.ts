/**
 * Minimal atomic file-backed JSON persistence for local/dev runtime.
 *
 * Production uses PostgreSQL (see db.ts); this backs the same logical stores
 * when DATABASE_URL is unset so the platform runs with zero external services
 * during development. Writes are atomic (temp file + rename).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "./env.js";

function resolvePath(name: string): string {
  return join(loadConfig().dataDir, `${name}.json`);
}

export function readJson<T>(name: string, fallback: T): T {
  const path = resolvePath(name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(name: string, value: unknown): void {
  const path = resolvePath(name);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, path);
}
