/**
 * Local inference adapter — OpenAI-compatible local server (Ollama, llama.cpp,
 * vLLM, etc.). No API key. Default endpoint is a local Ollama-style server;
 * override via config.endpoint.
 */
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider } from "./index.js";

const DEFAULT_LOCAL_ENDPOINT = "http://localhost:11434/v1";

class LocalInferenceProvider implements InferenceProvider {
  readonly kind = "local_inference" as const;
  readonly provider_id: string;

  constructor(private readonly config: ProviderConfig) {
    this.provider_id = config.provider_id;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const base = (this.config.endpoint ?? DEFAULT_LOCAL_ENDPOINT).replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
        return this.fail(`local provider HTTP ${res.status}`);
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

registerProvider("local_inference", (config) => new LocalInferenceProvider(config));
