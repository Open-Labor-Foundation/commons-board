import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArtifactStore, PlanOutput, ReviewResult, TestResult } from "./contracts.js";

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly repoPath: string) {}

  private runDir(runId: string): string {
    return join(this.repoPath, ".ai", "runs", runId);
  }

  async appendExecutionLog(runId: string, line: string): Promise<void> {
    const path = join(this.runDir(runId), "execution.log");
    await mkdir(this.runDir(runId), { recursive: true });
    await writeFile(path, `${line}\n`, { flag: "a", encoding: "utf8" });
  }

  async writePlan(runId: string, plan: PlanOutput): Promise<string> {
    const path = join(this.repoPath, ".ai", "plans", `${runId}.json`);
    await writeJson(path, plan);
    return path;
  }

  async writeTestResult(runId: string, testResult: TestResult): Promise<string> {
    const path = join(this.runDir(runId), "test-result.json");
    await writeJson(path, testResult);
    return path;
  }

  async writeReview(runId: string, review: ReviewResult): Promise<string> {
    const path = join(this.repoPath, ".ai", "reviews", `${runId}.json`);
    await writeJson(path, review);
    return path;
  }

  async writeRunReport(runId: string, report: Record<string, unknown>): Promise<string> {
    const path = join(this.repoPath, ".ai", "reports", `${runId}.json`);
    await writeJson(path, report);
    return path;
  }
}
