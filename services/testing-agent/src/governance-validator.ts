import request from "supertest";
import { createApp } from "../../api/src/index.js";
import type { ValidationCheck } from "./types.js";

// The testing-agent runs in-process against createApp() with no real auth
// backend. Enable insecure header auth so the identity headers (x-user-id,
// x-workspace-id, x-user-role) are trusted without a JWT or API token.
// This mirrors the single-operator dev posture documented in auth.ts.
process.env.CB_INSECURE_HEADER_AUTH = "true";

const app = createApp();

// Roles must match the auth ROLE_SET: admin | operator | member | observer.
type Role = "admin" | "operator" | "member" | "observer";

function asUser(workspaceId: string, role: Role, userId = "testing-agent"): Record<string, string> {
  return {
    "x-user-id": userId,
    "x-workspace-id": workspaceId,
    "x-user-role": role
  };
}

/**
 * Schema-valid business_profile payload matching the JSON Schema in
 * @commons-board/shared/schemas/business_profile.schema.json.
 */
function validBusinessProfile(orgId: string) {
  return {
    org_id: orgId,
    org_name: "TestOrg",
    governance_mode: "business",
    description: "A test organization for governance validation",
    industry: "SaaS",
    primary_domain: "ops",
    operating_since: null,
    location: { primary: "Austin, TX", regions: [] },
    size: { headcount: 10, member_count: null },
    external_systems: [],
    created_at: new Date().toISOString(),
    schema_version: "1.0"
  };
}

/**
 * Schema-valid objective_config payload matching the JSON Schema in
 * @commons-board/shared/schemas/objective_config.schema.json.
 */
function validObjectiveConfig(orgId: string) {
  return {
    org_id: orgId,
    primary_objectives: [{
      id: "obj-1",
      description: "Test objective",
      type: "growth" as const,
      priority: 1,
      success_criteria: ["pass tests"],
      target_date: null
    }],
    kpis: [],
    constraints: [],
    schema_version: "1.0"
  };
}

export async function runGovernanceValidation(): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Observer role should NOT be allowed to write artifacts (requires admin/operator)
  const unauthorizedWrite = await request(app)
    .post("/api/v1/artifacts/objective_config")
    .set(asUser("gov-ws", "observer", "viewer-user"))
    .send({ payload: validObjectiveConfig("gov-ws") });

  checks.push({
    name: "governance:unauthorized_write_blocked",
    passed: unauthorizedWrite.status === 403,
    details: `status=${unauthorizedWrite.status}`
  });

  // Create an artifact as operator in workspace gov-a
  const create = await request(app)
    .post("/api/v1/artifacts/business_profile")
    .set(asUser("gov-a", "operator", "op-a"))
    .send({ payload: validBusinessProfile("gov-a") });

  // Attempt to read that artifact from a different workspace (gov-b).
  // The artifact store scopes by org_id from req.ctx.workspaceId, so
  // gov-b should get 404 even though gov-a's artifact exists.
  const crossRead = await request(app)
    .get("/api/v1/artifacts/business_profile/1")
    .set(asUser("gov-b", "observer", "view-b"));

  checks.push({
    name: "governance:cross_tenant_read_blocked",
    passed: create.status === 201 && crossRead.status === 404,
    details: `create=${create.status}, crossRead=${crossRead.status}`
  });

  // Direct connector bypass check: webhooks route must reject unsigned delivery attempts
  const unsignedDelivery = await request(app)
    .post("/api/v1/webhooks/deliver")
    .set(asUser("gov-a", "observer", "viewer-user"))
    .send({ event_name: "governance.decision_made", payload: {} });

  checks.push({
    name: "governance:direct_connector_call_blocked",
    passed: unsignedDelivery.status === 403 || unsignedDelivery.status === 404,
    details: `status=${unsignedDelivery.status}`
  });

  return checks;
}
