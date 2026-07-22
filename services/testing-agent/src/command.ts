import { spawn } from "node:child_process";
import type { ValidationCheck } from "./types.js";

export function runCommandCheck(params: {
  name: string;
  cmd: string;
  args: string[];
  cwd: string;
  retries?: number;
  /** Per-attempt timeout in ms. Default: 120000 (2 min). */
  timeoutMs?: number;
}): Promise<ValidationCheck> {
  return new Promise((resolve) => {
    const maxAttempts = Math.max(1, params.retries ?? 1);
    const perAttemptTimeout = params.timeoutMs ?? 120_000;
    let attempt = 1;
    let output = "";
    let settled = false;

    const done = (result: ValidationCheck) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const runAttempt = () => {
      const child = spawn(params.cmd, params.args, {
        cwd: params.cwd,
        stdio: "pipe",
        shell: false,
        env: { ...process.env, NODE_ENV: "test" }
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        output += `\n[timeout] ${params.name} exceeded ${perAttemptTimeout}ms — killed\n`;
        if (attempt < maxAttempts) {
          attempt += 1;
          output += `\n[retry] ${params.name} attempt ${attempt}/${maxAttempts}\n`;
          runAttempt();
          return;
        }
        done({ name: params.name, passed: false, details: output.slice(0, 1200) });
      }, perAttemptTimeout);

      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          done({ name: params.name, passed: true, details: output.slice(0, 1200) });
          return;
        }
        if (attempt < maxAttempts) {
          attempt += 1;
          output += `\n[retry] ${params.name} attempt ${attempt}/${maxAttempts}\n`;
          runAttempt();
          return;
        }
        done({ name: params.name, passed: false, details: output.slice(0, 1200) });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        output += `\n[error] ${err.message}\n`;
        done({ name: params.name, passed: false, details: output.slice(0, 1200) });
      });
    };

    runAttempt();
  });
}
