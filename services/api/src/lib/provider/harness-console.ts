/**
 * Harness/console inference adapter — bridges to a console-authenticated CLI
 * harness (e.g. a logged-in coding CLI) rather than a raw API key. The harness
 * command is configured via options.command and receives the prompt on stdin.
 *
 * Credentials live in the harness's own session, never in commons-board.
 */
import { spawn } from "node:child_process";
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider } from "./index.js";

class HarnessConsoleProvider implements InferenceProvider {
  readonly kind = "harness_console" as const;
  readonly provider_id: string;

  constructor(private readonly config: ProviderConfig) {
    this.provider_id = config.provider_id;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const command = String(this.config.options.command ?? "");
    if (!command) {
      return this.fail("harness_console provider has no options.command configured");
    }
    const args = String(this.config.options.args ?? "")
      .split(" ")
      .filter((a) => a.length > 0);

    return new Promise<InferenceResponse>((resolve) => {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (err += String(d)));
      child.on("error", (e) => resolve(this.fail(e.message)));
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ ok: true, text: out.trim(), provider_id: this.provider_id, model: this.config.model });
        } else {
          resolve(this.fail(`harness exited ${code}: ${err.trim()}`));
        }
      });
      child.stdin.write(`${req.system}\n\n${req.prompt}`);
      child.stdin.end();
    });
  }

  private fail(error: string): InferenceResponse {
    return { ok: false, text: "", provider_id: this.provider_id, model: this.config.model, error };
  }
}

registerProvider("harness_console", (config) => new HarnessConsoleProvider(config));
