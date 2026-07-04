import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./env.js";

export type BoardChatJobStatus = "pending" | "running" | "done" | "error";

export type ChairPartialResult = {
  chair_id: string;
  chair_name: string;
  domain: string;
  thinking: string | null;
  answer: string;
  completed_at: string;
};

export type BoardChatResult = {
  thread_id: string;
  headline: string;
  summary_markdown: string;
  recommended_workflows: string[];
  meta: Record<string, unknown>;
};

export type BoardChatJob = {
  job_id: string;
  workspace_id: string;
  thread_id: string;
  message: string;
  status: BoardChatJobStatus;
  partial_results: ChairPartialResult[];
  result: BoardChatResult | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

function boardJobsDir(workspaceId: string): string {
  return path.join(loadConfig().dataDir, "board-chat-jobs", workspaceId);
}

function boardJobPath(workspaceId: string, jobId: string): string {
  return path.join(boardJobsDir(workspaceId), `${jobId}.json`);
}

export function createBoardChatJob(
  workspaceId: string,
  threadId: string,
  message: string
): BoardChatJob {
  fs.mkdirSync(boardJobsDir(workspaceId), { recursive: true });
  const job: BoardChatJob = {
    job_id: randomUUID(),
    workspace_id: workspaceId,
    thread_id: threadId,
    message,
    status: "pending",
    partial_results: [],
    result: null,
    error: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  fs.writeFileSync(boardJobPath(workspaceId, job.job_id), JSON.stringify(job));
  return job;
}

export function getBoardChatJob(workspaceId: string, jobId: string): BoardChatJob | null {
  try {
    return JSON.parse(
      fs.readFileSync(boardJobPath(workspaceId, jobId), "utf-8")
    ) as BoardChatJob;
  } catch {
    return null;
  }
}

export function updateBoardChatJob(
  workspaceId: string,
  jobId: string,
  patch: Partial<BoardChatJob>
): void {
  const job = getBoardChatJob(workspaceId, jobId);
  if (!job) return;
  fs.writeFileSync(
    boardJobPath(workspaceId, jobId),
    JSON.stringify({ ...job, ...patch })
  );
}

/** Appends a completed chair result to the job as it finishes — enables progressive UI reveal. */
export function appendChairResult(
  workspaceId: string,
  jobId: string,
  result: ChairPartialResult
): void {
  const job = getBoardChatJob(workspaceId, jobId);
  if (!job) return;
  fs.writeFileSync(
    boardJobPath(workspaceId, jobId),
    JSON.stringify({ ...job, partial_results: [...(job.partial_results ?? []), result] })
  );
}

export type BoardChatThreadSummary = {
  thread_id: string;
  first_message: string;
  created_at: string;
  last_activity: string;
  job_count: number;
  last_headline: string | null;
};

function listAllJobs(workspaceId: string): BoardChatJob[] {
  const dir = boardJobsDir(workspaceId);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as BoardChatJob];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Returns one summary per thread, newest last_activity first. */
export function listBoardChatThreads(workspaceId: string): BoardChatThreadSummary[] {
  const jobs = listAllJobs(workspaceId);
  const byThread = new Map<string, BoardChatJob[]>();
  for (const job of jobs) {
    if (!byThread.has(job.thread_id)) byThread.set(job.thread_id, []);
    byThread.get(job.thread_id)!.push(job);
  }
  const summaries: BoardChatThreadSummary[] = [];
  for (const [thread_id, threadJobs] of byThread) {
    const sorted = [...threadJobs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = sorted[sorted.length - 1];
    summaries.push({
      thread_id,
      first_message: sorted[0].message,
      created_at: sorted[0].created_at,
      last_activity: last.completed_at ?? last.created_at,
      job_count: sorted.length,
      last_headline: last.result?.headline ?? null,
    });
  }
  return summaries.sort((a, b) => b.last_activity.localeCompare(a.last_activity));
}

/** Returns all jobs for a thread in chronological order. */
export function listJobsForThread(workspaceId: string, threadId: string): BoardChatJob[] {
  return listAllJobs(workspaceId)
    .filter((j) => j.thread_id === threadId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
