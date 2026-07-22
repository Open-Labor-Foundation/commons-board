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
 * Walk the interview state machine through all 10 sections (S0–S9) by
 * sending one free-text response per section via POST /:id/respond.
 * The route's parseSection catches NoProviderConfiguredError and falls
 * back to empty/default payloads, so the machine advances even without
 * an inference provider. The final "confirmed" message triggers S9
 * confirmation, making the session ready to finalize.
 */
async function completeInterview(
  workspaceId: string,
  headers: Record<string, string>
): Promise<{ sessionId: string | null; confirmStatus: number }> {
  const start = await request(app)
    .post("/api/v1/interview/start")
    .set(headers);

  if (start.status !== 201) {
    return { sessionId: null, confirmStatus: start.status };
  }

  const sessionId = start.body.session_id as string;

  // S0: governance mode
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "business" });
  // S1: org identity
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "Testing Agent Co, a SaaS platform for development teams" });
  // S2: teams/pains
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "engineering, sales; need faster delivery" });
  // S3: systems
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "GitHub, Slack, Vercel" });
  // S4: objectives
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "ship features faster" });
  // S5: autonomy
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "advisor, low risk" });
  // S6: cadence
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "America/Chicago, 8am daily" });
  // S7: guardrails
  await request(app).post(`/api/v1/interview/${sessionId}/respond`).set(headers).send({ message: "none" });
  // S8 is auto-skipped for business governance mode.
  // S9: confirm
  const confirm = await request(app)
    .post(`/api/v1/interview/${sessionId}/respond`)
    .set(headers)
    .send({ message: "confirmed" });

  return { sessionId, confirmStatus: confirm.status };
}

export async function runIntegrationSimulation(): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const workspaceId = "testing-agent-ws";
  const headers = asUser(workspaceId, "operator", "tester-op");

  console.error("[TA] starting integration simulation");
  // Interview flow — walk all sections then finalize
  const { sessionId, confirmStatus } = await completeInterview(workspaceId, headers);
  console.error("[TA] interview complete");

  checks.push({
    name: "integration:create_interview_session",
    passed: sessionId !== null,
    details: `sessionId=${sessionId ?? "none"}`
  });

  let artifactsGenerated = false;
  if (sessionId) {
    console.error("[TA] finalizing interview");
    const finalize = await request(app)
      .post(`/api/v1/interview/${sessionId}/confirm`)
      .set(headers);
    console.error("[TA] interview finalized");

    artifactsGenerated = finalize.status === 201 || finalize.status === 200;
    checks.push({
      name: "integration:interview_artifacts_generated",
      passed: artifactsGenerated,
      details: `confirmStatus=${confirmStatus}, finalizeStatus=${finalize.status}`
    });
  } else {
    checks.push({
      name: "integration:interview_artifacts_generated",
      passed: false,
      details: `no session created`
    });
  }

  // Execution flow — requires artifacts from interview above
  console.error("[TA] execution run");
  const runExecution = await request(app)
    .post("/api/v1/execution/run")
    .set(headers);
  console.error("[TA] execution done");

  checks.push({
    name: "integration:execution_run",
    passed: runExecution.status === 200,
    details: `status=${runExecution.status}`
  });

  // Cadence flow
  console.error("[TA] cadence run");
  const runCadence = await request(app)
    .post("/api/v1/cadence/run")
    .set(headers);
  console.error("[TA] cadence done");

  checks.push({
    name: "integration:cadence_run",
    passed: runCadence.status === 200,
    details: `status=${runCadence.status}`
  });

  // Decision log
  const logs = await request(app)
    .get("/api/v1/decision-log")
    .set(asUser(workspaceId, "observer", "tester-viewer"));

  checks.push({
    name: "integration:decision_log_accessible",
    passed: logs.status === 200 && Array.isArray(logs.body.entries),
    details: `status=${logs.status}, entries=${logs.body.entries?.length ?? 0}`
  });

  // Launch flow — uses /sessions endpoint, not /start
  console.error("[TA] launch session");
  const launchWorkspaceId = "testing-agent-launch-ws";
  const launchHeaders = asUser(launchWorkspaceId, "operator", "tester-launch-op");
  const launchSession = await request(app)
    .post("/api/v1/launch/sessions")
    .set(launchHeaders);
  console.error("[TA] launch session done");

  checks.push({
    name: "integration:launch_session_created",
    passed: launchSession.status === 201,
    details: `status=${launchSession.status}`
  });

  if (launchSession.status === 201) {
    const launchSessionId = launchSession.body.session_id as string;

    // Walk through all 8 launch sections (L0–L7) by submitting payloads.
    // L0–L6 are skipped (empty payloads are fine — generateLaunchArtifacts
    // uses defaults). L7 is the confirmation section: finalize() requires
    // answers.L7.confirmed === true, so we must submit a real payload.
    const launchSections = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];
    for (const section of launchSections) {
      await request(app)
        .post(`/api/v1/launch/sessions/${launchSessionId}/sections/${section}`)
        .set(launchHeaders)
        .send({ skip: true });
    }
    // L7: confirmation — must have confirmed: true for finalize() to proceed
    await request(app)
      .post(`/api/v1/launch/sessions/${launchSessionId}/sections/L7`)
      .set(launchHeaders)
      .send({ payload: { confirmed: true } });

    const launchConfirm = await request(app)
      .post(`/api/v1/launch/sessions/${launchSessionId}/finalize`)
      .set(launchHeaders);
    checks.push({
      name: "integration:launch_artifacts_generated",
      passed: launchConfirm.status === 201 || launchConfirm.status === 200,
      details: `status=${launchConfirm.status}, body=${JSON.stringify(launchConfirm.body).slice(0, 300)}`
    });
  } else {
    checks.push({
      name: "integration:launch_artifacts_generated",
      passed: false,
      details: `no launch session created`
    });
  }

  // Level 4 flow — uses /launch-from-prompt, not /actions
  console.error("[TA] level4");
  const level4Workspace = "testing-agent-l4-ws";
  const level4Headers = asUser(level4Workspace, "admin", "tester-l4-admin");

  const level4Created = await request(app)
    .post("/api/v1/level4/launch-from-prompt")
    .set(level4Headers)
    .send({ prompt: "Autonomous launch assistant for developer tooling" });
  console.error("[TA] level4 done");

  checks.push({
    name: "integration:level4_action_created",
    passed: level4Created.status === 201 || level4Created.status === 200,
    details: `status=${level4Created.status}`
  });

  // Autonomous evolution cycle
  console.error("[TA] autonomy cycle");
  const autoWorkspace = "testing-agent-autonomy-ws";
  const autoHeaders = asUser(autoWorkspace, "admin", "tester-auto-admin");

  const cycleA = await request(app)
    .post("/api/v1/autonomous/cycle/run")
    .set(autoHeaders);
  console.error("[TA] autonomy done");

  checks.push({
    name: "integration:autonomy_cycle_runs",
    passed: cycleA.status === 200 || cycleA.status === 201,
    details: `status=${cycleA.status}`
  });

  return checks;
}
