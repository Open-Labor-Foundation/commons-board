/**
 * Cadence worker — builds daily pulse and weekly brief from governed action results.
 *
 * Ported from mother-board workers/cadence.ts.
 * Sanitized:
 *   - Removed SlackConnector dependency (Phase 15 connectors)
 *   - Removed level4Context (Phase 9)
 *   - Delivery is write-to-persistence + optional webhook; connector delivery Phase 15
 */
import type { GovernedAction } from "../agent-runtime/execution/types.js";

export type DailyPulse = {
  headline: string;
  anomaly?: string;
  risk?: string;
  next_best_action: string;
  reminders: string[];
  text: string;
};

export type WeeklyBrief = {
  template_version: string;
  schema_version: string;
  generated_at: string;
  correlation_id?: string;
  tldr: string[];
  objective_status: {
    score: number;
    trend: "up" | "flat" | "down";
    confidence: number;
  };
  decisions_needed: string[];
  constraints_and_risks: string[];
  recommended_plan: Array<{
    recommendation: string;
    tradeoffs: string;
    options_considered: string[];
    impact_range: { p10: number; p50: number; p90: number };
    confidence: number;
    approvals_required: number;
    blast_radius: string;
  }>;
  execution_status: {
    approved: number;
    denied: number;
    blocked: number;
    auto_approved: number;
  };
  watchlist: string[];
  text: string;
};

export type DeliveryStatus = {
  ok: boolean;
  channel: string;
  attempts: number;
  error?: string;
};

export type CadenceRunResult = {
  daily: DailyPulse;
  weekly: WeeklyBrief;
  delivery: DeliveryStatus;
};

export function buildDailyPulse(actions: GovernedAction[]): DailyPulse {
  const highestRisk = [...actions].sort((a, b) => b.risk_score - a.risk_score)[0];
  const blocked = actions.find((a) => a.governor_decision === "blocked");
  const nextBest = actions.find((a) => a.governor_decision !== "blocked");
  const reminders = actions
    .filter((a) => a.governor_decision === "requires_approval")
    .slice(0, 2)
    .map((a) => `Approval needed: ${a.action_type} (${a.agent_id})`);

  const headline = `Focus: ${nextBest?.action_type ?? "stabilize operations"}`;
  const anomaly = highestRisk ? `${highestRisk.action_type} risk=${highestRisk.risk_score}` : undefined;
  const risk = blocked ? `${blocked.action_type} blocked by policy` : undefined;
  const next_best_action = nextBest ? `${nextBest.agent_id}: ${nextBest.action_type}` : "No executable action available";

  return {
    headline,
    anomaly,
    risk,
    next_best_action,
    reminders,
    text: [
      "Daily Pulse",
      `Headline: ${headline}`,
      `Anomaly: ${anomaly ?? "none"}`,
      `Risk: ${risk ?? "none"}`,
      `Next Best Action: ${next_best_action}`,
      `Reminders: ${reminders.join("; ") || "none"}`
    ].join("\n")
  };
}

export function buildWeeklyBrief(
  actions: GovernedAction[],
  options?: {
    templateVersion?: string;
    schemaVersion?: string;
    correlationId?: string;
  }
): WeeklyBrief {
  const blocked = actions.filter((a) => a.governor_decision === "blocked").length;
  const requiringApproval = actions.filter((a) => a.governor_decision === "requires_approval").length;
  const autoApproved = actions.filter((a) => a.governor_decision === "auto_approved").length;

  const objectiveScore = Math.max(0, Math.min(100, 80 - blocked * 10 - requiringApproval * 5));
  const trend: "up" | "flat" | "down" = blocked > 1 ? "down" : requiringApproval > 1 ? "flat" : "up";
  const confidence = Number(Math.max(0.3, 0.95 - blocked * 0.12).toFixed(2));

  const topRisks = [...actions]
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, 3)
    .map((a) => `${a.action_type} risk=${a.risk_score}`);

  const decisions_needed = actions
    .filter((a) => a.governor_decision === "requires_approval")
    .slice(0, 3)
    .map((a) => `Decide approval for ${a.action_type} from ${a.agent_id}`);

  while (decisions_needed.length < 3) decisions_needed.push("No additional decision required");

  const recommended_plan = actions.slice(0, 3).map((a) => ({
    recommendation: `${a.agent_id}: ${a.action_type}`,
    tradeoffs: a.governor_decision === "requires_approval"
      ? "Execution waits for approval; competing work remains queued"
      : a.governor_decision === "blocked"
        ? "Blocked by policy; objective progress may slip"
        : "Proceed now; lower-priority work may slip",
    options_considered: [`Run ${a.action_type} this week`, `Defer ${a.action_type} by 1 sprint`],
    impact_range: a.impact_range,
    confidence: Number(Math.max(0.25, 1 - a.risk_score / 140).toFixed(2)),
    approvals_required: a.approvals_required,
    blast_radius: `${a.blast_radius.level}: ${a.blast_radius.explanation}`
  }));

  const tldr = [
    `${requiringApproval} approvals pending; ${blocked} blocked by policy`,
    `Objective trend: ${trend} with confidence ${confidence}`,
    `Top action: ${recommended_plan[0]?.recommendation ?? "none"}`
  ].map((line) => line.length > 140 ? `${line.slice(0, 137)}...` : line);

  const watchlist = actions.slice(0, 3).map((a) => `${a.action_type} execution latency`);

  return {
    template_version: options?.templateVersion ?? "exec-weekly-v1",
    schema_version: options?.schemaVersion ?? "1.0.0",
    generated_at: new Date().toISOString(),
    correlation_id: options?.correlationId,
    tldr,
    objective_status: { score: objectiveScore, trend, confidence },
    decisions_needed,
    constraints_and_risks: topRisks,
    recommended_plan,
    execution_status: { approved: requiringApproval, denied: 0, blocked, auto_approved: autoApproved },
    watchlist,
    text: [
      "Weekly Executive Brief",
      `TL;DR: ${tldr.join(" | ")}`,
      `Objective Status: score=${objectiveScore} trend=${trend} confidence=${confidence}`,
      `Approvals Needed: ${requiringApproval}`,
      `Blocked Actions: ${blocked}`,
      `Decisions Needed: ${decisions_needed.join("; ")}`,
      `Constraints/Risks: ${topRisks.join("; ") || "none"}`,
      `Recommended Plan: ${recommended_plan.map((p) => p.recommendation).join("; ") || "none"}`,
      `Watchlist: ${watchlist.join("; ") || "none"}`
    ].filter(Boolean).join("\n")
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return msg.includes("429") || msg.includes("rate limit") || msg.includes("timeout") || msg.includes("temporar");
}

export async function deliverWithBackoff(params: {
  channel: string;
  text: string;
  deliver: (channel: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  maxAttempts?: number;
  baseDelayMs?: number;
}): Promise<DeliveryStatus> {
  const maxAttempts = params.maxAttempts ?? 3;
  const baseDelayMs = params.baseDelayMs ?? 50;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const result = await params.deliver(params.channel, params.text);
      if (result.ok) return { ok: true, channel: params.channel, attempts };
      return { ok: false, channel: params.channel, attempts, error: result.error ?? "deliver returned ok=false" };
    } catch (error) {
      if (!isTransientError(error) || attempts >= maxAttempts) {
        return { ok: false, channel: params.channel, attempts, error: error instanceof Error ? error.message : String(error) };
      }
      await sleep(baseDelayMs * 2 ** (attempts - 1) + Math.floor(Math.random() * 25));
    }
  }
  return { ok: false, channel: params.channel, attempts, error: "max_attempts_exceeded" };
}
