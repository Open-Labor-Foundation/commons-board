/**
 * Board chat ingress — interprets messages, routes to chair(s), synthesizes response.
 *
 * Routes:
 *   POST /api/v1/board/chat           — enqueue a board chat job; returns {job_id} immediately
 *   GET  /api/v1/board/chat/jobs/:jobId — poll job status and result
 *   GET  /api/v1/board/chat/:threadId  — get session state for a thread
 *   DELETE /api/v1/board/chat/:threadId — clear session state for a thread
 *
 * The POST is non-blocking: execution runs in the background and the result is
 * written to the board-chat job store. The UI polls /jobs/:jobId until done.
 * This means a page refresh cannot kill an in-flight Featherless request.
 *
 * Sanitized from mother-board: no grant-pipeline, loan-packet, or aieb workflow keys.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { BoardDomain, GovernanceEvent, WorkspaceSettings } from "@commons-board/shared";
import { requireContext } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { getArtifact } from "../lib/artifact-store.js";
import { readJson } from "../lib/persistence.js";
import { getSessionState, applyInterpretation, clearSessionState } from "../services/board-session-state.js";
import { interpretChatMessage } from "../services/chat-interpreter.js";
import { buildReasonedBoardResponse } from "../services/chair-reasoning.js";
import { synthesizeBoardResponse } from "../services/board-synthesizer.js";
import { runReasoningLoop } from "../services/reasoning-loop.js";
import { getProviderConcurrency, mapConcurrent } from "../lib/model-client.js";
import {
  createBoardChatJob,
  getBoardChatJob,
  updateBoardChatJob,
  appendChairResult,
  listBoardChatThreads,
  listJobsForThread,
  type BoardChatJob,
} from "../lib/board-chat-job-store.js";

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

/**
 * Core board chat execution — runs in the background after POST returns.
 * Writes result (or error) back to the job store.
 */
