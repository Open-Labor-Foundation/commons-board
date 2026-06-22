/**
 * commons-board API gateway.
 *
 * Phase 1 wiring: config validation (fails fast on bad signing config in
 * strict/production), correlation IDs, health, and a structured error handler.
 * Routes (settings, interview, approvals, ...) mount here as their phases land.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { loadConfig } from "./lib/env.js";
import { validateGovernanceSigningConfig } from "./lib/governance-signing.js";
import { correlationId } from "./lib/request-context.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(correlationId);

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", service: "commons-board-api" });
  });

  // Route mounts land here per phase:
  //   app.use("/api/v1/settings", settingsRouter);     // Phase 1 (lane)
  //   app.use("/api/v1/interview", interviewRouter);   // Phase 2
  //   app.use("/api/v1/approvals", approvalsRouter);   // Phase 4

  // Structured error handler (last).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: message, correlation_id: req.correlationId });
  });

  return app;
}

export function start(): void {
  const config = loadConfig();
  // Fail fast if governance signing is misconfigured for the environment.
  validateGovernanceSigningConfig();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`commons-board API listening on :${config.port} (${config.nodeEnv})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
