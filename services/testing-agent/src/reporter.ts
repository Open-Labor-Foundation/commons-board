import type { TestingAgentReport, ValidationCheck } from "./types.js";

export function buildReport(checks: ValidationCheck[]): TestingAgentReport {
  const total = checks.length;
  const passed = checks.filter((check) => check.passed).length;
  const failed = total - passed;
  return {
    status: failed === 0 ? "pass" : "fail",
    summary: failed === 0 ? `All ${total} checks passed.` : `${failed} of ${total} checks failed.`,
    failed_tests: checks.filter((check) => !check.passed).map((check) => check.name),
    metrics: { total_tests: total, passed, failed }
  };
}
