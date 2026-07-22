/**
 * Autonomous company evolution routes — market signals, experiment lifecycle,
 * capital allocation, pivot protocol, venture memory, and the autonomy cycle.
 *
 * Ported from mother-board routes/autonomous-company.ts.
 * Sanitized:
 *   - store.* → readJson()/writeJsonAtomic() throughout
 *   - store.createArtifact(workspaceId, "rd_experiment_packet") → rd-packets/${workspaceId}
 *     (RD packets are operational state, not governed artifacts)
 *   - store.createBoardRequest/transitionBoardRequest/listBoardRequests
 *       → board-requests/${workspaceId} via readJson/writeJsonAtomic (same
 *         key as motherboard.ts; BoardRequestRecord format with snake_case fields)
 *   - store.createApproval → approvals/${workspaceId} (ApprovalRecord format)
 *   - store.createProductEvent/appendDecisionLog → appendEvent() (governance events)
 *   - store.listProductEvents → omitted (no product-event store in OLF Phase 10;
 *     revenueVelocity defaults to 0 in daily aggregation until Phase 11)
 *   - store.runAutonomyCycle → inline implementation using OLF persistence
 *   - org_blueprint → agent_blueprint (OLF canonical name; chair_id/domain format)
 *   - store.getLatestArtifact(workspaceId, "org_blueprint") → getArtifact(workspaceId, "agent_blueprint")
 *   - Chair lookup uses domain field (not agent_type) matching BoardDomain
 *   - Shutdown report does NOT call updateWorkspaceSettings (deployment concern,
 *     not runtime; operators use CB_KILL_SWITCH env var instead)
 *
 * Routes:
 *   POST /api/v1/autonomous/signals/aggregate-daily — compute & store today's market signal
 *   POST /api/v1/autonomous/signals               — manually record a market signal
 *   GET  /api/v1/autonomous/signals               — list all market signals
 *   POST /api/v1/autonomous/experiments           — create a new experiment
 *   GET  /api/v1/autonomous/experiments           — list all experiments
 *   POST /api/v1/autonomous/experiments/:id/review   — review & generate RD governance packet
 *   POST /api/v1/autonomous/experiments/:id/deploy   — deploy a reviewed experiment
 *   POST /api/v1/autonomous/cycle/run             — run the full autonomy cycle
 *   GET  /api/v1/autonomous/capital-plans         — list capital allocation plans
 *   GET  /api/v1/autonomous/pivot-events          — list pivot events
 *   GET  /api/v1/autonomous/shutdown-reports      — list shutdown reports
 *   POST /api/v1/autonomous/memory               — add a venture memory entry
 *   GET  /api/v1/autonomous/memory               — list venture memory entries
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { ApprovalRecord, BoardDomain, BoardRequestRecord, GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { asyncHandler } from "../lib/async-handler.js";
import { createApproval } from "../lib/approval-store.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { buildRdExperimentPacket, type RdExperimentPacket } from "../services/rd-orchestrator.js";
import { computeLevel4Dashboard } from "./level4.js";

export const autonomousCompanyRouter = Router();
autonomousCompanyRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MarketSignal = {
  id: string;
  workspaceId: string;
  date: string;
  marketHealthScore: number;
  replyRate: number;
  meetingRate: number;
  conversionRate: number;
  revenueVelocity: number;
  costPerAcquisition: number;
  bounceRate: number;
  unsubscribeRate: number;
  complaintRate: number;
  landingConversionRate: number;
  pipelineGrowth: number;
  revenueGrowth: number;
};

type ExperimentStatus = "active" | "success" | "fail" | "killed" | "scaled";

type ExperimentRecord = {
  id: string;
  workspaceId: string;
  hypothesis: string;
  channel: string;
  variant: string;
  cost: number;
  outcomeLift: number;
  roiScore: number;
  status: ExperimentStatus;
  consecutiveUnderperform: number;
  createdAt: string;
  updatedAt: string;
};

type PivotEvent = {
  id: string;
  workspaceId: string;
  createdAt: string;
  triggerReason: string;
  hypotheses: string[];
  icpShifts: string[];
  pricingShifts: string[];
  channelPlan: string[];
  requiresApproval: boolean;
};

type CapitalAllocationPlan = {
  id: string;
  workspaceId: string;
  createdAt: string;
  totalBudget: number;
  emergencyBuffer: number;
  runwayWeeks: number;
  burnRate: number;
  channelAllocations: Array<{ channel: string; amount: number }>;
  throttled: boolean;
  reason?: string;
};

type ShutdownReport = {
  id: string;
  workspaceId: string;
  createdAt: string;
  reason: string;
  preservationMode: boolean;
  recommendations: string[];
};

type CycleRunRecord = {
  cycle_id: string;
  workspace_id: string;
  status: "completed" | "partial";
  domains_run: string[];
  actions_taken: number;
  briefs_generated: number;
  pivot_triggered: boolean;
  shutdown_triggered: boolean;
  started_at: string;
  completed_at: string;
};

type VentureMemoryEntry = {
  id: string;
  workspaceId: string;
  createdAt: string;
  icpPattern: string;
  messagingVariant: string;
  pricingInsight: string;
  channelEfficiency: string;
  timeToFirstRevenueDays: number;
  outcome: "success" | "fail";
};

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const signalsKey = (w: string) => `market-signals/${w}`;
const experimentsKey = (w: string) => `experiments/${w}`;
const rdPacketsKey = (w: string) => `rd-packets/${w}`;
const capitalPlansKey = (w: string) => `capital-plans/${w}`;
const pivotEventsKey = (w: string) => `pivot-events/${w}`;
const shutdownReportsKey = (w: string) => `shutdown-reports/${w}`;
const ventureMemoryKey = (w: string) => `venture-memory/${w}`;
const boardRequestsKey = (w: string) => `board-requests/${w}`;
const approvalsKey = (w: string) => `approvals/${w}`;
const cyclesKey = (w: string) => `autonomous-cycles/${w}`;

// ---------------------------------------------------------------------------
// Market signal helpers
// ---------------------------------------------------------------------------

function computeMarketHealthScore(input: Omit<MarketSignal, "id" | "workspaceId" | "marketHealthScore">): number {
  const efficiencyScore = Math.max(0, 100 - input.costPerAcquisition);
  const negativePenalty = (input.bounceRate + input.unsubscribeRate + input.complaintRate) * 100;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        input.pipelineGrowth * 20 +
          input.revenueGrowth * 30 +
          input.replyRate * 20 +
          input.conversionRate * 20 +
          efficiencyScore * 0.1 -
          negativePenalty * 0.3
      )
    )
  );
}

function addMarketSignal(workspaceId: string, input: Omit<MarketSignal, "id" | "workspaceId" | "marketHealthScore">): MarketSignal {
  const signal: MarketSignal = {
    id: randomUUID(),
    workspaceId,
    marketHealthScore: computeMarketHealthScore(input),
    ...input
  };
  const all = readJson<MarketSignal[]>(signalsKey(workspaceId), []);
  writeJsonAtomic(signalsKey(workspaceId), [...all, signal]);
  return signal;
}

function listMarketSignals(workspaceId: string): MarketSignal[] {
  return readJson<MarketSignal[]>(signalsKey(workspaceId), []).sort(
    (a, b) => (a.date < b.date ? 1 : -1)
  );
}

// ---------------------------------------------------------------------------
// Experiment helpers
// ---------------------------------------------------------------------------

function listExperiments(workspaceId: string): ExperimentRecord[] {
  return readJson<ExperimentRecord[]>(experimentsKey(workspaceId), []).sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : -1)
  );
}

function saveExperiments(workspaceId: string, experiments: ExperimentRecord[]): void {
  writeJsonAtomic(experimentsKey(workspaceId), experiments);
}

// ---------------------------------------------------------------------------
// Board request helpers (write directly to the shared board-requests key)
// ---------------------------------------------------------------------------

function createBoardRequest(workspaceId: string, input: {
  title: string;
  request: string;
  requestedBy: string;
  targetChairId: string;
  targetDomain: BoardDomain;
  priority: BoardRequestRecord["priority"];
  constraints: string[];
  successCriteria: string[];
  approvalRequired: boolean;
  riskLevel: "low" | "medium" | "high";
}): BoardRequestRecord {
  const now = new Date().toISOString();
  const record: BoardRequestRecord = {
    id: randomUUID(),
    org_id: workspaceId,
    title: input.title,
    request: input.request,
    requested_by: input.requestedBy,
    target_chair_id: input.targetChairId,
    target_domain: input.targetDomain,
    routing_mode: "auto",
    status: "submitted",
    priority: input.priority,
    constraints: input.constraints,
    success_criteria: input.successCriteria,
    dependency_ids: [],
    approval_required: input.approvalRequired,
    risk_level: input.riskLevel,
    created_at: now,
    updated_at: now
  };
  const all = readJson<BoardRequestRecord[]>(boardRequestsKey(workspaceId), []);
  writeJsonAtomic(boardRequestsKey(workspaceId), [...all, record]);
  return record;
}

function transitionBoardRequest(workspaceId: string, requestId: string, status: BoardRequestRecord["status"], updatedBy: string): void {
  const all = readJson<BoardRequestRecord[]>(boardRequestsKey(workspaceId), []);
  const idx = all.findIndex((r) => r.id === requestId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], status, updated_at: new Date().toISOString() };
  writeJsonAtomic(boardRequestsKey(workspaceId), all);

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "board_request_status_changed",
    actor: updatedBy,
    artifact_type: null,
    artifact_id: null,
    details: { request_id: requestId, status, source: "autonomous_company" },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);
}

// ---------------------------------------------------------------------------
// RD packet helpers
// ---------------------------------------------------------------------------

function persistRdPacket(workspaceId: string, packet: RdExperimentPacket): void {
  const all = readJson<RdExperimentPacket[]>(rdPacketsKey(workspaceId), []);
  writeJsonAtomic(rdPacketsKey(workspaceId), [...all, packet]);
}

// ---------------------------------------------------------------------------
// Autonomy cycle helpers
// ---------------------------------------------------------------------------

function evaluateExperiments(workspaceId: string): {
  killed: number;
  scaled: number;
  updated: ExperimentRecord[];
  noPositiveWeeks: number;
} {
  const all = readJson<ExperimentRecord[]>(experimentsKey(workspaceId), []);
  let killed = 0;
  let scaled = 0;
  const updated: ExperimentRecord[] = [];

  for (const exp of all) {
    if (exp.status === "killed") {
      updated.push(exp);
      continue;
    }
    const now = new Date().toISOString();
    if (exp.outcomeLift < 0.02 || exp.roiScore < 0) {
      const consecutiveUnderperform = exp.consecutiveUnderperform + 1;
      if (consecutiveUnderperform >= 2) {
        updated.push({ ...exp, status: "killed", consecutiveUnderperform, updatedAt: now });
        killed += 1;
      } else {
        updated.push({ ...exp, status: "fail", consecutiveUnderperform, updatedAt: now });
      }
    } else if (exp.outcomeLift >= 0.15 && exp.roiScore > 0.4) {
      updated.push({ ...exp, status: "scaled", consecutiveUnderperform: 0, updatedAt: now });
      scaled += 1;
    } else if (exp.outcomeLift > 0) {
      updated.push({ ...exp, status: "success", consecutiveUnderperform: 0, updatedAt: now });
    } else {
      updated.push({ ...exp, status: "active", updatedAt: now });
    }
  }

  writeJsonAtomic(experimentsKey(workspaceId), updated);
  const noPositiveWeeks = updated.every((e) => e.outcomeLift <= 0) ? 4 : 0;
  return { killed, scaled, updated, noPositiveWeeks };
}

function createPivotEvent(workspaceId: string, triggerReason: string): PivotEvent {
  const event: PivotEvent = {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    triggerReason,
    hypotheses: [
      "Target a narrower ICP with urgent pain",
      "Shift offer from service to productized package",
      "Change positioning from cost-saving to revenue acceleration"
    ],
    icpShifts: ["SaaS founders -> Agency owners", "SMB -> Mid-market"],
    pricingShifts: ["$199/mo -> $499/mo with onboarding", "$500 setup removed + annual discount"],
    channelPlan: ["Reduce outbound volume", "Increase partner/channel outreach", "Expand content + referral loop"],
    requiresApproval: true
  };
  const all = readJson<PivotEvent[]>(pivotEventsKey(workspaceId), []);
  writeJsonAtomic(pivotEventsKey(workspaceId), [...all, event]);
  return event;
}

function createCapitalPlan(
  workspaceId: string,
  experiments: ExperimentRecord[],
  input: { totalBudget: number; runwayWeeks: number; burnRate: number }
): CapitalAllocationPlan {
  const channels = ["outbound", "content", "partnerships"];
  const baseWeight = channels.map((channel) => {
    const matches = experiments.filter((e) => e.channel === channel);
    const avgRoi = matches.length === 0
      ? 0.2
      : matches.reduce((acc, e) => acc + e.roiScore, 0) / matches.length;
    return { channel, weight: Math.max(0, avgRoi) };
  });

  const totalWeight = baseWeight.reduce((acc, item) => acc + item.weight, 0) || 1;
  const emergencyBuffer = Number((input.totalBudget * 0.2).toFixed(2));
  const allocatable = Math.max(0, input.totalBudget - emergencyBuffer);
  const throttled = input.burnRate > input.totalBudget * 0.6;
  const channelAllocations = baseWeight.map((item) => ({
    channel: item.channel,
    amount: Number(
      (throttled
        ? (allocatable * item.weight) / totalWeight * 0.5
        : (allocatable * item.weight) / totalWeight
      ).toFixed(2)
    )
  }));

  const plan: CapitalAllocationPlan = {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    totalBudget: input.totalBudget,
    emergencyBuffer,
    runwayWeeks: input.runwayWeeks,
    burnRate: input.burnRate,
    channelAllocations,
    throttled,
    reason: throttled ? "burn_above_projection" : undefined
  };
  const all = readJson<CapitalAllocationPlan[]>(capitalPlansKey(workspaceId), []);
  writeJsonAtomic(capitalPlansKey(workspaceId), [...all, plan]);
  return plan;
}

function createShutdownReport(workspaceId: string, reason: string): ShutdownReport {
  const report: ShutdownReport = {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    reason,
    preservationMode: true,
    recommendations: [
      "Halt outreach sends",
      "Pause non-essential spend",
      "Archive current venture artifacts",
      "Export venture memory before shutdown"
    ]
  };
  const all = readJson<ShutdownReport[]>(shutdownReportsKey(workspaceId), []);
  writeJsonAtomic(shutdownReportsKey(workspaceId), [...all, report]);
  return report;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/v1/autonomous/signals/aggregate-daily */
