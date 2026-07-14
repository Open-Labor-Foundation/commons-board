/**
 * Shared "ask the model for JSON" helper, used everywhere this repo asks an
 * LLM to return structured data (interview extraction, chair naming, worker
 * selection): completeText, strip <think>, regex out a JSON block, parse,
 * validate.
 *
 * Exists because three call sites each had their own copy of this logic,
 * and all three shared the same real, observed failure mode against a live
 * provider: the model occasionally returns a response with no parseable
 * JSON at all (truncated, wrapped in stray prose, or just malformed). One
 * retry resolves most of these in practice; every failure -- including the
 * final one that exhausts retries -- is always logged by the caller
 * (nothing here or upstream is allowed to swallow it silently).
 */
import { completeText } from "./model-client.js";

export class ModelJsonError extends Error {
  constructor(message: string, public readonly attempts: number) {
    super(message);
    this.name = "ModelJsonError";
  }
}

export async function completeJsonWithRetry<T>(
  workspaceId: string,
  system: string,
  prompt: string,
  options: { max_tokens: number; temperature: number },
  extractPattern: RegExp,
  validate: (parsed: unknown) => parsed is T,
  maxAttempts = 2
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await completeText(workspaceId, system, prompt, options);
      const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const match = stripped.match(extractPattern);
      if (!match) throw new Error("no JSON match in model response");
      const parsed = JSON.parse(match[0]) as unknown;
      if (!validate(parsed)) throw new Error("model response failed validation");
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new ModelJsonError(
    `completeJsonWithRetry exhausted ${maxAttempts} attempt(s): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    maxAttempts
  );
}
