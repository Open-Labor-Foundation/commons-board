/**
 * Board request management routes.
 *
 * Routes:
 *   POST /api/v1/board/requests              — create a board request
 *   GET  /api/v1/board/requests              — list board requests
 *   GET  /api/v1/board/requests/:id          — get a board request
 *   PATCH /api/v1/board/requests/:id         — update status, priority, or metadata
 *   POST /api/v1/board/requests/:id/roadmap  — build a roadmap for a request
 *   GET  /api/v1/board/requests/:id/roadmap  — get latest roadmap
 *   POST /api/v1/board/requests/:id/dispatch-to-commons-crew          — propose a delegate_to_child dispatch to the target chair's commons-crew run
 *   POST /api/v1/board/requests/:id/dispatch-to-commons-crew/decision — record an explicit admin/operator decision on a proposed dispatch
 *
 * Sanitized from mother-board: no grant-pipeline, loan-packet, or aieb workflow keys.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { BoardDomain, BoardRequestRecord, BoardRoadmapRecord, CommonsCrewDispatchState, GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { routeBoardRequest, buildRoadmapPhases, buildRoadmapSummary, isValidStatusTransition } from "../lib/board-orchestration.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { proposeDispatchToChair, submitDispatchDecision } from "../lib/commons-crew-client.js";

export const motherboardRouter = Router();
motherboardRouter.use(requireContext);

function requestsKey(orgId: string): string {
  return `board-requests/${orgId}`;
}

function roadmapKey(orgId: string, requestId: string): string {
  return `board-roadmaps/${orgId}/${requestId}`;
}

/** POST /api/v1/board/requests */
motherboardRouter.post("/requests", requireRole(["admin", "operator", "member"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const body = req.body as Partial<BoardRequestRecord> & { routing?: "explicit" | "auto" };

  if (!body.title?.trim() || !body.request?.trim()) {
    res.status(400).json({ error: "title and request are required" });
    return;
  }

  const blueprintRecord = getArtifact(ctx.workspaceId, "agent_blueprint");
  const blueprint = blueprintRecord ? (blueprintRecord.payload as Record<string, unknown>) : { chairs: [] };

  const autoRoute = !body.target_chair_id && !body.target_domain;
  let routingMode: "explicit" | "auto" = "explicit";
  let targetChairId = body.target_chair_id ?? "";
  let targetDomain: BoardDomain = body.target_domain ?? "ops";

  if (autoRoute || body.routing === "auto") {
    const routing = routeBoardRequest(blueprint, {
      title: body.title,
      request: body.request,
      targetChairId: body.target_chair_id,
      targetDomain: body.target_domain,
      autoRoute: true
    });
    if (routing) {
      routingMode = routing.routingMode;
      targetChairId = routing.chairId;
      targetDomain = routing.domain;
    } else {
      routingMode = "auto";
    }
  }

  const now = new Date().toISOString();
  const record: BoardRequestRecord = {
    id: randomUUID(),
    org_id: ctx.workspaceId,
    title: body.title.trim(),
    request: body.request.trim(),
    requested_by: ctx.userId,
    target_chair_id: targetChairId,
    target_domain: targetDomain,
    routing_mode: routingMode,
    status: "submitted",
    priority: body.priority ?? "medium",
    constraints: Array.isArray(body.constraints) ? body.constraints : [],
    deadline: body.deadline,
    success_criteria: Array.isArray(body.success_criteria) ? body.success_criteria : [],
    dependency_ids: Array.isArray(body.dependency_ids) ? body.dependency_ids : [],
    approval_required: body.approval_required ?? false,
    risk_level: body.risk_level ?? "low",
    created_at: now,
    updated_at: now
  };

  const existing = readJson<BoardRequestRecord[]>(requestsKey(ctx.workspaceId), []);
  writeJsonAtomic(requestsKey(ctx.workspaceId), [...existing, record]);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "board_request_submitted",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: record.id, title: record.title, target_domain: record.target_domain, routing_mode: routingMode },
    at: record.created_at
  } satisfies GovernanceEvent);

  res.status(201).json({ request: record });
});

/** GET /api/v1/board/requests */
motherboardRouter.get("/requests", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(workspaceId), []);

  const { status, domain, priority } = req.query as Record<string, string | undefined>;
  const filtered = all.filter((r) => {
    if (status && r.status !== status) return false;
    if (domain && r.target_domain !== domain) return false;
    if (priority && r.priority !== priority) return false;
    return true;
  });

  res.status(200).json({ requests: filtered.reverse(), total: filtered.length });
});

/** GET /api/v1/board/requests/:id */
motherboardRouter.get("/requests/:id", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(workspaceId), []);
  const record = all.find((r) => r.id === req.params.id);
  if (!record) {
    res.status(404).json({ error: "board request not found" });
    return;
  }
  res.status(200).json({ request: record });
});

