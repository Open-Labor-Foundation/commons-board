/**
 * Agent job runner — CB-native async worker agent execution loop.
 *
 * Polls for pending jobs every 5 seconds. Runs up to MAX_CONCURRENT jobs in
 * parallel across all agents; each agent serializes its own jobs so outputs
 * don't race. Jobs execute via completeText with the worker's specialist
 * system prompt built from their labor-commons spec.
 */
import { getArtifact } from "../lib/artifact-store.js";
import { getSpecialist } from "../lib/labor-commons-client.js";
import { completeText, getProviderConcurrency, NoProviderConfiguredError } from "../lib/model-client.js";
import {
  createJob,
  getJob,
  getPendingJobIds,
  listJobs,
  updateJob,
  type AgentJob,
} from "../lib/job-store.js";

export { createJob, getJob, listJobs };
export type { AgentJob };

const POLL_INTERVAL_MS = 5000;

// Track which jobs are currently executing to avoid double-processing
const running = new Set<string>();

// Track which agents are running to enforce per-agent serialization
const agentRunning = new Set<string>();

type BlueprintWorkerAgent = {
  agent_id: string;
  name: string;
  labor_commons_ref: string | null;
  task_scope: string[];
  model?: string;
};

type BlueprintChair = {
  chair_id: string;
  name: string;
  domain: string;
  labor_commons_refs?: Array<{ specialist_slug: string; catalog_path: string; role: string }>;
  worker_agents?: BlueprintWorkerAgent[];
  model?: string;
};

async function getChairsFromBlueprint(workspaceId: string): Promise<BlueprintChair[]> {
  const record = await getArtifact(workspaceId, "agent_blueprint");
  if (!record) return [];
  const bp = record.payload as Record<string, unknown>;
  return Array.isArray(bp.chairs) ? (bp.chairs as BlueprintChair[]) : [];
}

function findAgent(
  chairs: BlueprintChair[],
  agentId: string
): { agent: BlueprintWorkerAgent; chair: BlueprintChair } | null {
  for (const chair of chairs) {
    const agent = (chair.worker_agents ?? []).find((a) => a.agent_id === agentId);
    if (agent) return { agent, chair };
  }
  return null;
}

export async function buildWorkerSystemPrompt(
  agentName: string,
  taskScope: string[],
  chairName: string,
  laborCommonsRef: string | null
): Promise<string> {
  const lines: string[] = [
    `You are ${agentName}, a specialist worker agent on the ${chairName}.`,
    `Your task scope: ${taskScope.join(", ")}.`,
    "",
  ];

  if (laborCommonsRef) {
    // catalog_path format: "section-slug/agent-slug"
    const slug = laborCommonsRef.split("/").pop() ?? laborCommonsRef;
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
  }

  lines.push(
    "",
    "Execute the assigned task completely. Be specific and actionable.",
    "If you cannot complete part of the task, state why clearly and complete what you can.",
    "Format your output for direct use — do not add preamble about what you are about to do."
  );

  return lines.join("\n");
}

async function executeJob(job: AgentJob): Promise<void> {
  const chairs = await getChairsFromBlueprint(job.workspace_id);
  const match = findAgent(chairs, job.agent_id);

  updateJob(job.workspace_id, job.job_id, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  try {
    const agentName = match?.agent.name ?? job.agent_id;
    const chairName = match?.chair.name ?? job.chair_id;
    const taskScope = match?.agent.task_scope ?? [];
    const laborCommonsRef = match?.agent.labor_commons_ref ?? null;
    // Agent model > chair model > provider default
    const model = match?.agent.model ?? match?.chair.model ?? undefined;

    const systemPrompt = await buildWorkerSystemPrompt(agentName, taskScope, chairName, laborCommonsRef);

    const userMessage = [
      `TASK: ${job.task.description}`,
      job.task.expected_output ? `\nExpected output: ${job.task.expected_output}` : "",
      job.task.context ? `\nContext:\n${JSON.stringify(job.task.context, null, 2)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let output: string;
    try {
      output = await completeText(job.workspace_id, systemPrompt, userMessage, {
        max_tokens: 2048,
        temperature: 0.2,
        correlation_id: job.job_id,
        model,
      });
    } catch (err) {
      if (err instanceof NoProviderConfiguredError) {
        // Template output — provider not configured, produce a structured stub
        output =
          `${agentName} couldn't run this task because no inference provider is configured — ` +
          `configure one in Settings to enable AI task execution. ` +
          `When configured, this agent would apply its specialist expertise to complete "${job.task.description}" and return actionable output. ` +
          `_Specialist: ${laborCommonsRef ?? "unassigned"}_`;
      } else {
        throw err;
      }
    }

    updateJob(job.workspace_id, job.job_id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      output,
    });
  } catch (err) {
    updateJob(job.workspace_id, job.job_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Known workspace IDs that have jobs — populated when jobs are created
const activeWorkspaces = new Set<string>(["default"]);

export function registerWorkspace(workspaceId: string): void {
  activeWorkspaces.add(workspaceId);
}

async function tick(): Promise<void> {
  for (const workspaceId of activeWorkspaces) {
    const { maxParallel } = getProviderConcurrency(workspaceId);
    if (running.size >= maxParallel) return;

    const pendingIds = getPendingJobIds(workspaceId);

    for (const jobId of pendingIds) {
      if (running.size >= maxParallel) break;
      if (running.has(jobId)) continue;

      const job = getJob(workspaceId, jobId);
      if (!job || job.status !== "pending") continue;

      // Enforce per-agent serialization
      const agentKey = `${workspaceId}:${job.agent_id}`;
      if (agentRunning.has(agentKey)) continue;

      running.add(jobId);
      agentRunning.add(agentKey);

      executeJob(job).finally(() => {
        running.delete(jobId);
        agentRunning.delete(agentKey);
      });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startJobRunner(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  // Run once immediately on start
  void tick();
  console.log("[CB] Agent job runner started (poll interval: 5s, concurrency from provider settings)");
}

export function stopJobRunner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
