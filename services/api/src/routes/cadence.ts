/**
 * Cadence routes — trigger and manage the board's operating cadence.
 *
 * Routes:
 *   GET  /api/v1/cadence          — current state + recent runs (used by UI)
 *   POST /api/v1/cadence/run      — trigger a cadence run (daily + weekly)
 *   GET  /api/v1/cadence/status   — get cadence state
 *   GET  /api/v1/cadence/brief    — get latest brief
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { runAgentExecution } from "../agent-runtime/execution/engine.js";
import { buildDailyPulse, buildWeeklyBrief } from "../workers/cadence.js";
import { recordCadenceRun, getCadenceState } from "../workers/scheduler.js";
import type { ArtifactsForExecution } from "../agent-runtime/execution/types.js";
import { normalizeAutonomyPolicy, normalizeAgentBlueprint, normalizeObjectiveConfig } from "../lib/artifact-normalize.js";
import { completeText, NoProviderConfiguredError } from "../lib/model-client.js";

export const cadenceRouter = Router();
cadenceRouter.use(requireContext);

// ── storage keys ──────────────────────────────────────────────────────────────

function briefKey(orgId: string): string { return `cadence-briefs/${orgId}`; }
function runsKey(orgId: string): string { return `cadence-runs/${orgId}`; }
function boardRequestsKey(orgId: string): string { return `board-requests/${orgId}`; }

function isKillSwitchEnabled(): boolean {
  return process.env.CB_KILL_SWITCH === "true";
}

// ── types ─────────────────────────────────────────────────────────────────────

type CadenceRun = {
  run_id: string;
  status: "completed" | "failed" | "running";
  brief_type: string;
  started_at: string;
  completed_at?: string;
  error?: string;
};

type Brief = {
  generated_at: string;
  daily: {
    headline: string;
    anomaly?: string;
    risk?: string;
    next_best_action: string;
    reminders: string[];
    text: string;
  };
  weekly: {
    tldr: string[];
    objective_status: { score: number; trend: string; confidence: number };
    decisions_needed: string[];
    constraints_and_risks: string[];
    recommended_plan: unknown[];
    execution_status: unknown;
    watchlist: string[];
    text: string;
    template_version: string;
    schema_version: string;
    generated_at: string;
  };
};

// ── AI brief generation ───────────────────────────────────────────────────────

async function generateAIBrief(workspaceId: string): Promise<Brief> {
  const bp = await getArtifact(workspaceId, "business_profile");
  const ab = await getArtifact(workspaceId, "agent_blueprint");

  const businessContext = bp
    ? JSON.stringify(bp.payload, null, 2).slice(0, 1500)
    : "No business profile configured.";

  const chairs = ab
    ? ((ab.payload as { chairs?: Array<{ name: string; domain: string }> }).chairs ?? [])
        .map((c) => `${c.name} (${c.domain})`)
        .join(", ")
    : "No chairs configured.";

  const systemPrompt = [
    "You are the executive briefing system for a digital board of directors.",
    "Generate a concise daily pulse and weekly executive brief based on the org context.",
    "Return valid JSON matching the schema below exactly. No extra commentary.",
    "",
    'Schema: { "daily": { "headline": string, "anomaly": string|null, "risk": string|null, "next_best_action": string, "reminders": string[] }, "weekly": { "tldr": string[], "objective_status": { "score": number (0-100), "trend": "up"|"flat"|"down", "confidence": number (0-1) }, "decisions_needed": string[], "constraints_and_risks": string[], "watchlist": string[] } }',
  ].join("\n");

  const userMessage = [
    "Business context:",
    businessContext,
    "",
    `Active board chairs: ${chairs}`,
    "",
    "Generate a brief that reflects the current state of the business and identifies any items needing attention.",
    "decisions_needed should list 1-3 concrete decisions the owner should make this week.",
    "Be specific and actionable. Use the chair names when assigning accountability.",
  ].join("\n");

  const now = new Date().toISOString();

  try {
    const raw = await completeText(workspaceId, systemPrompt, userMessage, {
      max_tokens: 1024,
      temperature: 0.3,
      correlation_id: `cadence-${workspaceId}`,
    });

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON in AI response");
    const parsed = JSON.parse(jsonMatch[0]) as {
      daily: { headline: string; anomaly?: string | null; risk?: string | null; next_best_action: string; reminders?: string[] };
      weekly: { tldr?: string[]; objective_status?: { score: number; trend: string; confidence: number }; decisions_needed?: string[]; constraints_and_risks?: string[]; watchlist?: string[] };
    };

    return {
      generated_at: now,
      daily: {
        headline: parsed.daily.headline ?? "Board briefing",
        anomaly: parsed.daily.anomaly ?? undefined,
        risk: parsed.daily.risk ?? undefined,
        next_best_action: parsed.daily.next_best_action ?? "Review priorities with the board.",
        reminders: parsed.daily.reminders ?? [],
        text: `Daily Pulse: ${parsed.daily.headline}`,
      },
      weekly: {
        tldr: parsed.weekly.tldr ?? [],
        objective_status: parsed.weekly.objective_status ?? { score: 70, trend: "flat", confidence: 0.7 },
        decisions_needed: parsed.weekly.decisions_needed ?? [],
        constraints_and_risks: parsed.weekly.constraints_and_risks ?? [],
        recommended_plan: [],
        execution_status: { approved: 0, denied: 0, blocked: 0, auto_approved: 0 },
        watchlist: parsed.weekly.watchlist ?? [],
        text: (parsed.weekly.tldr ?? []).join(" | "),
        template_version: "ai-v1",
        schema_version: "1.0",
        generated_at: now,
      },
    };
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      return await buildFallbackBrief(workspaceId, now);
    }
    throw err;
  }
}

async function buildFallbackBrief(workspaceId: string, now: string): Promise<Brief> {
  const ab = await getArtifact(workspaceId, "agent_blueprint");
  const chairs = ab
    ? ((ab.payload as { chairs?: Array<{ name: string; domain: string }> }).chairs ?? [])
    : [];
  const chairNames = chairs.map((c) => c.name);

  return {
    generated_at: now,
    daily: {
      headline: "Board is active and monitoring operations.",
      next_best_action: "Configure an inference provider in Settings to enable AI-generated briefs.",
      reminders: chairNames.length > 0 ? [`${chairNames.length} chairs available — ask the board a question to get started.`] : [],
      text: "Daily Pulse: No AI provider configured.",
    },
    weekly: {
      tldr: [
        "No inference provider configured — AI briefs unavailable.",
        `Board has ${chairNames.length} active chair${chairNames.length !== 1 ? "s" : ""}.`,
        "Configure a provider in Settings to enable autonomous briefings.",
      ],
      objective_status: { score: 0, trend: "flat", confidence: 0 },
      decisions_needed: ["Configure an AI provider in Settings to enable automated decisions."],
      constraints_and_risks: ["No inference provider configured."],
      recommended_plan: [],
      execution_status: { approved: 0, denied: 0, blocked: 0, auto_approved: 0 },
      watchlist: [],
      text: "No inference provider configured.",
      template_version: "fallback-v1",
      schema_version: "1.0",
      generated_at: now,
    },
  };
}

// ── internal run logic (called by route + scheduler) ─────────────────────────

export async function runCadence(workspaceId: string, actor: string, correlationId?: string): Promise<Brief> {
  const now = new Date().toISOString();
  const runId = randomUUID();

  const runs = readJson<CadenceRun[]>(runsKey(workspaceId), []);
  writeJsonAtomic(runsKey(workspaceId), [...runs, { run_id: runId, status: "running", brief_type: "executive", started_at: now }].slice(-50));

  let brief: Brief;

  try {
    const bp = await getArtifact(workspaceId, "business_profile");
    const oc = await getArtifact(workspaceId, "objective_config");
    const ap = await getArtifact(workspaceId, "autonomy_policy");
    const cp = await getArtifact(workspaceId, "cadence_protocol");
    const ab = await getArtifact(workspaceId, "agent_blueprint");

    const hasFullArtifacts = bp && oc && ap && cp && ab;

    if (hasFullArtifacts) {
      const runResult = runAgentExecution({
        business_profile: bp.payload as Record<string, unknown>,
        objective_config: normalizeObjectiveConfig(oc.payload as Record<string, unknown>),
        autonomy_policy:  normalizeAutonomyPolicy(ap.payload as Record<string, unknown>),
        cadence_protocol: cp.payload as Record<string, unknown>,
        agent_blueprint:  normalizeAgentBlueprint(ab.payload as Record<string, unknown>)
      } as ArtifactsForExecution);

      const daily = buildDailyPulse(runResult.actions);
      const weekly = buildWeeklyBrief(runResult.actions, { correlationId });

      brief = {
        generated_at: now,
        daily,
        weekly: {
          ...weekly,
          recommended_plan: weekly.recommended_plan as unknown[],
          execution_status: weekly.execution_status as unknown,
        },
      };
    } else {
      brief = await generateAIBrief(workspaceId);
    }
  } catch (err) {
    const completedAt = new Date().toISOString();
    const updated = readJson<CadenceRun[]>(runsKey(workspaceId), []).map((r) =>
      r.run_id === runId ? { ...r, status: "failed" as const, completed_at: completedAt, error: err instanceof Error ? err.message : String(err) } : r
    );
    writeJsonAtomic(runsKey(workspaceId), updated);
    throw err;
  }

  const completedAt = new Date().toISOString();

  // Persist brief
  const existing = readJson<Brief[]>(briefKey(workspaceId), []);
  writeJsonAtomic(briefKey(workspaceId), [...existing, brief].slice(-10));

  // Update run record to completed
  const updatedRuns = readJson<CadenceRun[]>(runsKey(workspaceId), []).map((r) =>
    r.run_id === runId ? { ...r, status: "completed" as const, completed_at: completedAt } : r
  );
  writeJsonAtomic(runsKey(workspaceId), updatedRuns);

  // Record scheduler state
  recordCadenceRun(workspaceId, "daily");
  recordCadenceRun(workspaceId, "weekly");

  // Create board requests from decisions_needed
  const decisions = brief.weekly.decisions_needed ?? [];
  if (decisions.length > 0) {
    const boardRequests = readJson<Array<Record<string, unknown>>>(boardRequestsKey(workspaceId), []);
    const newRequests = decisions.map((decision) => ({
      id: randomUUID(),
      org_id: workspaceId,
      title: decision.length > 80 ? decision.slice(0, 77) + "…" : decision,
      request: decision,
      requested_by: actor,
      target_chair_id: "",
      target_domain: "ops",
      routing_mode: "auto",
      status: "submitted",
      priority: "medium",
      constraints: [],
      deadline: undefined,
      success_criteria: [],
      dependency_ids: [],
      approval_required: false,
      risk_level: "low",
      source: "cadence",
      created_at: completedAt,
      updated_at: completedAt,
    }));
    writeJsonAtomic(boardRequestsKey(workspaceId), [...boardRequests, ...newRequests]);
  }

  await appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "action_executed",
    actor,
    artifact_type: null,
    artifact_id: null,
    details: {
      cadence_run: true,
      run_id: runId,
      brief_trend: brief.weekly.objective_status.trend,
      decisions_created: decisions.length,
    },
    at: completedAt,
  } satisfies GovernanceEvent);

  return brief;
}

// ── routes ────────────────────────────────────────────────────────────────────

/** GET /api/v1/cadence — state + recent runs (used by Briefing Schedule page) */
cadenceRouter.get("/", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const state = getCadenceState(workspaceId);
  const runs = readJson<CadenceRun[]>(runsKey(workspaceId), []);
  const briefs = readJson<Brief[]>(briefKey(workspaceId), []);

  const lastRun = runs.filter((r) => r.status === "completed").slice(-1)[0];
  const nextRunAt = state.last_daily_at
    ? new Date(new Date(state.last_daily_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  res.status(200).json({
    cadence: {
      last_run_at: lastRun?.completed_at ?? state.last_daily_at ?? null,
      next_run_at: nextRunAt,
      run_count: runs.filter((r) => r.status === "completed").length,
      status: runs.some((r) => r.status === "running") ? "running" : "idle",
      brief_count: briefs.length,
    },
    runs: runs.slice().reverse().slice(0, 20),
  });
});

/** POST /api/v1/cadence/run */
cadenceRouter.post("/run", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;

  if (isKillSwitchEnabled()) {
    res.status(423).json({ error: "workspace kill switch enabled" });
    return;
  }

  try {
    const brief = await runCadence(workspaceId, userId, req.correlationId);
    res.status(200).json({
      generated_at: brief.generated_at,
      daily: brief.daily,
      weekly: brief.weekly,
      delivery: { ok: true, channel: "persistence", attempts: 1 },
    });
  } catch (err) {
    res.status(500).json({ error: "cadence run failed", detail: err instanceof Error ? err.message : "unknown" });
  }
});

/** GET /api/v1/cadence/status */
cadenceRouter.get("/status", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const state = getCadenceState(workspaceId);
  res.status(200).json({ state });
});

/** GET /api/v1/cadence/brief */
cadenceRouter.get("/brief", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const all = readJson<Brief[]>(briefKey(workspaceId), []);
  if (all.length === 0) {
    res.status(404).json({ error: "no brief generated yet; run POST /api/v1/cadence/run" });
    return;
  }
  res.status(200).json(all[all.length - 1]);
});
