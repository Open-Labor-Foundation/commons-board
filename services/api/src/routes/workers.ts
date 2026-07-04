/**
 * Workers API — surfaces the agent hierarchy (chairs → worker agents) with
 * live activity context (actions ledger, execution runs, approvals) and
 * provides a task-dispatch endpoint so users can assign work to specific agents.
 *
 * Routes (mounted at /api/v1/workers):
 *   GET  /                      — all workers across all chairs with status
 *   GET  /:agentId              — single worker detail + full activity context
 *   POST /:agentId/task         — dispatch an async job to a specific worker
 *   GET  /:agentId/jobs         — list jobs for a specific worker
 *   GET  /jobs/:jobId           — get job status and output
 *   PATCH /:agentId/task/:taskId — update legacy action record status
 *   GET  /by-chair/:chairId     — workers grouped under a chair
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { appendEvent } from "../lib/decision-log.js";
import { createJob, getJob, listJobs, registerWorkspace, buildWorkerSystemPrompt } from "../services/agent-job-runner.js";
import { completeChat } from "../lib/model-client.js";

export const workersRouter = Router();
workersRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkerAgent = {
  agent_id: string;
  name: string;
  labor_commons_ref: string | null;
  task_scope: string[];
};

type Chair = {
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  scope: { owns: string[]; refuses: string[]; escalates_to: string[] };
  worker_agents: WorkerAgent[];
  approval_required_for: string[];
};

type WorkerAction = {
  id: string;
  workspace_id: string;
  type: string;
  description: string;
  payload: Record<string, unknown>;
  status: "REQUESTED" | "SIMULATED" | "APPROVED" | "DENIED" | "EXECUTED";
  agent_id: string;
  chair_id: string;
  domain: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  result?: string;
};

type ApprovalRecord = {
  approval_id: string;
  action_id: string;
  status: "pending" | "approved" | "rejected";
  details?: Record<string, unknown>;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function workerActionsKey(workspaceId: string): string {
  return `worker-actions/${workspaceId}`;
}

function approvalKey(workspaceId: string): string {
  return `approvals/${workspaceId}`;
}

function loadWorkerActions(workspaceId: string): WorkerAction[] {
  return readJson<WorkerAction[]>(workerActionsKey(workspaceId), []);
}

function saveWorkerActions(workspaceId: string, actions: WorkerAction[]): void {
  writeJsonAtomic(workerActionsKey(workspaceId), actions);
}

function loadApprovals(workspaceId: string): ApprovalRecord[] {
  return readJson<ApprovalRecord[]>(approvalKey(workspaceId), []);
}

// ---------------------------------------------------------------------------
// Blueprint helper
// ---------------------------------------------------------------------------

function loadChairs(workspaceId: string): Chair[] {
  const bp = getArtifact(workspaceId, "agent_blueprint");
  if (!bp) return [];
  const payload = bp.payload as { chairs?: Chair[] };
  return payload?.chairs ?? [];
}

function findWorker(chairs: Chair[], agentId: string): { worker: WorkerAgent; chair: Chair } | null {
  for (const chair of chairs) {
    const worker = chair.worker_agents.find((w) => w.agent_id === agentId);
    if (worker) return { worker, chair };
  }
  return null;
}

function workerStatus(
  workspaceId: string,
  agentId: string,
  actions: WorkerAction[],
  approvals: ApprovalRecord[],
  chair: Chair
): "active" | "pending" | "ready" {
  const activeAction = actions.find(
    (a) => a.agent_id === agentId && (a.status === "REQUESTED" || a.status === "APPROVED")
  );
  if (activeAction) {
    // Cross-reference the live job store — the legacy action record never gets
    // updated by the job runner, so "REQUESTED" stays set even after completion.
    const job = getJob(workspaceId, activeAction.id);
    if (!job || job.status === "completed" || job.status === "failed") {
      // Job is done; fall through to pending/ready check below
    } else {
      return "active";
    }
  }
  const domainPending = approvals.filter(
    (a) => a.status === "pending" && String(a.details?.chair ?? "") === chair.chair_id
  );
  if (domainPending.length > 0) return "pending";
  return "ready";
}

// ---------------------------------------------------------------------------
// GET /api/v1/workers
// ---------------------------------------------------------------------------

workersRouter.get("/", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const chairs = loadChairs(workspaceId);
  if (chairs.length === 0) {
    res.status(200).json({ workers: [], chairs: [] });
    return;
  }

  const actions = loadWorkerActions(workspaceId);
  const approvals = loadApprovals(workspaceId);

  const workers = [];
  for (const chair of chairs) {
    for (const worker of chair.worker_agents) {
      const workerActions = actions.filter((a) => a.agent_id === worker.agent_id);
      const currentTask = workerActions.find(
        (a) => a.status === "REQUESTED" || a.status === "APPROVED"
      ) ?? null;
      const recentActions = [...workerActions].reverse().slice(0, 5);

      workers.push({
        agent_id: worker.agent_id,
        name: worker.name,
        task_scope: worker.task_scope,
        chair_id: chair.chair_id,
        chair_name: chair.name,
        chair_domain: chair.domain,
        status: workerStatus(workspaceId, worker.agent_id, actions, approvals, chair),
        current_task: currentTask,
        recent_actions: recentActions,
        action_count: workerActions.length,
      });
    }
  }

  res.status(200).json({ workers, total: workers.length });
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers/:agentId
// ---------------------------------------------------------------------------

workersRouter.get("/:agentId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { agentId } = req.params;
  const chairs = loadChairs(workspaceId);
  const found = findWorker(chairs, agentId);

  if (!found) {
    res.status(404).json({ error: "worker not found" });
    return;
  }

  const { worker, chair } = found;
  const actions = loadWorkerActions(workspaceId);
  const approvals = loadApprovals(workspaceId);

  const workerActions = actions.filter((a) => a.agent_id === agentId);
  const currentTask = workerActions.find(
    (a) => a.status === "REQUESTED" || a.status === "APPROVED"
  ) ?? null;
  const domainApprovals = approvals.filter(
    (a) => a.status === "pending" && String(a.details?.chair ?? "") === chair.chair_id
  );

  res.status(200).json({
    agent_id: worker.agent_id,
    name: worker.name,
    task_scope: worker.task_scope,
    labor_commons_ref: worker.labor_commons_ref,
    chair: {
      chair_id: chair.chair_id,
      name: chair.name,
      domain: chair.domain,
      description: chair.description,
      scope: chair.scope,
      approval_required_for: chair.approval_required_for,
    },
    status: workerStatus(workspaceId, agentId, actions, approvals, chair),
    current_task: currentTask,
    activity: [...workerActions].reverse().slice(0, 20),
    pending_chair_approvals: domainApprovals,
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/workers/:agentId/task — enqueue an async job to a worker
// ---------------------------------------------------------------------------

workersRouter.post(
  "/:agentId/task",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const { workspaceId, userId } = req.ctx!;
    const { agentId } = req.params;
    const chairs = loadChairs(workspaceId);
    const found = findWorker(chairs, agentId);

    if (!found) {
      res.status(404).json({ error: "worker not found" });
      return;
    }

    const { worker, chair } = found;
    const body = req.body as {
      description?: string;
      expected_output?: string;
      priority?: "low" | "medium" | "high";
      context?: Record<string, unknown>;
    };

    if (!body.description?.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    // Create async job — the job runner will pick it up within 5 seconds
    registerWorkspace(workspaceId);
    const job = createJob(workspaceId, agentId, chair.chair_id, {
      description: body.description.trim(),
      expected_output: body.expected_output,
      priority: body.priority ?? "medium",
      context: body.context,
    });

    // Also record in the action ledger for governance audit trail
    const now = new Date().toISOString();
    const action: WorkerAction = {
      id: job.job_id,
      workspace_id: workspaceId,
      type: "task",
      description: body.description.trim(),
      payload: { job_id: job.job_id, priority: job.task.priority },
      status: "REQUESTED",
      agent_id: agentId,
      chair_id: chair.chair_id,
      domain: chair.domain,
      created_at: now,
      updated_at: now,
    };
    const all = loadWorkerActions(workspaceId);
    all.push(action);
    saveWorkerActions(workspaceId, all);

    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_proposed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        job_id: job.job_id,
        agent_id: agentId,
        agent_name: worker.name,
        chair_id: chair.chair_id,
        domain: chair.domain,
        description: action.description,
      },
      at: now,
    } satisfies GovernanceEvent);

    res.status(201).json({
      job_id: job.job_id,
      agent_id: agentId,
      agent_name: worker.name,
      chair_id: chair.chair_id,
      status: "pending",
      created_at: job.created_at,
    });
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/workers/:agentId/chat — direct conversational chat with a worker
// ---------------------------------------------------------------------------

workersRouter.post("/:agentId/chat", async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { agentId } = req.params;
  const chairs = loadChairs(workspaceId);
  const found = findWorker(chairs, agentId);

  if (!found) {
    res.status(404).json({ error: "worker not found" });
    return;
  }

  const body = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const { worker, chair } = found;

  try {
    const system = await buildWorkerSystemPrompt(
      worker.name,
      worker.task_scope,
      chair.name,
      worker.labor_commons_ref ?? null
    );
    const { answer, thinking } = await completeChat(
      workspaceId,
      system,
      body.history ?? [],
      body.message.trim()
    );
    res.json({ reply: answer, thinking: thinking || null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "inference failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers/jobs/:jobId — get job status and output
// ---------------------------------------------------------------------------

workersRouter.get("/jobs/:jobId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const job = getJob(workspaceId, req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  res.status(200).json(job);
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers/:agentId/jobs — list jobs for a specific worker
// ---------------------------------------------------------------------------

workersRouter.get("/:agentId/jobs", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { agentId } = req.params;
  const chairs = loadChairs(workspaceId);
  if (!findWorker(chairs, agentId)) {
    res.status(404).json({ error: "worker not found" });
    return;
  }
  const jobs = listJobs(workspaceId, agentId);
  res.status(200).json({ agent_id: agentId, jobs, total: jobs.length });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/workers/:agentId/task/:taskId — update task status
// ---------------------------------------------------------------------------

workersRouter.patch(
  "/:agentId/task/:taskId",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const { workspaceId, userId } = req.ctx!;
    const { agentId, taskId } = req.params;
    const body = req.body as { status?: WorkerAction["status"]; result?: string };

    const all = loadWorkerActions(workspaceId);
    const idx = all.findIndex((a) => a.id === taskId && a.agent_id === agentId);
    if (idx < 0) {
      res.status(404).json({ error: "task not found" });
      return;
    }

    const now = new Date().toISOString();
    const updated: WorkerAction = {
      ...all[idx],
      ...(body.status && { status: body.status }),
      ...(body.result && { result: body.result }),
      updated_at: now,
      ...(["EXECUTED", "SIMULATED", "DENIED"].includes(body.status ?? "") && { completed_at: now }),
    };
    all[idx] = updated;
    saveWorkerActions(workspaceId, all);

    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: taskId, agent_id: agentId, status: updated.status },
      at: now,
    } satisfies GovernanceEvent);

    res.status(200).json(updated);
  }
);

// ---------------------------------------------------------------------------
// POST /api/v1/workers/by-chair/:chairId/chat — direct chat with a chair
// ---------------------------------------------------------------------------

workersRouter.post("/by-chair/:chairId/chat", async (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const chairs = loadChairs(workspaceId);
  const chair = chairs.find((c) => c.chair_id === req.params.chairId);

  if (!chair) {
    res.status(404).json({ error: "chair not found" });
    return;
  }

  const body = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!body.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const owns = (chair.scope?.owns ?? []).map((o: string) => o.replace(/_/g, " "));
  const refuses = (chair.scope?.refuses ?? []).map((o: string) => o.replace(/_/g, " "));
  const systemLines = [
    `You are ${chair.name}, the ${chair.domain} advisor on a business board.`,
    `Current date: ${today}.`,
    `Your role: ${chair.description}`,
  ];
  if (owns.length > 0) systemLines.push(``, `Your responsibilities: ${owns.join(", ")}.`);
  if (refuses.length > 0) systemLines.push(`Out of scope: ${refuses.join(", ")}.`);
  systemLines.push(``, `Answer from your domain expertise. Be direct, specific, and practical.`);

  try {
    const { answer, thinking } = await completeChat(
      workspaceId,
      systemLines.join("\n"),
      body.history ?? [],
      body.message.trim()
    );
    res.json({ reply: answer, thinking: thinking || null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "inference failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/workers/by-chair/:chairId — workers for a specific chair
// ---------------------------------------------------------------------------

workersRouter.get("/by-chair/:chairId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { chairId } = req.params;
  const chairs = loadChairs(workspaceId);
  const chair = chairs.find((c) => c.chair_id === chairId);

  if (!chair) {
    res.status(404).json({ error: "chair not found" });
    return;
  }

  const actions = loadWorkerActions(workspaceId);
  const approvals = loadApprovals(workspaceId);
  const domainApprovals = approvals.filter(
    (a) => a.status === "pending" && String(a.details?.chair ?? "") === chairId
  );

  const workers = chair.worker_agents.map((worker) => {
    const workerActions = actions.filter((a) => a.agent_id === worker.agent_id);
    const currentTask = workerActions.find(
      (a) => a.status === "REQUESTED" || a.status === "APPROVED"
    ) ?? null;
    return {
      agent_id: worker.agent_id,
      name: worker.name,
      task_scope: worker.task_scope,
      status: workerStatus(workspaceId, worker.agent_id, actions, approvals, chair),
      current_task: currentTask,
      recent_actions: [...workerActions].reverse().slice(0, 3),
    };
  });

  res.status(200).json({
    chair: {
      chair_id: chair.chair_id,
      name: chair.name,
      domain: chair.domain,
      description: chair.description,
      scope: chair.scope,
      approval_required_for: chair.approval_required_for,
    },
    workers,
    pending_approvals: domainApprovals,
    total_workers: workers.length,
    active_count: workers.filter((w) => w.status === "active").length,
  });
});
