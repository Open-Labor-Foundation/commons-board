/**
 * Launch interview routes — company creation via guided interview.
 *
 * Ported from mother-board routes/launch.ts.
 * Sanitized:
 *   - store.* → writeArtifact() + getArtifact() + appendEvent() + persistence.ts
 *   - store.ensureWorkspaceDefaults() removed (not needed in OLF)
 *   - Agent blueprint uses OLF chair schema (chair_id/domain) not id/type
 *   - "create if missing" for governance artifacts removed (interview phase owns those)
 *   - store.createProductEvent() → appendEvent() with launch event types
 *   - parseArtifactType() inline — only the 4 launch artifacts are valid here
 *
 * Routes:
 *   POST /api/v1/launch/sessions            — create launch interview session
 *   POST /api/v1/launch/sessions/:id/sections/:section — submit or skip a section
 *   GET  /api/v1/launch/sessions/:id/assumptions       — restate inferred assumptions
 *   POST /api/v1/launch/sessions/:id/finalize          — finalize and write artifacts
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { asyncHandler } from "../lib/async-handler.js";
import { writeArtifact, getArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { LaunchInterviewStateMachine } from "../agent-runtime/launch/state-machine.js";
import { mapLaunchToExecutionArtifacts } from "../agent-runtime/launch/generate-artifacts.js";
import type { LaunchSection } from "../agent-runtime/launch/types.js";

export const launchRouter = Router();
launchRouter.use(requireContext);

type LaunchSession = { workspaceId: string; machine: LaunchInterviewStateMachine };
const sessions = new Map<string, LaunchSession>();

function getSession(sessionId: string, workspaceId: string): LaunchInterviewStateMachine | null {
  const session = sessions.get(sessionId);
  if (!session || session.workspaceId !== workspaceId) return null;
  return session.machine;
}

const LAUNCH_ARTIFACT_TYPES = new Set(["venture_profile", "launch_plan", "tooling_plan", "financial_policy"]);

/** POST /api/v1/launch/sessions */
launchRouter.post("/sessions", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const sessionId = randomUUID();
  const machine = new LaunchInterviewStateMachine();
  sessions.set(sessionId, { workspaceId, machine });

  const event: GovernanceEvent = {
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "launch_session_started",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { session_id: sessionId },
    at: new Date().toISOString()
  };
  appendEvent(event);

  res.status(201).json({ session_id: sessionId, state: machine.getState() });
});

/** POST /api/v1/launch/sessions/:sessionId/sections/:section */
launchRouter.post("/sessions/:sessionId/sections/:section", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { sessionId, section } = req.params;
  const machine = getSession(sessionId, workspaceId);

  if (!machine) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  try {
    if (req.body?.skip === true) {
      machine.skip(section as LaunchSection);
    } else {
      machine.submit(section as LaunchSection, req.body?.payload ?? {});
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid launch interview input" });
    return;
  }

  res.status(200).json({ state: machine.getState() });
});

/** GET /api/v1/launch/sessions/:sessionId/assumptions */
launchRouter.get("/sessions/:sessionId/assumptions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const machine = getSession(req.params.sessionId, workspaceId);

  if (!machine) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  res.status(200).json({ assumptions: machine.restateAssumptions() });
});

