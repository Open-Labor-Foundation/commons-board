/**
 * commons-board API gateway.
 *
 * Phase 1 wiring: config validation (fails fast on bad signing config in
 * strict/production), correlation IDs, health, and a structured error handler.
 * Routes (settings, interview, approvals, ...) mount here as their phases land.
 */
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadConfig } from "./lib/env.js";
import { validateGovernanceSigningConfig } from "./lib/governance-signing.js";
import { correlationId } from "./lib/request-context.js";
import { corsMiddleware, securityHeadersMiddleware, basicRateLimitMiddleware } from "./lib/http-security.js";
import { settingsRouter } from "./routes/settings.js";
import { interviewRouter } from "./routes/interview.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { artifactsRouter } from "./routes/artifacts.js";
import { workspaceRouter } from "./routes/workspace.js";
import { orgRouter } from "./routes/org.js";
import { approvalsRouter } from "./routes/approvals.js";
import { votesRouter } from "./routes/votes.js";
import { amendmentsRouter } from "./routes/amendments.js";
import { decisionLogRouter } from "./routes/decision-log.js";
import { motherboardRouter } from "./routes/motherboard.js";
import { motherboardChatRouter } from "./routes/motherboard-chat.js";
import { simulationBoardRouter } from "./routes/simulation-board.js";
import { executionRouter } from "./routes/execution.js";
import { cadenceRouter } from "./routes/cadence.js";
import { briefTemplatesRouter } from "./routes/brief-templates.js";
import { businessIntelligenceRouter } from "./routes/business-intelligence.js";
import { observabilityRouter } from "./routes/observability.js";
import { eventsRouter } from "./routes/events.js";
import { launchRouter } from "./routes/launch.js";
import { level4Router } from "./routes/level4.js";
import { autonomousCompanyRouter } from "./routes/autonomous-company.js";
import { billingRouter } from "./routes/billing.js";
import { treasuryRouter } from "./routes/treasury.js";
import { crewBridgeRouter } from "./routes/crew-bridge.js";
import { federationRouter } from "./routes/federation.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { evalsRouter } from "./routes/evals.js";
import { feedbackRouter } from "./routes/feedback.js";
import { hrAgentRouter } from "./routes/hr-agent.js";
import { meetingsRouter } from "./routes/meetings.js";
import { actionsRouter } from "./routes/actions.js";
import { demoRouter } from "./routes/demo.js";
import { workersRouter } from "./routes/workers.js";
import { addinsRouter } from "./routes/addins.js";
import { aiChatRouter } from "./routes/ai-chat.js";
import { idempotencyGuard } from "./lib/idempotency.js";
import "./lib/provider/bootstrap.js"; // registers built-in inference adapters
import { startJobRunner } from "./services/agent-job-runner.js";
import { runCadence } from "./routes/cadence.js";
import { isDue, getCadenceState, type CadenceProtocol as SchedulerCadenceProtocol } from "./workers/scheduler.js";
import { readJson } from "./lib/persistence.js";
import { getArtifact } from "./lib/artifact-store.js";

