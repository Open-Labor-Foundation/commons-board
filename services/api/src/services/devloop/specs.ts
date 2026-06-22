export const DEVLOOP_TASK_STATES = [
  "pending",
  "claimed",
  "in_progress",
  "testing",
  "review",
  "done",
  "blocked",
  "failed"
] as const;

export const DEVLOOP_RUN_STATES = [
  "initialized",
  "workspace_ready",
  "planning",
  "coding",
  "testing",
  "reviewing",
  "finalizing",
  "completed",
  "blocked",
  "failed"
] as const;

export const DEVLOOP_RETRY_BUDGETS = {
  planner: 2,
  coding: 3,
  test_fix_iterations: 5,
  review_fix_iterations: 3
} as const;

export const DEVLOOP_SERVICE_CONTRACTS = {
  PlannerAgent: {
    request: {
      task: {},
      repo_summary: {},
      constraints: [],
      acceptance_criteria: [],
      context_files: []
    },
    response: {
      summary: "string",
      steps: ["string"],
      files_to_modify: ["string"],
      files_to_create: ["string"],
      tests_to_add: ["string"],
      risks: ["string"],
      assumptions: ["string"],
      reviewer_focus: ["string"]
    }
  },
  CodingAgent: {
    request: {
      task: {},
      plan: {},
      workspace_path: "string",
      repair_context: {
        enabled: false,
        test_failures: []
      }
    },
    response: {
      status: "success",
      changed_files: ["string"],
      summary: "string",
      notes: ["string"]
    }
  },
  CITestRunner: {
    request: {
      workspace_path: "string",
      profile: "default",
      commands: ["string"]
    },
    response: {
      status: "passed",
      executed_commands: ["string"],
      failures: [],
      metrics: {
        duration_seconds: 0,
        tests_run: 0
      },
      raw_log_path: "string"
    }
  },
  ReviewerAgent: {
    request: {
      task: {},
      plan: {},
      diff_summary: {},
      test_result: {},
      policy: {}
    },
    response: {
      status: "approved",
      comments: [],
      missing_coverage: [],
      risk_level: "low",
      approval_reason: "string"
    }
  }
} as const;
