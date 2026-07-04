import { runTestingAgent } from "./orchestrator.js";

async function main() {
  const { report } = await runTestingAgent();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "fail") process.exitCode = 1;
}

main().catch((error) => {
  const fallback = {
    status: "fail",
    summary: "Testing agent crashed before completion.",
    failed_tests: ["testing_agent:uncaught_exception"],
    metrics: { total_tests: 1, passed: 0, failed: 1 }
  };
  process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
