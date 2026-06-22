/**
 * Hosted-API inference adapter — OpenAI-compatible /chat/completions.
 * Works for Featherless, OpenAI, and any compatible endpoint.
 *
 * The API key is read at call time from the env var named in
 * config.api_key_env (resolveApiKey). It is never stored or logged.
 */
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider, resolveApiKey } from "./index.js";

class HostedApiProvider implements InferenceProvider {
  readonly kind = "hosted_api" as const;
  readonly provider_id: string;

  constructor(private readonly config: ProviderConfig) {
    this.provider_id = config.provider_id;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const base = (this.config.endpoint ?? "").replace(/\/$/, "");
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
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {})
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt }
          ],
          max_tokens: req.max_tokens ?? 2048,
          temperature: req.temperature ?? 0.2
        })
      });
      if (!res.ok) {
        return this.fail(`provider HTTP ${res.status}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      return { ok: true, text, provider_id: this.provider_id, model: this.config.model };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "request failed");
    }
  }

  private fail(error: string): InferenceResponse {
    return { ok: false, text: "", provider_id: this.provider_id, model: this.config.model, error };
  }
}

registerProvider("hosted_api", (config) => new HostedApiProvider(config));
