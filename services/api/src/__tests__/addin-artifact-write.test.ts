import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactType } from "@commons-board/shared";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";

/**
 * Covers the schema-validator.ts fix: an addin-declared artifact type (not
 * one of the 6 core platform types) previously crashed on write --
 * SCHEMA_FILES[type] was undefined, so require.resolve threw on an
 * "undefined" path. This is the exact shape of write routes/level4.ts
 * (startup-launch's launch-from-prompt) already performs via
 * `"venture_profile" as ArtifactType`, which had zero test coverage before
 * this file and would have thrown if ever actually called. ADDINS_DIR is
 * read once at module load by addin-registry.ts, so it must be set before
 * the dynamic import below, not in beforeEach (same constraint documented
 * in addin-registry.test.ts).
 */
describe("addin-contributed artifact types at the write path", () => {
  let addinsDir: string;
  let writeArtifact: typeof import("../lib/artifact-store.js").writeArtifact;
  let getArtifact: typeof import("../lib/artifact-store.js").getArtifact;
  let ArtifactValidationError: typeof import("../lib/artifact-store.js").ArtifactValidationError;

  before(async () => {
    addinsDir = mkdtempSync(join(tmpdir(), "addins-test-"));
    mkdirSync(join(addinsDir, "test-pack", "schemas"), { recursive: true });
    writeFileSync(
      join(addinsDir, "registry.json"),
      JSON.stringify({ version: "1", installed: ["test-pack"] })
    );
    writeFileSync(
      join(addinsDir, "test-pack", "manifest.json"),
      JSON.stringify({
        id: "test-pack",
        version: "1.0.0",
        name: "Test Pack",
        description: "A fixture addin standing in for a real one.",
        artifact_types: ["widget_config"],
      })
    );
    writeFileSync(
      join(addinsDir, "test-pack", "schemas", "widget_config.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      })
    );
    process.env.ADDINS_DIR = addinsDir;
    ({ writeArtifact, getArtifact, ArtifactValidationError } = await import("../lib/artifact-store.js"));
  });

  after(() => {
    delete process.env.ADDINS_DIR;
    rmSync(addinsDir, { recursive: true, force: true });
  });

  let dataDir: string;

  beforeEach(() => {
    dataDir = createTestDataDir();
    delete process.env.CB_GOVERNANCE_STRICT_SIGNING;
  });

  afterEach(() => {
    removeTestDataDir(dataDir);
  });

  const WIDGET_CONFIG = "widget_config" as ArtifactType;
  const UNKNOWN_TYPE = "totally_unknown_type" as ArtifactType;

  test("writes and validates an addin-declared artifact type against its on-disk schema", () => {
    const record = writeArtifact("test-org", WIDGET_CONFIG, { name: "espresso machine" }, "system");
    assert.equal(record.type, WIDGET_CONFIG);

    const fetched = getArtifact("test-org", WIDGET_CONFIG);
    assert.ok(fetched, "artifact should be persisted and retrievable");
    assert.equal((fetched.payload as { name: string }).name, "espresso machine");
  });

  test("rejects a payload that fails the addin's own schema, and does not persist it", () => {
    assert.throws(
      () => writeArtifact("test-org", WIDGET_CONFIG, { wrong_field: true }, "system"),
      ArtifactValidationError
    );
    assert.equal(getArtifact("test-org", WIDGET_CONFIG), null);
  });

  test("a type that is neither a core platform type nor declared by any installed addin fails validation cleanly, not a crash", () => {
    assert.throws(
      () => writeArtifact("test-org", UNKNOWN_TYPE, {}, "system"),
      (err: unknown) =>
        err instanceof ArtifactValidationError &&
        err.errors.some((message) => message.includes('no schema found for artifact type "totally_unknown_type"'))
    );
  });
});
