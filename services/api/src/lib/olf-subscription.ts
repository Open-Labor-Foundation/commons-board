/**
 * OLF Managed Inference subscription client.
 *
 * Fetches read-only subscription state from the OLF service's /subscription
 * endpoint. The API key IS the subscription identity (invariant 3), so this
 * client sends it as a Bearer token — the same auth the inference adapter
 * uses.
 *
 * This is a read model only (invariant 5: money/plan/tier = link-out).
 * The board displays subscription state but never modifies it; plan changes
 * happen at the OLF portal.
 *
 * Failures are graceful: if the service is unreachable or the key is invalid,
 * the returned state has status "unknown" and null fields. The board never
 * blocks on subscription display.
 */
import { createHmac } from "node:crypto";
import type { OlfSubscriptionState, ProviderConfig } from "@commons-board/shared";
import { resolveApiKey } from "./provider/index.js";

/** Default base URL for the OLF Managed Inference service. */
const DEFAULT_OLF_MANAGED_BASE_URL = "https://inference.openlaborfoundation.org/v1";

/** Default portal URL for subscription management link-out. */
const DEFAULT_OLF_PORTAL_URL = "https://openlaborfoundation.org/portal";

/** Hand-off token validity window (5 minutes). */
const HANDOFF_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch subscription state from the OLF service.
 *
 * Returns status "unknown" on any error — never throws.
 * The API key is never included in the returned state.
 */
export async function fetchSubscriptionState(
  config: ProviderConfig
): Promise<OlfSubscriptionState> {
  const base = (config.endpoint ?? DEFAULT_OLF_MANAGED_BASE_URL).replace(/\/$/, "");
  const key = resolveApiKey(config);

  if (!key) {
    return unknownState("no API key configured");
  }

  try {
    const res = await fetch(`${base}/subscription`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${key}`,
      },
    });

    if (!res.ok) {
      return unknownState(`subscription endpoint returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as Partial<OlfSubscriptionState>;
    return {
      status: data.status ?? "unknown",
      plan_name: data.plan_name ?? null,
      tokens_used: data.tokens_used ?? null,
      token_limit: data.token_limit ?? null,
      period_end: data.period_end ?? null,
      portal_url: data.portal_url ?? DEFAULT_OLF_PORTAL_URL,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request failed";
    return unknownState(msg);
  }
}

/**
 * Generate a signed hand-off token for the portal link-out.
 *
 * The token proves the caller possesses the API key without exposing the key
 * in the URL. It is an HMAC-SHA256 of a timestamp, signed with the API key.
 * The OLF portal verifies it because it issued the key and can look it up.
 *
 * The token expires after HANDOFF_TOKEN_TTL_MS (5 minutes).
 *
 * Returns null if no API key is configured — in that case the portal URL is
 * returned without a token and the user authenticates there directly.
 */
export function generateHandoffToken(config: ProviderConfig): string | null {
  const key = resolveApiKey(config);
  if (!key) return null;

  const expiresAt = Date.now() + HANDOFF_TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const hmac = createHmac("sha256", key).update(payload).digest("hex");
  // Base64url-encode the expiry so it's URL-safe, then append the HMAC.
  const encodedExpiry = Buffer.from(payload).toString("base64url");
  return `${encodedExpiry}.${hmac}`;
}

/**
 * Build the portal URL with an optional signed hand-off token appended.
 *
 * If a token is available, it's appended as a query parameter. The portal
 * uses it to establish an authenticated session without requiring the user
 * to re-enter their API key.
 */
export function buildPortalUrl(
  config: ProviderConfig,
  state: OlfSubscriptionState
): string {
  const baseUrl = state.portal_url ?? DEFAULT_OLF_PORTAL_URL;
  const token = generateHandoffToken(config);
  if (!token) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}handoff=${token}`;
}

function unknownState(_reason: string): OlfSubscriptionState {
  return {
    status: "unknown",
    plan_name: null,
    tokens_used: null,
    token_limit: null,
    period_end: null,
    portal_url: DEFAULT_OLF_PORTAL_URL,
  };
}