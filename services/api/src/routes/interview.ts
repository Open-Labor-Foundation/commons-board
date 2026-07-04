/**
 * Interview routes — conversational AI-driven onboarding interview.
 *
 * The API asks questions section by section; the user responds in free text;
 * AI (or simple heuristics) extracts structured payloads that feed the
 * InterviewStateMachine. The frontend contract is:
 *   start  → { session_id, prompt, current_section, sections_complete, status, complete }
 *   respond → same shape (prompt = next question, complete = true when done)
 *   confirm → write artifacts and redirect
 *
 * Routes:
 *   POST  /api/v1/interview/start        — create session, return first question
 *   POST  /api/v1/interview/:id/respond  — user message → extract → next question
 *   GET   /api/v1/interview/:id/state    — raw machine state (recovery)
 *   POST  /api/v1/interview/:id/confirm  — finalize and persist artifacts
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ArtifactType } from "@commons-board/shared";
import { InterviewStateMachine, applyCorrections } from "../agent-runtime/interview/state-machine.js";
import type { InterviewSection, InterviewAnswers } from "../agent-runtime/interview/types.js";
import { generateArtifacts } from "../agent-runtime/interview/generate-artifacts.js";
import { writeArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";
import { completeText } from "../lib/model-client.js";

export const interviewRouter = Router();

// ── session store ─────────────────────────────────────────────────────────────

interface SessionEntry {
  orgId: string;
  machine: InterviewStateMachine;
}

const sessions = new Map<string, SessionEntry>();

function getSession(sessionId: string, orgId: string): InterviewStateMachine | null {
  const entry = sessions.get(sessionId);
  if (!entry || entry.orgId !== orgId) return null;
  return entry.machine;
}

// ── section question prompts ──────────────────────────────────────────────────

const SECTION_QUESTIONS: Record<InterviewSection, string> = {
  S0: `Welcome to commons-board! Let's configure your AI board of advisors.

First: are you setting this up for a **business** or a **collective** (worker co-op, member-owned organization)?`,

  S1: `What's your organization called? Please share:
- The name
- What you do (a sentence or two)
- Your industry
- Rough team size (headcount)
- How long you've been operating (or if you're just starting out)`,

  S2: `Tell me about your structure and current focus:
- What are your main teams or departments?
- Who are the key people or roles?
- What are the top 2–3 challenges or initiatives you're working on right now?`,

  S3: `What tools and systems does your org currently use? (e.g. Slack, QuickBooks, Stripe, GitHub, Shopify…) List anything relevant. Say "none" if not applicable.`,

  S4: `What's your primary goal right now — the single most important objective? And how will you measure success? Feel free to mention specific KPIs or targets.`,

  S5: `How much autonomy should your AI board have?

- **Advisor** — makes recommendations only; you decide and execute everything
- **Orchestrator** — can coordinate tasks and agents, but needs your approval for significant actions
- **Autopilot** — operates autonomously within defined risk limits

Also: what's your risk tolerance — low, medium, or high?`,

  S6: `Briefing schedule: what timezone are you in, and when would you like your briefings?
- Daily pulse (e.g. "8:30 AM")
- Weekly summary (e.g. "Monday mornings")`,

  S7: `Hard limits — are there things the board should **never** do without your explicit sign-off? For example: "never send emails to clients", "never approve spend over $500", "never make hiring decisions". Say "none" if there are no hard limits.`,

  S8: `Since you're setting up a collective, tell me about membership:
- How many active members?
- What roles exist? (e.g. member, steward, coordinator)
- What decisions require a full member vote?`,

  S9: "", // built dynamically from collected answers
};

// ── UI section mapping (drives the frontend progress bar) ─────────────────────

// Maps machine section → frontend SECTIONS[].id
const SECTION_TO_UI: Record<InterviewSection, string> = {
  S0: "business_profile",
  S1: "business_profile",
  S2: "business_profile",
  S3: "business_profile",
  S4: "objective_config",
  S5: "autonomy_policy",
  S6: "cadence_protocol",
  S7: "autonomy_policy",
  S8: "agent_blueprint",
  S9: "agent_blueprint",
};

// A UI section is marked complete when this machine section is done
const UI_COMPLETE_AFTER: Record<string, InterviewSection> = {
  business_profile: "S3",
  objective_config:  "S4",
  cadence_protocol:  "S6",
  autonomy_policy:   "S7",
  agent_blueprint:   "S9",
};

function computeUIState(machine: InterviewStateMachine): {
  current_section: string;
  sections_complete: string[];
  complete: boolean;
} {
  const state = machine.getState();
  const done = new Set(state.completed_sections);
  const sections_complete = Object.entries(UI_COMPLETE_AFTER)
    .filter(([, ms]) => done.has(ms))
    .map(([ui]) => ui);
  return {
    current_section: SECTION_TO_UI[state.current_section] ?? "business_profile",
    sections_complete,
    complete: state.ready_to_finalize,
  };
}

// ── S9 review prompt ──────────────────────────────────────────────────────────

function buildReviewPrompt(answers: InterviewAnswers): string {
  const s0 = answers.S0 ?? {};
  const s1 = answers.S1 ?? {};
  const s2 = answers.S2 ?? {};
  const s4 = answers.S4 ?? {};
  const s5 = answers.S5 ?? {};
  const s6 = answers.S6 ?? {};
  const s7 = answers.S7 ?? {};

  const lines: string[] = ["Here's what I've captured for your board:"];
  if (s1.org_name) lines.push(`**Organization:** ${s1.org_name}${s1.description ? ` — ${s1.description}` : ""}`);
  if (s1.industry)  lines.push(`**Industry:** ${s1.industry}`);
  if (s1.size?.headcount) lines.push(`**Team size:** ${s1.size.headcount}`);
  if (s2.top_pains?.length) lines.push(`**Top challenges:** ${s2.top_pains.slice(0, 3).join(", ")}`);
  if (s4.primary_objective) lines.push(`**Primary objective:** ${s4.primary_objective}`);
  if (s5.autonomy_mode) lines.push(`**Board autonomy:** ${s5.autonomy_mode} (risk: ${s5.risk_appetite ?? "med"})`);
  if (s6.timezone) lines.push(`**Briefing:** daily ${s6.daily_run_at ?? "08:30"} · weekly ${s6.weekly_run_on ?? "monday"}s · ${s6.timezone}`);
  if (s7.never_do?.length) lines.push(`**Hard limits:** ${s7.never_do.slice(0, 3).join("; ")}`);
  lines.push(`**Governance:** ${s0.governance_mode ?? "business"}`);
  lines.push("\nDoes this look right? Type **yes** to generate your board, or describe any corrections.");
  return lines.join("\n");
}

const CORRECTIONS_SCHEMA = `{
  "S1"?: { "org_name"?: string, "industry"?: string, "description"?: string, "size"?: { "headcount"?: number } },
  "S2"?: { "top_pains"?: string[], "top_initiatives"?: string[] },
  "S4"?: { "primary_objective"?: string, "success_criteria"?: string[] },
  "S5"?: { "autonomy_mode"?: "advisor"|"orchestrator"|"autopilot", "risk_appetite"?: "low"|"med"|"high" },
  "S6"?: { "timezone"?: string, "daily_run_at"?: string, "weekly_run_on"?: string },
  "S7"?: { "never_do"?: string[] }
}`;

/** Interprets a free-text correction against the current review summary. Returns only the sections/fields the user asked to change. */
async function extractCorrections(
  workspaceId: string,
  currentAnswers: InterviewAnswers,
  message: string
): Promise<Partial<InterviewAnswers>> {
  try {
    const system = [
      "You are updating an onboarding review summary based on a user's correction request.",
      "Given the CURRENT answers (JSON) and the user's correction message, return ONLY a JSON object",
      "containing just the sections and fields that need to change, matching this schema:",
      CORRECTIONS_SCHEMA,
      "Only include a section if the user is actually asking to change something in it.",
      "Return {} if the message doesn't map to any known field. No commentary — just JSON.",
    ].join("\n");
    const prompt = `CURRENT ANSWERS:\n${JSON.stringify(currentAnswers)}\n\nUSER CORRECTION:\n${message}`;
    const raw = await completeText(workspaceId, system, prompt, { max_tokens: 500, temperature: 0.1 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return {};
    return JSON.parse(m[0]) as Partial<InterviewAnswers>;
  } catch {
    return {};
  }
}

// ── AI payload extraction ─────────────────────────────────────────────────────

async function extractWithAI<T extends object>(
  workspaceId: string,
  schema: string,
  message: string,
  fallback: T
): Promise<T> {
  try {
    const system = [
      "You are a structured data extractor for an onboarding interview.",
      "Extract information from the user response and return ONLY valid JSON matching this schema:",
      schema,
      "If information is missing or unclear, use reasonable defaults or null. No commentary — just JSON.",
    ].join("\n");
    const raw = await completeText(workspaceId, system, `User response: ${message}`, {
      max_tokens: 512,
      temperature: 0.1,
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    return { ...fallback, ...JSON.parse(m[0]) as T };
  } catch {
    return fallback;
  }
}

async function parseSection(
  workspaceId: string,
  section: InterviewSection,
  message: string
): Promise<NonNullable<InterviewAnswers[InterviewSection]>> {
  const lower = message.toLowerCase().trim();

  switch (section) {
    case "S0": {
      const isCollective =
        lower.includes("collective") || lower.includes("coop") || lower.includes("co-op") ||
        lower.includes("cooperative") || lower.includes("worker-owned") || lower.includes("member-owned");
      return { governance_mode: isCollective ? "collective" : "business" };
    }

    case "S1":
      return extractWithAI(workspaceId,
        `{ "org_name": string, "description": string, "industry": string, "primary_domain": "finance"|"ops"|"growth"|"legal"|"hr"|"product"|"it"|"security"|"strategy"|"rnd"|"sales"|"custom", "stage": string, "size": { "headcount": number|null }, "operating_since": string|null }`,
        message,
        { org_name: "My Organization", description: message.slice(0, 200), industry: "general", primary_domain: "ops" as const }
      );

    case "S2":
      return extractWithAI(workspaceId,
        `{ "teams": [{ "name": string, "function": string }], "key_roles": [{ "role": string }], "top_pains": string[], "top_initiatives": string[] }`,
        message,
        { teams: [], key_roles: [], top_pains: [message.slice(0, 100)], top_initiatives: [] }
      );

    case "S3": {
      if (lower === "none" || lower === "n/a" || lower === "no") return { systems: [] };
      const systems = message.split(/[,\n•\-–]/).map(s => s.trim()).filter(s => s.length > 1 && s.length < 60);
      return { systems };
    }

    case "S4":
      return extractWithAI(workspaceId,
        `{ "primary_objective": string, "objective_type": "revenue"|"mission"|"growth"|"sustainability"|"service"|"other", "success_criteria": string[], "kpis": [{ "name": string, "unit": string, "target_value": number|null, "reporting_cadence": "daily"|"weekly"|"monthly" }] }`,
        message,
        { primary_objective: message.slice(0, 200), objective_type: "growth" as const, success_criteria: [], kpis: [] }
      );

    case "S5": {
      let autonomy_mode: "advisor" | "orchestrator" | "autopilot" = "advisor";
      if (lower.includes("autopilot") || lower.includes("auto pilot") || lower.includes("fully autonomous")) {
        autonomy_mode = "autopilot";
      } else if (lower.includes("orchestrat")) {
        autonomy_mode = "orchestrator";
      }
      let risk_appetite: "low" | "med" | "high" = "med";
      if (/\blow\b/.test(lower) || lower.includes("conservative")) risk_appetite = "low";
      else if (/\bhigh\b/.test(lower) || lower.includes("aggressive")) risk_appetite = "high";
      return { autonomy_mode, execution_mode: "sim", risk_appetite };
    }

    case "S6":
      return extractWithAI(workspaceId,
        `{ "timezone": string (IANA e.g. "America/New_York"), "daily_run_at": string (HH:MM e.g. "08:30"), "weekly_run_on": "monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday", "weekly_run_at": string (HH:MM) }`,
        message,
        { timezone: "America/Chicago", daily_run_at: "08:30", weekly_run_on: "monday" as const, weekly_run_at: "09:00" }
      );

    case "S7": {
      if (lower === "none" || lower === "n/a" || lower === "no" || lower === "nothing") return { never_do: [] };
      const never_do = message.split(/[,\n•\-–]/).map(s => s.trim()).filter(s => s.length > 3 && s.length < 200);
      return { never_do };
    }

    case "S8":
      return extractWithAI(workspaceId,
        `{ "active_member_count": number, "member_roles": ("member"|"steward"|"coordinator"|"observer")[], "decisions_requiring_vote": string[] }`,
        message,
        { active_member_count: 0, member_roles: ["member" as const, "steward" as const], decisions_requiring_vote: [] }
      );

    case "S9":
      // handled separately in the route — should not reach here
      return { confirmed: false };
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

interviewRouter.use(requireContext);

/** POST /api/v1/interview/start */
interviewRouter.post("/start", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const sessionId = randomUUID();
  const machine = new InterviewStateMachine(sessionId, orgId);
  sessions.set(sessionId, { orgId, machine });

  const firstSection = machine.getState().current_section;
  const ui = computeUIState(machine);

  res.status(201).json({
    session_id: sessionId,
    prompt: SECTION_QUESTIONS[firstSection],
    current_section: ui.current_section,
    sections_complete: ui.sections_complete,
    status: "active",
    complete: false,
  });
});

/** POST /api/v1/interview/:id/respond */
interviewRouter.post("/:id/respond", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }

  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const state = machine.getState();
  const section = state.current_section;

  // S9 is handled separately — we only submit when the user explicitly confirms.
  if (section === "S9") {
    const lower = message.trim().toLowerCase();
    const confirmed = /\b(yes|yep|yeah|correct|confirm|confirmed|looks good|good|perfect|proceed|generate|go ahead|all good|approve|approved)\b/.test(lower);

    if (!confirmed) {
      const patch = await extractCorrections(orgId, state.answers, message.trim());
      const corrections = applyCorrections(state.answers.S9?.corrections ?? {}, patch);

      try {
        machine.submit("S9", { confirmed: false, corrections } as never);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "failed to apply correction" });
        return;
      }

      const ui = computeUIState(machine);
      const preview = applyCorrections(machine.getState().answers, corrections);
      res.status(200).json({
        session_id: req.params.id,
        prompt: buildReviewPrompt(preview),
        current_section: ui.current_section,
        sections_complete: ui.sections_complete,
        status: "active",
        complete: false,
      });
      return;
    }

    try {
      machine.submit("S9", { confirmed: true, corrections: state.answers.S9?.corrections } as never);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "failed to confirm" });
      return;
    }

    const ui = computeUIState(machine);
    res.status(200).json({
      session_id: req.params.id,
      sections_complete: ui.sections_complete,
      current_section: ui.current_section,
      status: "complete",
      complete: true,
    });
    return;
  }

  // All other sections: parse free text into structured payload and submit.
  let payload: NonNullable<InterviewAnswers[InterviewSection]>;
  try {
    payload = await parseSection(orgId, section, message.trim());
  } catch {
    payload = {} as NonNullable<InterviewAnswers[InterviewSection]>;
  }

  try {
    machine.submit(section, payload as never);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "failed to process response" });
    return;
  }

  const newState = machine.getState();
  const ui = computeUIState(machine);

  const nextPrompt = newState.current_section === "S9"
    ? buildReviewPrompt(newState.answers)
    : SECTION_QUESTIONS[newState.current_section];

  res.status(200).json({
    session_id: req.params.id,
    prompt: nextPrompt,
    current_section: ui.current_section,
    sections_complete: ui.sections_complete,
    status: "active",
    complete: false,
  });
});

