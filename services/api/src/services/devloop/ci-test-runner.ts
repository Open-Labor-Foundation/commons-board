import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { NormalizedFailure, TestResult, TestRunnerRequest } from "./contracts.js";

const execFileAsync = promisify(execFile);

export class CITestRunner {
  async run(input: TestRunnerRequest): Promise<TestResult> {
    const started = Date.now();
    const failures: NormalizedFailure[] = [];
    const executed: string[] = [];
    const lines: string[] = [];

    for (const command of input.commands) {
      executed.push(command);
      try {
        const { stdout, stderr } = await execFileAsync("sh", ["-lc", command], { cwd: input.workspace_path, maxBuffer: 1024 * 1024 * 8 });
        if (stdout) lines.push(`$ ${command}\n${stdout}`);
        if (stderr) lines.push(`$ ${command} [stderr]\n${stderr}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ command, message });
        lines.push(`$ ${command} [error]\n${message}`);
      }
    }

    const runDir = join(input.workspace_path, ".ai", "runs", input.run_id);
    await mkdir(runDir, { recursive: true });
    const logPath = join(runDir, "test.log");
    await writeFile(logPath, lines.join("\n\n"), "utf8");

    return {
      status: failures.length === 0 ? "passed" : "failed",
      executed_commands: executed,
      failures,
      metrics: {
        duration_seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
        tests_run: executed.length
      },
      raw_log_path: logPath
    };
  }
}