autonomousCompanyRouter.post(
  "/signals/aggregate-daily",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const { workspaceId } = req.ctx!;
    const today = new Date().toISOString().slice(0, 10);
    const existing = listMarketSignals(workspaceId).find((s) => s.date === today);
    if (existing) {
      res.status(200).json({ signal: existing, idempotent: true });
      return;
    }

    const dashboard = computeLevel4Dashboard(workspaceId);
    const campaigns = readJson<Array<{ sentCount: number; complaintCount: number; unsubscribeCount: number; bouncedCount: number }>>(
      `outreach-campaigns/${workspaceId}`,
      []
    );
    const replies = readJson<Array<{ classification: string }>>(
      `outreach-replies/${workspaceId}`,
      []
    );
    const capitalPlans = readJson<CapitalAllocationPlan[]>(capitalPlansKey(workspaceId), []);

    const totalSent = campaigns.reduce((acc, c) => acc + c.sentCount, 0);
    const interestedReplies = replies.filter((r) => r.classification === "interested").length;
    const complaintRate = campaigns.reduce((acc, c) => acc + c.complaintCount, 0) / Math.max(1, totalSent);
    const unsubscribeRate = campaigns.reduce((acc, c) => acc + c.unsubscribeCount, 0) / Math.max(1, totalSent);
    const bounceRate = campaigns.reduce((acc, c) => acc + c.bouncedCount, 0) / Math.max(1, totalSent);
    const latestCapital = capitalPlans[capitalPlans.length - 1] ?? null;
    // paidEvents deferred to Phase 11 (billing engine)
    const deals = dashboard.outreach.interestedCount;

    const signal = addMarketSignal(workspaceId, {
      date: today,
      replyRate: Number((interestedReplies / Math.max(1, totalSent)).toFixed(2)),
      meetingRate: Number((deals / Math.max(1, interestedReplies)).toFixed(2)),
      conversionRate: 0,
      revenueVelocity: 0,
      costPerAcquisition: Number(((latestCapital?.burnRate ?? 120) / Math.max(1, interestedReplies || deals || 1)).toFixed(2)),
      bounceRate: Number(bounceRate.toFixed(2)),
      unsubscribeRate: Number(unsubscribeRate.toFixed(2)),
      complaintRate: Number(complaintRate.toFixed(2)),
      landingConversionRate: Number((dashboard.payments.checkoutConfigured ? 0.12 : 0.04).toFixed(2)),
      pipelineGrowth: deals > 0 ? 0.08 : 0.01,
      revenueGrowth: 0.01
    });

    res.status(201).json({ signal, source: "daily_aggregate_job" });
  }
);

