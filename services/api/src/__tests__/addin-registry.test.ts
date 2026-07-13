import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * LOCAL_CATALOG_PATH is read from ADDINS_CATALOG_PATH once at module load
 * (not per-call), so the env override has to be set before the dynamic
 * import below, not in a beforeEach. The real default -- <OLF>/artifact-
 * commons/catalog.json, now that the addin-economy content moved out of
 * commons-artifacts -- was verified separately against the actual cloned
 * repo, not re-tested here.
 */
describe("addin-registry fetchCatalog (local filesystem fallback)", () => {
  let tempDir: string;
  let fetchCatalog: typeof import("../lib/addin-registry.js").fetchCatalog;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "addin-catalog-test-"));
    const catalogPath = join(tempDir, "catalog.json");
    writeFileSync(
      catalogPath,
      JSON.stringify({
        version: "1",
        packs: [
          { id: "test-pack", name: "Test Pack", version: "1.0.0", status: "available", description: "d", author: "a", cb_min_version: "1.0.0", artifact_types: ["x"] }
        ]
      })
    );
    process.env.ADDINS_CATALOG_PATH = catalogPath;
    ({ fetchCatalog } = await import("../lib/addin-registry.js"));
  });

  after(() => {
    delete process.env.ADDINS_CATALOG_PATH;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reads packs from the configured local catalog path", async () => {
    const packs = await fetchCatalog();
    assert.equal(packs.length, 1);
    assert.equal(packs[0].id, "test-pack");
  });

  test("an explicit remote catalogUrl argument takes priority over the local path", async () => {
    let requestedUrl: string | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ packs: [{ id: "remote-pack" }] }) } as Response;
    }) as typeof fetch;

    try {
      const packs = await fetchCatalog("https://example.com/catalog.json");
      assert.equal(requestedUrl, "https://example.com/catalog.json");
      assert.equal(packs[0].id, "remote-pack");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