async function executeBoardChat(
  workspaceId: string,
  userId: string,
  job: BoardChatJob,
  body: ChatRequest
): Promise<void> {
  updateBoardChatJob(workspaceId, job.job_id, { status: "running" });

  const threadId = job.thread_id;
  const sessionState = getSessionState(workspaceId, threadId);
  const workspaceSettings = readJson<WorkspaceSettings>(
    `settings/${workspaceId}`,
    null as unknown as WorkspaceSettings
  );
  const confidenceFloor = workspaceSettings?.board_settings?.confidence_floor ?? 0.45;

  const { spec, routing_note, reused_context } = interpretChatMessage({
    message: body.message,
    workspaceId,
    threadId,
    sessionState,
    chairAlias: body.chair_alias,
    forceChairDomain: body.force_chair_domain,
    forceChairId: body.force_chair_id,
  });

  const updatedSession = applyInterpretation(workspaceId, threadId, spec);

  const blueprintRecord = getArtifact(workspaceId, "agent_blueprint");
  const blueprint = blueprintRecord
    ? (blueprintRecord.payload as Record<string, unknown>)
    : { chairs: [] };
  type BlueprintChair = {
    chair_id: string;
    name: string;
    domain: string;
    model?: string;
    labor_commons_refs?: Array<{ specialist_slug: string; role: string }>;
  };
  const allChairs = Array.isArray((blueprint as Record<string, unknown>).chairs)
    ? (blueprint.chairs as BlueprintChair[])
    : [];
  const synthesisModel = (blueprint as Record<string, unknown>).synthesis_model as
    | string
    | undefined;

  const targetChairId = spec.target_chair_id ?? updatedSession.active_chair_id;
  const targetDomain =
    spec.target_chair_domain ?? updatedSession.active_chair_domain ?? "ops";
  const sessionMode =
    body.session_mode ?? (spec.conversation_mode === "chair" ? "chair" : "board");

  const primaryChair =
    allChairs.find((c) =>
      targetChairId ? c.chair_id === targetChairId : c.domain === targetDomain
    ) ?? null;
  const deliberatingChairs: BlueprintChair[] =
    sessionMode === "chair" || body.force_chair_id
      ? primaryChair
        ? [primaryChair]
        : []
      : allChairs.length > 0
        ? allChairs
        : primaryChair
          ? [primaryChair]
          : [];

  const fallbackChair: BlueprintChair = {
    chair_id: targetDomain,
    name: targetDomain.toUpperCase(),
    domain: targetDomain,
  };
  const activeChairs =
    deliberatingChairs.length > 0 ? deliberatingChairs : [fallbackChair];

  const effectiveFloor =
    sessionMode === "board" && activeChairs.length > 1 ? 0 : confidenceFloor;

  const loop = runReasoningLoop({
    prompt: body.message,
    domain: targetDomain,
    intent: spec.operation_kind,
    intentConfidence: (spec.task_spec.confidence as number) ?? 0.6,
    intentConfidenceFloor: effectiveFloor,
    domainPass: activeChairs.length > 0,
  });

  if (!loop.executor.result || loop.executor.result === "blocked") {
    updateBoardChatJob(workspaceId, job.job_id, {
      status: "error",
      error: "reasoning loop blocked — intent or domain validation failed",
      completed_at: new Date().toISOString(),
    });
    return;
  }

  const now = new Date().toISOString();
  const { maxParallel } = getProviderConcurrency(workspaceId);

  const chairResults = await mapConcurrent(activeChairs, maxParallel, async (chair) => {
    const domain = chair.domain as BoardDomain;
    const laborCommonsSlug = chair.labor_commons_refs?.find(
      (r) => r.role === "primary"
    )?.specialist_slug;

    const syntheticRequest = {
      id: randomUUID(),
      org_id: workspaceId,
      title: body.message.slice(0, 120).trim(),
      request: body.message,
      requested_by: userId,
      target_chair_id: chair.chair_id,
      target_domain: domain,
      routing_mode: "auto" as const,
      status: "submitted" as const,
      priority: "medium" as const,
      constraints: [],
      success_criteria: [],
      dependency_ids: [],
      approval_required: false,
      risk_level: "low" as const,
      created_at: now,
      updated_at: now,
    };

    const syntheticRoadmap = {
      id: randomUUID(),
      org_id: workspaceId,
      request_id: syntheticRequest.id,
      version: 1,
      domain,
      owner_chair_id: chair.chair_id,
      summary: `${chair.name} response for "${syntheticRequest.title}"`,
      assumptions: [],
      risks: [],
      mitigation_plan: [],
      resource_requests: [],
      phases: [],
      created_by: userId,
      created_at: now,
    };

    try {
      const result = await buildReasonedBoardResponse({
        workspaceId,
        request: syntheticRequest,
        roadmap: syntheticRoadmap,
        laborCommonsSlug,
        model: chair.model,
      });
      // Write this chair's result immediately so the UI can show it before all chairs finish
      appendChairResult(workspaceId, job.job_id, {
        chair_id: chair.chair_id,
        chair_name: chair.name,
        domain: chair.domain,
        thinking: result.thinking || null,
        answer: result.responseText,
        completed_at: new Date().toISOString(),
      });
      return {
        chair: { id: chair.chair_id, name: chair.name, domain },
        headline: `${chair.name} analysis`,
        summary_markdown: result.responseText,
        actions: [],
        approvals: [],
        meta: {
          confidence: result.responseMeta.confidence,
          citations: result.responseMeta.citations,
        },
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown error";
      appendChairResult(workspaceId, job.job_id, {
        chair_id: chair.chair_id,
        chair_name: chair.name,
        domain: chair.domain,
        thinking: null,
        answer: `_${chair.name} could not deliberate: ${detail}_`,
        completed_at: new Date().toISOString(),
      });
      return {
        chair: { id: chair.chair_id, name: chair.name, domain },
        headline: `${chair.name} — deliberation unavailable`,
        summary_markdown: `_${chair.name} could not deliberate: ${detail}_`,
        actions: [],
        approvals: [],
        meta: { confidence: 0, citations: [] },
      };
    }
  });

  let response: {
    headline: string;
    summary_markdown: string;
    recommended_workflows: string[];
  };

  if (sessionMode === "chair" && chairResults.length === 1) {
    response = {
      headline: chairResults[0].headline,
      summary_markdown: chairResults[0].summary_markdown,
      recommended_workflows: [],
    };
  } else {
    const synthesis = await synthesizeBoardResponse({
      workspaceId,
      prompt: body.message,
      interpretation: spec,
      chairResults,
      sessionMode,
      model: synthesisModel,
    });

    if (!synthesis.ok) {
      updateBoardChatJob(workspaceId, job.job_id, {
        status: "error",
        error: synthesis.error ?? "synthesis failed",
        completed_at: new Date().toISOString(),
      });
      return;
    }
    response = synthesis.payload;
  }

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "board_chat_completed",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: {
      thread_id: threadId,
      domain: targetDomain,
      operation_kind: spec.operation_kind,
      session_mode: sessionMode,
      chair_count: chairResults.length,
    },
    at: new Date().toISOString(),
  } satisfies GovernanceEvent);

  updateBoardChatJob(workspaceId, job.job_id, {
    status: "done",
    result: {
      thread_id: threadId,
      headline: response.headline,
      summary_markdown: response.summary_markdown,
      recommended_workflows: response.recommended_workflows,
      meta: {
        routing: { spec, routing_note, reused_context },
        deliberation: chairResults.map((r) => ({
          chair_id: r.chair.id,
          chair_name: r.chair.name,
          domain: r.chair.domain,
          confidence: r.meta.confidence,
          citations: r.meta.citations,
        })),
        loop: { pass: loop.critic.pass, score: loop.critic.score, issues: loop.critic.issues },
        session_mode: sessionMode,
        chair_count: chairResults.length,
      },
    },
    completed_at: new Date().toISOString(),
  });
}

/** POST /api/v1/board/chat — enqueue and return immediately */
motherboardChatRouter.post("/", async (req: Request, res: Response) => {
  const ctx = req.ctx!;
  const body = req.body as ChatRequest;

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const threadId = body.thread_id ?? randomUUID();
  const job = createBoardChatJob(ctx.workspaceId, threadId, body.message);

  // Fire-and-forget — the HTTP connection can close without killing inference
  void executeBoardChat(ctx.workspaceId, ctx.userId, job, body).catch((err: unknown) => {
    updateBoardChatJob(ctx.workspaceId, job.job_id, {
      status: "error",
      error: err instanceof Error ? err.message : "unknown error",
      completed_at: new Date().toISOString(),
    });
  });

  res.status(202).json({ job_id: job.job_id, thread_id: threadId, status: "pending" });
});

/** GET /api/v1/board/chat/jobs/:jobId — poll for result */
motherboardChatRouter.get("/jobs/:jobId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const job = getBoardChatJob(workspaceId, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  res.status(200).json(job);
});

/** GET /api/v1/board/chat/threads — list all thread summaries for the workspace */
motherboardChatRouter.get("/threads", (req: Request, res: Response) => {
  const threads = listBoardChatThreads(req.ctx!.workspaceId);
  res.status(200).json({ threads });
});

/** GET /api/v1/board/chat/threads/:threadId/jobs — all jobs for one thread, chronological */
motherboardChatRouter.get("/threads/:threadId/jobs", (req: Request, res: Response) => {
  const jobs = listJobsForThread(req.ctx!.workspaceId, req.params.threadId);
  res.status(200).json({ jobs });
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