/** POST /api/v1/autonomous/signals */
autonomousCompanyRouter.post("/signals", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const body = req.body as Record<string, unknown>;

  // UI form sends { name, value, domain, source } — map to metric fields.
  // Human-readable signals are stored with their label in metadata.
  const signalName = body.name ? String(body.name) : undefined;
  const signalValue = signalName ? Number(body.value ?? 0) : undefined;

  const signal = addMarketSignal(workspaceId, {
    date: String(body.date ?? new Date().toISOString().slice(0, 10)),
    replyRate: signalName === "reply_rate" ? signalValue! : Number(body.replyRate ?? 0),
    meetingRate: signalName === "meeting_rate" ? signalValue! : Number(body.meetingRate ?? 0),
    conversionRate: signalName === "conversion_rate" ? signalValue! : Number(body.conversionRate ?? 0),
    revenueVelocity: signalName === "revenue_velocity" ? signalValue! : Number(body.revenueVelocity ?? 0),
    costPerAcquisition: signalName === "cost_per_acquisition" ? signalValue! : Number(body.costPerAcquisition ?? 0),
    bounceRate: signalName === "bounce_rate" ? signalValue! : Number(body.bounceRate ?? 0),
    unsubscribeRate: signalName === "unsubscribe_rate" ? signalValue! : Number(body.unsubscribeRate ?? 0),
    complaintRate: signalName === "complaint_rate" ? signalValue! : Number(body.complaintRate ?? 0),
    landingConversionRate: signalName === "landing_conversion_rate" ? signalValue! : Number(body.landingConversionRate ?? 0),
    pipelineGrowth: signalName === "pipeline_growth" ? signalValue! : Number(body.pipelineGrowth ?? 0),
    revenueGrowth: signalName === "revenue_growth" ? signalValue! : Number(body.revenueGrowth ?? 0),
  } as Omit<MarketSignal, "id" | "workspaceId" | "marketHealthScore">);

  if (signalName) {
    appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        action_type: "market_signal_injected",
        signal_name: signalName,
        signal_value: String(body.value ?? ""),
        signal_domain: String(body.domain ?? ""),
        signal_source: String(body.source ?? "manual"),
        signal_id: signal.id,
      },
      at: new Date().toISOString(),
    } satisfies GovernanceEvent);
  }

  res.status(201).json(signal);
});