/** GET /api/v1/interview/:id/state */
interviewRouter.get("/:id/state", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }
  res.status(200).json({ state: machine.getState() });
});

/** POST /api/v1/interview/:id/confirm */
interviewRouter.post("/:id/confirm", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const machine = getSession(req.params.id, orgId);
  if (!machine) {
    res.status(404).json({ error: "interview session not found" });
    return;
  }

  let result: Awaited<ReturnType<typeof machine.finalize>>;
  try {
    result = await machine.finalize();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "finalization failed" });
    return;
  }

  const written: Array<{ type: ArtifactType; version: number; artifact_id: string }> = [];
  try {
    for (const [key, payload] of Object.entries(result.artifacts)) {
      if (payload === undefined) continue;
      const type = key as ArtifactType;
      const record = writeArtifact(orgId, type, payload, actor);
      written.push({ type, version: record.version, artifact_id: record.artifact_id });
    }
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "artifact validation failed", details: err.errors });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "failed to persist artifacts" });
    return;
  }

  sessions.delete(req.params.id);

  res.status(201).json({
    assumptions: result.assumptions,
    artifacts: written,
  });
});

// ── Seed presets ──────────────────────────────────────────────────────────────

const SEED_PRESETS: Record<string, { org_id: string; answers: InterviewAnswers }> = {
  "copper-skillet": {
    org_id: "default",
    answers: {
      S0: { governance_mode: "business" },
      S1: {
        org_name: "The Copper Skillet",
        industry: "full-service restaurant",
        description: "12-person independent full-service restaurant in Austin TX. Lunch and dinner, dine-in and delivery.",
        size: { headcount: 12, member_count: null },
        location: { primary: "Austin, TX", regions: [] },
      },
      S2: {
        top_pains: [
          "food cost running at 34% — need to get it under 30%",
          "high staff turnover and onboarding overhead",
          "delivery platform reconciliation is manual and error-prone",
          "no visibility into which menu items are actually profitable",
        ],
        top_initiatives: [
          "introduce a prix-fixe menu to increase average ticket",
          "reduce food waste through better prep scheduling",
        ],
      },
      S3: {
        systems: ["Toast POS", "QuickBooks Online", "ADP payroll", "DoorDash", "Uber Eats", "7shifts scheduling", "OpenTable reservations"],
      },
      S4: {
        primary_objective: "Reduce food cost ratio from 34% to under 30% within 6 months while maintaining current revenue.",
        objective_type: "sustainability",
        success_criteria: ["food cost ratio below 30%", "delivery platform reconciliation automated", "menu profitability dashboard live"],
        kpis: [
          { name: "Food cost ratio", unit: "%", target_value: 30, reporting_cadence: "weekly" },
          { name: "Weekly revenue", unit: "USD", target_value: null, reporting_cadence: "weekly" },
          { name: "Staff turnover rate", unit: "%/year", target_value: null, reporting_cadence: "monthly" },
        ],
      },
      S5: { autonomy_mode: "advisor", execution_mode: "sim", risk_appetite: "low" },
      S6: { timezone: "America/Chicago", daily_run_at: "07:30", weekly_run_on: "monday" },
      S7: { never_do: ["make purchasing commitments without owner approval", "contact staff directly"] },
      S9: { confirmed: true },
    },
  },

  "midtown-autoworks": {
    org_id: "default",
    answers: {
      S0: { governance_mode: "business" },
      S1: {
        org_name: "Midtown Autoworks",
        industry: "automotive repair and maintenance",
        description: "8-person independent auto repair shop in Kansas City MO. General repair, diagnostics, oil changes, and brake service.",
        size: { headcount: 8, member_count: null },
        location: { primary: "Kansas City, MO", regions: [] },
      },
      S2: {
        top_pains: [
          "parts inventory costs are unpredictable — over-stocking on slow movers",
          "technician bay utilization drops 30% in slow weeks due to poor scheduling visibility",
          "customer follow-up for service reminders and recalls is entirely manual",
          "warranty claim submissions take too long and sometimes get missed",
        ],
        top_initiatives: [
          "launch a prepaid oil-change club to build recurring revenue",
          "improve online reviews to rank higher in local search",
        ],
      },
      S3: {
        systems: ["Tekmetric shop management", "QuickBooks Online", "CARFAX Service", "Google Business Profile", "Fleetio", "AutoZone Pro"],
      },
      S4: {
        primary_objective: "Increase average repair order value from $280 to $380 and grow customer retention rate to 65% within 9 months.",
        objective_type: "revenue",
        success_criteria: ["average RO above $380", "customer retention 65%+", "service reminder automation live", "parts reorder process automated"],
        kpis: [
          { name: "Average repair order value", unit: "USD", target_value: 380, reporting_cadence: "weekly" },
          { name: "Customer retention rate", unit: "%", target_value: 65, reporting_cadence: "monthly" },
          { name: "Bay utilization rate", unit: "%", target_value: 85, reporting_cadence: "weekly" },
        ],
      },
      S5: { autonomy_mode: "advisor", execution_mode: "sim", risk_appetite: "med" },
      S6: { timezone: "America/Chicago", daily_run_at: "07:00", weekly_run_on: "monday" },
      S7: { never_do: ["approve parts purchases over $500 without owner sign-off", "contact customers directly"] },
      S9: { confirmed: true },
    },
  },

  "main-street-gifts": {
    org_id: "default",
    answers: {
      S0: { governance_mode: "business" },
      S1: {
        org_name: "Main Street Gifts",
        industry: "specialty retail",
        description: "6-person independent gift and home goods shop in Bozeman MT. Mix of brick-and-mortar and Shopify e-commerce, with strong local tourism traffic.",
        size: { headcount: 6, member_count: null },
        location: { primary: "Bozeman, MT", regions: ["Northwest US e-commerce"] },
      },
      S2: {
        top_pains: [
          "inventory sync between in-store POS and Shopify causes frequent oversells",
          "seasonal cash flow swings — summer is strong, January/February are very slow",
          "losing sales to Amazon on commodity items; need to differentiate on curation and local experience",
          "email marketing is inconsistent — no real retention playbook",
        ],
        top_initiatives: [
          "grow e-commerce to 40% of total revenue within 12 months",
          "build a local loyalty program tied to tourism season",
        ],
      },
      S3: {
        systems: ["Shopify", "Square POS", "QuickBooks Online", "Klaviyo", "ShipStation", "Instagram", "Google Merchant Center"],
      },
      S4: {
        primary_objective: "Grow e-commerce from 15% to 40% of total revenue within 12 months without adding headcount.",
        objective_type: "growth",
        success_criteria: ["e-commerce 40% of revenue", "email list 2,500+ active subscribers", "inventory accuracy 98%+"],
        kpis: [
          { name: "E-commerce revenue share", unit: "%", target_value: 40, reporting_cadence: "monthly" },
          { name: "Email list size", unit: "subscribers", target_value: 2500, reporting_cadence: "monthly" },
          { name: "Inventory accuracy", unit: "%", target_value: 98, reporting_cadence: "weekly" },
        ],
      },
      S5: { autonomy_mode: "orchestrator", execution_mode: "sim", risk_appetite: "med" },
      S6: { timezone: "America/Denver", daily_run_at: "08:00", weekly_run_on: "tuesday" },
      S7: { never_do: ["publish social posts without approval", "offer discounts above 20% without owner sign-off"] },
      S9: { confirmed: true },
    },
  },

  "peak-hvac": {
    org_id: "default",
    answers: {
      S0: { governance_mode: "business" },
      S1: {
        org_name: "Peak HVAC Solutions",
        industry: "HVAC installation and service",
        description: "15-person HVAC contractor serving residential and light commercial customers in Denver CO and surrounding suburbs.",
        size: { headcount: 15, member_count: null },
        location: { primary: "Denver, CO", regions: ["Denver metro", "Boulder", "Aurora"] },
      },
      S2: {
        top_pains: [
          "technician utilization falls to 55% in shoulder seasons (spring and fall)",
          "service agreement renewal rate is only 48% — customers churn after the first year",
          "parts and refrigerant inventory costs are high; over-purchasing is common",
          "dispatching is still done by phone and whiteboard — no real-time visibility",
        ],
        top_initiatives: [
          "grow service agreement contracts from 200 to 350 by end of year",
          "implement automated maintenance reminder and renewal campaigns",
        ],
      },
      S3: {
        systems: ["ServiceTitan", "QuickBooks Online", "Google Local Services Ads", "Fleetio", "Procore (commercial projects)", "TechSee for remote diagnostics"],
      },
      S4: {
        primary_objective: "Grow service agreement base from 200 to 350 active contracts by year end while maintaining 60%+ gross margin.",
        objective_type: "revenue",
        success_criteria: ["350 active service agreements", "renewal rate above 70%", "technician utilization above 75% year-round"],
        kpis: [
          { name: "Active service agreements", unit: "contracts", target_value: 350, reporting_cadence: "monthly" },
          { name: "Renewal rate", unit: "%", target_value: 70, reporting_cadence: "monthly" },
          { name: "Technician utilization rate", unit: "%", target_value: 75, reporting_cadence: "weekly" },
          { name: "Gross margin", unit: "%", target_value: 60, reporting_cadence: "monthly" },
        ],
      },
      S5: { autonomy_mode: "orchestrator", execution_mode: "sim", risk_appetite: "med" },
      S6: { timezone: "America/Denver", daily_run_at: "06:30", weekly_run_on: "monday" },
      S7: { never_do: ["commit to equipment purchases without owner approval", "contact customers directly without dispatch confirmation"] },
      S9: { confirmed: true },
    },
  },

  "open-labor-foundation": {
    org_id: "default",
    answers: {
      S0: { governance_mode: "business" },
      S1: {
        org_name: "Open Labor Foundation",
        industry: "open-source AI infrastructure software development",
        description: "1-person open-source project building AI labor infrastructure: commons-board (AI board of directors platform), labor-commons (NAICS-seeded specialist agent catalog), and commons-crew (agent execution runtime). TypeScript/Next.js/PostgreSQL services deployed via Docker Compose across a main production stack and several demo stacks on remote infrastructure.",
        size: { headcount: 1, member_count: null },
        location: { primary: "United States", regions: ["North America"] },
        operating_since: "2026",
      },
      S2: {
        top_pains: [
          "keeping several live Docker Compose stacks (production + demo) in sync after every code change",
          "coordinating multi-step rebuild -> recreate -> reseed deploys across remote infrastructure without missing a stack",
          "LLM-generated content (chair names, board structure) drifting in quality without review",
          "security/tenant-isolation regressions slipping into API routes without a dedicated review pass",
        ],
        top_initiatives: [
          "harden security review coverage across new API routes before they ship",
          "keep demo stacks and documentation in sync with the current codebase",
        ],
      },
      S3: {
        systems: ["GitHub", "Docker", "Docker Compose", "PostgreSQL", "Featherless AI", "TypeScript", "Next.js"],
      },
      S4: {
        primary_objective: "Ship a reliable, secure commons-board platform and keep every deployed environment (production and demo stacks) correctly configured and up to date.",
        objective_type: "other",
        success_criteria: ["no unreviewed security regressions ship", "demo stacks stay in sync with the latest code", "clean TypeScript builds across all packages"],
        kpis: [],
      },
      S5: { autonomy_mode: "advisor", execution_mode: "sim", risk_appetite: "low" },
      S6: { timezone: "America/Chicago", daily_run_at: "08:00", weekly_run_on: "monday" },
      S7: { never_do: ["push directly to a shared branch without review", "deploy to production without explicit approval", "force-push or rewrite shared git history", "modify billing, payment, or credential configuration"] },
      S9: { confirmed: true },
    },
  },
};

