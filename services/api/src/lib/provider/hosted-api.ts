/**
 * Hosted-API inference adapter — OpenAI-compatible /chat/completions.
 * Works for Featherless, OpenAI, and any compatible endpoint.
 *
 * The API key is read at call time from the env var named in
 * config.api_key_env (resolveApiKey). It is never stored or logged.
 */
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider, resolveApiKey } from "./index.js";

const KNOWN_ENDPOINTS: Record<string, string> = {
  featherless: "https://api.featherless.ai/v1",
  openai: "https://api.openai.com/v1",
};

class HostedApiProvider implements InferenceProvider {
  readonly kind = "hosted_api" as const;
  readonly provider_id: string;

  constructor(private readonly config: ProviderConfig) {
    this.provider_id = config.provider_id;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const base = (this.config.endpoint ?? KNOWN_ENDPOINTS[this.config.provider_id] ?? "").replace(/\/$/, "");
    if (!base) {
      return this.fail("hosted_api provider has no endpoint configured");
    }
    const key = resolveApiKey(this.config);
    if (this.config.api_key_env && !key) {
      return this.fail(`API key env "${this.config.api_key_env}" is not set in this deployment`);
    }

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        // Live evidence: raising max_tokens so a reasoning model has room to
        // finish (see generate-artifacts.ts) also raises real completion
        // time -- a worker-selection call timed out at 120s once the budget
        // went from 1200 to 4000. 240s gives headroom without hiding a truly
        // hung request forever.
        signal: AbortSignal.timeout(240_000),
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {})
        },
        body: JSON.stringify({
          model: req.model ?? this.config.model,
          messages: [
            { role: "system", content: req.system },
            ...(req.history ?? []),
            { role: "user", content: req.prompt },
          ],
          // Only send max_tokens if caller explicitly set one — otherwise let the
          // provider use its own default (model's full remaining context window)
          ...(req.max_tokens != null ? { max_tokens: req.max_tokens } : {}),
          temperature: req.temperature ?? 0.2
        })
      });
      if (!res.ok) {
        return this.fail(`provider HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      const finishReason = data.choices?.[0]?.finish_reason;
      // Reasoning models (e.g. GLM-5.2 on Featherless) can spend the entire
      // max_tokens budget on internal reasoning before ever emitting the
      // final answer, leaving `content` empty with finish_reason "length".
      // That's a truncated response, not a valid empty completion -- treat
      // it as a failure instead of returning ok:true with nothing, so
      // callers get an actionable error instead of silently unparseable text.
      if (text.trim() === "" && finishReason === "length") {
        return this.fail("provider truncated the response before emitting any content (finish_reason=length) -- max_tokens too low for this model");
      }
      return { ok: true, text, provider_id: this.provider_id, model: req.model ?? this.config.model };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "request failed");
    }
  }

  private fail(error: string): InferenceResponse {
    return { ok: false, text: "", provider_id: this.provider_id, model: this.config.model, error };
  }
}

registerProvider("hosted_api", (config) => new HostedApiProvider(config));
