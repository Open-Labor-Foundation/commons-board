import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DevTask, TaskProvider, TaskStatus } from "../contracts.js";

function now(): string {
  return new Date().toISOString();
}

function asTask(raw: Record<string, unknown>): DevTask {
  return {
    id: String(raw.id ?? `task-${Date.now()}`),
    title: String(raw.title ?? "Untitled Task"),
    description: String(raw.description ?? ""),
    priority: String(raw.priority ?? "medium"),
    status: (String(raw.status ?? "pending") as TaskStatus) || "pending",
    acceptance_criteria: Array.isArray(raw.acceptance_criteria) ? raw.acceptance_criteria.map((item) => String(item)) : [],
    constraints: Array.isArray(raw.constraints) ? raw.constraints.map((item) => String(item)) : [],
    labels: Array.isArray(raw.labels) ? raw.labels.map((item) => String(item)) : [],
    source_type: "local_backlog",
    source_ref: String(raw.source_ref ?? "local:.ai/backlog.json"),
    repo_target: String(raw.repo_target ?? "."),
    created_at: String(raw.created_at ?? now()),
    updated_at: String(raw.updated_at ?? now()),
    metadata: typeof raw.metadata === "object" && raw.metadata ? (raw.metadata as Record<string, unknown>) : {}
  };
}

export class LocalBacklogTaskProvider implements TaskProvider {
  private readonly backlogPath: string;

  constructor(private readonly repoPath: string) {
    this.backlogPath = join(this.repoPath, ".ai", "backlog.json");
  }

  private async readTasks(): Promise<DevTask[]> {
    try {
      const raw = JSON.parse(await readFile(this.backlogPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((item) => asTask((item as Record<string, unknown>) ?? {}));
    } catch {
      return [];
    }
  }

  private async writeTasks(tasks: DevTask[]): Promise<void> {
    await mkdir(join(this.backlogPath, ".."), { recursive: true });
    await writeFile(this.backlogPath, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  }

  async claimNextTask(): Promise<DevTask | null> {
    const tasks = await this.readTasks();
    const next = tasks.find((item) => item.status === "pending");
    if (!next) return null;
    next.status = "claimed";
    next.updated_at = now();
    await this.writeTasks(tasks);
    return next;
  }

  async transitionTask(taskId: string, nextStatus: TaskStatus): Promise<void> {
    const tasks = await this.readTasks();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.status = nextStatus;
    task.updated_at = now();
    await this.writeTasks(tasks);
  }
}
