/**
 * Smoke test for Phase 3 specialist resolver.
 * Run: node scripts/smoke-resolver.mjs
 * Requires CB_LABOR_COMMONS_PATH to be set.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

process.env.CB_LABOR_COMMONS_PATH = process.env.CB_LABOR_COMMONS_PATH ?? join(root, "..", "labor-commons");
// persistence needs a data dir
process.env.CB_DATA_DIR = "/tmp/commons-board-smoke";
process.env.CB_NODE_ENV = "development";
process.env.CB_PORT = "3001";
process.env.CB_GOVERNANCE_MODE = "development";

// Import from compiled dist
const { searchSpecialists } = await import(join(root, "services/api/dist/lib/labor-commons-client.js"));

const TEST_CASES = [
  {
    label: "Finance Chair",
    query: {
      function_description: "Financial planning, bookkeeping, budget approval and financial reporting",
      industry: "technology",
      domain_hint: "finance",
      required_tasks: ["budget_approval", "financial_reporting", "expense_policy"]
    }
  },
  {
    label: "Operations Chair",
    query: {
      function_description: "Day-to-day operational workflows, vendor management, logistics and facilities coordination",
      industry: "technology",
      domain_hint: "ops",
      required_tasks: ["vendor_onboarding", "facility_management", "logistics"]
    }
  },
  {
    label: "Legal Chair",
    query: {
      function_description: "Contract review, compliance monitoring, regulatory risk assessment and legal advisory",
      industry: "technology",
      domain_hint: "legal",
      required_tasks: ["contract_review", "compliance_audit", "risk_assessment"]
    }
  },
  {
    label: "Growth Chair",
    query: {
      function_description: "Marketing campaigns, customer acquisition, brand strategy and revenue growth",
      industry: "technology",
      domain_hint: "growth",
      required_tasks: ["campaign_management", "customer_acquisition", "brand_strategy"]
    }
  },
  {
    label: "IT Chair",
    query: {
      function_description: "Cloud infrastructure, cybersecurity, network management and software deployments",
      industry: "technology",
      domain_hint: "it",
      required_tasks: ["cloud_deployment", "security_audit", "network_monitoring"]
    }
  }
];

console.log("=== Specialist Resolver Smoke Test ===\n");

for (const { label, query } of TEST_CASES) {
  const matches = await searchSpecialists(query);
  console.log(`Chair: ${label}`);
  if (matches.length === 0) {
    console.log("  No matches found (gap)");
  } else {
    const top3 = matches.slice(0, 3);
    for (let i = 0; i < top3.length; i++) {
      const m = top3[i];
      const role = i === 0 ? "Primary" : "Supporting";
      console.log(`  ${role}: ${m.display_name} (score=${m.match_score}, family=${m.domain_family})`);
    }
  }
  console.log();
}