/** GET /api/v1/autonomous/signals */
autonomousCompanyRouter.get("/signals", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  res.status(200).json({ signals: listMarketSignals(workspaceId) });
});

/** POST /api/v1/autonomous/experiments */
autonomousCompanyRouter.post("/experiments", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const body = req.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const experiment: ExperimentRecord & { name?: string; domain?: string } = {
    id: randomUUID(),
    workspaceId,
    hypothesis: String(body.hypothesis ?? body.name ?? "improve conversion"),
    channel: String(body.channel ?? body.domain ?? "outbound"),
    variant: String(body.variant ?? "A"),
    cost: Number(body.cost ?? 0),
    outcomeLift: Number(body.outcomeLift ?? 0),
    roiScore: Number(body.roiScore ?? 0),
    status: "active",
    consecutiveUnderperform: 0,
    createdAt: now,
    updatedAt: now,
    name: body.name ? String(body.name) : undefined,
    domain: body.domain ? String(body.domain) : undefined,
  };
  const all = readJson<ExperimentRecord[]>(experimentsKey(workspaceId), []);
  writeJsonAtomic(experimentsKey(workspaceId), [...all, experiment]);

  const packet = buildRdExperimentPacket({
    experimentId: experiment.id,
    hypothesis: experiment.hypothesis,
    observedResult: `lift=${experiment.outcomeLift}, roi=${experiment.roiScore}`,
    outcomeLift: experiment.outcomeLift,
    roiScore: experiment.roiScore,
    consecutiveUnderperform: experiment.consecutiveUnderperform,
    confidence: Number(body.confidence ?? 0.72),
    majorFactors: Array.isArray(body.majorFactors) ? body.majorFactors.map((item) => String(item)) : undefined,
    nextActions: Array.isArray(body.nextActions) ? body.nextActions.map((item) => String(item)) : undefined
  });
  persistRdPacket(workspaceId, packet);

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "action_proposed",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { action_type: "experiment_created", experiment_id: experiment.id, hypothesis: experiment.hypothesis },
    at: now
  } satisfies GovernanceEvent);

  res.status(201).json({ experiment, packet });
});

