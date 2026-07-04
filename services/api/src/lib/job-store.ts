/**
 * Job store — persists async worker agent task records to .data/jobs/{workspaceId}/.
 *
 * Each job is a single JSON file: {job_id}.json
 * An index file tracks pending/running job IDs for efficient runner polling.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./env.js";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type AgentJob = {
  job_id: string;
  workspace_id: string;
  agent_id: string;
  chair_id: string;
  task: {
    description: string;
    expected_output?: string;
    priority?: "low" | "medium" | "high";
    context?: Record<string, unknown>;
  };
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
  error: string | null;
};

function jobsDir(workspaceId: string): string {
  return path.join(loadConfig().dataDir, "jobs", workspaceId);
}

function jobPath(workspaceId: string, jobId: string): string {
  return path.join(jobsDir(workspaceId), `${jobId}.json`);
}

function indexPath(workspaceId: string): string {
  return path.join(jobsDir(workspaceId), "_index.json");
}

function ensureDir(workspaceId: string): void {
  fs.mkdirSync(jobsDir(workspaceId), { recursive: true });
}

function readIndex(workspaceId: string): string[] {
  try {
    return JSON.parse(fs.readFileSync(indexPath(workspaceId), "utf-8")) as string[];
  } catch {
    return [];
  }
}

function writeIndex(workspaceId: string, ids: string[]): void {
  fs.writeFileSync(indexPath(workspaceId), JSON.stringify(ids));
}

export function createJob(
  workspaceId: string,
  agentId: string,
  chairId: string,
  task: AgentJob["task"]
): AgentJob {
  ensureDir(workspaceId);
  const job: AgentJob = {
    job_id: randomUUID(),
    workspace_id: workspaceId,
    agent_id: agentId,
    chair_id: chairId,
    task,
    status: "pending",
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    output: null,
    error: null,
  };
  fs.writeFileSync(jobPath(workspaceId, job.job_id), JSON.stringify(job));
  const index = readIndex(workspaceId);
  index.push(job.job_id);
  writeIndex(workspaceId, index);
  return job;
}

export function getJob(workspaceId: string, jobId: string): AgentJob | null {
  try {
    return JSON.parse(fs.readFileSync(jobPath(workspaceId, jobId), "utf-8")) as AgentJob;
  } catch {
    return null;
  }
}

export function updateJob(workspaceId: string, jobId: string, patch: Partial<AgentJob>): AgentJob | null {
  const job = getJob(workspaceId, jobId);
  if (!job) return null;
  const updated = { ...job, ...patch };
  fs.writeFileSync(jobPath(workspaceId, jobId), JSON.stringify(updated));
  // Remove from index if terminal
  if (patch.status === "completed" || patch.status === "failed") {
    const index = readIndex(workspaceId).filter((id) => id !== jobId);
    writeIndex(workspaceId, index);
  }
  return updated;
}

export function listJobs(workspaceId: string, agentId?: string): AgentJob[] {
  ensureDir(workspaceId);
  const dir = jobsDir(workspaceId);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "_index.json")
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as AgentJob; }
        catch { return null; }
      })
      .filter((j): j is AgentJob => j !== null && (!agentId || j.agent_id === agentId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}

export function getPendingJobIds(workspaceId: string): string[] {
  return readIndex(workspaceId);
}