/** PATCH /api/v1/board/requests/:id */
motherboardRouter.patch("/requests/:id", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(ctx.workspaceId), []);
  const idx = all.findIndex((r) => r.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ error: "board request not found" });
    return;
  }

  const existing = all[idx];
  const body = req.body as Partial<BoardRequestRecord>;

  if (body.status && body.status !== existing.status) {
    if (!isValidStatusTransition(existing.status, body.status)) {
      res.status(422).json({ error: `invalid status transition: ${existing.status} → ${body.status}` });
      return;
    }
  }

  const updated: BoardRequestRecord = {
    ...existing,
    status: body.status ?? existing.status,
    priority: body.priority ?? existing.priority,
    constraints: Array.isArray(body.constraints) ? body.constraints : existing.constraints,
    success_criteria: Array.isArray(body.success_criteria) ? body.success_criteria : existing.success_criteria,
    approval_required: body.approval_required ?? existing.approval_required,
    risk_level: body.risk_level ?? existing.risk_level,
    updated_at: new Date().toISOString()
  };

  all[idx] = updated;
  writeJsonAtomic(requestsKey(ctx.workspaceId), all);

  const now2 = new Date().toISOString();
  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: body.status && body.status !== existing.status ? "board_request_status_changed" : "board_request_updated",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: updated.id, previous_status: existing.status, new_status: updated.status, priority: updated.priority },
    at: now2
  } satisfies GovernanceEvent);

  res.status(200).json({ request: updated });
});

/** POST /api/v1/board/requests/:id/roadmap */
motherboardRouter.post("/requests/:id/roadmap", requireRole(["admin", "operator", "member"]), (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(ctx.workspaceId), []);
  const boardRequest = all.find((r) => r.id === req.params.id);
  if (!boardRequest) {
    res.status(404).json({ error: "board request not found" });
    return;
  }

  const existing = readJson<BoardRoadmapRecord[]>(roadmapKey(ctx.workspaceId, boardRequest.id), []);
  const version = existing.length + 1;

  const phases = buildRoadmapPhases(boardRequest);
  const summary = buildRoadmapSummary(boardRequest);

  const roadmap: BoardRoadmapRecord = {
    id: randomUUID(),
    org_id: ctx.workspaceId,
    request_id: boardRequest.id,
    version,
    domain: boardRequest.target_domain,
    owner_chair_id: boardRequest.target_chair_id,
    summary,
    assumptions: ["Stakeholder alignment achieved prior to execution", "Resources approved per phase gate", "Dependencies are active at start of phase 2"],
    risks: ["Scope creep in phase 2", "Key dependency unresolved at phase boundary", "Stakeholder availability during milestone reviews"],
    mitigation_plan: ["Weekly governance checkpoint with explicit go/no-go gates", "Track dependencies in board request record before phase transition", "Reserve 20% buffer in each phase for rework"],
    resource_requests: [],
    phases,
    created_by: ctx.userId,
    created_at: new Date().toISOString()
  };

  writeJsonAtomic(roadmapKey(ctx.workspaceId, boardRequest.id), [...existing, roadmap]);

  const requestIdx = all.findIndex((r) => r.id === boardRequest.id);
  if (requestIdx >= 0) {
    all[requestIdx] = { ...all[requestIdx], latest_roadmap_version: version, updated_at: new Date().toISOString() };
    writeJsonAtomic(requestsKey(ctx.workspaceId), all);
  }

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "board_roadmap_created",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: boardRequest.id, roadmap_id: roadmap.id, version, domain: boardRequest.target_domain, phase_count: phases.length },
    at: roadmap.created_at
  } satisfies GovernanceEvent);

  res.status(201).json({ roadmap });
});

/** GET /api/v1/board/requests/:id/roadmap */
motherboardRouter.get("/requests/:id/roadmap", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const all = readJson<BoardRoadmapRecord[]>(roadmapKey(workspaceId, req.params.id), []);
  if (all.length === 0) {
    res.status(404).json({ error: "no roadmap found for this request" });
    return;
  }
  const version = req.query.version ? Number(req.query.version) : undefined;
  const roadmap = version ? all.find((r) => r.version === version) : all[all.length - 1];
  if (!roadmap) {
    res.status(404).json({ error: "roadmap version not found" });
    return;
  }
  res.status(200).json({ roadmap });
});

/**
 * POST /api/v1/board/requests/:id/dispatch-to-commons-crew
 *
 * Proposes a delegate_to_child dispatch of this request to its target
 * chair's registered commons-crew run. This step is safe to run
 * automatically -- it only ensures a pending delegation approval exists
 * and creates a proposal, neither of which has any real-world effect.
 * Nothing executes until an admin/operator explicitly decides via the
 * /decision endpoint below.
 */
