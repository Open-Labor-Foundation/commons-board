import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

function repoRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, "../../..");
}

function checkEnvVars() {
  const required = ["NODE_ENV"];
  return required.map((key) => ({ key, ok: Boolean(process.env[key]), severity: "warn" as const }));
}

function checkFiles(root: string) {
  const required = [
    "services/api/db/migrations/0001_core.sql",
    "services/api/db/migrations/0002_collective.sql",
    "services/api/db/migrations/0003_catalog.sql",
    "services/api/db/migrations/0004_economics.sql",
    "services/api/db/migrations/0005_settings.sql",
    "docker-compose.yml"
  ];
  return required.map((rel) => ({ file: rel, ok: existsSync(path.join(root, rel)), severity: "error" as const }));
}

async function checkApiDiagnostics() {
  const baseUrl = process.env.CB_API_BASE_URL;
  const workspaceId = process.env.CB_WORKSPACE_ID ?? "doctor-workspace";
  const userId = process.env.CB_USER_ID ?? "doctor-bot";
  const userRole = process.env.CB_USER_ROLE ?? "admin";

  if (!baseUrl) {
    return { attempted: false, checks: [] as Array<{ name: string; ok: boolean; severity: "warn"; details?: string }> };
  }

  const headers = { "x-workspace-id": workspaceId, "x-user-id": userId, "x-user-role": userRole };
  const checks: Array<{ name: string; ok: boolean; severity: "warn"; details?: string }> = [];

  try {
    const [health, settings] = await Promise.all([
      fetch(`${baseUrl}/health`, { headers }),
      fetch(`${baseUrl}/api/v1/settings`, { headers })
    ]);
    checks.push({ name: "api_health", ok: health.ok, severity: "warn", details: health.ok ? undefined : `HTTP ${health.status}` });
    checks.push({ name: "settings_endpoint", ok: settings.ok, severity: "warn", details: settings.ok ? undefined : `HTTP ${settings.status}` });
  } catch (error) {
    checks.push({ name: "api_connectivity", ok: false, severity: "warn", details: error instanceof Error ? error.message : "unknown error" });
  }

  return { attempted: true, checks };
}

async function main() {
  const root = repoRoot();
  const env = checkEnvVars();
  const files = checkFiles(root);
  const api = await checkApiDiagnostics();
  const checks = [...env, ...files, ...api.checks];
  const hasErrors = checks.some((item) => !item.ok && item.severity === "error");
  const hasWarnings = checks.some((item) => !item.ok && item.severity === "warn");

  const report = {
    status: hasErrors ? "error" : hasWarnings ? "warn" : "ok",
    env,
    files,
    api,
    hints: [
      "Run npm run test for the unit/integration suite.",
      "Run node services/testing-agent/src/cli.js for full system validation.",
      "Set CB_API_BASE_URL to include live API diagnostics."
    ]
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "error") process.exitCode = 1;
}

await main();
