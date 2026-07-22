/**
 * Business intelligence — evaluates capabilities and dashboards using
 * signals derived from the persistence layer.
 *
 * Ported from mother-board services/business-intelligence.ts.
 * Sanitized:
 *   - store.* → readJson() from persistence.ts
 *   - resolveModelNativeBusinessInsight → heuristic narrative generator
 *   - Level4 context removed (Phase 9)
 *   - "cio" domain removed
 */
import type { BoardDomain } from "@commons-board/shared";
import { readJson } from "../lib/persistence.js";
import { getLog } from "../lib/decision-log.js";
import { listApprovals } from "../lib/approval-store.js";
import {
  capabilityCatalog,
  dashboardCatalog,
  getCapabilityByKey,
  getDashboardByKey,
  type CapabilitySpec,
  type DashboardSpec
} from "./business-intelligence-catalog.js";

export type CapabilityEvaluation = {
  capability: CapabilitySpec;
  value: number;
  trend: "up" | "flat" | "down";
  insight: string;
  recommendations: string[];
  confidence: number;
  evidence: Array<{ signal: string; value: number }>;
};

export type DashboardEvaluation = {
  dashboard: DashboardSpec;
  score: number;
  trend: "up" | "flat" | "down";
  capabilities: CapabilityEvaluation[];
  narrative: string;
  confidence: number;
  evidence: Array<{ signal: string; value: number }>;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function trendFromValue(value: number): "up" | "flat" | "down" {
  if (value >= 67) return "up";
  if (value >= 45) return "flat";
  return "down";
}

async function workspaceSignals(workspaceId: string): Promise<Record<string, number>> {
  const approvals = await listApprovals(workspaceId);
  const requests = readJson<Array<{ status: string }>>(
    `board-requests/${workspaceId}`,
    []
  );
  const execRuns = readJson<Array<{ status: string; action_count?: number; blocked_count?: number }>>(
    `execution-runs/${workspaceId}`,
    []
  );
  const decisionLog = await getLog(workspaceId);

  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;
  const openRequests = requests.filter((r) => !["completed", "rejected"].includes(r.status)).length;
  const completedRequests = requests.filter((r) => r.status === "completed").length;
  const totalActions = execRuns.reduce((sum, r) => sum + (r.action_count ?? 0), 0);
  const totalBlocked = execRuns.reduce((sum, r) => sum + (r.blocked_count ?? 0), 0);
  const failedRuns = execRuns.filter((r) => r.status === "failed").length;

  const approvalSignal = clamp01(1 - pendingApprovals / Math.max(1, approvals.length));
  const completionSignal = clamp01(completedRequests / Math.max(1, requests.length));
  const blockRatio = clamp01(totalBlocked / Math.max(1, totalActions));
  const uptimeSignal = clamp01(1 - failedRuns / Math.max(1, execRuns.length));

  return {
    approvals_pending: pendingApprovals,
    approvals_signal: approvalSignal,
    decision_volume: decisionLog.length,
    request_open: openRequests,
    request_completed: completedRequests,
    request_completion_signal: completionSignal,
    block_ratio: blockRatio,
    worker_uptime_signal: uptimeSignal,
    event_volume: decisionLog.length
  };
}

function deriveValue(workspaceId: string, capability: CapabilitySpec, signals: Record<string, number>): number {
  const seed = stableHash(`${workspaceId}:${capability.key}`);
  const keys = Object.keys(signals);
  const sigA = signals[keys[seed % keys.length] ?? "event_volume"] ?? 0.5;
  const sigB = signals[keys[(seed >>> 3) % keys.length] ?? "request_completion_signal"] ?? 0.5;
  const base = ((seed % 1000) / 1000) * 0.35 + clamp01(sigA) * 0.4 + clamp01(sigB) * 0.25;
  return Number((clamp01(base) * 100).toFixed(1));
}

function buildInsight(
  subject: string,
  domain: BoardDomain,
  value: number,
  trend: "up" | "flat" | "down",
  signals: Record<string, number>
): { summary: string; recommendations: string[]; confidence: number } {
  const trend_word = trend === "up" ? "trending positively" : trend === "flat" ? "holding steady" : "trending downward";
  const confidence = Number(clamp01(0.62 + (value / 100) * 0.2 + signals.approvals_signal * 0.1 + signals.worker_uptime_signal * 0.08).toFixed(2));

  const summary = `${subject} (${domain.toUpperCase()}) is ${trend_word} at ${value}/100. Approval queue: ${signals.approvals_pending ?? 0} pending. Decision volume: ${signals.decision_volume ?? 0} entries.`;

  const recommendations = trend === "up"
    ? [`Maintain current execution cadence for ${domain.toUpperCase()}`, "Document what is working for institutional memory"]
    : trend === "down"
      ? [`Escalate ${domain.toUpperCase()} blockers to board for governance review`, "Review pending approvals and clear backlog"]
      : [`Monitor ${domain.toUpperCase()} signals weekly`, "Consider increasing automation coverage to improve throughput"];

  return { summary, recommendations, confidence };
}

export async function evaluateCapability(workspaceId: string, capability: CapabilitySpec): Promise<CapabilityEvaluation> {
  const signals = await workspaceSignals(workspaceId);
  const value = deriveValue(workspaceId, capability, signals);
  const trend = trendFromValue(value);
  const { summary, recommendations, confidence } = buildInsight(capability.name, capability.domain, value, trend, signals);
  return {
    capability,
    value,
    trend,
    insight: summary,
    recommendations,
    confidence,
    evidence: [
      { signal: "signal_value", value: Number((value / 100).toFixed(3)) },
      { signal: "request_completion_signal", value: Number(signals.request_completion_signal.toFixed(3)) },
      { signal: "worker_uptime_signal", value: Number(signals.worker_uptime_signal.toFixed(3)) },
      { signal: "approvals_signal", value: Number(signals.approvals_signal.toFixed(3)) }
    ]
  };
}

export async function evaluateCapabilities(workspaceId: string): Promise<CapabilityEvaluation[]> {
  const results = await Promise.all(capabilityCatalog.map((c) => evaluateCapability(workspaceId, c)));
  return results;
}

export async function evaluateDashboard(workspaceId: string, dashboard: DashboardSpec): Promise<DashboardEvaluation> {
  const capabilities = await Promise.all(dashboard.capabilityIds
    .map((id) => capabilityCatalog.find((c) => c.id === id))
    .filter((c): c is CapabilitySpec => Boolean(c))
    .map((c) => evaluateCapability(workspaceId, c)));

  const score = Number((capabilities.reduce((sum, c) => sum + c.value, 0) / Math.max(1, capabilities.length)).toFixed(1));
  const trend = trendFromValue(score);
  const avgConfidence = Number((capabilities.reduce((sum, c) => sum + c.confidence, 0) / Math.max(1, capabilities.length)).toFixed(2));
  const narrative = `${dashboard.name} score: ${score}/100 (${trend}). ${capabilities.length} capabilities evaluated across ${dashboard.domain.toUpperCase()}. Average confidence: ${(avgConfidence * 100).toFixed(0)}%.`;

  return {
    dashboard,
    score,
    trend,
    capabilities,
    narrative,
    confidence: avgConfidence,
    evidence: [
      { signal: "dashboard_score", value: Number((score / 100).toFixed(3)) },
      { signal: "capability_count", value: Number((capabilities.length / 12).toFixed(3)) },
      { signal: "avg_confidence", value: avgConfidence }
    ]
  };
}

export async function evaluateDashboardByKey(workspaceId: string, key: string): Promise<DashboardEvaluation | null> {
  const dashboard = getDashboardByKey(key);
  if (!dashboard) return null;
  return evaluateDashboard(workspaceId, dashboard);
}

export async function evaluateCapabilityByKey(workspaceId: string, key: string): Promise<CapabilityEvaluation | null> {
  const capability = getCapabilityByKey(key);
  if (!capability) return null;
  return evaluateCapability(workspaceId, capability);
}

export { capabilityCatalog, dashboardCatalog };
