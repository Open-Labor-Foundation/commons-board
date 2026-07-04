import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "commons-board-test-"));
  process.env.CB_DATA_DIR = dir;
  return dir;
}

export function removeTestDataDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  delete process.env.CB_DATA_DIR;
}
