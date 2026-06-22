/**
 * Level 4 Autonomous Launcher routes — prompt-driven company bootstrapping and
 * outreach orchestration with governed external writes.
 *
 * Ported from mother-board routes/level4.ts.
 * Sanitized:
 *   - store.* → writeArtifact() + getArtifact() + readJson()/writeJsonAtomic()
 *   - store.createLevel4Action/listLevel4Actions/updateLevel4Action
 *       → level4-actions/${workspaceId} via readJson/writeJsonAtomic
 *   - store.createApproval/listApprovals/approve
 *       → level4-approvals/${workspaceId} (separate from global board approvals)
 *   - Distributed DB lock → in-process Set (single-instance; Phase 15 can upgrade)
 *   - DB-backed idempotency keys → idempotency-keys/${workspaceId} via persistence
 *   - DB-backed dead letters → dead-letters/${workspaceId} via persistence
 *   - store.recordExternalWrite → external-writes/${workspaceId} via persistence
 *   - Outreach prospects/campaigns/replies → scoped persistence keys
 *   - AEB_CONNECTOR_MODE → CB_CONNECTOR_MODE; AEB_STRIPE_MODE → CB_STRIPE_MODE
 *   - outreach_config, pipeline_state, provisioning_status → plain JSON persistence
 *     (not governed artifacts — operational state, not governance)
 *   - agent_blueprint created with OLF chair schema (not Pre-OLF id/type format)
 *   - processDeadLetterException() simplified to persist + governance event
 *   - Connector calls stubbed in Phase 9; Phase 15 wires real implementations
 *   - store.listVentureMemory → venture-memory/${workspaceId} (written by Phase 10)
 *
 * Routes:
 *   POST /api/v1/level4/launch-from-prompt          — quick-launch from a text prompt
 *   GET  /api/v1/level4/actions                     — list all level4 actions
 *   POST /api/v1/level4/actions/:actionId/approve-execute — approve + execute (admin only)
 *   PATCH /api/v1/level4/outreach/config            — update outreach configuration
 *   POST /api/v1/level4/outreach/prospects/upload   — bulk-add prospects
 *   POST /api/v1/level4/outreach/campaigns          — create campaign
 *   POST /api/v1/level4/outreach/campaigns/:id/send — send campaign
 *   POST /api/v1/level4/outreach/replies            — record + classify a reply
 *   GET  /api/v1/level4/dashboard                   — level4 operational dashboard
 *   GET  /api/v1/level4/audits/external-writes      — external write audit log
 *   GET  /api/v1/level4/crm/pipeline                — CRM pipeline view
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { writeArtifact, getArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { externalWriteAllowed } from "../lib/container-policy.js";
import { canTransitionLoopStage, type LoopStage } from "../lib/operational-loop.js";
import { resolveModelNativeOutreachReply } from "../services/model-native-level4.js";

export const level4Router = Router();
level4Router.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Level4ActionStatus = "pending" | "approved" | "executing" | "completed" | "failed" | "blocked";

type Level4Action = {
  id: string;
  workspaceId: string;
  type: string;
  payload: Record<string, unknown>;
  blastRadius: "low" | "medium" | "high";
  rollbackPlan: string;
  approvalsRequired: number;
  status: Level4ActionStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  correlationId?: string;
};

type Level4Approval = {
  id: string;
  actionId: string;
  agentId: string;
  actionType: string;
  riskScore: number;
  blastRadius: string;
  category: string;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
};

type Level4Checkpoint = {
  requestId: string;
  stage: LoopStage;
  status: string;
  enteredAt: string;
  context: Record<string, unknown>;
};

type IdempotencyRecord = {
  key: string;
  scope: string;
  registeredAt: string;
};

type DeadLetterRecord = {
  id: string;
  workspaceId: string;
  source: string;
  reason: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type ExternalWriteRecord = {
  id: string;
  workspaceId: string;
  actionId: string;
  connector: string;
  status: "success" | "failed";
  requestMeta: Record<string, unknown>;
  responseMeta: Record<string, unknown>;
  durationMs: number;
  correlationId?: string;
  createdAt: string;
};

type OutreachProspect = {
  id: string;
  email: string;
  name?: string;
  company?: string;
  source: string;
  suppressed: boolean;
  suppressReason?: string;
  createdAt: string;
};

type OutreachCampaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: "draft" | "sent" | "paused";
  sentCount: number;
  deliveredCount: number;
  bouncedCount: number;
  unsubscribeCount: number;
  complaintCount: number;
  createdAt: string;
  updatedAt: string;
};

type OutreachReply = {
  id: string;
  email: string;
  body: string;
  classification: "interested" | "not_now" | "unsubscribe" | "complaint";
  createdAt: string;
};

type VentureMemoryEntry = {
  icpPattern: string;
  messagingVariant: string;
  pricingInsight: string;
  channelEfficiency: string;
  outcome: "success" | "fail";
};

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const actionsKey = (w: string) => `level4-actions/${w}`;
const approvalsKey = (w: string) => `level4-approvals/${w}`;
const checkpointsKey = (w: string) => `level4-checkpoints/${w}`;
const idempotencyKey = (w: string) => `idempotency-keys/${w}`;
const deadLettersKey = (w: string) => `dead-letters/${w}`;
const externalWritesKey = (w: string) => `external-writes/${w}`;
const prospectsKey = (w: string) => `outreach-prospects/${w}`;
const campaignsKey = (w: string) => `outreach-campaigns/${w}`;
const repliesKey = (w: string) => `outreach-replies/${w}`;
const outreachConfigKey = (w: string) => `outreach-config/${w}`;
const pipelineStateKey = (w: string) => `pipeline-state/${w}`;
const provisioningStatusKey = (w: string) => `provisioning-status/${w}`;
const landingPageKey = (w: string) => `landing-page/${w}`;
const paymentSetupKey = (w: string) => `payment-setup/${w}`;
const ventureMemoryKey = (w: string) => `venture-memory/${w}`;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function createLevel4Action(input: {
  workspaceId: string;
  type: string;
  payload: Record<string, unknown>;
  blastRadius: "low" | "medium" | "high";
  rollbackPlan: string;
  approvalsRequired: number;
  correlationId?: string;
}): Level4Action {
  const now = new Date().toISOString();
  const action: Level4Action = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    type: input.type,
    payload: input.payload,
    blastRadius: input.blastRadius,
    rollbackPlan: input.rollbackPlan,
    approvalsRequired: input.approvalsRequired,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    correlationId: input.correlationId
  };
  const all = readJson<Level4Action[]>(actionsKey(input.workspaceId), []);
  writeJsonAtomic(actionsKey(input.workspaceId), [...all, action]);
  return action;
}

function listLevel4Actions(workspaceId: string): Level4Action[] {
  return readJson<Level4Action[]>(actionsKey(workspaceId), []);
}

function getLevel4Action(workspaceId: string, actionId: string): Level4Action | null {
  return listLevel4Actions(workspaceId).find((a) => a.id === actionId) ?? null;
}

function updateLevel4Action(
  workspaceId: string,
  actionId: string,
  patch: Partial<Pick<Level4Action, "status" | "error">>
): Level4Action | null {
  const all = readJson<Level4Action[]>(actionsKey(workspaceId), []);
  const idx = all.findIndex((a) => a.id === actionId);
  if (idx === -1) return null;
  const updated: Level4Action = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  all[idx] = updated;
  writeJsonAtomic(actionsKey(workspaceId), all);
  return updated;
}

function createLevel4Approval(workspaceId: string, input: {
  actionId: string;
  agentId: string;
  actionType: string;
  riskScore: number;
  blastRadius: string;
  category: string;
}): Level4Approval {
  const now = new Date().toISOString();
  const approval: Level4Approval = {
    id: randomUUID(),
    actionId: input.actionId,
    agentId: input.agentId,
    actionType: input.actionType,
    riskScore: input.riskScore,
    blastRadius: input.blastRadius,
    category: input.category,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  const all = readJson<Level4Approval[]>(approvalsKey(workspaceId), []);
  writeJsonAtomic(approvalsKey(workspaceId), [...all, approval]);
  return approval;
}

function approveLevel4Action(workspaceId: string, actionId: string, approvedBy: string): Level4Approval | null {
  const all = readJson<Level4Approval[]>(approvalsKey(workspaceId), []);
  const idx = all.findIndex((a) => a.actionId === actionId && a.status === "pending");
  if (idx === -1) return null;
  const updated: Level4Approval = {
    ...all[idx],
    status: "approved",
    approvedBy,
    updatedAt: new Date().toISOString()
  };
  all[idx] = updated;
  writeJsonAtomic(approvalsKey(workspaceId), all);
  return updated;
}

function registerIdempotency(workspaceId: string, scope: string, key: string): boolean {
  const records = readJson<IdempotencyRecord[]>(idempotencyKey(workspaceId), []);
  if (records.some((r) => r.scope === scope && r.key === key)) return false;
  records.push({ key, scope, registeredAt: new Date().toISOString() });
  writeJsonAtomic(idempotencyKey(workspaceId), records);
  return true;
}

function createDeadLetter(workspaceId: string, input: {
  source: string;
  reason: string;
  payload: Record<string, unknown>;
}): DeadLetterRecord {
  const record: DeadLetterRecord = {
    id: randomUUID(),
    workspaceId,
    source: input.source,
    reason: input.reason,
    payload: input.payload,
    createdAt: new Date().toISOString()
  };
  const all = readJson<DeadLetterRecord[]>(deadLettersKey(workspaceId), []);
  writeJsonAtomic(deadLettersKey(workspaceId), [...all, record]);
  return record;
}

function recordExternalWrite(workspaceId: string, input: {
  actionId: string;
  connector: string;
  status: "success" | "failed";
  requestMeta: Record<string, unknown>;
  responseMeta: Record<string, unknown>;
  durationMs: number;
  correlationId?: string;
}): ExternalWriteRecord {
  const record: ExternalWriteRecord = {
    id: randomUUID(),
    workspaceId,
    actionId: input.actionId,
    connector: input.connector,
    status: input.status,
    requestMeta: input.requestMeta,
    responseMeta: input.responseMeta,
    durationMs: input.durationMs,
    correlationId: input.correlationId,
    createdAt: new Date().toISOString()
  };
  const all = readJson<ExternalWriteRecord[]>(externalWritesKey(workspaceId), []);
  writeJsonAtomic(externalWritesKey(workspaceId), [...all, record]);
  return record;
}

function addOutreachProspects(
  workspaceId: string,
  prospects: Array<{ email: string; name?: string; company?: string; source: string }>
): OutreachProspect[] {
  const all = readJson<OutreachProspect[]>(prospectsKey(workspaceId), []);
  const now = new Date().toISOString();
  const created = prospects.map((p) => ({
    id: randomUUID(),
    email: p.email,
    name: p.name,
    company: p.company,
    source: p.source,
    suppressed: false,
    createdAt: now
  } satisfies OutreachProspect));
  writeJsonAtomic(prospectsKey(workspaceId), [...all, ...created]);
  return created;
}

function listOutreachProspects(workspaceId: string): OutreachProspect[] {
  return readJson<OutreachProspect[]>(prospectsKey(workspaceId), []);
}

function suppressProspect(workspaceId: string, email: string, reason: string): void {
  const all = readJson<OutreachProspect[]>(prospectsKey(workspaceId), []);
  const updated = all.map((p) =>
    p.email === email ? { ...p, suppressed: true, suppressReason: reason } : p
  );
  writeJsonAtomic(prospectsKey(workspaceId), updated);
}

function createOutreachCampaign(
  workspaceId: string,
  input: { name: string; subject: string; body: string }
): OutreachCampaign {
  const now = new Date().toISOString();
  const campaign: OutreachCampaign = {
    id: randomUUID(),
    name: input.name,
    subject: input.subject,
    body: input.body,
    status: "draft",
    sentCount: 0,
    deliveredCount: 0,
    bouncedCount: 0,
    unsubscribeCount: 0,
    complaintCount: 0,
    createdAt: now,
    updatedAt: now
  };
  const all = readJson<OutreachCampaign[]>(campaignsKey(workspaceId), []);
  writeJsonAtomic(campaignsKey(workspaceId), [...all, campaign]);
  return campaign;
}

function listOutreachCampaigns(workspaceId: string): OutreachCampaign[] {
  return readJson<OutreachCampaign[]>(campaignsKey(workspaceId), []);
}

function updateOutreachCampaign(
  workspaceId: string,
  campaignId: string,
  patch: Partial<Pick<OutreachCampaign, "status" | "sentCount" | "deliveredCount" | "bouncedCount" | "unsubscribeCount" | "complaintCount">>
): OutreachCampaign | null {
  const all = readJson<OutreachCampaign[]>(campaignsKey(workspaceId), []);
  const idx = all.findIndex((c) => c.id === campaignId);
  if (idx === -1) return null;
  const updated: OutreachCampaign = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  all[idx] = updated;
  writeJsonAtomic(campaignsKey(workspaceId), all);
  return updated;
}

function addOutreachReply(
  workspaceId: string,
  input: { email: string; body: string; classification: OutreachReply["classification"] }
): OutreachReply {
  const reply: OutreachReply = {
    id: randomUUID(),
    email: input.email,
    body: input.body,
    classification: input.classification,
    createdAt: new Date().toISOString()
  };
  const all = readJson<OutreachReply[]>(repliesKey(workspaceId), []);
  writeJsonAtomic(repliesKey(workspaceId), [...all, reply]);
  return reply;
}

function listOutreachReplies(workspaceId: string): OutreachReply[] {
  return readJson<OutreachReply[]>(repliesKey(workspaceId), []);
}

// ---------------------------------------------------------------------------
// In-process concurrency lock (upgrade to distributed lock in Phase 15)
// ---------------------------------------------------------------------------

const activeLocks = new Set<string>();

function acquireLock(key: string): boolean {
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

function releaseLock(key: string): void {
  activeLocks.delete(key);
}

// ---------------------------------------------------------------------------
// Loop checkpoint helpers
// ---------------------------------------------------------------------------

function latestCheckpointStage(workspaceId: string, actionId: string): LoopStage | null {
  const requestId = `level4:${actionId}`;
  const checkpoints = readJson<Level4Checkpoint[]>(checkpointsKey(workspaceId), []);
  const relevant = checkpoints.filter((c) => c.requestId === requestId);
  if (relevant.length === 0) return null;
  return relevant[relevant.length - 1].stage;
}

function recordCheckpoint(input: {
  workspaceId: string;
  userId: string;
  actionId: string;
  stage: LoopStage;
  status: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}): { ok: true } | { ok: false; error: string } {
  const requestId = `level4:${input.actionId}`;
  const previous = latestCheckpointStage(input.workspaceId, input.actionId);
  if (previous && previous !== input.stage && !canTransitionLoopStage(previous, input.stage)) {
    return { ok: false, error: `operational loop violation ${previous} -> ${input.stage}` };
  }
  const checkpoint: Level4Checkpoint = {
    requestId,
    stage: input.stage,
    status: input.status,
    enteredAt: new Date().toISOString(),
    context: { source: "level4_action", ...(input.context ?? {}) }
  };
  const all = readJson<Level4Checkpoint[]>(checkpointsKey(input.workspaceId), []);
  writeJsonAtomic(checkpointsKey(input.workspaceId), [...all, checkpoint]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Connector dispatch — routes to real implementations or stubs via CB_CONNECTOR_MODE
// ---------------------------------------------------------------------------

import {
  cloudflareUpsertDnsRecords,
  vercelDeployTemplate,
  stripeCreateProduct,
  stripeCreatePrice,
  stripeCreateCheckoutSession,
  emailSend
} from "@commons-board/connectors";

const _connectorMode = process.env.CB_CONNECTOR_MODE === "live"
  ? "live"
  : process.env.CB_CONNECTOR_MODE === "mock"
    ? "mock"
    : "test";

async function connectorCloudflareUpsertRecords(
  _workspaceId: string,
  domain: string,
  records: Array<{ type: string; name: string; value: string }>
): Promise<{ ok: boolean; domain: string; records_count: number; mode: string }> {
  if (_connectorMode === "live") {
    const result = await cloudflareUpsertDnsRecords(
      domain,
      records.map((r) => ({ type: r.type as "A" | "CNAME" | "TXT" | "MX", name: r.name, content: r.value }))
    );
    return { ...result, mode: "live" };
  }
  return { ok: true, domain, records_count: records.length, mode: _connectorMode };
}

async function connectorVercelDeployTemplate(
  _workspaceId: string,
  opts: { projectName: string; headline: string; cta: string }
): Promise<{ url: string; projectName: string; mode: string }> {
  if (_connectorMode === "live") {
    const result = await vercelDeployTemplate(opts);
    return { url: result.url, projectName: opts.projectName, mode: "live" };
  }
  const slug = opts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return { url: `https://${slug}.example.com`, projectName: opts.projectName, mode: _connectorMode };
}

async function connectorStripeCreateProduct(
  _workspaceId: string,
  name: string
): Promise<{ id: string; name: string; mode: string }> {
  if (_connectorMode === "live") {
    const result = await stripeCreateProduct(name);
    return { id: result.id, name: result.name, mode: "live" };
  }
  return { id: `prod_${randomUUID().slice(0, 8)}`, name, mode: _connectorMode };
}

async function connectorStripeCreatePrice(
  _workspaceId: string,
  opts: { productId: string; unitAmount: number; currency: string }
): Promise<{ id: string; productId: string; unitAmount: number; mode: string }> {
  if (_connectorMode === "live") {
    const result = await stripeCreatePrice(opts);
    return { id: result.id, productId: opts.productId, unitAmount: opts.unitAmount, mode: "live" };
  }
  return { id: `price_${randomUUID().slice(0, 8)}`, productId: opts.productId, unitAmount: opts.unitAmount, mode: _connectorMode };
}

async function connectorStripeCreateCheckoutLink(
  _workspaceId: string,
  priceId: string
): Promise<{ url: string; priceId: string; mode: string }> {
  if (_connectorMode === "live") {
    const successUrl = process.env.STRIPE_SUCCESS_URL ?? "https://example.com/success";
    const cancelUrl = process.env.STRIPE_CANCEL_URL ?? "https://example.com/cancel";
    const session = await stripeCreateCheckoutSession({ priceId, successUrl, cancelUrl });
    return { url: session.url, priceId, mode: "live" };
  }
  return { url: `https://checkout.example.com/pay/${priceId}`, priceId, mode: _connectorMode };
}

async function connectorEmailSend(
  _workspaceId: string,
  opts: { to: string; subject: string; body: string; unsubscribeLink?: string }
): Promise<void> {
  if (_connectorMode === "live") {
    await emailSend({ to: opts.to, subject: opts.subject, text: opts.body, unsubscribeUrl: opts.unsubscribeLink });
    return;
  }
  // stub: no-op in test/mock mode
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

function isKillSwitchEnabled(): boolean {
  return process.env.CB_KILL_SWITCH === "true";
}

// ---------------------------------------------------------------------------
// Prompt parsing
// ---------------------------------------------------------------------------

function parseIdea(prompt: string): { title: string; domain: string; icp: string } {
  const normalized = prompt.trim() || "AI Venture";
  const title = normalized.split(/[.!?]/)[0].slice(0, 60) || "AI Venture";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "venture";
  return { title, domain: `${slug}.example.com`, icp: "Founder-led SaaS teams" };
}

// ---------------------------------------------------------------------------
// Dashboard computation (exported for Phase 10 autonomous-company use)
// ---------------------------------------------------------------------------

export function computeLevel4Dashboard(workspaceId: string): {
  actions: { total: number; pending: number; executing: number; completed: number; failed: number; blocked: number };
  outreach: { prospects: number; campaigns: number; replies: number; sentTotal: number; interestedCount: number };
  payments: { checkoutConfigured: boolean; checkoutUrl: string | null };
  provisioning: { dns: string; deploy: string; emailReady: boolean; status: string };
} {
  const actions = listLevel4Actions(workspaceId);
  const campaigns = listOutreachCampaigns(workspaceId);
  const replies = listOutreachReplies(workspaceId);
  const prospects = listOutreachProspects(workspaceId);
  const paymentSetup = readJson<{ checkout_url?: string } | null>(paymentSetupKey(workspaceId), null);
  const provisioning = readJson<{
    dns?: string;
    deploy?: string;
    email_ready?: boolean;
    status?: string;
  } | null>(provisioningStatusKey(workspaceId), null);

  return {
    actions: {
      total: actions.length,
      pending: actions.filter((a) => a.status === "pending").length,
      executing: actions.filter((a) => a.status === "executing").length,
      completed: actions.filter((a) => a.status === "completed").length,
      failed: actions.filter((a) => a.status === "failed").length,
      blocked: actions.filter((a) => a.status === "blocked").length
    },
    outreach: {
      prospects: prospects.length,
      campaigns: campaigns.length,
      replies: replies.length,
      sentTotal: campaigns.reduce((sum, c) => sum + c.sentCount, 0),
      interestedCount: replies.filter((r) => r.classification === "interested").length
    },
    payments: {
      checkoutConfigured: Boolean(paymentSetup?.checkout_url),
      checkoutUrl: paymentSetup?.checkout_url ?? null
    },
    provisioning: {
      dns: provisioning?.dns ?? "pending",
      deploy: provisioning?.deploy ?? "pending",
      emailReady: provisioning?.email_ready ?? false,
      status: provisioning?.status ?? "pending"
    }
  };
}

// ---------------------------------------------------------------------------
// Action adapter (for container policy)
// ---------------------------------------------------------------------------

function actionAdapter(actionType: string): "email" | "publish" | "deploy" | null {
  if (actionType === "provisioning.deploy") return "deploy";
  if (actionType === "outreach.campaign_send" || actionType === "outreach.reply_send") return "email";
  if (
    actionType === "provisioning.domain_dns" ||
    actionType === "provisioning.email_setup" ||
    actionType === "monetization.stripe_setup" ||
    actionType === "crm.write" ||
    actionType === "calendar.schedule" ||
    actionType === "analytics.configure"
  ) {
    return "publish";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/v1/level4/launch-from-prompt */
