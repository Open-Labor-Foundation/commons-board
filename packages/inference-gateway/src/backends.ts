/**
 * Foundry MaaS adapter — the hosted fulfillment backend.
 *
 * Calls Azure AI Foundry Models-as-a-Service and returns a FulfillmentResult.
 * The adapter resolves the artifact's abstract model_class to a concrete
 * Foundry deployment, pins the model version explicitly (§9), and reports
 * token usage back for metering.
 *
 * This adapter does NOT enforce invariants — that's the gateway's job. The
 * adapter is a pure fulfillment backend: it serves the request and reports
 * what it did. The gateway checks subscription, ceiling, and version pin
 * around this call.
 *
 * The fetch call is injectable for testing. In production, the global fetch
 * is used. The adapter never sees the raw Foundry key — the gateway issues
 * per-tenant keys, and the adapter uses the key from the request context.
 * (Key Vault + managed identity is the deployment-time concern, not a
 * code-level one — see design brief §8.)
 */
import type { FulfillmentBackend, FulfillmentRequest, FulfillmentResult, InferenceNeed } from "./types.js";

export type FoundryModelMapping = {
  /** The abstract model_class from an InferenceNeed. */
  model_class: string;
  /** The concrete Foundry deployment name to route to. */
  deployment_name: string;
  /** The version string Foundry reports for this deployment (for §9 pinning). */
  version: string;
  /** Minimum context window this deployment supports (for router floor check). */
  min_context_tokens: number;
};

export type FoundryAdapterConfig = {
  /** Base URL of the Foundry MaaS endpoint. */
  endpoint: string;
  /** API key for the Foundry deployment (from Key Vault in production). */
  api_key: string;
  /** Maps abstract model_class → concrete Foundry deployment + version. */
  model_mappings: FoundryModelMapping[];
};

export type FoundryFetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export class FoundryMaaSAdapter implements FulfillmentBackend {
  readonly kind = "hosted" as const;
  readonly backend_id: string;
  private readonly config: FoundryAdapterConfig;
  private readonly fetchFn: FoundryFetchFn;
  private readonly mappingIndex: Map<string, FoundryModelMapping>;

  constructor(config: FoundryAdapterConfig, backend_id = "foundry-maas", fetchFn?: FoundryFetchFn) {
    this.config = config;
    this.backend_id = backend_id;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
    this.mappingIndex = new Map(config.model_mappings.map((m) => [m.model_class, m]));
  }

  async fulfill(req: FulfillmentRequest): Promise<FulfillmentResult> {
    const mapping = this.mappingIndex.get(req.need.model_class);
    if (!mapping) {
      return {
        ok: false,
        text: "",
        model_version_served: "",
        input_tokens: 0,
        output_tokens: 0,
        error: `No Foundry deployment mapped for model_class "${req.need.model_class}"`,
      };
    }

    // Context floor check: the deployment must satisfy the artifact's
    // declared minimum context. This is a routing concern, not an invariant —
    // the router should have caught this, but the adapter checks defensively.
    if (mapping.min_context_tokens < req.need.context.min_tokens) {
      return {
        ok: false,
        text: "",
        model_version_served: mapping.version,
        input_tokens: 0,
        output_tokens: 0,
        error: `Deployment "${mapping.deployment_name}" (context: ${mapping.min_context_tokens}) does not satisfy declared min_tokens (${req.need.context.min_tokens})`,
      };
    }

    const url = `${this.config.endpoint.replace(/\/$/, "")}/chat/completions`;
    const body = JSON.stringify({
      model: mapping.deployment_name,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature ?? 0,
    });

    let response: Awaited<ReturnType<FoundryFetchFn>>;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.api_key}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (err) {
      return {
        ok: false,
        text: "",
        model_version_served: mapping.version,
        input_tokens: 0,
        output_tokens: 0,
        error: `Foundry fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(unreadable)");
      return {
        ok: false,
        text: "",
        model_version_served: mapping.version,
        input_tokens: 0,
        output_tokens: 0,
        error: `Foundry API error ${response.status}: ${errorText}`,
      };
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        text: "",
        model_version_served: mapping.version,
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
        error: "Foundry returned empty response content",
      };
    }

    return {
      ok: true,
      text: content,
      model_version_served: mapping.version,
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * Self-hosted fulfillment backend. The customer's own endpoint satisfies the
 * same FulfillmentBackend interface. The artifact's InferenceNeed does not
 * change; only the fulfillment does (design brief §5).
 *
 * Self-hosted fulfillment is opaque once routed (design brief open question):
 * the managed layer's authority ends at the routing decision. Drift
 * monitoring applies to managed fulfillment; self-hosted drift is the
 * customer's problem, by design.
 */
export class SelfHostedAdapter implements FulfillmentBackend {
  readonly kind = "self_hosted" as const;
  readonly backend_id: string;
  private readonly endpoint: string;
  private readonly api_key: string;
  private readonly fetchFn: FoundryFetchFn;

  constructor(opts: {
    endpoint: string;
    api_key: string;
    backend_id?: string;
    fetchFn?: FoundryFetchFn;
  }) {
    this.endpoint = opts.endpoint;
    this.api_key = opts.api_key;
    this.backend_id = opts.backend_id ?? "self-hosted";
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async fulfill(req: FulfillmentRequest): Promise<FulfillmentResult> {
    const url = `${this.endpoint.replace(/\/$/, "")}/chat/completions`;
    const body = JSON.stringify({
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature ?? 0,
    });

    let response: Awaited<ReturnType<FoundryFetchFn>>;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.api_key}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (err) {
      return {
        ok: false,
        text: "",
        model_version_served: req.need.version_pin.declared_version,
        input_tokens: 0,
        output_tokens: 0,
        error: `Self-hosted fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "(unreadable)");
      return {
        ok: false,
        text: "",
        model_version_served: req.need.version_pin.declared_version,
        input_tokens: 0,
        output_tokens: 0,
        error: `Self-hosted API error ${response.status}: ${errorText}`,
      };
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        text: "",
        model_version_served: req.need.version_pin.declared_version,
        input_tokens: json.usage?.prompt_tokens ?? 0,
        output_tokens: json.usage?.completion_tokens ?? 0,
        error: "Self-hosted endpoint returned empty response content",
      };
    }

    // Self-hosted reports its own version. The gateway still validates this
    // against the artifact's pin — the contract is uniform across fulfillment
    // modes (design brief §5).
    return {
      ok: true,
      text: content,
      model_version_served: json.model ?? req.need.version_pin.declared_version,
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    };
  }
}