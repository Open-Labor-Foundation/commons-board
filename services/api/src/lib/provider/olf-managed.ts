/**
 * OLF Managed Inference adapter — OpenAI-compatible /chat/completions pointed
 * at the OLF Managed Inference service.
 *
 * This is one more OpenAI-compatible provider alongside hosted-api, not a
 * replacement for it. The key difference: the default endpoint is the OLF
 * Managed Inference service, and the API key doubles as subscription identity
 * (invariant 3: API key = identity). No second identity system in the client.
 *
 * The service is MitM for its own traffic only (invariant 2). Accounting is
 * captured server-side from the standard request + usage response; this
 * adapter sends nothing extra for it.
 *
 * No sidecar (invariant 4): per-call cost rides the standard usage block.
 * Subscription state comes from a dedicated GET /subscription, never
 * piggybacked on inference responses.
 */
import type { InferenceProvider, InferenceRequest, InferenceResponse, ProviderConfig } from "@commons-board/shared";
import { registerProvider, resolveApiKey } from "./index.js";

/**
 * Default base URL for the OLF Managed Inference service.
 * Overridable via config.endpoint for self-hosted deployments.
 */
const DEFAULT_OLF_MANAGED_BASE_URL = "https://inference.openlaborfoundation.org/v1";

class OlfManagedProvider implements InferenceProvider {
  readonly kind = "olf_managed" as const;
  readonly provider_id: string;

  constructor(private readonly config: ProviderConfig) {
    this.provider_id = config.provider_id;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const base = (this.config.endpoint ?? DEFAULT_OLF_MANAGED_BASE_URL).replace(/\/$/, "");
    if (!base) {
      return this.fail("olf_managed provider has no endpoint configured");
    }
    const key = resolveApiKey(this.config);
    if (this.config.api_key_env && !key) {
      return this.fail(`API key env "${this.config.api_key_env}" is not set in this deployment`);
    }
    // API key is required for OLF Managed — it IS the subscription identity.
    if (!key) {
      return this.fail("OLF Managed Inference requires an API key (subscription identity)");
    }

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(240_000),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: req.model ?? this.config.model,
          messages: [
            { role: "system", content: req.system },
            ...(req.history ?? []),
            { role: "user", content: req.prompt },
          ],
          ...(req.max_tokens != null ? { max_tokens: req.max_tokens } : {}),
          temperature: req.temperature ?? 0.2
        })
      });
      if (!res.ok) {
        return this.fail(mapOlfHttpError(res.status));
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      const finishReason = data.choices?.[0]?.finish_reason;
      if (text.trim() === "" && finishReason === "length") {
        return this.fail("provider truncated the response before emitting any content (finish_reason=length) -- max_tokens too low for this model");
      }
      // The service may report the actual resolved model (different from the
      // requested abstract model_class). Surface it for provenance (Phase 4).
      const resolvedModel = data.model ?? req.model ?? this.config.model;
      // Surface token usage for metering and display. The OLF service
      // captures this server-side too, but including it here lets the
      // board display per-call usage without a round-trip.
      const usage = data.usage && typeof data.usage.prompt_tokens === "number"
        ? {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? (data.usage.prompt_tokens + (data.usage.completion_tokens ?? 0)),
          }
        : undefined;
      return { ok: true, text, provider_id: this.provider_id, model: resolvedModel, usage };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "request failed");
    }
  }

  private fail(error: string): InferenceResponse {
    return { ok: false, text: "", provider_id: this.provider_id, model: this.config.model, error };
  }
}

/**
 * Maps OLF Managed Inference HTTP status codes to actionable denial messages.
 * For OLF Managed, the API key IS the subscription identity (invariant 3),
 * so auth failures map to subscription-level explanations.
 */
function mapOlfHttpError(status: number): string {
  switch (status) {
    case 401:
      return "OLF Managed API key rejected (HTTP 401) — key may be invalid or revoked";
    case 402:
      return "OLF Managed subscription exhausted (HTTP 402) — token limit reached for this period";
    case 403:
      return "OLF Managed subscription suspended (HTTP 403) — contact the foundation";
    case 429:
      return "OLF Managed rate limited (HTTP 429) — retry after a short delay";
    default:
      return `OLF Managed provider HTTP ${status}`;
  }
}

registerProvider("olf_managed", (config) => new OlfManagedProvider(config));