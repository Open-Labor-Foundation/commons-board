export type DevMode = "project" | "product";

export type TaskStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "testing"
  | "review"
  | "done"
  | "blocked"
  | "failed";

export type RunStatus =
  | "initialized"
  | "workspace_ready"
  | "planning"
  | "coding"
  | "testing"
  | "reviewing"
  | "finalizing"
  | "completed"
  | "blocked"
  | "failed";

export type DevTask = {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: TaskStatus;
  acceptance_criteria: string[];
  constraints: string[];
  labels: string[];
  source_type: "local_backlog" | "github_issue" | "unknown";
  source_ref?: string;
  repo_target: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
};

export type PlanOutput = {
  summary: string;
  steps: string[];
  files_to_modify: string[];
  files_to_create: string[];
  tests_to_add: string[];
  risks: string[];
  assumptions: string[];
  reviewer_focus: string[];
};

export type CodingResult = {
  status: "success" | "failed";
  changed_files: string[];
  summary: string;
  notes: string[];
};

export type NormalizedFailure = {
  command: string;
  message: string;
};

export type TestResult = {
  status: "passed" | "failed";
  executed_commands: string[];
  failures: NormalizedFailure[];
  metrics: {
    duration_seconds: number;
    tests_run: number;
  };
  raw_log_path: string | null;
};

export type ReviewResult = {
  status: "approved" | "needs_changes" | "rejected";
  comments: string[];
  missing_coverage: string[];
  risk_level: "low" | "medium" | "high";
  approval_reason: string;
};

export type FinalizationResult = {
  status: "completed" | "blocked" | "failed";
  commit_sha: string | null;
  pr_url: string | null;
  local_commit_ref: string | null;
  closure_notes: string[];
};

export type TaskRun = {
  run_id: string;
  task_id: string;
  mode: DevMode;
  workspace_id: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  planner_attempts: number;
  coding_attempts: number;
  test_iterations: number;
  review_iterations: number;
};

export type RepoSummary = {
  repo_path: string;
  key_files: string[];
};

export type PlannerRequest = {
  task: DevTask;
  repo_summary: RepoSummary;
  constraints: string[];
  acceptance_criteria: string[];
  context_files: string[];
};

export type CodingRequest = {
  task: DevTask;
  plan: PlanOutput;
  workspace_path: string;
  repair_context: {
    enabled: boolean;
    test_failures: NormalizedFailure[];
    review_comments?: string[];
  };
};

export type TestRunnerRequest = {
  workspace_path: string;
  profile: "default" | "unit" | "integration" | "lint" | "build";
  commands: string[];
  run_id: string;
};

export type ReviewerRequest = {
  task: DevTask;
  plan: PlanOutput;
  diff_summary: {
    changed_files: string[];
  };
  test_result: TestResult;
  policy: Record<string, unknown>;
};

export type TaskProvider = {
  claimNextTask(): Promise<DevTask | null>;
  transitionTask(taskId: string, nextStatus: TaskStatus, note?: string): Promise<void>;
};

export type WorkspaceDescriptor = {
  workspace_id: string;
  workspace_path: string;
  cleanup_hint: string;
  git_branch: string | null;
};

export type WorkspaceManager = {
  createWorkspace(task: DevTask, runId: string): Promise<WorkspaceDescriptor>;
};

export type ArtifactStore = {
  writePlan(runId: string, plan: PlanOutput): Promise<string>;
  writeTestResult(runId: string, testResult: TestResult): Promise<string>;
  writeReview(runId: string, review: ReviewResult): Promise<string>;
  writeRunReport(runId: string, report: Record<string, unknown>): Promise<string>;
  appendExecutionLog(runId: string, line: string): Promise<void>;
};

export type StateStore = {
  updateRun(run: TaskRun): Promise<void>;
};

export type Finalizer = {
  finalize(input: {
    task: DevTask;
    mode: DevMode;
    workspace: WorkspaceDescriptor;
    testResult: TestResult;
    reviewResult: ReviewResult;
    dryRun: boolean;
    runId: string;
    codingResult: CodingResult;
  }): Promise<FinalizationResult>;
};

export type OrchestratorResult = {
  status: "idle" | "completed" | "blocked" | "failed";
  mode: DevMode;
  task: DevTask | null;
  run: TaskRun | null;
  plan: PlanOutput | null;
  coding: CodingResult | null;
  test_result: TestResult | null;
  review_result: ReviewResult | null;
  finalization: FinalizationResult | null;
  artifacts: {
    plan_path?: string;
    test_path?: string;
    review_path?: string;
    report_path?: string;
  };
};
