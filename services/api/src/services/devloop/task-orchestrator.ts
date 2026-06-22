import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AICodingAgent } from "./coding-agent.js";
import type {
  ArtifactStore,
  DevMode,
  OrchestratorResult,
  PlanOutput,
  RepoSummary,
  ReviewResult,
  StateStore,
  TaskProvider,
  TaskRun,
  TestResult,
  WorkspaceManager,
  Finalizer
} from "./contracts.js";
import { AIPlannerAgent } from "./planner-agent.js";
import { AIReviewerAgent } from "./reviewer-agent.js";
import { CITestRunner } from "./ci-test-runner.js";

export type OrchestratorInput = {
  mode: DevMode;
  testProfile: "default" | "unit" | "integration" | "lint" | "build";
  dryRun: boolean;
};

export type OrchestratorDeps = {
  taskProvider: TaskProvider;
  workspaceManager: WorkspaceManager;
  artifactStore: ArtifactStore;
  stateStore: StateStore;
  plannerAgent: AIPlannerAgent;
  codingAgent: AICodingAgent;
  ciTestRunner: CITestRunner;
  reviewerAgent: AIReviewerAgent;
  finalizer: Finalizer;
  repoPath: string;
};

async function listContextFiles(repoPath: string): Promise<string[]> {
  const candidates = ["README.md", "package.json", "services/api/src/index.ts", "apps/web/src/app/page.tsx"];
  const hits: string[] = [];
  for (const candidate of candidates) {
    try {
      await readFile(join(repoPath, candidate), "utf8");
      hits.push(candidate);
    } catch {
      continue;
    }
  }
  return hits;
}

async function testCommandsForProfile(repoPath: string, profile: OrchestratorInput["testProfile"]): Promise<string[]> {
  const configPath = join(repoPath, ".ai", "config.json");
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
      test_profiles?: Record<string, string[]>;
    };
    const profileCommands = parsed.test_profiles?.[profile];
    if (Array.isArray(profileCommands) && profileCommands.length > 0) return profileCommands.map((item) => String(item));
  } catch {
    // no-op
  }
  if (profile === "default") return ["npm run test --if-present"];
  return [`npm run ${profile} --if-present`];
}

export class TaskOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async runNext(input: OrchestratorInput): Promise<OrchestratorResult> {
    const task = await this.deps.taskProvider.claimNextTask();
    if (!task) {
      return {
        status: "idle",
        mode: input.mode,
        task: null,
        run: null,
        plan: null,
        coding: null,
        test_result: null,
        review_result: null,
        finalization: null,
        artifacts: {}
      };
    }

    const runId = randomUUID();
    const run: TaskRun = {
      run_id: runId,
      task_id: task.id,
      mode: input.mode,
      workspace_id: "",
      status: "initialized",
      started_at: new Date().toISOString(),
      ended_at: null,
      planner_attempts: 0,
      coding_attempts: 0,
      test_iterations: 0,
      review_iterations: 0
    };
    await this.deps.stateStore.updateRun(run);
    await this.deps.taskProvider.transitionTask(task.id, "in_progress");

    let artifacts: OrchestratorResult["artifacts"] = {};
    let plan: PlanOutput | null = null;
    let codingResult: OrchestratorResult["coding"] = null;
    let testResult: TestResult | null = null;
    let reviewResult: ReviewResult | null = null;

