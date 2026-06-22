/**
 * Board chat ingress — interprets messages, routes to chair(s), synthesizes response.
 *
 * Routes:
 *   POST /api/v1/board/chat     — send a message to the board or a specific chair
 *   GET  /api/v1/board/chat/:threadId — get session state for a thread
 *   DELETE /api/v1/board/chat/:threadId — clear session state for a thread
 *
 * Sanitized from mother-board: no grant-pipeline, loan-packet, or aieb workflow keys.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { BoardDomain, GovernanceEvent } from "@commons-board/shared";
import { requireContext } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { getArtifact } from "../lib/artifact-store.js";
import { getSessionState, applyInterpretation, clearSessionState } from "../services/board-session-state.js";
import { interpretChatMessage } from "../services/chat-interpreter.js";
import { buildReasonedBoardResponse } from "../services/chair-reasoning.js";
import { synthesizeBoardResponse } from "../services/board-synthesizer.js";
import { runReasoningLoop } from "../services/reasoning-loop.js";

export const motherboardChatRouter = Router();
motherboardChatRouter.use(requireContext);

type ChatRequest = {
  message: string;
  thread_id?: string;
  chair_alias?: string;
  force_chair_domain?: BoardDomain;
  force_chair_id?: string;
  session_mode?: "board" | "chair";
};

/** POST /api/v1/board/chat */
motherboardChatRouter.post("/", async (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const body = req.body as ChatRequest;

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const threadId = body.thread_id ?? randomUUID();
  const sessionState = getSessionState(ctx.workspaceId, threadId);

  // Interpret the message into a routing spec
  const { spec, routing_note, reused_context } = interpretChatMessage({
    message: body.message,
    workspaceId: ctx.workspaceId,
    threadId,
    sessionState,
    chairAlias: body.chair_alias,
    forceChairDomain: body.force_chair_domain,
    forceChairId: body.force_chair_id
  });

  // Update session state with the new interpretation
  const updatedSession = applyInterpretation(ctx.workspaceId, threadId, spec);

  // Resolve the chair from the blueprint
  const blueprintRecord = getArtifact(ctx.workspaceId, "agent_blueprint");
  const blueprint = blueprintRecord ? (blueprintRecord.payload as Record<string, unknown>) : { chairs: [] };
  const chairs = Array.isArray((blueprint as Record<string, unknown>).chairs)
    ? (blueprint.chairs as Array<{ chair_id: string; name: string; domain: string; labor_commons_refs?: Array<{ specialist_slug: string; role: string }> }>)
    : [];

  const targetChairId = spec.target_chair_id ?? updatedSession.active_chair_id;
  const targetDomain = spec.target_chair_domain ?? updatedSession.active_chair_domain ?? "ops";

  const chair = chairs.find((c) => targetChairId ? c.chair_id === targetChairId : c.domain === targetDomain) ?? null;

  // Get the primary labor-commons specialist slug for this chair (if resolved)
  const laborCommonsSlug = chair?.labor_commons_refs?.find((r) => r.role === "primary")?.specialist_slug;

  // Run the reasoning loop for planner/critic/executor validation
  const loop = runReasoningLoop({
    prompt: body.message,
    domain: targetDomain,
    intent: spec.operation_kind,
    intentConfidence: (spec.task_spec.confidence as number) ?? 0.6,
    domainPass: !!chair || !!targetDomain
  });

  if (!loop.executor.result || loop.executor.result === "blocked") {
    res.status(422).json({
      error: "reasoning loop blocked — intent or domain validation failed",
      loop_issues: loop.critic.issues,
      routing: { spec, routing_note }
    });
    return;
  }

  // Build a synthetic BoardRequestRecord from the chat message for chair reasoning
  const now = new Date().toISOString();
  const syntheticRequest = {
    id: randomUUID(),
    org_id: ctx.workspaceId,
    title: body.message.slice(0, 120).trim(),
    request: body.message,
    requested_by: ctx.userId,
    target_chair_id: chair?.chair_id ?? "",
    target_domain: targetDomain,
    routing_mode: "auto" as const,
    status: "submitted" as const,
    priority: "medium" as const,
    constraints: [],
    success_criteria: [],
    dependency_ids: [],
    approval_required: false,
    risk_level: "low" as const,
    created_at: now,
    updated_at: now
  };

  const syntheticRoadmap = {
    id: randomUUID(),
    org_id: ctx.workspaceId,
    request_id: syntheticRequest.id,
    version: 1,
    domain: targetDomain,
    owner_chair_id: chair?.chair_id ?? "",
    summary: `Board response for "${syntheticRequest.title}"`,
    assumptions: [],
    risks: [],
    mitigation_plan: [],
    resource_requests: [],
    phases: [],
    created_by: ctx.userId,
    created_at: now
  };

  // Build the chair response
  const chairResult = await buildReasonedBoardResponse({
    request: syntheticRequest,
    roadmap: syntheticRoadmap,
    laborCommonsSlug
  });

  // Synthesize: in "chair" mode return the chair result directly; in "board" mode synthesize
  const sessionMode = body.session_mode ?? (spec.conversation_mode === "chair" ? "chair" : "board");

  let response: { headline: string; summary_markdown: string; recommended_workflows: string[] };

  if (sessionMode === "board") {
    const chairConsultResult = {
      chair: { id: chair?.chair_id ?? targetDomain, name: chair?.name ?? targetDomain.toUpperCase(), domain: targetDomain },
      headline: `${targetDomain.toUpperCase()} analysis`,
      summary_markdown: chairResult.responseText,
      actions: [],
      approvals: []
    };

    const synthesis = await synthesizeBoardResponse({
      workspaceId: ctx.workspaceId,
      prompt: body.message,
      interpretation: spec,
      chairResults: [chairConsultResult],
      sessionMode: "board"
    });

    if (!synthesis.ok) {
      res.status(502).json({ error: synthesis.error, detail: synthesis.detail, routing: { spec, routing_note } });
      return;
    }
    response = synthesis.payload;
  } else {
    response = {
      headline: `${targetDomain.toUpperCase()} response`,
      summary_markdown: chairResult.responseText,
      recommended_workflows: []
    };
  }

  appendEvent({
    event_id: randomUUID(),
    org_id: ctx.workspaceId,
    event_type: "board_chat_completed",
    actor: ctx.userId,
    artifact_type: null,
    artifact_id: null,
    details: { thread_id: threadId, domain: targetDomain, operation_kind: spec.operation_kind, session_mode: sessionMode },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);

  res.status(200).json({
    thread_id: threadId,
    headline: response.headline,
    summary_markdown: response.summary_markdown,
    recommended_workflows: response.recommended_workflows,
    meta: {
      routing: { spec, routing_note, reused_context },
      reasoning: { confidence: chairResult.responseMeta.confidence, citations: chairResult.responseMeta.citations },
      loop: { pass: loop.critic.pass, score: loop.critic.score, issues: loop.critic.issues },
      domain: targetDomain,
      chair_id: chair?.chair_id ?? null,
      specialist_slug: laborCommonsSlug ?? null
    }
  });
});

/** GET /api/v1/board/chat/:threadId */
motherboardChatRouter.get("/:threadId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const state = getSessionState(workspaceId, req.params.threadId);
  res.status(200).json({ thread_id: req.params.threadId, session_state: state });
});

/** DELETE /api/v1/board/chat/:threadId */
motherboardChatRouter.delete("/:threadId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  clearSessionState(workspaceId, req.params.threadId);
  res.status(200).json({ thread_id: req.params.threadId, cleared: true });
});
