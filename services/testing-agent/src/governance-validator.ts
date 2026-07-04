import request from "supertest";
import app from "../../api/src/index.js";
import type { ValidationCheck } from "./types.js";

type Role = "admin" | "operator" | "viewer";

function asUser(workspaceId: string, role: Role, userId = "testing-agent"): Record<string, string> {
  return {
    "x-user-id": userId,
    "x-workspace-id": workspaceId,
    "x-user-role": role
  };
}

export async function runGovernanceValidation(): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  const unauthorizedWrite = await request(app)
    .post("/api/v1/artifacts/objective_config")
    .set(asUser("gov-ws", "viewer", "viewer-user"))
    .send({
      payload: {
        primary_objective: "margin",
        guardrails: [],
        weights: { objective: 1 },
        risk_appetite: "low"
      }
    });

  checks.push({
    name: "governance:unauthorized_write_blocked",
    passed: unauthorizedWrite.status === 403,
    details: `status=${unauthorizedWrite.status}`
  });

  const create = await request(app)
    .post("/api/v1/artifacts/business_profile")
    .set(asUser("gov-a", "operator", "op-a"))
    .send({
      payload: {
        company_name: "TenantA",
        business_type: "SaaS",
        offerings: [{ name: "Platform" }],
        org: { teams: [] }
      }
    });

  const crossRead = await request(app)
    .get("/api/v1/artifacts/business_profile/1")
    .set(asUser("gov-b", "viewer", "view-b"));

  checks.push({
    name: "governance:cross_tenant_read_blocked",
    passed: create.status === 201 && crossRead.status === 404,
    details: `create=${create.status}, crossRead=${crossRead.status}`
  });

  // Direct connector bypass check: webhooks route must reject unsigned delivery attempts
  const unsignedDelivery = await request(app)
    .post("/api/v1/webhooks/deliver")
    .set(asUser("gov-a", "viewer", "viewer-user"))
    .send({ event_name: "governance.decision_made", payload: {} });

  checks.push({
    name: "governance:direct_connector_call_blocked",
    passed: unsignedDelivery.status === 403 || unsignedDelivery.status === 404,
    details: `status=${unsignedDelivery.status}`
  });

  return checks;
}
