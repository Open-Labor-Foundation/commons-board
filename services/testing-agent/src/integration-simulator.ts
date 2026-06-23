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

export async function runIntegrationSimulation(): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const workspaceId = "testing-agent-ws";
  const headers = asUser(workspaceId, "operator", "tester-op");

  // Interview flow
  const createSession = await request(app)
    .post("/api/v1/interview/start")
    .set(headers);

  checks.push({
    name: "integration:create_interview_session",
    passed: createSession.status === 201,
    details: `status=${createSession.status}`
  });

  if (createSession.status === 201) {
    const sessionId = createSession.body.session_id as string;

    const respond = (message: string) =>
      request(app)
        .post(`/api/v1/interview/${sessionId}/respond`)
        .set(headers)
        .send({ message });

    const r1 = await respond("Testing Agent Co, a SaaS platform for development teams");
    const r2 = await respond("collective");
    const r3 = await respond("confirmed");

    checks.push({
      name: "integration:interview_responds",
      passed: [r1, r2, r3].every((r) => r.status === 200),
      details: [r1, r2, r3].map((r) => r.status).join(",")
    });

    const confirm = await request(app)
      .post(`/api/v1/interview/${sessionId}/confirm`)
      .set(headers);

    checks.push({
      name: "integration:interview_artifacts_generated",
      passed: confirm.status === 201 || confirm.status === 200,
      details: `status=${confirm.status}`
    });
  }

  // Execution flow
  const runExecution = await request(app)
    .post("/api/v1/execution/run")
    .set(headers);

  checks.push({
    name: "integration:execution_run",
    passed: runExecution.status === 200,
    details: `status=${runExecution.status}`
  });

  // Cadence flow
  const runCadence = await request(app)
    .post("/api/v1/cadence/run")
    .set(headers);

  checks.push({
    name: "integration:cadence_run",
    passed: runCadence.status === 200,
    details: `status=${runCadence.status}`
  });

  // Decision log
  const logs = await request(app)
    .get("/api/v1/decision-log")
    .set(asUser(workspaceId, "viewer", "tester-viewer"));

  checks.push({
    name: "integration:decision_log_accessible",
    passed: logs.status === 200 && Array.isArray(logs.body.entries),
    details: `status=${logs.status}, entries=${logs.body.entries?.length ?? 0}`
  });

  // Launch flow
  const launchWorkspaceId = "testing-agent-launch-ws";
  const launchHeaders = asUser(launchWorkspaceId, "operator", "tester-launch-op");
  const launchSession = await request(app)
    .post("/api/v1/launch/start")
    .set(launchHeaders);

  checks.push({
    name: "integration:launch_session_created",
    passed: launchSession.status === 201,
    details: `status=${launchSession.status}`
  });

  if (launchSession.status === 201) {
    const launchSessionId = launchSession.body.session_id as string;

    const launchRespond = (message: string) =>
      request(app)
        .post(`/api/v1/launch/${launchSessionId}/respond`)
        .set(launchHeaders)
        .send({ message });

    await launchRespond("10 hours/week, $100/month budget");
    await launchRespond("SaaS, developer tooling");
    await launchRespond("confirmed");

    const launchConfirm = await request(app)
      .post(`/api/v1/launch/${launchSessionId}/confirm`)
      .set(launchHeaders);

    checks.push({
      name: "integration:launch_artifacts_generated",
      passed: launchConfirm.status === 201 || launchConfirm.status === 200,
      details: `status=${launchConfirm.status}`
    });
  }

  // Level 4 flow
  const level4Workspace = "testing-agent-l4-ws";
  const level4Headers = asUser(level4Workspace, "admin", "tester-l4-admin");

  const level4Created = await request(app)
    .post("/api/v1/level4/actions")
    .set(level4Headers)
    .send({ title: "Autonomous launch assistant", action_type: "outreach", description: "Automated outreach for founder-led teams" });

  checks.push({
    name: "integration:level4_action_created",
    passed: level4Created.status === 201,
    details: `status=${level4Created.status}`
  });

  // Autonomous evolution cycle
  const autoWorkspace = "testing-agent-autonomy-ws";
  const autoHeaders = asUser(autoWorkspace, "admin", "tester-auto-admin");

  const cycleA = await request(app)
    .post("/api/v1/autonomous/cycle/run")
    .set(autoHeaders);

  checks.push({
    name: "integration:autonomy_cycle_runs",
    passed: cycleA.status === 200 || cycleA.status === 201,
    details: `status=${cycleA.status}`
  });

  return checks;
}