/** GET /api/v1/autonomous/experiments */
autonomousCompanyRouter.get("/experiments", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const raw = listExperiments(workspaceId) as Array<ExperimentRecord & { name?: string; domain?: string; concludedAt?: string }>;
  const experiments = raw.map((e) => ({
    experiment_id: e.id,
    name: e.name ?? e.hypothesis,
    hypothesis: e.hypothesis,
    status: e.status,
    variant: e.variant,
    domain: e.domain ?? e.channel,
    started_at: e.createdAt,
    concluded_at: e.concludedAt ?? (e.status !== "active" ? e.updatedAt : undefined),
    result: e.status === "success" || e.status === "scaled" ? "success" : e.status === "fail" || e.status === "killed" ? "failed" : undefined,
  }));
  res.status(200).json({ experiments });
});

/** POST /api/v1/autonomous/experiments/:id/review */
autonomousCompanyRouter.post("/experiments/:id/review", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const experiment = listExperiments(workspaceId).find((e) => e.id === req.params.id);
  if (!experiment) {
    res.status(404).json({ error: "experiment not found" });
    return;
  }

  const packet = buildRdExperimentPacket({
    experimentId: experiment.id,
    hypothesis: experiment.hypothesis,
    observedResult: `review lift=${experiment.outcomeLift}, roi=${experiment.roiScore}, status=${experiment.status}`,
    outcomeLift: experiment.outcomeLift,
    roiScore: experiment.roiScore,
    consecutiveUnderperform: experiment.consecutiveUnderperform,
    majorFactors: ["experiment_outcome", "roi_signal", "underperformance_streak"]
  });
  persistRdPacket(workspaceId, packet);

  let handoffRequestId: string | null = null;
  if (packet.governance_handoff_required) {
    // Find matching chair in agent_blueprint
    type AgentBlueprintPayload = { chairs?: Array<{ chair_id: string; domain: string }> };
    const blueprintPayload = (await getArtifact(workspaceId, "agent_blueprint"))?.payload as AgentBlueprintPayload | undefined;
    const chairs = blueprintPayload?.chairs ?? [];
    const matchingChair = chairs.find((c) => c.domain === packet.recommended_owner_domain);

    if (matchingChair) {
      const boardRequest = createBoardRequest(workspaceId, {
        title: `R&D governance handoff: ${experiment.hypothesis}`,
        request: `Review experiment ${experiment.id} with stage=${packet.stage} and execute governance handoff.`,
        requestedBy: userId,
        targetChairId: matchingChair.chair_id,
        targetDomain: packet.recommended_owner_domain as BoardDomain,
        priority: "high",
        constraints: [`experiment_id:${experiment.id}`, `rd_packet:${packet.packet_id}`],
        successCriteria: ["governance decision recorded", "next actions assigned"],
        approvalRequired: true,
        riskLevel: packet.stage === "rejected" ? "high" : "medium"
      });

      await appendEvent({
        event_id: randomUUID(),
        org_id: workspaceId,
        event_type: "board_request_submitted",
        actor: userId,
        artifact_type: null,
        artifact_id: null,
        details: { request_id: boardRequest.id, source: "rd_governance_handoff", experiment_id: experiment.id },
        at: new Date().toISOString()
      } satisfies GovernanceEvent);

      transitionBoardRequest(workspaceId, boardRequest.id, "triaged", userId);
      handoffRequestId = boardRequest.id;
    }
  }

  res.status(200).json({ experiment, packet, handoff_request_id: handoffRequestId });
}));

