import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateRegistry } from "./generate-addin-page-registry.mjs";

/**
 * Covers the codegen that replaces ADDIN_PAGES's old requirement of a
 * developer hand-editing a per-pack import. Runs against fixture
 * addins/staging directories, not the real ADDINS_DIR.
 */
describe("generateRegistry", () => {
  let addinsDir;
  let stagingDir;

  beforeEach(() => {
    addinsDir = mkdtempSync(join(tmpdir(), "addins-fixture-"));
    stagingDir = mkdtempSync(join(tmpdir(), "staging-fixture-"));
  });

  afterEach(() => {
    rmSync(addinsDir, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  });

  function installFixturePack(id, { pages = [], missingComponents = [] } = {}) {
    const packDir = join(addinsDir, id);
    mkdirSync(join(packDir, "pages"), { recursive: true });
    writeFileSync(
      join(packDir, "manifest.json"),
      JSON.stringify({ id, version: "1.0.0", name: id, description: "d", artifact_types: [], pages })
    );
    for (const page of pages) {
      if (missingComponents.includes(page.component)) continue;
      writeFileSync(
        join(packDir, "pages", `${page.component}.tsx`),
        `export default function ${page.component}() { return null; }`
      );
    }
    const registryPath = join(addinsDir, "registry.json");
    const current = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : { version: "1", installed: [] };
    current.installed.push(id);
    writeFileSync(registryPath, JSON.stringify(current));
  }

  test("no installed packs produces an empty registry", () => {
    writeFileSync(join(addinsDir, "registry.json"), JSON.stringify({ version: "1", installed: [] }));
    const { content, packCount, pageCount, warnings } = generateRegistry(addinsDir, stagingDir);
    assert.equal(packCount, 0);
    assert.equal(pageCount, 0);
    assert.equal(warnings.length, 0);
    assert.match(content, /export const ADDIN_PAGES.*=\s*\{\s*\};/s);
  });

  test("a pack with real page components generates real dynamic imports and stages the files", () => {
    installFixturePack("gig-cooperative", {
      pages: [
        { route: "service-catalog", component: "ServiceCatalogPage" },
        { route: "earnings", component: "EarningsPage" },
      ],
    });

    const { content, packCount, pageCount, warnings } = generateRegistry(addinsDir, stagingDir);
    assert.equal(packCount, 1);
    assert.equal(pageCount, 2);
    assert.equal(warnings.length, 0);
    assert.match(content, /"service-catalog": dynamic\(\(\) => import\("\.\.\/addins\/gig-cooperative\/pages\/ServiceCatalogPage"\)\)/);
    assert.ok(existsSync(join(stagingDir, "gig-cooperative", "pages", "ServiceCatalogPage.tsx")));
    assert.ok(existsSync(join(stagingDir, "gig-cooperative", "pages", "EarningsPage.tsx")));
  });

  test("a page component that doesn't exist yet is skipped with a warning, not a crash", () => {
    installFixturePack("startup-launch", {
      pages: [{ route: "venture-profile", component: "VentureProfilePage" }],
      missingComponents: ["VentureProfilePage"],
    });

    const { content, packCount, pageCount, warnings } = generateRegistry(addinsDir, stagingDir);
    assert.equal(packCount, 0, "a pack with zero successfully-staged pages should not appear at all");
    assert.equal(pageCount, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /VentureProfilePage.*not found/);
    assert.equal(content.includes("startup-launch"), false);
  });

  test("an unsafe component name is refused, not interpolated into the generated import", () => {
    installFixturePack("bad-pack", {
      pages: [{ route: "x", component: "../../evil" }],
    });

    const { content, warnings } = generateRegistry(addinsDir, stagingDir);
    assert.equal(content.includes("../../evil"), false);
    assert.ok(warnings.some((w) => w.includes("not a safe identifier")));
  });

  test("re-running against a changed install set drops stale staged files (fresh staging dir each run)", () => {
    installFixturePack("pack-a", { pages: [{ route: "x", component: "XPage" }] });
    generateRegistry(addinsDir, stagingDir);
    assert.ok(existsSync(join(stagingDir, "pack-a", "pages", "XPage.tsx")));

    rmSync(addinsDir, { recursive: true, force: true });
    addinsDir = mkdtempSync(join(tmpdir(), "addins-fixture-"));
    writeFileSync(join(addinsDir, "registry.json"), JSON.stringify({ version: "1", installed: [] }));

    generateRegistry(addinsDir, stagingDir);
    assert.equal(existsSync(join(stagingDir, "pack-a")), false, "stale staged pack should be gone after re-generation");
  });
});
