/**
 * Billing routes — organization's own revenue tracking.
 *
 * OLF-original (NOT ported from Pre-OLF billing.ts).
 *
 * Design principle: OLF never charges for the platform. This route helps
 * the ORGANIZATION track revenue from THEIR OWN customers — inverted billing
 * (bill your customers, not us). Applicable in both business and collective
 * governance modes. For collective mode, revenue tracked here feeds into the
 * treasury/distribution calculations (/api/v1/treasury).
 *
 * Routes:
 *   POST /api/v1/billing/events            — record a customer revenue event
 *   GET  /api/v1/billing/events            — list revenue events
 *   POST /api/v1/billing/customers         — register a customer
 *   GET  /api/v1/billing/customers         — list customers
 *   GET  /api/v1/billing/metrics           — revenue metrics summary (MRR, ARR, total)
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const billingRouter = Router();
billingRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RevenueEventName =
  | "checkout_completed"
  | "payment_received"
  | "invoice_paid"
  | "subscription_started"
  | "subscription_cancelled"
  | "refund_issued";

type RevenueEvent = {
  id: string;
  workspaceId: string;
  eventName: RevenueEventName;
  customerId: string | null;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Customer = {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  company: string | null;
  source: string;
  status: "active" | "churned" | "trial";
  mrr: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const eventsKey = (w: string) => `billing-events/${w}`;
const customersKey = (w: string) => `billing-customers/${w}`;

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computeMetrics(workspaceId: string): {
  totalRevenue: number;
  mrr: number;
  arr: number;
  activeCustomers: number;
  trialCustomers: number;
  churnedCustomers: number;
  eventCounts: Record<string, number>;
  currency: string;
} {
  const events = readJson<RevenueEvent[]>(eventsKey(workspaceId), []);
  const customers = readJson<Customer[]>(customersKey(workspaceId), []);

  const INCOME_EVENTS: RevenueEventName[] = ["checkout_completed", "payment_received", "invoice_paid"];
  const totalRevenue = events
    .filter((e) => INCOME_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + e.amount, 0);

  const activeCustomers = customers.filter((c) => c.status === "active");
  const mrr = activeCustomers.reduce((sum, c) => sum + c.mrr, 0);

  const eventCounts: Record<string, number> = {};
  for (const event of events) {
    eventCounts[event.eventName] = (eventCounts[event.eventName] ?? 0) + 1;
  }

  const currency = customers[0]?.currency ?? events[0]?.currency ?? "USD";

  return {
    totalRevenue,
    mrr,
    arr: mrr * 12,
    activeCustomers: activeCustomers.length,
    trialCustomers: customers.filter((c) => c.status === "trial").length,
    churnedCustomers: customers.filter((c) => c.status === "churned").length,
    eventCounts,
    currency
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const VALID_EVENT_NAMES = new Set<RevenueEventName>([
  "checkout_completed",
  "payment_received",
  "invoice_paid",
  "subscription_started",
  "subscription_cancelled",
  "refund_issued"
]);

/** POST /api/v1/billing/events */
billingRouter.post("/events", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const body = req.body as {
    eventName?: string;
    customerId?: string;
    amount?: number;
    currency?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.eventName || !VALID_EVENT_NAMES.has(body.eventName as RevenueEventName)) {
    res.status(400).json({ error: `eventName must be one of: ${[...VALID_EVENT_NAMES].join(", ")}` });
    return;
  }

  const event: RevenueEvent = {
    id: randomUUID(),
    workspaceId,
    eventName: body.eventName as RevenueEventName,
    customerId: body.customerId ?? null,
    amount: Number(body.amount ?? 0),
    currency: String(body.currency ?? "USD").toUpperCase(),
    metadata: body.metadata ?? {},
    createdAt: new Date().toISOString()
  };

  const all = readJson<RevenueEvent[]>(eventsKey(workspaceId), []);
  writeJsonAtomic(eventsKey(workspaceId), [...all, event]);

  const INCOME_EVENTS: RevenueEventName[] = ["checkout_completed", "payment_received", "invoice_paid"];
  if (INCOME_EVENTS.includes(event.eventName)) {
    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        action_type: "revenue_event_recorded",
        event_name: event.eventName,
        amount: event.amount,
        currency: event.currency,
        customer_id: event.customerId
      },
      at: event.createdAt
    } satisfies GovernanceEvent);
  }

  res.status(201).json(event);
});

/** GET /api/v1/billing/events */
billingRouter.get("/events", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const events = readJson<RevenueEvent[]>(eventsKey(workspaceId), [])
    .slice()
    .reverse();
  res.status(200).json({ events, total: events.length });
});

/** POST /api/v1/billing/customers */
billingRouter.post("/customers", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as {
    email?: string;
    name?: string;
    company?: string;
    source?: string;
    status?: Customer["status"];
    mrr?: number;
    currency?: string;
  };

  if (!body.email || !String(body.email).includes("@")) {
    res.status(400).json({ error: "valid email is required" });
    return;
  }

  const now = new Date().toISOString();
  const customer: Customer = {
    id: randomUUID(),
    workspaceId,
    email: String(body.email),
    name: body.name ? String(body.name) : null,
    company: body.company ? String(body.company) : null,
    source: String(body.source ?? "manual"),
    status: body.status ?? "active",
    mrr: Number(body.mrr ?? 0),
    currency: String(body.currency ?? "USD").toUpperCase(),
    createdAt: now,
    updatedAt: now
  };

  const all = readJson<Customer[]>(customersKey(workspaceId), []);
  writeJsonAtomic(customersKey(workspaceId), [...all, customer]);
  res.status(201).json(customer);
});

/** GET /api/v1/billing/customers */
billingRouter.get("/customers", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const customers = readJson<Customer[]>(customersKey(workspaceId), [])
    .slice()
    .reverse();
  res.status(200).json({ customers, total: customers.length });
});

/** GET /api/v1/billing/metrics */
billingRouter.get("/metrics", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  res.status(200).json(computeMetrics(workspaceId));
});
