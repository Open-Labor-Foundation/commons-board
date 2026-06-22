/**
 * Webhook subscription routes — outbound event delivery to external URLs.
 *
 * OLF-original.
 *
 * Subscriptions register a URL + signing_secret_env (NAME of an env var,
 * not the secret itself). When a governance event fires on this board,
 * `dispatchWebhookEvent()` POSTs a signed payload to all matching URLs.
 * Delivery is fire-and-forget; reliable queuing is a future concern.
 *
 * Routes:
 *   POST   /api/v1/webhooks/subscriptions          — register a subscription
 *   GET    /api/v1/webhooks/subscriptions          — list subscriptions
 *   PATCH  /api/v1/webhooks/subscriptions/:id      — update active state or events filter
 *   DELETE /api/v1/webhooks/subscriptions/:id      — remove a subscription
 *   GET    /api/v1/webhooks/deliveries             — recent delivery log
 *   POST   /api/v1/webhooks/test                   — send a test ping to all active subs
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import {
  type WebhookSubscription,
  type WebhookDelivery,
  dispatchWebhookEvent
} from "../lib/webhook-delivery.js";

export const webhooksRouter = Router();
webhooksRouter.use(requireContext);

const subsKey = (w: string) => `webhook-subscriptions/${w}`;
const deliveriesKey = (w: string) => `webhook-deliveries/${w}`;

/** POST /api/v1/webhooks/subscriptions */
webhooksRouter.post("/subscriptions", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as {
    url?: string;
    signing_secret_env?: string;
    events?: string[];
  };

  if (!body.url || !body.signing_secret_env) {
    res.status(400).json({ error: "url and signing_secret_env are required" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(body.url));
    if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new Error("invalid protocol");
  } catch {
    res.status(400).json({ error: "url must be a valid http or https URL" });
    return;
  }

  const subscription: WebhookSubscription = {
    id: randomUUID(),
    org_id: workspaceId,
    url: parsedUrl.toString(),
    signing_secret_env: String(body.signing_secret_env),
    events: Array.isArray(body.events) && body.events.length > 0
      ? body.events.map(String)
      : ["*"],
    active: true,
    created_at: new Date().toISOString()
  };

  const all = readJson<WebhookSubscription[]>(subsKey(workspaceId), []);
  writeJsonAtomic(subsKey(workspaceId), [...all, subscription]);
  res.status(201).json(subscription);
});

/** GET /api/v1/webhooks/subscriptions */
webhooksRouter.get("/subscriptions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const subs = readJson<WebhookSubscription[]>(subsKey(workspaceId), []);
  res.status(200).json({ subscriptions: subs, total: subs.length });
});

/** PATCH /api/v1/webhooks/subscriptions/:id */
webhooksRouter.patch("/subscriptions/:id", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { id } = req.params;
  const body = req.body as { active?: boolean; events?: string[] };

  const all = readJson<WebhookSubscription[]>(subsKey(workspaceId), []);
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) {
    res.status(404).json({ error: "subscription not found" });
    return;
  }

  const updated: WebhookSubscription = {
    ...all[idx],
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    ...(Array.isArray(body.events) ? { events: body.events.map(String) } : {})
  };
  all[idx] = updated;
  writeJsonAtomic(subsKey(workspaceId), all);
  res.status(200).json(updated);
});

/** DELETE /api/v1/webhooks/subscriptions/:id */
webhooksRouter.delete("/subscriptions/:id", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { id } = req.params;

  const all = readJson<WebhookSubscription[]>(subsKey(workspaceId), []);
  if (!all.some((s) => s.id === id)) {
    res.status(404).json({ error: "subscription not found" });
    return;
  }
  writeJsonAtomic(subsKey(workspaceId), all.filter((s) => s.id !== id));
  res.status(200).json({ removed: true, id });
});

/** GET /api/v1/webhooks/deliveries */
webhooksRouter.get("/deliveries", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const limitParam = Number(req.query.limit ?? 100);
  const limit = Math.min(Math.max(1, limitParam), 500);
  const deliveries = readJson<WebhookDelivery[]>(deliveriesKey(workspaceId), []).slice(-limit).reverse();
  res.status(200).json({ deliveries, total: deliveries.length });
});

/** POST /api/v1/webhooks/test */
webhooksRouter.post("/test", requireRole(["admin"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;

  await dispatchWebhookEvent(workspaceId, {
    event_id: randomUUID(),
    event_type: "webhook_ping",
    actor: userId,
    at: new Date().toISOString(),
    details: { source: "webhook_test" }
  });

  const recent = readJson<WebhookDelivery[]>(deliveriesKey(workspaceId), [])
    .filter((d) => d.event_type === "webhook_ping")
    .slice(-10);

  res.status(200).json({ pinged: true, deliveries: recent });
});