level4Router.post("/launch-from-prompt", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { prompt, constraints } = req.body as { prompt?: string; constraints?: Record<string, unknown> };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const idea = parseIdea(prompt);
  const memoryHints = readJson<VentureMemoryEntry[]>(ventureMemoryKey(workspaceId), [])
    .slice(0, 3)
    .map((entry) => ({
      icp: entry.icpPattern,
      messaging: entry.messagingVariant,
      pricing: entry.pricingInsight,
      outcome: entry.outcome
    }));

  try {
    const ventureProfileRecord = writeArtifact(
      workspaceId,
      "venture_profile",
      {
        chosen_market_problem: `Automate operations for ${idea.icp}`,
        target_icp: idea.icp,
        offer_pricing_hypothesis: "$500 setup + $199/mo",
        differentiation: "Governed autonomous launch + weekly operating cadence",
        strategic_memory_hints: memoryHints
      },
      userId
    );

    const launchPlanRecord = writeArtifact(
      workspaceId,
      "launch_plan",
      {
        milestones_14_30_60_90: {
          day14: ["Landing page live", "DNS configured", "First outreach campaign drafted"],
          day30: ["10 discovery calls", "first paid conversion"],
          day60: ["repeatable acquisition loop"],
          day90: ["documented operating cadence"]
        },
        experiments_backlog: ["headline_split_test", "cta_pricing_test", "outreach_sequence_a"],
        success_metrics: ["reply_rate", "meetings_booked", "checkout_conversions"]
      },
      userId
    );

    const toolingPlanRecord = writeArtifact(
      workspaceId,
      "tooling_plan",
      {
        required_tools: ["cloudflare", "vercel", "stripe", "email_sender", "crm"],
        connection_status: {
          cloudflare: "pending",
          vercel: "pending",
          stripe: "pending",
          email_sender: "pending",
          crm: "pending"
        },
        approved_domain: idea.domain
      },
      userId
    );

    const financialPolicyRecord = writeArtifact(
      workspaceId,
      "financial_policy",
      {
        currency: "USD",
        daily_spend_cap: 100,
        weekly_spend_cap: 500,
        per_transaction_cap: 100,
        categories: {
          allowed: ["software_tools", "domain_purchase"],
          forbidden: ["advertising_spend"]
        },
        approvals: {
          required_over_amount: 50,
          required_for_categories: ["advertising_spend", "price_update"],
          approver_roles: ["admin"]
        }
      },
      userId
    );

    // Agent blueprint only if none exists — interview flow owns it when present
    const existingBlueprint = getArtifact(workspaceId, "agent_blueprint");
    let blueprintRecord: { artifact_id: string; type: string; version: number } | null = null;
    if (!existingBlueprint) {
      blueprintRecord = writeArtifact(
        workspaceId,
        "agent_blueprint",
        {
          org_id: workspaceId,
          chairs: [
            {
              chair_id: "strategy-1",
              name: "Strategy Governor",
              domain: "strategy",
              description: "Governs launch playbook and overall objective alignment.",
              labor_commons_refs: [],
              scope: { owns: ["objective_score", "guardrail_violations"], refuses: [], escalates_to: [] },
              worker_agents: [],
              approval_required_for: []
            },
            {
              chair_id: "growth-1",
              name: "Growth Chair",
              domain: "growth",
              description: "Drives launch experiments and qualified pipeline conversations.",
              labor_commons_refs: [],
              scope: { owns: ["experiment_velocity", "qualified_conversations_per_week"], refuses: [], escalates_to: ["strategy-1"] },
              worker_agents: [],
              approval_required_for: ["launch_provisioning"]
            },
            {
              chair_id: "finance-1",
              name: "Finance Guard",
              domain: "finance",
              description: "Enforces spend caps and flags policy violations.",
              labor_commons_refs: [],
              scope: { owns: ["spend_cap_violations", "weekly_spend"], refuses: ["financial_account_changes"], escalates_to: ["strategy-1"] },
              worker_agents: [],
              approval_required_for: []
            },
            {
              chair_id: "product-1",
              name: "Product Delivery Chair",
              domain: "product",
              description: "Tracks throughput and cycle time for the product backlog.",
              labor_commons_refs: [],
              scope: { owns: ["throughput", "cycle_time"], refuses: [], escalates_to: ["strategy-1"] },
              worker_agents: [],
              approval_required_for: ["reprioritize_backlog"]
            },
            {
              chair_id: "ops-1",
              name: "Operations Chair",
              domain: "ops",
              description: "Monitors handoff time and process friction.",
              labor_commons_refs: [],
              scope: { owns: ["handoff_time", "process_friction"], refuses: [], escalates_to: ["strategy-1"] },
              worker_agents: [],
              approval_required_for: []
            }
          ],
          schema_version: "1.0"
        },
        userId
      );
    }

    // Operational state (not governed artifacts)
    writeJsonAtomic(outreachConfigKey(workspaceId), {
      enabled: false,
      daily_cap: 50,
      complaint_pause_threshold: 0.05,
      send_window: "09:00-16:00"
    });
    writeJsonAtomic(pipelineStateKey(workspaceId), { contacts: [], deals: [] });
    writeJsonAtomic(provisioningStatusKey(workspaceId), {
      domain: idea.domain,
      dns: "pending",
      deploy: "pending",
      email_ready: false,
      status: "pending"
    });

    // Create governed actions for each provisioning step
    const actionDefs = [
      {
        type: "provisioning.domain_dns" as const,
        payload: { domain: idea.domain },
        blastRadius: "medium" as const,
        rollbackPlan: "revert_dns_records"
      },
      {
        type: "provisioning.deploy" as const,
        payload: { projectName: idea.title, headline: idea.title, cta: "Book a demo" },
        blastRadius: "medium" as const,
        rollbackPlan: "redeploy_previous"
      },
      {
        type: "provisioning.email_setup" as const,
        payload: { domain: idea.domain },
        blastRadius: "low" as const,
        rollbackPlan: "remove_email_dns_records"
      },
      {
        type: "monetization.stripe_setup" as const,
        payload: { productName: `${idea.title} Offer`, unitAmount: 19900, currency: "USD" },
        blastRadius: "medium" as const,
        rollbackPlan: "archive_product"
      }
    ];

    const now = new Date().toISOString();
    const actions = actionDefs.map((def) => {
      const action = createLevel4Action({
        workspaceId,
        type: def.type,
        payload: def.payload,
        blastRadius: def.blastRadius,
        rollbackPlan: def.rollbackPlan,
        approvalsRequired: 1,
        correlationId: req.correlationId
      });

      createLevel4Approval(workspaceId, {
        actionId: action.id,
        agentId: "level4-orchestrator",
        actionType: action.type,
        riskScore: action.blastRadius === "medium" ? 60 : 30,
        blastRadius: action.blastRadius,
        category: action.type
      });

      appendEvent({
        event_id: randomUUID(),
        org_id: workspaceId,
        event_type: "action_proposed",
        actor: userId,
        artifact_type: null,
        artifact_id: null,
        details: {
          action_id: action.id,
          action_type: action.type,
          blast_radius: action.blastRadius,
          source: "level4_launch_from_prompt",
          correlationId: req.correlationId ?? null
        },
        at: now
      } satisfies GovernanceEvent);

      return action;
    });

    res.status(201).json({
      artifacts: {
        ventureProfile: ventureProfileRecord.artifact_id,
        launchPlan: launchPlanRecord.artifact_id,
        toolingPlan: toolingPlanRecord.artifact_id,
        financialPolicy: financialPolicyRecord.artifact_id,
        agentBlueprint: blueprintRecord?.artifact_id ?? existingBlueprint?.artifact_id ?? null
      },
      actions,
      constraints: constraints ?? {}
    });
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      res.status(400).json({ error: "artifact validation failed", details: error.errors });
      return;
    }
    const detail = error instanceof Error ? error.message : "unknown error";
    res.status(500).json({ error: "launch-from-prompt failed", detail });
  }
});