/** POST /api/v1/autonomous/experiments/:id/deploy */
autonomousCompanyRouter.post("/experiments/:id/deploy", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const experiment = listExperiments(workspaceId).find((e) => e.id === req.params.id);
  if (!experiment) {
    res.status(404).json({ error: "experiment not found" });
    return;
  }

  const boardRequests = readJson<BoardRequestRecord[]>(boardRequestsKey(workspaceId), []);
  const handoff = boardRequests.find((r) => r.constraints.includes(`experiment_id:${experiment.id}`));
  if (!handoff) {
    res.status(409).json({ error: "governance handoff not found", requires_governance_approval: true });
    return;
  }
  if (!["approved", "executing", "completed"].includes(handoff.status)) {
    res.status(409).json({
      error: "governance approval required before deployment",
      requires_governance_approval: true,
      handoff_request_id: handoff.id,
      handoff_status: handoff.status
    });
    return;
  }

  const deployment = {
    deployment_id: `exp-deploy-${experiment.id}`,
    experiment_id: experiment.id,
    hypothesis: experiment.hypothesis,
    deployed_at: new Date().toISOString(),
    approved_request_id: handoff.id,
    approved_request_status: handoff.status
  };

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "action_executed",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { action_type: "autonomous_experiment_deployed", ...deployment },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);

  res.status(200).json({ deployed: true, deployment });
});

