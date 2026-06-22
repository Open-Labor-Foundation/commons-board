import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { writeArtifact, getArtifact, getArtifactHistory, ArtifactValidationError } from "../lib/artifact-store.js";

const ORG = "test-org-1";

const validBusinessProfile = {
  org_id: ORG,
  org_name: "Test Co",
  governance_mode: "business" as const,
  description: "A test organization",
  industry: "Technology",
  primary_domain: "testco.example.com",
  operating_since: null,
  location: { primary: "Remote", regions: [] },
  size: { headcount: 5, member_count: null },
  external_systems: [],
  created_at: new Date().toISOString(),
  schema_version: "1.0"
};

describe("artifact-store", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
    // Decision log needs CB_GOVERNANCE_STRICT_SIGNING unset
    delete process.env.CB_GOVERNANCE_STRICT_SIGNING;
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("getArtifact returns null when no artifact exists", () => {
    const result = getArtifact(ORG, "business_profile");
    assert.equal(result, null);
  });

  test("writeArtifact persists a valid business_profile", () => {
    const record = writeArtifact(ORG, "business_profile", validBusinessProfile, "system");
    assert.equal(record.type, "business_profile");
    assert.ok(record.artifact_id, "artifact_id should be set");
    assert.equal(record.version, 1);
  });

  test("getArtifact returns the latest written artifact", () => {
    writeArtifact(ORG, "business_profile", validBusinessProfile, "system");
    const fetched = getArtifact(ORG, "business_profile");
    assert.ok(fetched, "artifact should exist");
    assert.equal((fetched.payload as { org_name: string }).org_name, "Test Co");
  });

  test("writeArtifact increments version on each write", () => {
    writeArtifact(ORG, "business_profile", validBusinessProfile, "system");
    const v2 = writeArtifact(
      ORG,
      "business_profile",
      { ...validBusinessProfile, org_name: "Test Co v2" },
      "system"
    );
    assert.equal(v2.version, 2);
    const latest = getArtifact(ORG, "business_profile");
    assert.equal((latest?.payload as { org_name: string }).org_name, "Test Co v2");
  });

  test("getArtifactHistory returns all versions in order", () => {
    writeArtifact(ORG, "business_profile", validBusinessProfile, "user-a");
    writeArtifact(ORG, "business_profile", { ...validBusinessProfile, org_name: "v2" }, "user-b");
    const history = getArtifactHistory(ORG, "business_profile");
    assert.equal(history.length, 2);
    assert.equal(history[0].version, 1);
    assert.equal(history[1].version, 2);
  });

  test("writeArtifact throws ArtifactValidationError for invalid payload", () => {
    const invalid = { org_id: ORG };
    assert.throws(
      () => writeArtifact(ORG, "business_profile", invalid, "system"),
      ArtifactValidationError
    );
  });

  test("invalid artifact is not persisted after validation failure", () => {
    try {
      writeArtifact(ORG, "business_profile", {}, "system");
    } catch {
      // expected
    }
    const result = getArtifact(ORG, "business_profile");
    assert.equal(result, null);
  });
});
