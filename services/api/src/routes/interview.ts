/**
 * Interview routes — the onboarding discovery flow that generates all governing
 * artifacts. Supports both governance modes (business + collective).
 *
 * Sessions are held in process memory during the interview (they are short-lived).
 * On confirm, all artifacts are written via the governed artifact store.
 *
 * Routes:
 *   POST   /api/v1/interview/start        — create session
 *   POST   /api/v1/interview/:id/respond  — submit or skip a section
 *   GET    /api/v1/interview/:id/state    — read current session state
 *   POST   /api/v1/interview/:id/confirm  — finalize and persist artifacts
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ArtifactType } from "@commons-board/shared";
import { InterviewStateMachine } from "../agent-runtime/interview/state-machine.js";
import type { InterviewSection } from "../agent-runtime/interview/types.js";
import { writeArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";

export const interviewRouter = Router();

interface SessionEntry {
  orgId: string;
  machine: InterviewStateMachine;
}

const sessions = new Map<string, SessionEntry>();

function getSession(sessionId: string, orgId: string): InterviewStateMachine | null {
  const entry = sessions.get(sessionId);
  if (!entry || entry.orgId !== orgId) return null;
  return entry.machine;
}

interviewRouter.use(requireContext);

/** POST /api/v1/interview/start */
interviewRouter.post("/start", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const sessionId = randomUUID();
  const machine = new InterviewStateMachine(sessionId, orgId);
  sessions.set(sessionId, { orgId, machine });

  res.status(201).json({ session_id: sessionId, state: machine.getState() });
});

/** POST /api/v1/interview/:id/respond */
interviewRouter.post("/:id/respond", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }

  const body = req.body as { section?: string; payload?: unknown; skip?: boolean };
  const section = body.section as InterviewSection | undefined;
  if (!section) {
    res.status(400).json({ error: "section is required" });
    return;
  }

  try {
    if (body.skip === true) {
      machine.skip(section);
    } else {
      machine.submit(section, (body.payload ?? {}) as never);
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid section response" });
    return;
  }

  res.status(200).json({ state: machine.getState() });
});

/** GET /api/v1/interview/:id/state */
interviewRouter.get("/:id/state", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }
  res.status(200).json({ state: machine.getState() });
});

/** POST /api/v1/interview/:id/confirm */
interviewRouter.post("/:id/confirm", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }

  let result: ReturnType<typeof machine.finalize>;
  try {
    result = machine.finalize();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "finalization failed" });
    return;
  }

  const written: Array<{ type: ArtifactType; version: number; artifact_id: string }> = [];
  try {
    for (const [key, payload] of Object.entries(result.artifacts)) {
      if (payload === undefined) continue;
      const type = key as ArtifactType;
      const record = writeArtifact(orgId, type, payload, actor);
      written.push({ type, version: record.version, artifact_id: record.artifact_id });
    }
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "artifact validation failed", details: err.errors });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "failed to persist artifacts" });
    return;
  }

  sessions.delete(req.params.id);

  res.status(201).json({
    assumptions: result.assumptions,
    artifacts: written
  });
});