/** POST /api/v1/autonomous/cycle/run */
autonomousCompanyRouter.post("/cycle/run", requireRole(["admin", "operator"]), asyncHandler(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const now = new Date().toISOString();

  const signals = listMarketSignals(workspaceId);
  const latestSignal = signals[0] ?? null;
  const experimentResult = evaluateExperiments(workspaceId);
  const experiments = readJson<ExperimentRecord[]>(experimentsKey(workspaceId), []);

  let pivotEvent: PivotEvent | null = null;
  if (latestSignal && latestSignal.marketHealthScore < 45) {
    pivotEvent = createPivotEvent(workspaceId, "market_health_below_threshold");
  } else if (experimentResult.noPositiveWeeks >= 4) {
    pivotEvent = createPivotEvent(workspaceId, "no_positive_experiments_for_4_weeks");
  }

  if (pivotEvent) {
    const approval: ApprovalRecord = {
      approval_id: randomUUID(),
      org_id: workspaceId,
      action_id: `pivot:${pivotEvent.id}`,
      status: "pending",
      required_approvers: 2,
      responses: [],
      created_at: now,
      resolved_at: null
    };
    await createApproval(approval);

    await appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "approval_recorded",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: `pivot:${pivotEvent.id}`, source: "autonomy_cycle", trigger: pivotEvent.triggerReason },
      at: now
    } satisfies GovernanceEvent);
  }

  const capitalPlan = createCapitalPlan(workspaceId, experiments, {
    totalBudget: 500,
    runwayWeeks: latestSignal
      ? Math.max(4, Math.round(100 / Math.max(1, latestSignal.costPerAcquisition)))
      : 12,
    burnRate: latestSignal ? latestSignal.costPerAcquisition * 5 : 120
  });

  let shutdownReport: ShutdownReport | null = null;
  if (latestSignal && latestSignal.marketHealthScore < 30 && capitalPlan.runwayWeeks < 8) {
    shutdownReport = createShutdownReport(workspaceId, "health_below_30_and_runway_below_8_weeks");

    await appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_proposed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_type: "shutdown_recommendation_generated", reason: shutdownReport.reason },
      at: now
    } satisfies GovernanceEvent);
  }

  if (experimentResult.killed > 0 || experimentResult.scaled > 0) {
    await appendEvent({
      event_id: randomUUID(),
      org_id: workspaceId,
      event_type: "action_executed",
      actor: userId,
      artifact_type: null,
      artifact_id: null,
      details: {
        action_type: "experiment_evolution",
        killed: experimentResult.killed,
        scaled: experimentResult.scaled,
        noPositiveWeeks: experimentResult.noPositiveWeeks
      },
      at: now
    } satisfies GovernanceEvent);
  }

  // Generate RD packets for finalized experiments
  const finalizedExperiments = readJson<ExperimentRecord[]>(experimentsKey(workspaceId), []).filter(
    (e) => e.status === "scaled" || e.status === "killed"
  );
  for (const exp of finalizedExperiments) {
    const packet = buildRdExperimentPacket({
      experimentId: exp.id,
      hypothesis: exp.hypothesis,
      observedResult: `cycle lift=${exp.outcomeLift}, roi=${exp.roiScore}, status=${exp.status}`,
      outcomeLift: exp.outcomeLift,
      roiScore: exp.roiScore,
      consecutiveUnderperform: exp.consecutiveUnderperform
    });
    persistRdPacket(workspaceId, packet);
  }

  const completedAt = new Date().toISOString();
  const cycleRecord: CycleRunRecord = {
    cycle_id: randomUUID(),
    workspace_id: workspaceId,
    status: "completed",
    domains_run: ["growth", "finance", "ops"],
    actions_taken: experimentResult.killed + experimentResult.scaled,
    briefs_generated: 0,
    pivot_triggered: !!pivotEvent,
    shutdown_triggered: !!shutdownReport,
    started_at: now,
    completed_at: completedAt,
  };
  const existingCycles = readJson<CycleRunRecord[]>(cyclesKey(workspaceId), []);
  writeJsonAtomic(cyclesKey(workspaceId), [...existingCycles, cycleRecord].slice(-50));

  res.status(200).json({
    cycle_id: cycleRecord.cycle_id,
    latestSignal,
    experimentResult: {
      killed: experimentResult.killed,
      scaled: experimentResult.scaled,
      noPositiveWeeks: experimentResult.noPositiveWeeks
    },
    pivotEvent,
    capitalPlan,
    shutdownReport
  });
}));

