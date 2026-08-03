import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogPack } from "../lib/addin-registry.js";

/**
 * Covers the fix to installPack(): previously it only ever wrote
 * manifest.json, never fetching a pack's real schemas/pages/seeds/README
 * from source_url -- meaning no addin's declared files have ever existed
 * on disk at runtime, for any pack, ever. ADDINS_DIR is read once at
 * module load by addin-registry.ts, so it must be set before the dynamic
 * import below (same constraint as addin-registry.test.ts).
 */
describe("installPack fetches real pack content", () => {
  let addinsDir: string;
  let server: Server;
  let baseUrl: string;
  let served: Record<string, string>;
  let installPack: typeof import("../lib/addin-install.js").installPack;
  let readRegistry: typeof import("../lib/addin-registry.js").readRegistry;
  let getRebuildPending: typeof import("../lib/addin-install.js").getRebuildPending;

  before(async () => {
    addinsDir = mkdtempSync(join(tmpdir(), "addin-install-test-"));
    process.env.ADDINS_DIR = addinsDir;
    ({ installPack } = await import("../lib/addin-install.js"));
    ({ readRegistry } = await import("../lib/addin-registry.js"));
    ({ getRebuildPending } = await import("../lib/addin-install.js"));
  });

  after(() => {
    delete process.env.ADDINS_DIR;
    rmSync(addinsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    served = {};
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const key = (req.url ?? "").replace(/^\//, "");
      const content = served[key];
      if (content === undefined) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(content);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function fixturePack(overrides: Partial<CatalogPack> = {}): CatalogPack {
    return {
      id: "fixture-pack",
      version: "1.0.0",
      name: "Fixture Pack",
      description: "d",
      artifact_types: ["widget_config"],
      pages: [{ route: "widgets", component: "WidgetsPage" }],
      seeds: ["seeds/seed_widgets.py"],
      source_url: baseUrl,
      ...overrides,
    };
  }

  test("fetches schema, page component, seed, and README onto disk", async () => {
    served["schemas/widget_config.schema.json"] = '{"type":"object"}';
    served["pages/WidgetsPage.tsx"] = "export default function WidgetsPage() { return null; }";
    served["seeds/seed_widgets.py"] = "# seed script";
    served["README.md"] = "# Fixture Pack";

    const result = await installPack(fixturePack());

    assert.equal(result.installed, true);
    assert.equal(result.requires_rebuild, true);

    const packDir = join(addinsDir, "fixture-pack");
    assert.equal(
      readFileSync(join(packDir, "schemas", "widget_config.schema.json"), "utf8"),
      '{"type":"object"}'
    );
    assert.equal(
      readFileSync(join(packDir, "pages", "WidgetsPage.tsx"), "utf8"),
      "export default function WidgetsPage() { return null; }"
    );
    assert.equal(readFileSync(join(packDir, "seeds", "seed_widgets.py"), "utf8"), "# seed script");
    assert.equal(readFileSync(join(packDir, "README.md"), "utf8"), "# Fixture Pack");

    const manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.artifact_types, ["widget_config"]);

    assert.ok(readRegistry().includes("fixture-pack"));
    assert.equal(getRebuildPending(addinsDir).packs.includes("fixture-pack"), true);
  });

  test("a pack whose files aren't published yet still installs -- missing files are skipped, not a failed install", async () => {
    // Nothing registered in `served` -- every fetch 404s.
    const result = await installPack(fixturePack({ id: "unpublished-pack" }));

    assert.equal(result.installed, true);
    const packDir = join(addinsDir, "unpublished-pack");
    assert.ok(existsSync(join(packDir, "manifest.json")), "manifest should still be written");
    assert.equal(existsSync(join(packDir, "schemas", "widget_config.schema.json")), false);
    assert.ok(readRegistry().includes("unpublished-pack"), "pack should still be registered");
  });

  test("path traversal in a seed ref is refused, not written outside the pack directory", async () => {
    served["../../etc/passwd"] = "malicious content";
    served["schemas/widget_config.schema.json"] = "{}";

    await installPack(
      fixturePack({ id: "traversal-pack", seeds: ["../../etc/passwd"] })
    );

    const escapedPath = join(addinsDir, "..", "..", "etc", "passwd");
    assert.equal(existsSync(escapedPath), false, "traversal path must never be written to");
  });

  test("a pack with no source_url installs with just the manifest (backward compatible)", async () => {
    const result = await installPack(fixturePack({ id: "no-source-pack", source_url: undefined }));
    assert.equal(result.installed, true);
    assert.ok(existsSync(join(addinsDir, "no-source-pack", "manifest.json")));
  });
});
