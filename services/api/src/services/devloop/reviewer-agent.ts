import type { ReviewResult, ReviewerRequest } from "./contracts.js";

export class AIReviewerAgent {
  async review(input: ReviewerRequest): Promise<ReviewResult> {
    if (input.test_result.status !== "passed") {
      return {
        status: "rejected",
        comments: ["Test suite did not pass."],
        missing_coverage: input.plan.tests_to_add,
        risk_level: "high",
        approval_reason: "Cannot approve while tests are failing"
      };
    }

    const missingCoverage = input.plan.tests_to_add.filter((item) => !item.toLowerCase().includes("test:"));
    if (missingCoverage.length > 0) {
      return {
        status: "needs_changes",
        comments: ["Coverage tags are incomplete."],
        missing_coverage: missingCoverage,
        risk_level: "medium",
        approval_reason: "Additional test coverage metadata required"
      };
    }

    return {
      status: "approved",
      comments: ["Plan alignment and test status satisfied"],
      missing_coverage: [],
      risk_level: input.diff_summary.changed_files.length > 8 ? "medium" : "low",
      approval_reason: "Changes meet acceptance gate"
    };
  }
}