/** GET /api/v1/level4/actions */
level4Router.get("/actions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  res.status(200).json({ actions: listLevel4Actions(workspaceId) });
});

/** POST /api/v1/level4/actions/:actionId/approve-execute */
level4Router.post("/actions/:actionId/approve-execute", requireRole(["admin"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { actionId } = req.params;

  // Idempotency
  const idempotencyHeader = req.header("x-idempotency-key");
  if (idempotencyHeader) {
    const accepted = registerIdempotency(workspaceId, "level4.approve-execute", idempotencyHeader);
    if (!accepted) {
      res.status(409).json({ error: "duplicate request", scope: "level4.approve-execute" });
      return;
    }
  }

  if (isKillSwitchEnabled()) {
    res.status(423).json({ error: "workspace kill switch enabled" });
    return;
  }

  // Acquire in-process lock
  const lockResource = `level4.action.${actionId}`;
  if (!acquireLock(lockResource)) {
    res.status(409).json({ error: "action execution already in progress" });
    return;
  }

  try {
    const action = getLevel4Action(workspaceId, actionId);
    if (!action) {
      releaseLock(lockResource);
      res.status(404).json({ error: "action not found" });
      return;
    }
    if (action.status !== "pending") {
      releaseLock(lockResource);
      res.status(409).json({ error: `action already in status: ${action.status}` });
      return;
    }

    updateLevel4Action(workspaceId, actionId, { status: "approved" });
    approveLevel4Action(workspaceId, actionId, userId);

    // Operation checkpoint
    const opCheckpoint = recordCheckpoint({
      workspaceId,
      userId,
      actionId,
      stage: "operation",
      status: "pending",
      correlationId: req.correlationId
    });
    if (!opCheckpoint.ok) {
      releaseLock(lockResource);
      res.status(409).json({ error: opCheckpoint.error });
      return;
    }

    // Container policy check
    const adapter = actionAdapter(action.type);
    if (adapter) {
      const policy = externalWriteAllowed(adapter);
      if (!policy.ok) {
        updateLevel4Action(workspaceId, actionId, { status: "blocked", error: policy.reason });
        recordCheckpoint({
          workspaceId, userId, actionId, stage: "verification", status: "blocked",
          correlationId: req.correlationId, context: { reason: "container_policy_blocked" }
        });
        releaseLock(lockResource);
        res.status(409).json({ error: "action blocked by container policy", reason: policy.reason });
        return;
      }
    }

    // Verification checkpoint
    const verifyCheckpoint = recordCheckpoint({
      workspaceId, userId, actionId, stage: "verification", status: "approved",
      correlationId: req.correlationId
    });
    if (!verifyCheckpoint.ok) {
      releaseLock(lockResource);
      res.status(409).json({ error: verifyCheckpoint.error });
      return;
    }

    // Execution
    updateLevel4Action(workspaceId, actionId, { status: "executing" });
    const execCheckpoint = recordCheckpoint({
      workspaceId, userId, actionId, stage: "governance", status: "executing",
      correlationId: req.correlationId
    });
    if (!execCheckpoint.ok) {
      updateLevel4Action(workspaceId, actionId, { status: "blocked", error: execCheckpoint.error });
      releaseLock(lockResource);
      res.status(409).json({ error: execCheckpoint.error });
      return;
    }

    const start = Date.now();

    if (action.type === "provisioning.domain_dns") {
      const domain = String(action.payload.domain ?? "example.com");
      const result = await connectorCloudflareUpsertRecords(workspaceId, domain, [
        { type: "A", name: "@", value: "76.76.21.21" },
        { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none" }
      ]);
      recordExternalWrite(workspaceId, {
        actionId,
        connector: "cloudflare",
        status: result.ok ? "success" : "failed",
        requestMeta: { domain },
        responseMeta: result,
        durationMs: Date.now() - start,
        correlationId: req.correlationId
      });
      const existing = readJson<Record<string, unknown> | null>(provisioningStatusKey(workspaceId), null);
      if (existing) writeJsonAtomic(provisioningStatusKey(workspaceId), { ...existing, dns: "green" });
    }

    if (action.type === "provisioning.deploy") {
      const result = await connectorVercelDeployTemplate(workspaceId, {
        projectName: String(action.payload.projectName ?? "venture-site"),
        headline: String(action.payload.headline ?? "Launch faster"),
        cta: String(action.payload.cta ?? "Book a demo")
      });
      recordExternalWrite(workspaceId, {
        actionId,
        connector: "vercel",
        status: "success",
        requestMeta: action.payload,
        responseMeta: result,
        durationMs: Date.now() - start,
        correlationId: req.correlationId
      });
      writeJsonAtomic(landingPageKey(workspaceId), {
        url: result.url,
        headline: String(action.payload.headline ?? "Launch faster"),
        cta: String(action.payload.cta ?? "Book a demo")
      });
      const existing = readJson<Record<string, unknown> | null>(provisioningStatusKey(workspaceId), null);
      if (existing) {
        writeJsonAtomic(provisioningStatusKey(workspaceId), {
          ...existing, deploy: "green", deployed_url: result.url
        });
      }
    }

    if (action.type === "provisioning.email_setup") {
      recordExternalWrite(workspaceId, {
        actionId,
        connector: "email_dns",
        status: "success",
        requestMeta: action.payload,
        responseMeta: { verified: true },
        durationMs: Date.now() - start,
        correlationId: req.correlationId
      });
      const existing = readJson<Record<string, unknown> | null>(provisioningStatusKey(workspaceId), null);
      if (existing) {
        writeJsonAtomic(provisioningStatusKey(workspaceId), {
          ...existing, email_ready: true, status: "green"
        });
      }
    }

    if (action.type === "monetization.stripe_setup") {
      const product = await connectorStripeCreateProduct(workspaceId, String(action.payload.productName ?? "Offer"));
      const price = await connectorStripeCreatePrice(workspaceId, {
        productId: product.id,
        unitAmount: Number(action.payload.unitAmount ?? 19900),
        currency: String(action.payload.currency ?? "USD")
      });
      const checkout = await connectorStripeCreateCheckoutLink(workspaceId, price.id);
      recordExternalWrite(workspaceId, {
        actionId,
        connector: "stripe",
        status: "success",
        requestMeta: action.payload,
        responseMeta: { product, price, checkout },
        durationMs: Date.now() - start,
        correlationId: req.correlationId
      });
      writeJsonAtomic(paymentSetupKey(workspaceId), {
        provider: "stripe",
        product_id: product.id,
        price_id: price.id,
        checkout_url: checkout.url
      });
      const landingPage = readJson<Record<string, unknown> | null>(landingPageKey(workspaceId), null);
      if (landingPage) {
        writeJsonAtomic(landingPageKey(workspaceId), {
          ...landingPage, checkout_url: checkout.url, cta: "Start checkout"
        });
      }
    }

    const completed = updateLevel4Action(workspaceId, actionId, { status: "completed" });
    recordCheckpoint({
      workspaceId, userId, actionId, stage: "deployment", status: "completed",
      correlationId: req.correlationId
    });

    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        action_id: actionId,
        action_type: action.type,
        blast_radius: action.blastRadius,
        duration_ms: Date.now() - start,
        correlationId: req.correlationId ?? null
      },
      at: new Date().toISOString()
    } satisfies GovernanceEvent);

    releaseLock(lockResource);
    res.status(200).json({ action: completed });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateLevel4Action(workspaceId, actionId, { status: "failed", error: errorMessage });
    recordExternalWrite(workspaceId, {
      actionId,
      connector: "unknown",
      status: "failed",
      requestMeta: {},
      responseMeta: { error: errorMessage },
      durationMs: 0,
      correlationId: req.correlationId
    });
    recordCheckpoint({
      workspaceId, userId, actionId, stage: "governance", status: "blocked",
      correlationId: req.correlationId, context: { reason: "execution_failed" }
    });
    createDeadLetter(workspaceId, {
      source: "level4.approve-execute",
      reason: "action_execution_failure",
      payload: { action_id: actionId, correlationId: req.correlationId, error: errorMessage }
    });
    releaseLock(lockResource);
    res.status(500).json({ error: "action execution failed", detail: errorMessage });
  }
});