// ── Debug: seed board from a named preset ────────────────────────────────────
// POST /api/v1/interview/seed-board
// Body: { preset?: string }
// preset defaults to "copper-skillet". Always seeds the caller's own workspace.
// Available presets: copper-skillet, midtown-autoworks, main-street-gifts, peak-hvac
interviewRouter.post("/seed-board", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const presetName = (req.body?.preset as string | undefined) ?? "copper-skillet";
  const preset = SEED_PRESETS[presetName];
  if (!preset) {
    res.status(400).json({
      error: `unknown preset "${presetName}"`,
      available: Object.keys(SEED_PRESETS),
    });
    return;
  }

  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;

  try {
    const artifacts = await generateArtifacts(preset.answers, orgId);
    const written: Array<{ type: string; version: number }> = [];
    for (const [key, payload] of Object.entries(artifacts)) {
      if (payload === undefined) continue;
      const type = key as ArtifactType;
      const record = writeArtifact(orgId, type, payload, actor);
      written.push({ type, version: record.version });
    }
    res.status(201).json({ ok: true, preset: presetName, org_id: orgId, written });
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "artifact validation failed", details: err.errors });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : "seed failed" });
  }
});

// ── Debug: test board generation with pre-set answers ───────────────────────
// POST /api/v1/interview/test-board
// Body: { answers?: InterviewAnswers, preset?: string }
// Returns: the raw agent_blueprint without persisting anything. Uses the caller's own workspace.
interviewRouter.post("/test-board", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const presetName = (req.body?.preset as string | undefined) ?? "copper-skillet";
  const preset = SEED_PRESETS[presetName] ?? SEED_PRESETS["copper-skillet"]!;

  const answers = (req.body?.answers as InterviewAnswers | undefined) ?? preset.answers;
  const orgId = req.ctx!.workspaceId;

  try {
    const artifacts = await generateArtifacts(answers, orgId);
    res.status(200).json({ org_id: orgId, preset: presetName, agent_blueprint: artifacts.agent_blueprint });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "board generation failed" });
  }
});
