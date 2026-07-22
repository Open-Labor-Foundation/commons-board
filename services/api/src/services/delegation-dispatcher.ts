/**
 * Delegation dispatcher — bridges DelegatableTask[] to the existing job store
 * and executes worker tasks inline (Phase 1: synchronous execution).
 *
 * For each task:
 *   1. Resolve the worker agent from the blueprint
 *   2. Create a job in the job store
 *   3. Execute the job inline via the inference queue (not the 5s poll loop)
 *   4. Capture the output as a WorkerDeliverable
 *
 * Handles depends_on: tasks with dependencies wait for predecessors.
 * Independent tasks run in parallel. Failed tasks don't block other
 * independent tasks; dependent tasks whose predecessor failed are skipped.
 *
 * See planning/delegation-architecture.md, Section B.
 */
import { getSpecialist } from "../lib/labor-commons-client.js";
import { getProviderConcurrency, mapConcurrent, parseThinking } from "../lib/model-client.js";
import { enqueueInference, QueueFullError } from "../lib/inference-queue.js";
import { createJob } from "../lib/job-store.js";
import { registerWorkspace } from "../services/agent-job-runner.js";
import type {
  DelegatableTask,
  DelegationWorkerAgent,
  WorkerDeliverable,
} from "./delegation-types.js";

/**
 * Input for dispatchTasks. Takes the extracted tasks and the board context
 * needed to resolve workers and execute jobs.
 */
export interface DispatchInput {
  workspaceId: string;
  /** Tasks extracted by extractDelegatableTasks. */
  tasks: DelegatableTask[];
  /** Worker agents available (resolved from the blueprint). */
  workerAgents: DelegationWorkerAgent[];
}

/**
 * Dispatch tasks to worker agents and execute them synchronously.
 *
 * Returns one WorkerDeliverable per task. Tasks with no dependencies run in
 * parallel (up to provider concurrency). Tasks with depends_on wait for their
 * predecessors to complete. If a predecessor failed, the dependent task is
 * skipped.
 */
export async function dispatchTasks(input: DispatchInput): Promise<WorkerDeliverable[]> {
  const { workspaceId, tasks, workerAgents } = input;

  if (tasks.length === 0) return [];

  // Register the workspace so the job runner index is aware of it.
  registerWorkspace(workspaceId);

  // Build a lookup for worker agents.
  const agentById = new Map<string, DelegationWorkerAgent>();
  for (const agent of workerAgents) {
    agentById.set(agent.agent_id, agent);
  }

  // Build a lookup for task by task_id (for dependency resolution).
  const taskById = new Map<string, DelegatableTask>();
  for (const task of tasks) {
    taskById.set(task.task_id, task);
  }

  // Track completed deliverables by task_id so dependents can check status.
  const deliverableById = new Map<string, WorkerDeliverable>();

  // Topological execution: process tasks in waves. Each wave contains tasks
  // whose dependencies are all satisfied. Continue until all tasks are
  // processed or no progress is made (cycle detection).
  const completed = new Set<string>();
  const remaining = [...tasks];

  while (remaining.length > 0) {
    // Find tasks whose dependencies are all completed (or have no dependencies).
    const ready: DelegatableTask[] = [];
    const notReady: DelegatableTask[] = [];

    for (const task of remaining) {
      const depsSatisfied = task.depends_on.every((depId) => completed.has(depId));
      if (depsSatisfied) {
        ready.push(task);
      } else {
        notReady.push(task);
      }
    }

    // No tasks are ready — possible cycle. Mark remaining as skipped.
    if (ready.length === 0) {
      console.warn(
        `[delegation] ${notReady.length} tasks have unsatisfied dependencies (possible cycle) — skipping`
      );
      for (const task of notReady) {
        const deliverable: WorkerDeliverable = {
          task_id: task.task_id,
          worker_agent_id: task.assigned_worker_id,
          worker_name: agentById.get(task.assigned_worker_id)?.name ?? task.assigned_worker_id,
          output_type: task.expected_output_type,
          output: "",
          status: "skipped",
          error: "dependency cycle or unresolvable dependency",
          source_chair_id: task.source_chair_id,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        };
        deliverableById.set(task.task_id, deliverable);
      }
      break;
    }

    // Check for tasks whose dependencies failed — skip them.
    const toExecute: DelegatableTask[] = [];
    for (const task of ready) {
      const depFailed = task.depends_on.some((depId) => {
        const dep = deliverableById.get(depId);
        return dep && (dep.status === "failed" || dep.status === "skipped");
      });
      if (depFailed) {
        const deliverable: WorkerDeliverable = {
          task_id: task.task_id,
          worker_agent_id: task.assigned_worker_id,
          worker_name: agentById.get(task.assigned_worker_id)?.name ?? task.assigned_worker_id,
          output_type: task.expected_output_type,
          output: "",
          status: "skipped",
          error: "dependency failed or was skipped",
          source_chair_id: task.source_chair_id,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        };
        deliverableById.set(task.task_id, deliverable);
        completed.add(task.task_id);
      } else {
        toExecute.push(task);
      }
    }

    // Execute ready tasks in parallel (bounded by provider concurrency).
    const { maxParallel } = await getProviderConcurrency(workspaceId);
    const results = await mapConcurrent(toExecute, maxParallel, (task) =>
      executeTaskInline(task, workspaceId, agentById)
    );

    for (const deliverable of results) {
      deliverableById.set(deliverable.task_id, deliverable);
      completed.add(deliverable.task_id);
    }

    // Remove processed tasks from remaining.
    remaining.length = 0;
    remaining.push(...notReady);
  }

  // Return deliverables in the same order as the input tasks.
  return tasks.map((t) => deliverableById.get(t.task_id)!).filter(Boolean);
}

