import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOverlayDirName, specYamlPath, catalogPathFor, isValidCatalogSlug } from "../lib/labor-commons-client.js";

describe("labor-commons-client overlay axis resolution", () => {
  let lcDir: string;

  beforeEach(() => {
    lcDir = mkdtempSync(join(tmpdir(), "labor-commons-fixture-"));
    process.env.CB_LABOR_COMMONS_PATH = lcDir;

    const naicsDir = join(lcDir, "catalog", "naics-overlays", "some-industry", "naics-specialist");
    mkdirSync(naicsDir, { recursive: true });
    writeFileSync(join(naicsDir, "spec.yaml"), "schema_version: '1.0'\n");

    const functionDir = join(lcDir, "catalog", "function-overlays", "finance", "financial-planning-and-analysis-specialist");
    mkdirSync(functionDir, { recursive: true });
    writeFileSync(join(functionDir, "spec.yaml"), "schema_version: '1.0'\n");
  });

  afterEach(() => {
    rmSync(lcDir, { recursive: true, force: true });
    delete process.env.CB_LABOR_COMMONS_PATH;
  });

  test("resolves a naics-overlays specialist under naics-overlays", () => {
    assert.equal(resolveOverlayDirName("some-industry", "naics-specialist"), "naics-overlays");
  });

  test("resolves a function-overlays specialist under function-overlays", () => {
    assert.equal(resolveOverlayDirName("finance", "financial-planning-and-analysis-specialist"), "function-overlays");
  });

  test("falls back to naics-overlays default when neither exists", () => {
    assert.equal(resolveOverlayDirName("nonexistent-section", "nonexistent-agent"), "naics-overlays");
  });

  test("specYamlPath resolves to the correct axis for a function-overlays specialist", () => {
    const path = specYamlPath("finance", "financial-planning-and-analysis-specialist");
    assert.equal(path, join(lcDir, "catalog", "function-overlays", "finance", "financial-planning-and-analysis-specialist", "spec.yaml"));
  });

  test("catalogPathFor reports function-overlays, not a naics-overlays lie", () => {
    const path = catalogPathFor("finance", "financial-planning-and-analysis-specialist");
    assert.equal(path, "catalog/function-overlays/finance/financial-planning-and-analysis-specialist/spec.yaml");
  });

  test("catalogPathFor still reports naics-overlays for an industry specialist", () => {
    const path = catalogPathFor("some-industry", "naics-specialist");
    assert.equal(path, "catalog/naics-overlays/some-industry/naics-specialist/spec.yaml");
  });

  // CodeQL flagged sectionSlug/agentSlug as an uncontrolled-data path-traversal
  // sink (the practitioner-correction route passes both straight through from
  // an untrusted request body) -- these prove the real fix, not just that the
  // happy path still works.
  describe("rejects path-traversal payloads instead of resolving them", () => {
    const traversalPayloads = [
      "../../../etc",
      "..",
      "foo/../../bar",
      "foo/bar",
      "",
      "UPPERCASE",
      "trailing-slash/",
      "has spaces",
      "semi;colon"
    ];

    for (const payload of traversalPayloads) {
      test(`isValidCatalogSlug rejects ${JSON.stringify(payload)}`, () => {
        assert.equal(isValidCatalogSlug(payload), false);
      });

      test(`resolveOverlayDirName throws for section_slug ${JSON.stringify(payload)}`, () => {
        assert.throws(() => resolveOverlayDirName(payload, "naics-specialist"), /Invalid section_slug/);
      });

      test(`specYamlPath throws for agent_slug ${JSON.stringify(payload)}, never returning a path outside catalog/`, () => {
        assert.throws(() => specYamlPath("some-industry", payload), /Invalid agent_slug/);
      });
    }

    test("a rejected slug is never echoed back in the thrown error message", () => {
      try {
        resolveOverlayDirName("../../../etc/passwd", "x");
        assert.fail("expected resolveOverlayDirName to throw");
      } catch (err) {
        assert.equal((err as Error).message.includes("passwd"), false);
        assert.equal((err as Error).message.includes(".."), false);
      }
    });
  });

  test("isValidCatalogSlug accepts every real slug shape used across the catalog", () => {
    for (const slug of ["gig-cooperative", "accommodation-and-travel-services", "front-office-specialist", "finance", "a", "a1-b2"]) {
      assert.equal(isValidCatalogSlug(slug), true, `expected ${slug} to be valid`);
    }
  });
});
