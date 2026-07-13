import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { UI_DOMAIN_TO_CHAIR_ROLE } from "../agent-runtime/interview/generate-artifacts.js";

// The exact seven values CHAIR_CONTEXT_SYSTEM's prompt instructs the LLM to
// produce ui_domain as ("Set ui_domain to exactly one of: finance, ops, hr,
// growth, it, legal, security"), plus what the guaranteed-domain fallback
// list in inferChairContexts() can append. If either drifts, this test
// should be updated to match -- it exists to catch an *unintentional* gap,
// not to pin the prompt text itself.
const ONBOARDING_UI_DOMAINS = ["finance", "ops", "hr", "growth", "it", "legal", "security"];

describe("UI_DOMAIN_TO_CHAIR_ROLE", () => {
  test("covers every ui_domain the onboarding chair-context prompt can produce", () => {
    for (const domain of ONBOARDING_UI_DOMAINS) {
      assert.ok(domain in UI_DOMAIN_TO_CHAIR_ROLE, `missing mapping for ui_domain "${domain}"`);
    }
  });

  test("maps growth to marketing and ops to operations (the two renames)", () => {
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.growth, "marketing");
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.ops, "operations");
  });

  test("maps finance, hr, legal, it, and security 1:1", () => {
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.finance, "finance");
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.hr, "hr");
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.legal, "legal");
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.it, "it");
    assert.equal(UI_DOMAIN_TO_CHAIR_ROLE.security, "security");
  });
});
