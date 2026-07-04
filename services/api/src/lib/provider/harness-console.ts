/**
 * Harness/console inference adapter — bridges to a console-authenticated CLI
 * harness (e.g. a logged-in coding CLI) rather than a raw API key. The harness
 * command is configured via options.command and receives the prompt on stdin.
 *
 * Credentials live in the harness's own session, never in commons-board.
 *
 * options.command is provider config written through the Settings API — never
 * spawn it unless it appears in the server-side CB_HARNESS_ALLOWED_COMMANDS
 * allowlist. Without that allowlist, provider config alone could turn an
 * inference call into arbitrary command execution on the API host.
 */
import { spawn } from "node:child_process";
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider } from "./index.js";

function allowedHarnessCommands(): Set<string> {
  const raw = process.env.CB_HARNESS_ALLOWED_COMMANDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
}

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
    if (!allowedHarnessCommands().has(command)) {
      return this.fail(
        `harness_console command "${command}" is not permitted. Set CB_HARNESS_ALLOWED_COMMANDS ` +
          `to a comma-separated allowlist of trusted binary paths to enable this provider.`
      );
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