/** PATCH /api/v1/level4/outreach/config */
level4Router.patch("/outreach/config", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const existing = readJson<Record<string, unknown>>(outreachConfigKey(workspaceId), {
    enabled: false, daily_cap: 50, complaint_pause_threshold: 0.05, send_window: "09:00-16:00"
  });
  const next = {
    enabled: Boolean(req.body?.enabled ?? existing.enabled ?? false),
    daily_cap: Number(req.body?.daily_cap ?? existing.daily_cap ?? 50),
    complaint_pause_threshold: Number(req.body?.complaint_pause_threshold ?? existing.complaint_pause_threshold ?? 0.05),
    send_window: String(req.body?.send_window ?? existing.send_window ?? "09:00-16:00")
  };
  writeJsonAtomic(outreachConfigKey(workspaceId), next);
  res.status(200).json(next);
});

/** POST /api/v1/level4/outreach/prospects/upload */
level4Router.post("/outreach/prospects/upload", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const prospects = (req.body?.prospects ?? []) as Array<{ email: string; name?: string; company?: string }>;
  if (!Array.isArray(prospects) || prospects.length === 0) {
    res.status(400).json({ error: "prospects array is required" });
    return;
  }
  const valid = prospects
    .filter((item) => typeof item.email === "string" && item.email.includes("@"))
    .map((item) => ({ ...item, source: "csv_upload" as const }));
  const created = addOutreachProspects(workspaceId, valid);
  res.status(201).json({ prospects: created });
});