export function createApp() {
  const app = express();
  app.use(corsMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(basicRateLimitMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(correlationId);
  app.use(idempotencyGuard);

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", service: "commons-board-api" });
  });

  // Route mounts land here per phase:
  app.use("/api/v1/settings", settingsRouter);     // Phase 1
  app.use("/api/v1/interview", interviewRouter);   // Phase 2
  app.use("/api/v1/onboarding", onboardingRouter); // Phase 2
  app.use("/api/v1/artifacts", artifactsRouter);   // Phase 2
  app.use("/api/v1/workspace", workspaceRouter);   // Phase 2
  app.use("/api/v1/org", orgRouter);               // Phase 3
  app.use("/api/v1/approvals", approvalsRouter);   // Phase 4
  app.use("/api/v1/votes", votesRouter);           // Phase 4
  app.use("/api/v1/amendments", amendmentsRouter); // Phase 4
  app.use("/api/v1/decision-log", decisionLogRouter); // Phase 4
  app.use("/api/v1/board/chat", motherboardChatRouter); // Phase 5 (must precede /api/v1/board)
  app.use("/api/v1/board", motherboardRouter);      // Phase 5
  app.use("/api/v1/sim", simulationBoardRouter);   // Phase 5
  app.use("/api/v1/execution", executionRouter);        // Phase 6
  app.use("/api/v1/cadence", cadenceRouter);            // Phase 7
  app.use("/api/v1/brief-templates", briefTemplatesRouter); // Phase 7
  app.use("/api/v1/bi", businessIntelligenceRouter);    // Phase 7
  app.use("/api/v1/obs", observabilityRouter);          // Phase 7
  app.use("/api/v1/events", eventsRouter);              // Phase 7
  app.use("/api/v1/launch", launchRouter);             // Phase 8
  app.use("/api/v1/level4", level4Router);             // Phase 9
  app.use("/api/v1/autonomous", autonomousCompanyRouter); // Phase 10
  app.use("/api/v1/billing", billingRouter);             // Phase 11
  app.use("/api/v1/treasury", treasuryRouter);           // Phase 11
  app.use("/api/v1/crew-bridge", crewBridgeRouter);      // Phase 12
  app.use("/api/v1/federation", federationRouter);       // Phase 14
  app.use("/api/v1/webhooks", webhooksRouter);           // Phase 15
  app.use("/api/v1/evals", evalsRouter);                 // Phase 16
  app.use("/api/v1/feedback", feedbackRouter);           // Phase 16
  app.use("/api/v1/hr", hrAgentRouter);                  // gated capability, disabled by default
  app.use("/api/v1/meetings", meetingsRouter);           // meetings + executive sessions
  app.use("/api/v1/sim", actionsRouter);                 // actions + ledger (extends sim)
  app.use("/api/v1/demo", demoRouter);                   // demo mode seeding
  app.use("/api/v1/workers", workersRouter);             // agent workforce visibility
  app.use("/api/v1/addins", addinsRouter);               // installed add-in registry
  app.use("/api/v1/ai/chat", aiChatRouter);              // freeform direct AI chat

  // Structured error handler (last).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: message, correlation_id: req.correlationId });
  });

  return app;
}

const CADENCE_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function startCadenceScheduler(): void {
  // Collect registered workspaces by checking for existing cadence state or artifacts
  function getActiveWorkspaceIds(): string[] {
    try {
      const known = readJson<string[]>("active-workspaces", ["default"]);
      return known.length > 0 ? known : ["default"];
    } catch {
      return ["default"];
    }
  }

  // Fallback protocol used when no cadence_protocol artifact exists yet.
  const DEFAULT_PROTOCOL: SchedulerCadenceProtocol = {
    enabled: true,
    daily: { enabled: true },
    weekly: { enabled: true }
  };

  async function tick(): Promise<void> {
    const workspaces = getActiveWorkspaceIds();
    for (const workspaceId of workspaces) {
      try {
        const state = getCadenceState(workspaceId);
        // Read the cadence_protocol artifact; fall back to default if absent.
        const artifact = await getArtifact(workspaceId, "cadence_protocol");
        const protocol: SchedulerCadenceProtocol = artifact
          ? { enabled: true, ...(artifact.payload as Record<string, unknown>) } as SchedulerCadenceProtocol
          : DEFAULT_PROTOCOL;
        if (isDue(workspaceId, "daily", protocol)) {
          console.log(`[CB] Cadence due for workspace ${workspaceId} — running`);
          await runCadence(workspaceId, "scheduler");
          console.log(`[CB] Cadence complete for workspace ${workspaceId}`);
        } else {
          void state; // suppress unused warning; state read happens inside isDue
        }
      } catch (err) {
        console.error(`[CB] Cadence error for workspace ${workspaceId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Check 30 seconds after startup, then every 15 minutes
  setTimeout(() => { void tick(); }, 30_000);
  setInterval(() => { void tick(); }, CADENCE_CHECK_INTERVAL_MS);
  console.log("[CB] Cadence scheduler started (check interval: 15m, first check in 30s)");
}

export function start(): void {
  const config = loadConfig();
  // Fail fast if governance signing is misconfigured for the environment.
  validateGovernanceSigningConfig();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`commons-board API listening on :${config.port} (${config.nodeEnv})`);
    startJobRunner();
    startCadenceScheduler();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