/** GET /api/v1/autonomous/cycles */
autonomousCompanyRouter.get("/cycles", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const cycles = readJson<CycleRunRecord[]>(cyclesKey(workspaceId), []);
  res.status(200).json({ cycles: cycles.slice().reverse(), total: cycles.length });
});

/** GET /api/v1/autonomous/capital-plans */
autonomousCompanyRouter.get("/capital-plans", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const plans = readJson<CapitalAllocationPlan[]>(capitalPlansKey(workspaceId), []);
  res.status(200).json({ plans });
});

/** GET /api/v1/autonomous/pivot-events */
autonomousCompanyRouter.get("/pivot-events", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const pivots = readJson<PivotEvent[]>(pivotEventsKey(workspaceId), []);
  res.status(200).json({ pivots });
});

/** GET /api/v1/autonomous/shutdown-reports */
autonomousCompanyRouter.get("/shutdown-reports", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const reports = readJson<ShutdownReport[]>(shutdownReportsKey(workspaceId), []);
  res.status(200).json({ reports });
});

/** POST /api/v1/autonomous/memory */
autonomousCompanyRouter.post("/memory", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const body = req.body as Record<string, unknown>;
  const entry: VentureMemoryEntry = {
    id: randomUUID(),
    workspaceId,
    createdAt: new Date().toISOString(),
    icpPattern: String(body.icpPattern ?? "unknown"),
    messagingVariant: String(body.messagingVariant ?? "A"),
    pricingInsight: String(body.pricingInsight ?? "none"),
    channelEfficiency: String(body.channelEfficiency ?? "neutral"),
    timeToFirstRevenueDays: Number(body.timeToFirstRevenueDays ?? 0),
    outcome: body.outcome === "fail" ? "fail" : "success"
  };
  const all = readJson<VentureMemoryEntry[]>(ventureMemoryKey(workspaceId), []);
  writeJsonAtomic(ventureMemoryKey(workspaceId), [...all, entry]);
  res.status(201).json(entry);
});

/** GET /api/v1/autonomous/memory */
autonomousCompanyRouter.get("/memory", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const memory = readJson<VentureMemoryEntry[]>(ventureMemoryKey(workspaceId), []);
  res.status(200).json({ memory });
});