    try {
      const workspace = await this.deps.workspaceManager.createWorkspace(task, runId);
      run.workspace_id = workspace.workspace_id;
      run.status = "workspace_ready";
      await this.deps.stateStore.updateRun(run);
      await this.deps.artifactStore.appendExecutionLog(runId, `workspace_created path=${workspace.workspace_path}`);

      run.status = "planning";
      run.planner_attempts += 1;
      await this.deps.stateStore.updateRun(run);

      const contextFiles = await listContextFiles(this.deps.repoPath);
      const repoSummary: RepoSummary = {
        repo_path: this.deps.repoPath,
        key_files: contextFiles
      };

      plan = await this.deps.plannerAgent.plan({
        task,
        repo_summary: repoSummary,
        constraints: task.constraints,
        acceptance_criteria: task.acceptance_criteria,
        context_files: contextFiles
      });
      artifacts.plan_path = await this.deps.artifactStore.writePlan(runId, plan);
      await this.deps.artifactStore.appendExecutionLog(runId, "plan_created");

      const maxCodingAttempts = 3;
      const maxReviewIterations = 3;
      let reviewIterations = 0;

      for (let attempt = 1; attempt <= maxCodingAttempts; attempt += 1) {
        run.status = "coding";
        run.coding_attempts = attempt;
        await this.deps.stateStore.updateRun(run);
        codingResult = await this.deps.codingAgent.apply({
          task,
          plan,
          workspace_path: workspace.workspace_path,
          repair_context: {
            enabled: attempt > 1,
            test_failures: testResult?.failures ?? [],
            review_comments: reviewResult?.comments ?? []
          }
        });

        run.status = "testing";
        run.test_iterations += 1;
        await this.deps.stateStore.updateRun(run);
        const commands = await testCommandsForProfile(this.deps.repoPath, input.testProfile);
        testResult = await this.deps.ciTestRunner.run({
          workspace_path: workspace.workspace_path,
          profile: input.testProfile,
          commands,
          run_id: runId
        });
        artifacts.test_path = await this.deps.artifactStore.writeTestResult(runId, testResult);

        if (testResult.status !== "passed") {
          await this.deps.artifactStore.appendExecutionLog(runId, `tests_failed attempt=${attempt}`);
          continue;
        }

        run.status = "reviewing";
        run.review_iterations += 1;
        await this.deps.stateStore.updateRun(run);
        reviewResult = await this.deps.reviewerAgent.review({
          task,
          plan,
          diff_summary: { changed_files: codingResult.changed_files },
          test_result: testResult,
          policy: { mode: input.mode }
        });
        artifacts.review_path = await this.deps.artifactStore.writeReview(runId, reviewResult);

        if (reviewResult.status === "approved") {
          break;
        }

        reviewIterations += 1;
        if (reviewIterations >= maxReviewIterations || reviewResult.status === "rejected") {
          break;
        }
      }

      run.status = "finalizing";
      await this.deps.stateStore.updateRun(run);
      const finalization = await this.deps.finalizer.finalize({
        task,
        mode: input.mode,
        workspace,
        testResult:
          testResult ?? {
            status: "failed",
            executed_commands: [],
            failures: [{ command: "unknown", message: "test runner did not execute" }],
            metrics: { duration_seconds: 0, tests_run: 0 },
            raw_log_path: null
          },
        reviewResult:
          reviewResult ?? {
            status: "rejected",
            comments: ["review stage did not complete"],
            missing_coverage: [],
            risk_level: "high",
            approval_reason: "review not completed"
          },
        dryRun: input.dryRun,
        runId,
        codingResult:
          codingResult ?? {
            status: "failed",
            changed_files: [],
            summary: "coding stage did not complete",
            notes: []
          }
      });

      const nextTaskStatus =
        finalization.status === "completed" ? "done" : finalization.status === "blocked" ? "blocked" : "failed";
      await this.deps.taskProvider.transitionTask(task.id, nextTaskStatus);

      run.status = finalization.status === "completed" ? "completed" : finalization.status;
      run.ended_at = new Date().toISOString();
      await this.deps.stateStore.updateRun(run);

      artifacts.report_path = await this.deps.artifactStore.writeRunReport(runId, {
        task,
        run,
        plan,
        coding: codingResult,
        test_result: testResult,
        review_result: reviewResult,
        finalization
      });

      return {
        status: finalization.status,
        mode: input.mode,
        task,
        run,
        plan,
        coding: codingResult,
        test_result: testResult,
        review_result: reviewResult,
        finalization,
        artifacts
      };
    } catch (error) {
      run.status = "failed";
      run.ended_at = new Date().toISOString();
      await this.deps.stateStore.updateRun(run);
      await this.deps.taskProvider.transitionTask(task.id, "failed");
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.artifactStore.writeRunReport(runId, {
        task,
        run,
        error: message
      });
      return {
        status: "failed",
        mode: input.mode,
        task,
        run,
        plan,
        coding: codingResult,
        test_result: testResult,
        review_result: reviewResult,
        finalization: {
          status: "failed",
          commit_sha: null,
          pr_url: null,
          local_commit_ref: null,
          closure_notes: [message]
        },
        artifacts
      };
    }
  }
}
