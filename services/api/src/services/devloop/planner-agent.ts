import type { PlanOutput, PlannerRequest } from "./contracts.js";

export class AIPlannerAgent {
  async plan(input: PlannerRequest): Promise<PlanOutput> {
    const filesToModify = input.context_files.length > 0 ? input.context_files.slice(0, 6) : [];
    const filesToCreate = input.task.acceptance_criteria.length
      ? [`src/tasks/${input.task.id}.md`, `tests/${input.task.id}.spec.md`]
      : [`src/tasks/${input.task.id}.md`];
    const steps = [
      `Align solution with acceptance criteria (${input.acceptance_criteria.length})`,
      "Implement the smallest safe code change set",
      "Run configured tests and capture structured failures",
      "Review diff against task plan and risk profile"
    ];

    return {
      summary: `Implementation plan for ${input.task.id}: ${input.task.title}`,
      steps,
      files_to_modify: filesToModify,
      files_to_create: filesToCreate,
      tests_to_add: input.task.acceptance_criteria.map((criterion, idx) => `test:${idx + 1}:${criterion.slice(0, 100)}`),
      risks: ["scope creep", "insufficient regression coverage"],
      assumptions: ["repository is writable", "task acceptance criteria are current"],
      reviewer_focus: ["acceptance criteria coverage", "regression risk", "security impact"]
    };
  }
}
