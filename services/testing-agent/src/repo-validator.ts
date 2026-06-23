import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandCheck } from "./command.js";
import type { ValidationCheck } from "./types.js";

function repoRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, "../../..");
}

export async function runRepoValidation(): Promise<ValidationCheck[]> {
  const cwd = repoRoot();

  const checks = [
    () => runCommandCheck({ name: "baseline:typecheck", cmd: "npm", args: ["run", "typecheck"], cwd }),
    () => runCommandCheck({ name: "baseline:test", cmd: "npm", args: ["run", "test"], cwd, retries: 2 }),
    () =>
      runCommandCheck({
        name: "baseline:migrations_present",
        cmd: "sh",
        args: ["-c", "test -f services/api/db/migrations/0001_core.sql && test -f services/api/db/migrations/0002_collective.sql"],
        cwd
      }),
    () =>
      runCommandCheck({
        name: "baseline:docker_services_declared",
        cmd: "sh",
        args: [
          "-c",
          "grep -q 'cb-api:' docker-compose.yml && grep -q 'cb-web:' docker-compose.yml && grep -q 'cb-db:' docker-compose.yml"
        ],
        cwd
      })
  ];

  const results: ValidationCheck[] = [];
  for (const check of checks) {
    results.push(await check());
  }
  return results;
}
