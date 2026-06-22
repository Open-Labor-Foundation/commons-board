/**
 * Amendments routes — collective artifact amendment workflow.
 *
 * Amendment workflow:
 *   proposed → noticed (if notice_period > 0) → voting → applied | rejected
 *
 * Artifact is only written after the vote passes and applyAmendment is called.
 *
 * Routes:
 *   POST /api/v1/amendments               — propose an amendment
 *   GET  /api/v1/amendments               — list amendments
 *   GET  /api/v1/amendments/:id           — single amendment
 *   POST /api/v1/amendments/:id/advance   — advance amendment to next stage
 *   POST /api/v1/amendments/:id/apply     — apply after vote passes (writes artifact)
 */
import { Router, type Request, type Response } from "express";
import type { ArtifactType } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact, writeArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import {
  proposeAmendment,
  getAmendment,
  listAmendments,
  advanceAmendment,
  applyAmendment,
  getVote
} from "../lib/collective-governance.js";

export const amendmentsRouter = Router();
amendmentsRouter.use(requireContext);

/** POST /api/v1/amendments */
amendmentsRouter.post("/", requireRole(["admin", "operator", "member"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const body = req.body as {
    artifact_type?: string;
    proposed_payload?: Record<string, unknown>;
    notice_period_hours?: number;
  };

  if (!body.artifact_type || !body.proposed_payload) {
    res.status(400).json({ error: "artifact_type and proposed_payload are required" });
    return;
  }

  const cc = getArtifact(orgId, "collective_config")?.payload as Record<string, unknown> | undefined;
  const amendProtocol = cc?.amendment_protocol as Record<string, unknown> | undefined;
  const noticePeriodHours = body.notice_period_hours ?? (amendProtocol?.notice_period_hours as number ?? 24);

  const amendment = proposeAmendment({
    orgId,
    artifactType: body.artifact_type,
    proposedBy: actor,
    proposedPayload: body.proposed_payload,
    noticePeriodHours
  });

  res.status(201).json(amendment);
});

/** GET /api/v1/amendments */
amendmentsRouter.get("/", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const status = req.query.status as string | undefined;
  const amendments = listAmendments(orgId, status as Parameters<typeof listAmendments>[1]);
  res.status(200).json({ amendments, total: amendments.length });
});

/** GET /api/v1/amendments/:id */
amendmentsRouter.get("/:id", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const amendment = getAmendment(orgId, req.params.id);
  if (!amendment) { res.status(404).json({ error: "amendment not found" }); return; }

  // Include associated vote if in voting stage
  let vote = null;
  if (amendment.vote_id) vote = getVote(orgId, amendment.vote_id);

  res.status(200).json({ amendment, vote });
});

/** POST /api/v1/amendments/:id/advance */
amendmentsRouter.post("/:id/advance", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const body = req.body as {
    vote_duration_hours?: number;
    vote_method?: string;
    supermajority_threshold?: number;
    quorum_threshold?: number;
  };

  const cc = getArtifact(orgId, "collective_config")?.payload as Record<string, unknown> | undefined;
  const voting = cc?.voting as Record<string, unknown> | undefined;
  const membership = cc?.membership as Record<string, number> | undefined;
  const amendProtocol = cc?.amendment_protocol as Record<string, unknown> | undefined;

  try {
    const amendment = advanceAmendment({
      orgId,
      amendmentId: req.params.id,
      actor,
      voteDurationHours: body.vote_duration_hours ?? (voting?.standard_vote_duration_hours as number ?? 72),
      voteMethod: (body.vote_method ?? amendProtocol?.amendment_vote_method ?? "supermajority") as Parameters<typeof advanceAmendment>[0]["voteMethod"],
      supermajorityThreshold: body.supermajority_threshold ?? (voting?.supermajority_threshold as number | undefined),
      quorumThreshold: body.quorum_threshold ?? membership?.quorum_threshold
    });
    res.status(200).json(amendment);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "advance failed" });
  }
});

/** POST /api/v1/amendments/:id/apply */
amendmentsRouter.post("/:id/apply", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;

  try {
    const amendment = applyAmendment(orgId, req.params.id, actor);
    if (amendment.status !== "applied") {
      res.status(200).json({ amendment, artifact_updated: false, reason: "vote did not pass" });
      return;
    }

    // Write the proposed payload as the new artifact version
    try {
      const record = writeArtifact(orgId, amendment.artifact_type as ArtifactType, amendment.proposed_payload, actor);
      res.status(200).json({ amendment, artifact_updated: true, artifact_id: record.artifact_id, version: record.version });
    } catch (err) {
      if (err instanceof ArtifactValidationError) {
        res.status(422).json({ error: "artifact validation failed after applying amendment", details: err.errors });
        return;
      }
      throw err;
    }
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "apply failed" });
  }
});