/** POST /api/v1/level4/outreach/campaigns */
level4Router.post("/outreach/campaigns", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { name, subject, body } = req.body as { name?: string; subject?: string; body?: string };
  if (!name || !subject || !body) {
    res.status(400).json({ error: "name, subject, and body are required" });
    return;
  }
  const campaign = createOutreachCampaign(workspaceId, { name, subject, body });
  res.status(201).json(campaign);
});

/** POST /api/v1/level4/outreach/campaigns/:campaignId/send */
level4Router.post("/outreach/campaigns/:campaignId/send", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { campaignId } = req.params;

  // Idempotency
  const idempotencyHeader = req.header("x-idempotency-key");
  if (idempotencyHeader) {
    if (!registerIdempotency(workspaceId, "outreach.send", idempotencyHeader)) {
      res.status(409).json({ error: "duplicate request", scope: "outreach.send" });
      return;
    }
  }

  if (isKillSwitchEnabled()) {
    res.status(423).json({ error: "workspace kill switch enabled" });
    return;
  }

  const policy = externalWriteAllowed("email");
  if (!policy.ok) {
    res.status(409).json({ error: "outreach blocked by container policy", reason: policy.reason });
    return;
  }

  const config = readJson<Record<string, unknown>>(outreachConfigKey(workspaceId), {});
  if (!config || config.enabled !== true) {
    res.status(409).json({ error: "outreach is disabled; enable it first via PATCH /outreach/config" });
    return;
  }

  const lockResource = `outreach.campaign.${campaignId}.send`;
  if (!acquireLock(lockResource)) {
    res.status(409).json({ error: "campaign send already in progress" });
    return;
  }

  const campaign = listOutreachCampaigns(workspaceId).find((c) => c.id === campaignId);
  if (!campaign) {
    releaseLock(lockResource);
    res.status(404).json({ error: "campaign not found" });
    return;
  }

  try {
    if (campaign.sentCount === 0 && req.body?.copyApproved !== true) {
      const approvalAction = createLevel4Action({
        workspaceId,
        type: "outreach.campaign_send",
        payload: { campaignId },
        blastRadius: "medium",
        rollbackPlan: "pause_campaign",
        approvalsRequired: 1,
        correlationId: req.correlationId
      });
      createLevel4Approval(workspaceId, {
        actionId: approvalAction.id,
        agentId: "growth-1",
        actionType: "outreach.campaign_send",
        riskScore: 65,
        blastRadius: "medium",
        category: "outreach.campaign_send"
      });
      releaseLock(lockResource);
      res.status(202).json({ requiresApproval: true, action: approvalAction });
      return;
    }

    const prospects = listOutreachProspects(workspaceId)
      .filter((p) => !p.suppressed)
      .slice(0, Number(config.daily_cap ?? 50));

    let sent = 0;
    for (const prospect of prospects) {
      await connectorEmailSend(workspaceId, {
        to: prospect.email,
        subject: campaign.subject,
        body: `${campaign.body}\n\nTo unsubscribe reply with 'unsubscribe'.`,
        unsubscribeLink: "mailto:unsubscribe@example.com"
      });
      sent += 1;
      recordExternalWrite(workspaceId, {
        actionId: `campaign:${campaign.id}`,
        connector: "email_sender",
        status: "success",
        requestMeta: { campaignId: campaign.id, toHash: prospect.email.split("@")[0].slice(0, 2) },
        responseMeta: { sent: true },
        durationMs: 10,
        correlationId: req.correlationId
      });
    }

    const updated = updateOutreachCampaign(workspaceId, campaign.id, {
      status: "sent",
      sentCount: campaign.sentCount + sent,
      deliveredCount: campaign.deliveredCount + sent
    });

    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_type: "outreach.campaign_send", campaign_id: campaign.id, sent, source: "campaign_send" },
      at: new Date().toISOString()
    } satisfies GovernanceEvent);

    releaseLock(lockResource);
    res.status(200).json({ campaign: updated, sent });
  } catch (error) {
    releaseLock(lockResource);
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "campaign send failed", detail });
  }
});