/**
 * Execute a single task inline: create a job, run it via the inference
 * queue, and return the deliverable. Does NOT use the 5s poll loop — this
 * runs immediately within the board chat flow.
 */
async function executeTaskInline(
  task: DelegatableTask,
  workspaceId: string,
  agentById: Map<string, DelegationWorkerAgent>
): Promise<WorkerDeliverable> {
  const agent = agentById.get(task.assigned_worker_id);
  const agentName = agent?.name ?? task.assigned_worker_id;
  const startedAt = new Date().toISOString();

  // Create a job in the job store (same mechanism as workers.ts createJob).
  // The job record is created for its side effect (job-store indexing); the
  // inference queue does not carry a correlation_id, so the handle is unused.
  createJob(workspaceId, task.assigned_worker_id, task.source_chair_id, {
    description: task.description,
    expected_output: task.expected_output_description,
    priority: "medium",
    context: {
      delegation_task_id: task.task_id,
      source_chair_id: task.source_chair_id,
      source_excerpt: task.source_excerpt,
      task_context: task.context,
      expected_output_type: task.expected_output_type,
    },
  });

  try {
    // Build the worker system prompt using the same pattern as
    // agent-job-runner.ts buildWorkerSystemPrompt, but inline.
    const systemPrompt = await buildDelegationWorkerPrompt(agent, task);

    const userMessage = [
      `TASK: ${task.description}`,
      task.expected_output_description ? `\nExpected output: ${task.expected_output_description}` : "",
      task.context ? `\nContext:\n${task.context}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Route through the inference queue for per-type concurrency budget,
    // retry with backoff, and backpressure shedding.
    const result = await enqueueInference({
      callType: "worker_dispatch",
      workspaceId,
      prompt: userMessage,
      systemPrompt,
      model: agent?.model,
      temperature: 0.2,
      maxTokens: 4096,
    });

    // enqueueInference returns raw text that may include thinking blocks;
    // strip them the same way task-extractor and board-synthesizer do.
    const output = parseThinking(result.text).answer;

    const completedAt = new Date().toISOString();

    return {
      task_id: task.task_id,
      worker_agent_id: task.assigned_worker_id,
      worker_name: agentName,
      output_type: task.expected_output_type,
      output,
      status: "completed",
      source_chair_id: task.source_chair_id,
      started_at: startedAt,
      completed_at: completedAt,
    };
  } catch (err) {
    if (err instanceof QueueFullError) {
      const completedAt = new Date().toISOString();
      return {
        task_id: task.task_id,
        worker_agent_id: task.assigned_worker_id,
        worker_name: agentName,
        output_type: task.expected_output_type,
        output: "",
        status: "skipped",
        error: "inference queue at capacity",
        source_chair_id: task.source_chair_id,
        started_at: startedAt,
        completed_at: completedAt,
      };
    }
    const completedAt = new Date().toISOString();
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.warn(`[delegation] task ${task.task_id} failed: ${errorMessage}`);

    return {
      task_id: task.task_id,
      worker_agent_id: task.assigned_worker_id,
      worker_name: agentName,
      output_type: task.expected_output_type,
      output: "",
      status: "failed",
      error: errorMessage,
      source_chair_id: task.source_chair_id,
      started_at: startedAt,
      completed_at: completedAt,
    };
  }
}

/**
 * Build the worker system prompt for a delegated task. Follows the same
 * pattern as buildWorkerSystemPrompt in agent-job-runner.ts but adapted
 * for the delegation context.
 */
async function buildDelegationWorkerPrompt(
  agent: DelegationWorkerAgent | undefined,
  task: DelegatableTask
): Promise<string> {
  const agentName = agent?.name ?? task.assigned_worker_id;
  const taskScope = agent?.task_scope ?? [];
  const laborCommonsRef = agent?.labor_commons_ref ?? null;

  const lines: string[] = [
    `You are ${agentName}, a specialist worker agent.`,
    `Your task scope: ${taskScope.length > 0 ? taskScope.join(", ") : "general"}.`,
    "",
  ];

  if (laborCommonsRef) {
    const slug = laborCommonsRef.split("/").pop() ?? laborCommonsRef;
    try {
      const spec = await getSpecialist(slug);
      if (spec) {
        lines.push(`Specialist role: ${spec.purpose}`);
        if (spec.scope.supported_tasks && spec.scope.supported_tasks.length > 0) {
          lines.push(`Supported tasks: ${spec.scope.supported_tasks.slice(0, 6).join(", ")}.`);
        }
        if (spec.knowledge_baseline && spec.knowledge_baseline.length > 0) {
          lines.push("", "Knowledge baseline:");
          for (const kb of spec.knowledge_baseline.slice(0, 4)) {
            lines.push(`- ${kb}`);
          }
        }
        if (spec.scope.out_of_scope_rules && spec.scope.out_of_scope_rules.length > 0) {
          lines.push("", "Out of scope (do not attempt):");
          for (const rule of spec.scope.out_of_scope_rules.slice(0, 2)) {
            lines.push(`- ${rule}`);
          }
        }
      }
    } catch {
      // Specialist lookup failed — continue without specialist context.
    }
  }

  lines.push(
    "",
    "Execute the assigned task completely. Be specific and actionable.",
    "If you cannot complete part of the task, state why clearly and complete what you can.",
    "Format your output for direct use — do not add preamble about what you are about to do."
  );

  return lines.join("\n");
}
