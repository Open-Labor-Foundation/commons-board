import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildBusinessProfile } from "../agent-runtime/interview/generate-artifacts.js";
import { validateArtifact } from "../lib/schema-validator.js";
import type { InterviewAnswers } from "../agent-runtime/interview/types.js";

/**
 * Caught live: a real generation run (chair inference + six worker-selection
 * calls, several minutes of real inference) completed successfully end to
 * end, then failed at the very last step -- writeArtifact's schema
 * validation -- because S1.operating_since came back from the model as the
 * JSON number 2026 ("operating since 2026"), not a string, and nothing
 * between extraction and the schema-typed artifact coerced it. The whole
 * run's output was discarded over one untyped field. Deliberately not a
 * live end-to-end interview run here -- that costs several real minutes
 * against the actual provider and doesn't add coverage beyond this
 * function, which is where the coercion actually needs to happen.
 */
describe("buildBusinessProfile", () => {
  function baseAnswers(overrides: Partial<InterviewAnswers["S1"]> = {}): InterviewAnswers {
    return {
      S0: { governance_mode: "business" },
      S1: { org_name: "Test Org", description: "test", industry: "software", ...overrides },
    } as InterviewAnswers;
  }

  test("passes real schema validation when operating_since is a number, not a string", () => {
    // @ts-expect-error -- deliberately simulating a model response that doesn't match the TS type
    const profile = buildBusinessProfile(baseAnswers({ operating_since: 2026 }), "org-1");
    assert.equal(profile.operating_since, "2026");
    const result = validateArtifact("business_profile", profile);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });

  test("leaves a real string operating_since untouched", () => {
    const profile = buildBusinessProfile(baseAnswers({ operating_since: "2020" }), "org-1");
    assert.equal(profile.operating_since, "2020");
    assert.equal(validateArtifact("business_profile", profile).valid, true);
  });

  test("passes null through as null, not the string 'null'", () => {
    const profile = buildBusinessProfile(baseAnswers({ operating_since: null }), "org-1");
    assert.equal(profile.operating_since, null);
    assert.equal(validateArtifact("business_profile", profile).valid, true);
  });

  test("coerces a string headcount to a number", () => {
    // @ts-expect-error -- deliberately simulating a model response that doesn't match the TS type
    const profile = buildBusinessProfile(baseAnswers({ size: { headcount: "1" } }), "org-1");
    assert.equal(profile.size.headcount, 1);
    assert.equal(validateArtifact("business_profile", profile).valid, true);
  });

  test("produces a fully schema-valid artifact from realistic answers, end to end", () => {
    const profile = buildBusinessProfile(
      baseAnswers({
        org_name: "Open Labor Foundation",
        industry: "Open-source software / nonprofit technology platform",
        // @ts-expect-error -- deliberately simulates the real model response that broke this live
        operating_since: 2026,
        size: { headcount: 1 },
      }),
      "default"
    );
    const result = validateArtifact("business_profile", profile);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });
});
