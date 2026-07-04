import { spawn } from "node:child_process";
import type { ValidationCheck } from "./types.js";

export function runCommandCheck(params: {
  name: string;
  cmd: string;
  args: string[];
  cwd: string;
  retries?: number;
}): Promise<ValidationCheck> {
  return new Promise((resolve) => {
    const maxAttempts = Math.max(1, params.retries ?? 1);
    let attempt = 1;
    let output = "";

    const runAttempt = () => {
      const child = spawn(params.cmd, params.args, {
        cwd: params.cwd,
        stdio: "pipe",
        shell: false,
        env: { ...process.env, NODE_ENV: "test" }
      });

      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ name: params.name, passed: true, details: output.slice(0, 1200) });
          return;
        }
        if (attempt < maxAttempts) {
          attempt += 1;
          output += `\n[retry] ${params.name} attempt ${attempt}/${maxAttempts}\n`;
          runAttempt();
          return;
        }
        resolve({ name: params.name, passed: false, details: output.slice(0, 1200) });
      });
    };

    runAttempt();
  });
}