motherboardRouter.post("/requests/:id/dispatch-to-commons-crew", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(ctx.workspaceId), []);
  const idx = all.findIndex((r) => r.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ error: "board request not found" });
    return;
  }
  const request = all[idx];
  const now = new Date().toISOString();

  const blueprintRecord = getArtifact(ctx.workspaceId, "agent_blueprint");
  const blueprintChairs = (blueprintRecord?.payload as { chairs?: Array<{ chair_id: string; commons_crew_run_id?: string | null }> } | undefined)?.chairs ?? [];
  const chair = blueprintChairs.find((c) => c.chair_id === request.target_chair_id);

  if (!chair?.commons_crew_run_id) {
    const dispatch: CommonsCrewDispatchState = { status: "unavailable", reason: "target chair has no registered commons-crew run", attempted_at: now };
    all[idx] = { ...request, commons_crew_dispatch: dispatch, updated_at: now };
    writeJsonAtomic(requestsKey(ctx.workspaceId), all);
    res.status(422).json({ error: "target chair has no registered commons-crew run", request: all[idx] });
    return;
  }

  const proposed = await proposeDispatchToChair({ runId: chair.commons_crew_run_id, workDescription: request.request });
  if (!proposed) {
    const dispatch: CommonsCrewDispatchState = { status: "unavailable", reason: "commons-crew is not reachable or the proposal failed", attempted_at: now };
    all[idx] = { ...request, commons_crew_dispatch: dispatch, updated_at: now };
    writeJsonAtomic(requestsKey(ctx.workspaceId), all);
    res.status(422).json({ error: "commons-crew dispatch proposal failed", request: all[idx] });
    return;
  }

  const dispatch: CommonsCrewDispatchState = {
    status: "awaiting_decision",
    approval_id: proposed.approvalId,
    proposal_id: proposed.proposalId,
    run_id: proposed.runId,
    proposed_at: now
  };
  all[idx] = { ...request, commons_crew_dispatch: dispatch, updated_at: now };
  writeJsonAtomic(requestsKey(ctx.workspaceId), all);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "board_request_commons_crew_dispatch_proposed",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: request.id, approval_id: proposed.approvalId, proposal_id: proposed.proposalId, run_id: proposed.runId },
    at: now
  } satisfies GovernanceEvent);

  res.status(201).json({ request: all[idx] });
});

/**
 * POST /api/v1/board/requests/:id/dispatch-to-commons-crew/decision
 *
 * Records an EXPLICIT admin/operator decision on a proposed dispatch and
 * relays it to commons-crew. `decision` is required in the request body
 * with no default -- this route cannot approve anything on its own, only
 * forward a decision an authenticated admin/operator actually made.
 */
motherboardRouter.post("/requests/:id/dispatch-to-commons-crew/decision", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const all = readJson<BoardRequestRecord[]>(requestsKey(ctx.workspaceId), []);
  const idx = all.findIndex((r) => r.id === req.params.id);
  if (idx < 0) {
    res.status(404).json({ error: "board request not found" });
    return;
  }
  const request = all[idx];
  const dispatch = request.commons_crew_dispatch;
  if (!dispatch || dispatch.status !== "awaiting_decision") {
    res.status(422).json({ error: "no commons-crew dispatch is awaiting a decision on this request" });
    return;
  }

  const body = req.body as { decision?: "approved" | "denied"; comment?: string };
  if (body.decision !== "approved" && body.decision !== "denied") {
    res.status(400).json({ error: 'decision must be "approved" or "denied"' });
    return;
  }

  const result = await submitDispatchDecision({
    approvalId: dispatch.approval_id,
    proposalId: dispatch.proposal_id,
    runId: dispatch.run_id,
    decision: body.decision,
    actorUserId: ctx.userId,
    orgContext: ctx.workspaceId,
    comment: body.comment
  });

  if (!result) {
    res.status(422).json({ error: "commons-crew decision could not be recorded" });
    return;
  }

  const now = new Date().toISOString();
  const updatedDispatch: CommonsCrewDispatchState =
    result.decision === "approved"
      ? { status: "approved", child_run_id: result.childRunId!, layer: result.layer!, decided_at: now, decided_by: ctx.userId }
      : { status: "denied", decided_at: now, decided_by: ctx.userId };

  all[idx] = { ...request, commons_crew_dispatch: updatedDispatch, updated_at: now };
  writeJsonAtomic(requestsKey(ctx.workspaceId), all);

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "board_request_commons_crew_dispatch_decided",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: request.id, decision: result.decision, child_run_id: result.decision === "approved" ? result.childRunId : null },
    at: now
  } satisfies GovernanceEvent);

  res.status(200).json({ request: all[idx] });
});