/** POST /api/v1/launch/sessions/:sessionId/finalize */
launchRouter.post("/sessions/:sessionId/finalize", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { sessionId } = req.params;
  const machine = getSession(sessionId, workspaceId);

  if (!machine) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  try {
    const result = machine.finalize();

    // Write the 4 launch artifacts — venture_profile, launch_plan, tooling_plan, financial_policy
    const createdArtifacts: Array<{ artifact_type: string; version: number; artifact_id: string }> = [];

    for (const [key, payload] of Object.entries(result.artifacts)) {
      if (!LAUNCH_ARTIFACT_TYPES.has(key)) {
        throw new Error(`unsupported launch artifact type: ${key}`);
      }
      // Safe: we just checked the set above
      const record = await writeArtifact(workspaceId, key as Parameters<typeof writeArtifact>[1], payload, userId);
      createdArtifacts.push({ artifact_type: record.type, version: record.version, artifact_id: record.artifact_id });
    }

    // Write the agent_blueprint — OLF chair schema
    const existingBlueprint = await getArtifact(workspaceId, "agent_blueprint");
    if (!existingBlueprint) {
      const launchBlueprint = {
        org_id: workspaceId,
        chairs: [
          {
            chair_id: "strategy-1",
            name: "Strategy Governor",
            domain: "strategy",
            description: "Governs the launch playbook and overall objective alignment.",
            labor_commons_refs: [],
            scope: { owns: ["objective_score", "guardrail_violations"], refuses: [], escalates_to: [] },
            worker_agents: [],
            approval_required_for: []
          },
          {
            chair_id: "growth-1",
            name: "Growth Chair",
            domain: "growth",
            description: "Drives launch experiments and qualified pipeline conversations.",
            labor_commons_refs: [],
            scope: { owns: ["experiment_velocity", "qualified_conversations_per_week"], refuses: [], escalates_to: ["strategy-1"] },
            worker_agents: [],
            approval_required_for: ["launch_provisioning"]
          },
          {
            chair_id: "finance-1",
            name: "Finance Guard",
            domain: "finance",
            description: "Enforces spend caps and flags policy violations.",
            labor_commons_refs: [],
            scope: { owns: ["spend_cap_violations", "weekly_spend"], refuses: ["financial_account_changes"], escalates_to: ["strategy-1"] },
            worker_agents: [],
            approval_required_for: []
          },
          {
            chair_id: "product-1",
            name: "Product Delivery Chair",
            domain: "product",
            description: "Tracks throughput and cycle time for the product backlog.",
            labor_commons_refs: [],
            scope: { owns: ["throughput", "cycle_time"], refuses: [], escalates_to: ["strategy-1"] },
            worker_agents: [],
            approval_required_for: ["reprioritize_backlog"]
          },
          {
            chair_id: "ops-1",
            name: "Operations Chair",
            domain: "ops",
            description: "Monitors handoff time and process friction.",
            labor_commons_refs: [],
            scope: { owns: ["handoff_time", "process_friction"], refuses: [], escalates_to: ["strategy-1"] },
            worker_agents: [],
            approval_required_for: []
          }
        ],
        schema_version: "1.0"
      };
      const bpRecord = await writeArtifact(workspaceId, "agent_blueprint", launchBlueprint, userId);
      createdArtifacts.push({ artifact_type: bpRecord.type, version: bpRecord.version, artifact_id: bpRecord.artifact_id });
    }

    // Map launch answers → execution-required artifacts so the engine can run immediately
    const executionArtifacts = mapLaunchToExecutionArtifacts(workspaceId, result.artifacts, machine.getState().answers);
    const EXECUTION_ARTIFACT_TYPES = ["business_profile", "objective_config", "autonomy_policy", "cadence_protocol"] as const;
    for (const type of EXECUTION_ARTIFACT_TYPES) {
      const existing = await getArtifact(workspaceId, type);
      if (!existing) {
        const rec = await writeArtifact(workspaceId, type, executionArtifacts[type], userId);
        createdArtifacts.push({ artifact_type: rec.type, version: rec.version, artifact_id: rec.artifact_id });
      }
    }

    sessions.delete(sessionId);

    const event: GovernanceEvent = {
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "launch_artifacts_written",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        session_id: sessionId,
        artifacts_written: createdArtifacts.length,
        artifact_types: createdArtifacts.map((a) => a.artifact_type)
      },
      at: new Date().toISOString()
    };
    await appendEvent(event);

    res.status(201).json({
      assumptions: result.assumptions,
      artifacts: createdArtifacts,
      launch_blueprint_instantiated: true
    });
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      res.status(400).json({ error: "artifact validation failed", details: error.errors });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : "failed to finalize launch session" });
  }
}));
