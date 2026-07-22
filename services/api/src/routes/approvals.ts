/**
 * Approvals routes — operator queue for actions requiring human sign-off.
 *
 * Business mode actions above the risk threshold land here. Collective mode
 * actions that require operator sign-off (not a member vote) also use this queue.
 *
 * Routes:
 *   POST /api/v1/approvals                — create an approval request
 *   GET  /api/v1/approvals                — list pending/all approvals
 *   GET  /api/v1/approvals/:id            — single approval
 *   POST /api/v1/approvals/:id/approve    — approve an action
 *   POST /api/v1/approvals/:id/reject     — reject an action
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ApprovalRecord } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { classifyAction } from "../lib/verification-policy.js";
import { getArtifact } from "../lib/artifact-store.js";
import { asyncHandler } from "../lib/async-handler.js";
import { createApproval, getApproval, listApprovals, updateApproval } from "../lib/approval-store.js";

export const approvalsRouter = Router();
approvalsRouter.use(requireContext);

/** POST /api/v1/approvals */
approvalsRouter.post("/", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const body = req.body as {
    action_id?: string;
    action_type?: string;
    summary?: string;
    risk_score?: number;
    blast_radius?: "low" | "medium" | "high";
    required_approvers?: number;
    details?: Record<string, unknown>;
  };

  if (!body.action_id || !body.action_type || !body.summary) {
    res.status(400).json({ error: "action_id, action_type, and summary are required" });
    return;
  }

  // Read autonomy_policy to resolve risk threshold
  const policyRecord = await getArtifact(orgId, "autonomy_policy");
  const policy = policyRecord?.payload as Record<string, unknown> | undefined;
  const riskThreshold = (policy?.risk_escalation_threshold as number) ?? 50;
  const blastThreshold = (policy?.blast_radius_escalation_threshold as "low" | "medium" | "high") ?? "high";

  const fakeAction = {
    action_id: body.action_id,
    org_id: orgId,
    agent_id: actor,
    action_type: body.action_type,
    summary: body.summary,
    evidence: [],
    assumptions: [],
    risk_score: body.risk_score ?? 50,
    impact_range: "unknown",
    blast_radius: body.blast_radius ?? "low",
    approvals_required: body.required_approvers ?? 1,
    rollback_plan: "",
    governor_decision: "requires_approval" as const,
    created_at: new Date().toISOString()
  };

  const requirement = classifyAction(fakeAction, "business", riskThreshold, blastThreshold);
  const requiredApprovers = body.required_approvers ?? requirement.required_approvers;

  const record: ApprovalRecord = {
    approval_id: randomUUID(),
    org_id: orgId,
    action_id: body.action_id,
    action_type: body.action_type,
    summary: body.summary,
    risk_score: body.risk_score,
    blast_radius: body.blast_radius,
    status: "pending",
    required_approvers: requiredApprovers,
    responses: [],
    created_at: new Date().toISOString(),
    resolved_at: null
  };

  await appendEvent({
    event_id: randomUUID(),
    org_id: orgId,
    event_type: "action_proposed",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: { action_id: body.action_id, action_type: body.action_type, risk_score: fakeAction.risk_score, required_approvers: requiredApprovers, ...(body.details ?? {}) },
    at: record.created_at
  });

  const saved = await createApproval(record);
  res.status(201).json(saved);
}));

/** GET /api/v1/approvals */
approvalsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const status = req.query.status as ApprovalRecord["status"] | undefined;
  const filtered = await listApprovals(orgId, status);
  res.status(200).json({ approvals: filtered, total: filtered.length });
}));

/** GET /api/v1/approvals/:id */
approvalsRouter.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const record = await getApproval(orgId, req.params.id);
  if (!record) { res.status(404).json({ error: "approval not found" }); return; }
  res.status(200).json(record);
}));

/** POST /api/v1/approvals/:id/approve */
approvalsRouter.post("/:id/approve", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const { note } = req.body as { note?: string };
  const existing = await getApproval(orgId, req.params.id);
  if (!existing) { res.status(404).json({ error: "approval not found" }); return; }
  if (existing.status !== "pending") {
    res.status(409).json({ error: `approval is already ${existing.status}` });
    return;
  }
  const alreadyVoted = existing.responses.find((r) => r.approver_id === actor);
  if (alreadyVoted) {
    res.status(409).json({ error: "you have already responded to this approval" });
    return;
  }
  const responses = [...existing.responses, { approver_id: actor, decision: "approve" as const, note: note ?? "", at: new Date().toISOString() }];
  const approveCount = responses.filter((r) => r.decision === "approve").length;
  const status: ApprovalRecord["status"] = approveCount >= existing.required_approvers ? "approved" : "pending";
  const resolvedAt = status === "approved" ? new Date().toISOString() : null;

  const updated = await updateApproval(orgId, req.params.id, { status, responses, resolved_at: resolvedAt });
  if (!updated) { res.status(404).json({ error: "approval not found" }); return; }

  await appendEvent({
    event_id: randomUUID(),
    org_id: orgId,
    event_type: "approval_recorded",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: { approval_id: updated.approval_id, action_id: updated.action_id, decision: "approve", status: updated.status },
    at: new Date().toISOString()
  });

  res.status(200).json(updated);
}));

/** POST /api/v1/approvals/:id/reject */
approvalsRouter.post("/:id/reject", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const { note } = req.body as { note?: string };
  const existing = await getApproval(orgId, req.params.id);
  if (!existing) { res.status(404).json({ error: "approval not found" }); return; }
  if (existing.status !== "pending") {
    res.status(409).json({ error: `approval is already ${existing.status}` });
    return;
  }
  const responses = [...existing.responses, { approver_id: actor, decision: "reject" as const, note: note ?? "", at: new Date().toISOString() }];
  const resolvedAt = new Date().toISOString();

  const updated = await updateApproval(orgId, req.params.id, { status: "rejected", responses, resolved_at: resolvedAt });
  if (!updated) { res.status(404).json({ error: "approval not found" }); return; }

  await appendEvent({
    event_id: randomUUID(),
    org_id: orgId,
    event_type: "approval_recorded",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: { approval_id: updated.approval_id, action_id: updated.action_id, decision: "reject", status: "rejected" },
    at: new Date().toISOString()
  });

  res.status(200).json(updated);
}));
