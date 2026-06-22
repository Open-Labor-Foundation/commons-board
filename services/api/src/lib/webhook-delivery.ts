/**
 * Outbound webhook delivery.
 * Reads subscriptions from persistence and fires HTTP POST to each matching URL.
 * Signatures use HMAC-SHA256 keyed from the env var named in `signing_secret_env`.
 */
import { createHmac } from "node:crypto";
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
