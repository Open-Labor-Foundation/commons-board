/**
 * Outbound webhook delivery.
 * Reads subscriptions from persistence and fires HTTP POST to each matching URL.
 * Signatures use HMAC-SHA256 keyed from the env var named in `signing_secret_env`.
 */
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { readJson, writeJsonAtomic } from "./persistence.js";

export type WebhookSubscription = {
  id: string;
  org_id: string;
  url: string;
  signing_secret_env: string;
  events: string[];
  active: boolean;
  created_at: string;
};

export type WebhookDelivery = {
  id: string;
  subscription_id: string;
  event_type: string;
  status: "delivered" | "failed" | "skipped";
  status_code: number | null;
  error: string | null;
  attempted_at: string;
};

const subsKey = (orgId: string) => `webhook-subscriptions/${orgId}`;
const deliveriesKey = (orgId: string) => `webhook-deliveries/${orgId}`;

function signPayload(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return false;
}

// Blocks SSRF against internal services / cloud metadata endpoints. Checked
// both at subscription create time (routes/webhooks.ts) and again here on
// every dispatch: a hostname that resolved to a public IP at creation time
// can be re-pointed at an internal IP later (DNS rebinding), and this also
// covers subscriptions that were created before this check existed.
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("webhook url must be http or https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw new Error(`webhook url host "${hostname}" is not allowed`);
  }
  if (isIP(hostname)) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`webhook url host "${hostname}" is a private/loopback address`);
    }
    return;
  }
  const { address } = await lookup(hostname);
  if (isPrivateOrLoopbackIp(address)) {
    throw new Error(`webhook url host "${hostname}" resolves to a private/loopback address (${address})`);
  }
}

export async function dispatchWebhookEvent(
  orgId: string,
  event: { event_type: string; [key: string]: unknown }
): Promise<void> {
  const subs = readJson<WebhookSubscription[]>(subsKey(orgId), []).filter(
    (s) => s.active && (s.events.includes("*") || s.events.includes(event.event_type))
  );

  if (subs.length === 0) return;

  const payload = JSON.stringify({ org_id: orgId, ...event });
  const deliveries = readJson<WebhookDelivery[]>(deliveriesKey(orgId), []);

  for (const sub of subs) {
    const secret = sub.signing_secret_env ? (process.env[sub.signing_secret_env] ?? "") : "";
    const sig = secret ? signPayload(payload, secret) : undefined;

    let delivery: WebhookDelivery;
    try {
      await assertSafeWebhookUrl(sub.url);
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Commons-Board-Event": event.event_type,
          ...(sig ? { "X-Commons-Board-Signature": sig } : {})
        },
        body: payload,
        signal: AbortSignal.timeout(10000)
      });
      delivery = {
        id: `del_${Date.now()}`,
        subscription_id: sub.id,
        event_type: event.event_type,
        status: res.ok ? "delivered" : "failed",
        status_code: res.status,
        error: res.ok ? null : `HTTP ${res.status}`,
        attempted_at: new Date().toISOString()
      };
    } catch (err) {
      delivery = {
        id: `del_${Date.now()}`,
        subscription_id: sub.id,
        event_type: event.event_type,
        status: "failed",
        status_code: null,
        error: err instanceof Error ? err.message : "unknown error",
        attempted_at: new Date().toISOString()
      };
    }

    deliveries.push(delivery);
  }

  // Keep last 500 delivery records
  writeJsonAtomic(deliveriesKey(orgId), deliveries.slice(-500));
}
