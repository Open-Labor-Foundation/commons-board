/**
 * Votes routes — collective member voting.
 *
 * Routes:
 *   POST /api/v1/votes              — open a vote
 *   GET  /api/v1/votes              — list votes (filter by ?status=open|passed|failed|cancelled)
 *   GET  /api/v1/votes/:id          — vote + ballots
 *   POST /api/v1/votes/:id/cast     — cast a ballot
 *   POST /api/v1/votes/:id/resolve  — force-resolve a vote (admin/operator only)
 */
import { Router, type Request, type Response } from "express";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import {
  openVote,
  listVotes,
  getVote,
  castBallot,
  resolveVote,
  getVoteBallots,
  recordContribution
} from "../lib/collective-governance.js";

export const votesRouter = Router();
votesRouter.use(requireContext);

function collectiveConfig(orgId: string): Record<string, unknown> | null {
  const r = getArtifact(orgId, "collective_config");
  return r ? (r.payload as Record<string, unknown>) : null;
}

/** POST /api/v1/votes */
votesRouter.post("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const body = req.body as {
    decision_id?: string;
    decision_type?: string;
    method?: string;
    duration_hours?: number;
    quorum_threshold?: number;
    supermajority_threshold?: number;
  };

  if (!body.decision_id || !body.decision_type) {
    res.status(400).json({ error: "decision_id and decision_type are required" });
    return;
  }

  const cc = collectiveConfig(orgId);
  const voting = cc?.voting as Record<string, unknown> | undefined;

  const vote = openVote({
    orgId,
    decisionId: body.decision_id,
    decisionType: body.decision_type,
    method: (body.method ?? voting?.vote_method ?? "simple_majority") as Parameters<typeof openVote>[0]["method"],
    durationHours: body.duration_hours ?? (voting?.standard_vote_duration_hours as number ?? 72),
    actor,
    quorumThreshold: body.quorum_threshold ?? (cc?.membership as Record<string, number>)?.quorum_threshold,
    supermajorityThreshold: body.supermajority_threshold ?? (voting?.supermajority_threshold as number | undefined)
  });

  res.status(201).json(vote);
});

/** GET /api/v1/votes */
votesRouter.get("/", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const status = req.query.status as string | undefined;
  const votes = listVotes(orgId, status as Parameters<typeof listVotes>[1]);
  res.status(200).json({ votes, total: votes.length });
});

/** GET /api/v1/votes/:id */
votesRouter.get("/:id", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const vote = getVote(orgId, req.params.id);
  if (!vote) { res.status(404).json({ error: "vote not found" }); return; }
  const ballots = getVoteBallots(orgId, vote.vote_id);
  res.status(200).json({ vote, ballots });
});

/** POST /api/v1/votes/:id/cast */
votesRouter.post("/:id/cast", requireRole(["admin", "operator", "member"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const body = req.body as { choice?: string; member_id?: string };

  if (!body.choice) {
    res.status(400).json({ error: "choice is required (yes/no or ranked)" });
    return;
  }

  const cc = collectiveConfig(orgId);
  const activeMemberCount = ((cc?.membership as Record<string, number>)?.active_member_count) ?? 1;

  try {
    const result = castBallot({
      orgId,
      voteId: req.params.id,
      memberId: body.member_id ?? actor,
      choice: body.choice,
      activeMemberCount
    });

    // Track contribution if contribution_tracking is enabled
    const ct = (cc?.contribution_tracking as Record<string, unknown>) ?? {};
    if (ct.enabled && Array.isArray(ct.tracked_actions) && (ct.tracked_actions as string[]).includes("vote")) {
      recordContribution({ orgId, memberId: body.member_id ?? actor, actionType: "vote" });
    }

    res.status(200).json({ ballot: result.ballot, quorum_reached: result.quorum_reached, tally: result.vote.tally });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "ballot error" });
  }
});

/** POST /api/v1/votes/:id/resolve */
votesRouter.post("/:id/resolve", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;

  const cc = collectiveConfig(orgId);
  const activeMemberCount = ((cc?.membership as Record<string, number>)?.active_member_count) ?? 1;

  try {
    const result = resolveVote(orgId, req.params.id, actor, activeMemberCount);
    res.status(200).json({ vote: result.vote, outcome: result.outcome });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "resolve error" });
  }
});