/** POST /api/v1/level4/outreach/replies */
level4Router.post("/outreach/replies", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const { email, body } = req.body as { email?: string; body?: string };
  if (!email || !body) {
    res.status(400).json({ error: "email and body are required" });
    return;
  }

  const modelDecision = await resolveModelNativeOutreachReply(body);
  const { classification } = modelDecision;

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "action_proposed",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: {
      action_type: "outreach.reply_classify",
      classification: modelDecision.classification,
      confidence: modelDecision.confidence,
      model_provider: modelDecision.model.provider,
      model_source: modelDecision.model.source
    },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);

  const reply = addOutreachReply(workspaceId, { email, body, classification });

  const campaigns = listOutreachCampaigns(workspaceId);
  const campaign = campaigns[0] ?? null;

  if (campaign) {
    if (classification === "unsubscribe") {
      suppressProspect(workspaceId, email, "unsubscribe");
      updateOutreachCampaign(workspaceId, campaign.id, {
        unsubscribeCount: campaign.unsubscribeCount + 1
      });
    }

    if (classification === "complaint") {
      suppressProspect(workspaceId, email, "complaint");
      const updatedCampaign = updateOutreachCampaign(workspaceId, campaign.id, {
        complaintCount: campaign.complaintCount + 1
      });
      const config = readJson<Record<string, unknown>>(outreachConfigKey(workspaceId), {});
      const threshold = Number(config?.complaint_pause_threshold ?? 0.05);
      const sentCount = updatedCampaign?.sentCount ?? 0;
      const complaintCount = updatedCampaign?.complaintCount ?? 0;
      const complaintRate = sentCount === 0 ? 0 : complaintCount / sentCount;
      if (complaintRate >= threshold) {
        updateOutreachCampaign(workspaceId, campaign.id, { status: "paused" });
      }
    }
  }

  const pipeline = readJson<{ contacts: Array<Record<string, unknown>>; deals: Array<Record<string, unknown>> }>(
    pipelineStateKey(workspaceId),
    { contacts: [], deals: [] }
  );
  const contacts = [...pipeline.contacts];
  const deals = [...pipeline.deals];

  if (classification === "interested") {
    contacts.push({ email, status: "engaged", updated_at: new Date().toISOString() });
    deals.push({
      id: `deal-${Date.now()}`,
      email,
      stage: "discovery",
      value: 199,
      next_step: "propose meeting slots"
    });
  }

  writeJsonAtomic(pipelineStateKey(workspaceId), { contacts, deals });

  res.status(201).json({ reply, classification });
});

/** GET /api/v1/level4/dashboard */
level4Router.get("/dashboard", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const provisioning = readJson<Record<string, unknown> | null>(provisioningStatusKey(workspaceId), null);
  const outreachConfig = readJson<Record<string, unknown> | null>(outreachConfigKey(workspaceId), null);
  const campaigns = listOutreachCampaigns(workspaceId);
  const replies = listOutreachReplies(workspaceId);
  const payments = readJson<Record<string, unknown> | null>(paymentSetupKey(workspaceId), null);
  const metrics = computeLevel4Dashboard(workspaceId);

  res.status(200).json({
    provisioning,
    outreach: { config: outreachConfig, campaigns, replies },
    payments,
    metrics
  });
});

/** GET /api/v1/level4/audits/external-writes */
level4Router.get("/audits/external-writes", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const writes = readJson<ExternalWriteRecord[]>(externalWritesKey(workspaceId), []);
  res.status(200).json({ writes });
});

/** GET /api/v1/level4/crm/pipeline */
level4Router.get("/crm/pipeline", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const pipeline = readJson<Record<string, unknown>>(
    pipelineStateKey(workspaceId),
    { contacts: [], deals: [] }
  );
  res.status(200).json({ pipeline });
});
