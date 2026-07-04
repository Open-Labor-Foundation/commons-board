import { runGovernanceValidation } from "./governance-validator.js";
import { runIntegrationSimulation } from "./integration-simulator.js";
import { buildReport } from "./reporter.js";
import { runRepoValidation } from "./repo-validator.js";
import type { TestingAgentReport } from "./types.js";

export async function runTestingAgent(): Promise<{ report: TestingAgentReport }> {
  const baseline = await runRepoValidation();
  const integration = await runIntegrationSimulation();
  const governance = await runGovernanceValidation();
  const report = buildReport([...baseline, ...integration, ...governance]);
  return { report };
}
