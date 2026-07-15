import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateChairWorkers, ChairNotFoundError } from "../agent-runtime/interview/generate-artifacts.js";
import { writeArtifact } from "../lib/artifact-store.js";

/**
 * Full happy-path coverage (a real worker-selection call actually replacing
 * a chair's roster) needs a real labor-commons SQLite catalog index --
 * getSpecialist/searchBySections both query it directly, and no existing
 * test in this suite fakes that index (labor-commons-client-overlay-axes.test.ts
 * only covers the pure filesystem-path functions). That path is verified
 * live against the real deployment instead, same as the rest of this fix.
 * This covers the one thing regenerateChairWorkers owns before it ever
 * touches the catalog: refusing to operate on a chair that doesn't exist.
 */
describe("regenerateChairWorkers", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "regenerate-chair-test-"));
    process.env.CB_DATA_DIR = tempRoot;
  });

  afterEach(() => {
    delete process.env.CB_DATA_DIR;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("throws ChairNotFoundError when no board exists yet", async () => {
    await assert.rejects(
      () => regenerateChairWorkers("default", "finance"),
      ChairNotFoundError
    );
  });

  test("throws ChairNotFoundError when the board exists but has no chair for that domain", async () => {
    writeArtifact("default", "agent_blueprint", { org_id: "default", chairs: [], schema_version: "1.0" }, "test");
    await assert.rejects(
      () => regenerateChairWorkers("default", "finance"),
      ChairNotFoundError
    );
  });
});
