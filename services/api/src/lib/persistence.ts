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

const SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Keys are built from request-derived values (workspaceId, ids, etc.) via
 * template strings like `settings/${workspaceId}`. Reject any segment that
 * isn't a bare filesystem-safe token so a value like "../../etc/passwd"
 * can't escape dataDir.
 */
function resolvePath(name: string): string {
  const segments = name.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || !SEGMENT_PATTERN.test(segment)) {
      throw new Error(`invalid persistence key: ${JSON.stringify(name)}`);
    }
  }
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
