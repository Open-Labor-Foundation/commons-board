import { CURRENT_ARTIFACT_SCHEMA_VERSION } from "@commons-board/shared";
import type { GovernanceModeValue, InterviewAnswers, InterviewArtifacts, MemberRole } from "./types.js";
import { searchBySections, getSpecialist } from "../../lib/labor-commons-client.js";
import { getProviderConcurrency, mapConcurrent } from "../../lib/model-client.js";
import { completeJsonWithRetry } from "../../lib/model-json.js";
import { registerChair, syncOrgAutonomyTier, sanitizeForLog, type CommonsCrewChairRole } from "../../lib/commons-crew-client.js";
import { getArtifact } from "../../lib/artifact-store.js";

// commons-board's onboarding always produces exactly these seven ui_domain
// values (see CHAIR_CONTEXT_SYSTEM below and its guaranteed-domain fallback
// list) -- this maps each onto commons-crew's fixed v1 CHAIR_ROLES set.
export const UI_DOMAIN_TO_CHAIR_ROLE: Record<string, CommonsCrewChairRole> = {
  finance: "finance",
  ops: "operations",
  hr: "hr",
  growth: "marketing",
  legal: "legal",
  it: "it",
  security: "security",
};

function def<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

// completeJsonWithRetry's validation only checks structural shape (is this
// an object, does it have the right field names/array-ness) -- it doesn't
// deep-check that every field matches the exact JSON Schema type each
// artifact requires. Caught live: the model returned operating_since as
// the JSON number 2026 (S1 said "operating since 2026"), which passed
// extraction and the review step fine, then failed writeArtifact's schema
// validation at the very last step of a multi-minute generation run --
// discarding all of it, including the real, successful chair/worker
// inference calls that had already completed. Coerce at the one point
// each field actually meets its schema-typed destination, rather than
// trying to make every extraction schema perfectly self-enforcing.
function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return String(value);
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function riskThreshold(appetite: "low" | "med" | "high" | undefined): number {
  if (appetite === "low") return 40;
  if (appetite === "high") return 80;
  return 60;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ChairContext = {
  name: string;
  function: string;
  ui_domain: string;
  has_workers: boolean;
};

type WorkerSelection = {
  chair: ChairContext;
  workers: Array<{ slug: string; catalog_path: string }>;
};

// ── Org summary ───────────────────────────────────────────────────────────────

function buildOrgSummary(answers: InterviewAnswers): string {
  const s1 = answers.S1 ?? {};
  const s2 = answers.S2 ?? {};
  const s3 = answers.S3 ?? {};
  const s4 = answers.S4 ?? {};
  const parts: string[] = [];
  if (s1.org_name) parts.push(`Name: ${s1.org_name}`);
  if (s1.industry) parts.push(`Industry: ${s1.industry}`);
  if (s1.description) parts.push(`Description: ${s1.description}`);
  if (s1.size?.headcount) parts.push(`Employees: ${s1.size.headcount}`);
  if (s1.location?.primary) parts.push(`Location: ${s1.location.primary}`);
  if (s3.systems?.length) parts.push(`Systems in use: ${s3.systems.join(", ")}`);
  if (s2.top_pains?.length) parts.push(`Top challenges: ${s2.top_pains.join("; ")}`);
  if (s2.top_initiatives?.length) parts.push(`Current initiatives: ${s2.top_initiatives.join("; ")}`);
  if (s4.primary_objective) parts.push(`Primary objective: ${s4.primary_objective}`);
  if (s4.success_criteria?.length) parts.push(`Success criteria: ${s4.success_criteria.join("; ")}`);
  if (s4.constraints?.length) parts.push(`Constraints: ${s4.constraints.join("; ")}`);
  return parts.join("\n");
}

// ── Industry & domain → catalog section mapping ───────────────────────────────

function isFinancialBusiness(industry: string): boolean {
  return /financ|bank|credit|insurance|investment|capital market|lend/.test(industry.toLowerCase());
}
function isTechBusiness(industry: string): boolean {
  return /software|saas|tech company|platform|digital product/.test(industry.toLowerCase());
}

function industrySections(industry: string): string[] {
  const lower = industry.toLowerCase();
  if (/restaurant|food|dining|cafe|bar|catering/.test(lower)) return ["food-service-and-restaurants"];
  if (/retail|shop|store|boutique|gift/.test(lower)) return ["grocery-and-food-retail", "consumer-packaged-goods"];
  if (/hvac|plumb|electric|mechanical|contractor/.test(lower)) return ["home-services-and-field-consumer-services", "construction-and-field-services"];
  if (/auto|car|vehicle|mechanic|repair/.test(lower)) return ["automotive-and-mobility", "home-services-and-field-consumer-services"];
  if (/health|medical|clinic|dental|pharma/.test(lower)) return ["hospitals-and-health-systems", "ambulatory-and-physician-services"];
  if (/hotel|hospitality|travel|lodging/.test(lower)) return ["hospitality-and-travel", "accommodation-and-travel-services"];
  return [];
}

// Hardcoded domain → catalog sections. No LLM guessing here.
//
// Every case includes exactly one catalog/function-overlays/ section
// alongside the naics-overlays industry sections. A chair needs generic
// corporate-function depth (FP&A/treasury/AP-AR for finance, not an
// industry-vertical operational specialist) -- without this, chair
// matching only ever searched industry verticals, so the specialty type
// a chair actually needs was never in the search scope at all.
function sectionsByDomain(uiDomain: string, industry: string): string[] {
  const fin = isFinancialBusiness(industry);
  const tech = isTechBusiness(industry);
  const indSecs = industrySections(industry);

  switch (uiDomain) {
    case "finance":
      return fin
        ? ["accounting-tax-and-audit-services", "financial-services", "capital-markets-and-asset-management", "finance"]
        : ["accounting-tax-and-audit-services", "finance"];

    case "ops":
      return [...new Set([...indSecs, "administrative-support-and-business-services", "facilities-services-and-building-operations", "operations"])];

    case "hr":
      // No industry sections — prevents ops workers from bleeding in; function text drives specificity
      return ["administrative-support-and-business-services", "human-resources"];

    case "growth":
      return [...new Set([...indSecs, "advertising-media-buying-and-agency-services", "marketing"])];

    case "it":
    case "product":
      return tech
        ? ["it-service-management-and-support", "business-applications-and-enterprise-platforms", "cloud-platform-and-infrastructure", "software-engineering-and-application-delivery", "data-analytics-and-ai"]
        : ["it-service-management-and-support", "data-analytics-and-ai"]; // ITSM only for non-tech; avoids enterprise middleware specialists

    case "legal":
      return ["governance-risk-compliance-and-commercial-control", "legal-and-compliance"];

    case "security":
      return ["cybersecurity", "governance-risk-compliance-and-commercial-control", "security-and-risk"];

    case "strategy":
      return [...new Set([...indSecs, "administrative-support-and-business-services", "chief-executive-and-strategy"])];

    case "sales":
      return [...new Set([...indSecs, "advertising-media-buying-and-agency-services", "sales-and-revenue"])];

    default:
      return [...new Set([...indSecs, "administrative-support-and-business-services"])];
  }
}

// IT governance slugs that don't belong on legal/security chairs for non-tech businesses
const IT_GOV_SLUG = /^(it-|software-asset-|enterprise-architecture-|finops-|itsm-|cloud-)/;

// ── Chair contextualization (LLM's only job) ──────────────────────────────────

const CHAIR_CONTEXT_SYSTEM = `You are configuring an advisory board for a specific small business.

Every board always has exactly these six domain seats: Finance, Operations, HR, Growth, Technology, and Legal+Security.

Your task for each seat:
- Write a name specific to what this seat actually does for THIS business — not a generic department label like "Finance", and never the industry or business type (e.g. never "Restaurant Finance", "HVAC Ops", "Auto Shop HR"). The user already knows what industry they're in; repeating it in every seat name adds nothing and doesn't distinguish one seat from another. Name each seat by its concrete concern instead, e.g. "Cash Flow & Food Cost Control", "Prep Scheduling & Waste Reduction", "Technician Retention & Scheduling".
- Write a one-sentence function description anchored in this business's actual work, systems, and challenges
- Set has_workers to false ONLY if this domain has genuinely zero applicability (extremely rare)
- Set ui_domain to exactly one of: finance, ops, hr, growth, it, legal, security

Domain-specific naming rules:
- Finance: name must be built ONLY from this fixed list of financial concerns — bookkeeping, cash flow, tax compliance, pricing margins, payroll, revenue tracking, expense budgeting. Do not pull other wording from the business's pain points or initiatives into the Finance name, even if it has a cost angle. Hard rule: the words inventory, parts, dispatch, scheduling, and stocking never appear in the Finance name — those are Ops concerns, even when the underlying pain point is about cost (e.g. "over-stocking on slow-moving parts" is an Ops naming source, not Finance). Good examples: "Cash Flow & Food Cost Control", "Pricing Margins & Tax Compliance", "Payroll & Bookkeeping". Bad examples (industry-prefixed, not specific): "Restaurant Finance & Bookkeeping", "HVAC Business Finance & Cash Flow". Bad examples (Ops language leaking into Finance): "Parts Inventory Cost Control & Cash Flow Management", "Inventory Spend Optimization & Cash Flow".
- HR: name must reflect workforce — hiring, retention, scheduling, training, culture. Not operational delivery.
- Legal: function must focus on employment law, vendor contracts, licensing, liability, industry-specific regulatory compliance. Do NOT mention IT governance, data architecture, or cybersecurity (those belong in IT or Security).
- Security (if split from Legal): physical security, data protection policy, and business risk controls.

For Legal+Security: decide whether to combine them (one entry, ui_domain "legal") or split into two entries (ui_domain "legal" and ui_domain "security"). Most small service businesses get one combined chair.

Return ONLY valid JSON array — no prose, no markdown fences:
[
  {"name":"...","function":"...","ui_domain":"finance","has_workers":true},
  {"name":"...","function":"...","ui_domain":"ops","has_workers":true},
  {"name":"...","function":"...","ui_domain":"hr","has_workers":true},
  {"name":"...","function":"...","ui_domain":"growth","has_workers":true},
  {"name":"...","function":"...","ui_domain":"it","has_workers":true},
  {"name":"...","function":"...","ui_domain":"legal","has_workers":true}
]`;

function fallbackChair(uiDomain: string, industry: string): ChairContext {
  const names: Record<string, string> = {
    finance: "Financial Planning & Cost Control",
    ops: "Operations & Service Delivery",
    hr: "People & Workforce Management",
    growth: "Growth & Customer Retention",
    it: "Technology & Systems Management",
    legal: "Legal, Risk & Compliance",
    security: "Security & Risk Management",
  };
  const fns: Record<string, string> = {
    finance: `Manage bookkeeping, tax, and financial health for this ${industry} business.`,
    ops: `Oversee day-to-day operations, scheduling, and service delivery.`,
    hr: `Handle staffing, scheduling, onboarding, and workforce management.`,
    growth: `Drive customer acquisition, retention, and revenue growth.`,
    it: `Manage technology systems, software, and data operations.`,
    legal: `Ensure legal compliance, contracts, and risk management.`,
    security: `Manage security posture and risk controls.`,
  };
  return {
    name: names[uiDomain] ?? uiDomain,
    function: fns[uiDomain] ?? `Advise on ${uiDomain}.`,
    ui_domain: uiDomain,
    has_workers: true,
  };
}

function isChairContextArray(parsed: unknown): parsed is ChairContext[] {
  return Array.isArray(parsed) && parsed.length >= 5 && parsed.every(c =>
    typeof c === "object" && c !== null &&
    typeof (c as ChairContext).name === "string" &&
    typeof (c as ChairContext).function === "string" &&
    typeof (c as ChairContext).ui_domain === "string"
  );
}

async function inferChairContexts(
  answers: InterviewAnswers,
  orgId: string
): Promise<ChairContext[]> {
  const industry = answers.S1?.industry ?? "general";
  const orgSummary = buildOrgSummary(answers);
  const prompt = `BUSINESS:\n${orgSummary}\n\nConfigure the six advisory board seats for this business.`;

  try {
    // Match specifically a JSON array of objects: [{...}] — avoids collisions with [bracket] notation in prose
    // Live evidence (same failure class as worker-selection below): this
    // reasoning model can spend its whole budget on internal reasoning
    // before emitting the answer, coming back with an empty, truncated
    // response (finish_reason=length) rather than the six-seat JSON array.
    const contexts = await completeJsonWithRetry(
      orgId, CHAIR_CONTEXT_SYSTEM, prompt,
      { max_tokens: 3200, temperature: 0.2 },
      /\[\s*\{[\s\S]*\}\s*\]/,
      isChairContextArray
    );

    // Guarantee the five non-negotiable domains are present
    const present = new Set(contexts.map(c => c.ui_domain));
    for (const required of ["finance", "ops", "hr", "growth", "it"] as const) {
      if (!present.has(required)) contexts.push(fallbackChair(required, industry));
    }
    // Guarantee at least one of legal/security
    if (!present.has("legal") && !present.has("security")) {
      contexts.push(fallbackChair("legal", industry));
    }

    return contexts;
  } catch (err) {
    const errText = err instanceof Error ? err.message : String(err);
    console.error(`[chair-context] failed for org=${sanitizeForLog(orgId)}: ${errText}`);
    return ["finance", "ops", "hr", "growth", "it", "legal"].map(d => fallbackChair(d, industry));
  }
}

// ── Worker search: code retrieves candidates, LLM decides which are actually needed ──

// Retrieval is still code: searchBySections' lexical/specialization ranking
// narrows an entire catalog section down to a manageable candidate pool --
// no LLM could reasonably be handed the unfiltered catalog. But which of
// those candidates a *specific seat* actually needs, for *this* business,
// is a judgment call, not a fixed cutoff -- that's the part that was
// missing. A one-person volunteer-run software foundation and a 50-person
// restaurant chain shouldn't get the same size roster just because both
// searches happened to return enough hits to fill a fixed count.
const WORKER_SELECTION_SYSTEM = `You are staffing one advisory-board seat with real specialists from a catalog, for one specific business.

You'll get the seat's name and function, the business's real profile, and a list of candidate specialists already narrowed by a lexical/relevance search (slug, name, domain, task coverage against this business's description, definition boundary quality, freshness).

Decide which candidates this specific seat actually needs to do its job well for THIS business -- not a fixed number, not "as many as possible." Select as many or as few as are genuinely relevant. Omit anything that's a weak or tangential fit even if the search ranked it highly -- lexical similarity is not the same thing as actual need. Never invent a slug that isn't in the candidate list; never select zero if at least one candidate is genuinely relevant.

Return ONLY valid JSON -- no prose, no markdown fences:
{"selected": [{"slug": "...", "reason": "one short phrase"}]}`;

type WorkerSelectionResponse = { selected: Array<{ slug: string }> };

function isWorkerSelectionResponse(parsed: unknown): parsed is WorkerSelectionResponse {
  return typeof parsed === "object" && parsed !== null &&
    Array.isArray((parsed as WorkerSelectionResponse).selected) &&
    (parsed as WorkerSelectionResponse).selected.every(s => typeof s === "object" && s !== null && typeof s.slug === "string");
}

async function selectRelevantWorkers(
  chair: ChairContext,
  orgId: string,
  orgSummary: string,
  candidates: Awaited<ReturnType<typeof searchBySections>>
): Promise<Array<{ slug: string; catalog_path: string }>> {
  if (candidates.length === 0) return [];

  const candidateList = candidates.slice(0, 30).map(c => ({
    slug: c.specialist_slug,
    name: c.display_name,
    domain: c.domain_family,
    task_coverage: c.task_coverage,
    boundary_quality: c.boundary_quality,
    freshness: c.freshness_status,
  }));

  const prompt = `SEAT: ${chair.name} -- ${chair.function}\n\nBUSINESS:\n${orgSummary}\n\nCANDIDATES:\n${JSON.stringify(candidateList, null, 2)}\n\nWhich of these candidates does this seat actually need?`;

  const fallbackToTopRanked = (reason: string) => {
    // Single-argument form deliberately: with a second arg present, Node's
    // console.error treats the first string as a printf-style format
    // string, and chair.ui_domain/orgId aren't sanitized against "%".
    console.error(`[worker-selection] ${reason} for chair=${sanitizeForLog(chair.ui_domain)} org=${sanitizeForLog(orgId)}, falling back to top-ranked candidates.`);
    const seen = new Set<string>();
    const workers: Array<{ slug: string; catalog_path: string }> = [];
    for (const c of candidates) {
      if (seen.has(c.specialist_slug) || workers.length >= 12) continue;
      seen.add(c.specialist_slug);
      workers.push({ slug: c.specialist_slug, catalog_path: c.catalog_path });
    }
    return workers;
  };

  try {
    const parsed = await completeJsonWithRetry(
      orgId, WORKER_SELECTION_SYSTEM, prompt,
      // Live evidence: 1200 was enough for chair-context (a much shorter
      // prompt) but a reasoning model working through 30 real, differentiated
      // catalog candidates routinely spent the whole budget on internal
      // reasoning and never reached the final JSON -- every worker-selection
      // call in a real run failed this way. 4000 gives real headroom.
      { max_tokens: 4000, temperature: 0.2 },
      /\{[\s\S]*\}/,
      isWorkerSelectionResponse
    );

    const bySlug = new Map(candidates.map(c => [c.specialist_slug, c]));
    const seen = new Set<string>();
    const workers: Array<{ slug: string; catalog_path: string }> = [];
    for (const { slug } of parsed.selected) {
      const c = bySlug.get(slug);
      // Ignore hallucinated slugs (not in the offered candidate list) rather
      // than trusting the model to only ever pick from what it was given.
      if (!c || seen.has(slug) || workers.length >= 15) continue;
      seen.add(slug);
      workers.push({ slug: c.specialist_slug, catalog_path: c.catalog_path });
    }
    if (workers.length === 0) return fallbackToTopRanked("model selected zero valid candidates");
    return workers;
  } catch (err) {
    return fallbackToTopRanked(err instanceof Error ? err.message : String(err));
  }
}

async function populateChairWorkers(
  chair: ChairContext,
  industry: string,
  orgId: string,
  orgSummary: string
): Promise<WorkerSelection> {
  if (!chair.has_workers) return { chair, workers: [] };

  const sections = sectionsByDomain(chair.ui_domain, industry);
  let results: Awaited<ReturnType<typeof searchBySections>> = [];
  try {
    results = await searchBySections(sections, chair.function, industry);
  } catch {
    return { chair, workers: [] };
  }

  // For legal/security chairs on non-tech businesses, drop IT governance specialists
  // before the model ever sees them -- a domain-correctness filter, not a relevance judgment.
  const filterItGov = ["legal", "security"].includes(chair.ui_domain) && !isTechBusiness(industry);
  const candidates = filterItGov
    ? results.filter(m => !IT_GOV_SLUG.test(m.specialist_slug))
    : results;

  const workers = await selectRelevantWorkers(chair, orgId, orgSummary, candidates);
  return { chair, workers };
}

// ── Governance ────────────────────────────────────────────────────────────────

function approvalKeysForDomain(uiDomain: string): string[] {
  switch (uiDomain) {
    case "finance":   return ["financial_spend_above_threshold"];
    case "legal":     return ["external_write", "regulatory_commitment"];
    case "security":  return ["external_write", "regulatory_commitment"];
    case "hr":        return ["hiring_decisions", "external_write"];
    default:          return ["external_write"];
  }
}

type ChairRefsAndWorkers = {
  labor_commons_refs: Array<{ specialist_slug: string; catalog_path: string; role: "primary" | "supporting"; pinned_ref: null }>;
  owns: string[];
  refuses: string[];
  worker_agents: Array<{ agent_id: string; name: string; labor_commons_ref: string | null; task_scope: string[] }>;
};

// Turns a chair's selected workers into the catalog-backed refs/scope/agents
// a blueprint chair needs. Pulled out of buildBlueprintChairs so a single
// chair's roster can be rebuilt (regenerateChairWorkers below) with the
// exact same real logic, not a re-implementation of it.
async function buildChairRefsAndWorkers(
  chair: ChairContext,
  chair_id: string,
  workers: Array<{ slug: string; catalog_path: string }>
): Promise<ChairRefsAndWorkers> {
  const refuses: string[] = [];
  const owns: string[] = [];
  const labor_commons_refs: ChairRefsAndWorkers["labor_commons_refs"] = [];
  const worker_agents: ChairRefsAndWorkers["worker_agents"] = [];

  for (let i = 0; i < workers.length; i++) {
    const { slug, catalog_path } = workers[i];
    const spec = await getSpecialist(slug).catch(() => null);

    labor_commons_refs.push({ specialist_slug: slug, catalog_path, role: i === 0 ? "primary" : "supporting", pinned_ref: null });
    worker_agents.push({
      agent_id: `${chair_id}-worker-${i + 1}`,
      name: spec?.metadata.name ?? slug,
      labor_commons_ref: slug,
      task_scope: (spec?.scope.supported_tasks ?? []).slice(0, 5),
    });

    if (spec?.metadata.specialty_boundary) {
      const b = spec.metadata.specialty_boundary.slice(0, 120);
      if (!owns.includes(b)) owns.push(b);
    }
    for (const rule of spec?.scope.out_of_scope_rules ?? []) {
      if (!refuses.includes(rule)) refuses.push(rule);
    }
  }

  if (worker_agents.length === 0) {
    worker_agents.push({ agent_id: `${chair_id}-worker-1`, name: `${chair.name} Advisor`, labor_commons_ref: null, task_scope: [] });
    owns.push(chair.function);
  }

  return { labor_commons_refs, owns, refuses: refuses.slice(0, 10), worker_agents };
}

async function buildBlueprintChairs(
  selections: WorkerSelection[],
  orgContext: string
): Promise<Array<{
  chair_id: string;
  name: string;
  domain: string;
  description: string;
  labor_commons_refs: Array<{ specialist_slug: string; catalog_path: string; role: "primary" | "supporting"; pinned_ref: null }>;
  scope: { owns: string[]; refuses: string[]; escalates_to: string[] };
  worker_agents: Array<{ agent_id: string; name: string; labor_commons_ref: string | null; task_scope: string[] }>;
  approval_required_for: string[];
  commons_crew_run_id: string | null;
  commons_crew_session_id: string | null;
}>> {
  const allChairNames = selections.map(s => s.chair.name);

  return Promise.all(selections.map(async (sel, chairIdx) => {
    const chair_id = `chair-${chairIdx + 1}`;
    const { chair, workers } = sel;

    const { labor_commons_refs, owns, refuses, worker_agents } = await buildChairRefsAndWorkers(chair, chair_id, workers);

    // Only escalate to chairs actually on this board — a raw catalog slug with
    // no chair backing it isn't something a governance consumer can route to.
    const escalates_to: string[] = [];
    for (const { slug } of workers) {
      const spec = await getSpecialist(slug).catch(() => null);
      for (const adj of spec?.adjacent_specialties ?? []) {
        const matchingChair = allChairNames.find((_, idx) => selections[idx].workers.some(w => w.slug === adj));
        if (matchingChair && !escalates_to.includes(matchingChair)) escalates_to.push(matchingChair);
      }
    }

    // Register this chair as a real commons-crew run -- governance identity
    // (audit trail, autonomy tiers, delegate_to_child capability), separate
    // from the specialist preview picked above. Non-fatal: commons-crew
    // isn't guaranteed to be deployed alongside every commons-board instance.
    const chairRole = UI_DOMAIN_TO_CHAIR_ROLE[chair.ui_domain];
    const registered = chairRole
      ? await registerChair({ orgContext, chairRole, surface: "web", title: chair.name })
      : null;

    return {
      chair_id,
      name: chair.name,
      domain: chair.ui_domain,
      description: chair.function,
      labor_commons_refs,
      scope: { owns, refuses, escalates_to },
      worker_agents,
      approval_required_for: approvalKeysForDomain(chair.ui_domain),
      commons_crew_run_id: registered?.runId ?? null,
      commons_crew_session_id: registered?.sessionId ?? null,
    };
  }));
}

// ── Agent blueprint ───────────────────────────────────────────────────────────

async function buildAgentBlueprint(
  answers: InterviewAnswers,
  orgId: string
): Promise<{ chairs: Awaited<ReturnType<typeof buildBlueprintChairs>> }> {
  const industry = answers.S1?.industry ?? "general";
  const orgSummary = buildOrgSummary(answers);

  // Step 1: LLM contextualizes chair names + functions (guaranteed domains, legal/security split)
  const chairContexts = await inferChairContexts(answers, orgId);

  // Step 2: code retrieves a candidate pool per domain (lexical/relevance
  // search), LLM decides which of those candidates this specific seat
  // actually needs for this business -- see selectRelevantWorkers. Bounded
  // to the real concurrency budget (maxParallel = floor(lanes/cost) --
  // e.g. a 4-lane key with a 4-lane-cost model is exactly 1 concurrent
  // call, not 4). This alone wasn't sufficient live: complete() (model-
  // client.ts) previously had no *global* concurrency gate, so this loop
  // could correctly bound itself to its own maxParallel and still lose a
  // race against a completely unrelated concurrent request (a scheduled
  // cadence job, a chat request) hitting the same provider at the same
  // moment -- exactly what produced the malformed/truncated responses
  // this was chasing, not clean 429s every time. Fixed at the actual
  // choke point instead: complete() now gates on a real, global,
  // provider-keyed semaphore every caller shares, so bounding here is
  // correct and sufficient again rather than needing to hardcode a
  // pessimistic value.
  const { maxParallel } = await getProviderConcurrency(orgId);
  const selections = await mapConcurrent(chairContexts, maxParallel, chair =>
    populateChairWorkers(chair, industry, orgId, orgSummary)
  );

  // Step 3: Assemble with governance from specs
  const orgContext = answers.S1?.org_name ?? orgId;

  // Sync this org's chosen autonomy mode to commons-crew before any chair is
  // registered below, so a chair's first delegate_to_child proposal already
  // reflects the org's real setting rather than commons-crew's fail-closed
  // "advisor" default. Non-fatal: see syncOrgAutonomyTier.
  await syncOrgAutonomyTier(orgContext, def(answers.S5?.autonomy_mode, "advisor" as const));

  const chairs = await buildBlueprintChairs(selections, orgContext);
  return { chairs };
}

export class ChairNotFoundError extends Error {
  constructor(uiDomain: string) {
    super(`no chair with domain "${uiDomain}" on the current board`);
    this.name = "ChairNotFoundError";
  }
}

/**
 * Rebuild one chair's specialist roster (worker-selection only) without
 * re-running chair naming, the other five chairs' rosters, or commons-crew
 * registration for any chair. For when one chair's worker-selection call
 * failed live (a real, observed 429/truncation fallback) and a user wants
 * just that seat re-decided, not the whole board re-rolled.
 *
 * escalates_to and commons_crew_run_id/session_id are preserved from the
 * existing chair rather than recomputed: both depend on knowing the *other*
 * five chairs' rosters, which a single-chair rebuild doesn't have.
 */
export async function regenerateChairWorkers(
  orgId: string,
  uiDomain: string
): Promise<Awaited<ReturnType<typeof buildBlueprintChairs>>[number]> {
  const blueprint = await getArtifact(orgId, "agent_blueprint");
  const chairs = (blueprint?.payload as { chairs?: Array<Record<string, unknown>> } | undefined)?.chairs ?? [];
  const existing = chairs.find(c => c.domain === uiDomain);
  if (!existing) throw new ChairNotFoundError(uiDomain);

  const profile = await getArtifact(orgId, "business_profile");
  const p = (profile?.payload ?? {}) as Record<string, unknown>;
  const answers: InterviewAnswers = {
    S1: {
      org_name: typeof p.org_name === "string" ? p.org_name : undefined,
      description: typeof p.description === "string" ? p.description : undefined,
      industry: typeof p.industry === "string" ? p.industry : "general",
      size: (p.size as { headcount?: number } | undefined) ?? undefined,
      location: (p.location as { primary?: string } | undefined) ?? undefined,
    },
  };
  const industry = answers.S1?.industry ?? "general";
  const orgSummary = buildOrgSummary(answers);

  const chair: ChairContext = {
    name: String(existing.name ?? uiDomain),
    function: String(existing.description ?? ""),
    ui_domain: uiDomain,
    has_workers: true,
  };

  const { workers } = await populateChairWorkers(chair, industry, orgId, orgSummary);
  const chair_id = String(existing.chair_id);
  const { labor_commons_refs, owns, refuses, worker_agents } = await buildChairRefsAndWorkers(chair, chair_id, workers);

  const existingScope = (existing.scope ?? {}) as { escalates_to?: string[] };
  return {
    chair_id,
    name: chair.name,
    domain: uiDomain,
    description: chair.function,
    labor_commons_refs,
    scope: { owns, refuses, escalates_to: existingScope.escalates_to ?? [] },
    worker_agents,
    approval_required_for: (existing.approval_required_for as string[] | undefined) ?? approvalKeysForDomain(uiDomain),
    commons_crew_run_id: (existing.commons_crew_run_id as string | null | undefined) ?? null,
    commons_crew_session_id: (existing.commons_crew_session_id as string | null | undefined) ?? null,
  };
}

// ── Artifact generators ───────────────────────────────────────────────────────

export function buildBusinessProfile(answers: InterviewAnswers, orgId: string) {
  const s0 = answers.S0 ?? {};
  const s1 = answers.S1 ?? {};
  const s3 = answers.S3 ?? {};
  const mode = (s0.governance_mode ?? "business") as GovernanceModeValue;
  return {
    org_id: orgId,
    org_name: def(s1.org_name, "My Organization"),
    governance_mode: mode,
    description: def(s1.description, ""),
    industry: def(s1.industry, "general"),
    primary_domain: def(s1.primary_domain, "ops"),
    operating_since: toStringOrNull(s1.operating_since),
    location: {
      primary: def(s1.location?.primary, ""),
      regions: def(s1.location?.regions, []),
    },
    size: {
      headcount: toNonNegativeInt(s1.size?.headcount, 0),
      member_count: s1.size?.member_count == null ? null : toNonNegativeInt(s1.size.member_count, 0),
    },
    external_systems: def(s3.systems, []),
    created_at: new Date().toISOString(),
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };
}

function buildObjectiveConfig(answers: InterviewAnswers, orgId: string) {
  const s4 = answers.S4 ?? {};
  return {
    org_id: orgId,
    primary_objectives: [
      {
        id: "obj-1",
        description: def(s4.primary_objective, "Operate sustainably and grow."),
        type: def(s4.objective_type, "other" as const),
        priority: 1,
        success_criteria: def(s4.success_criteria, []),
        target_date: def(s4.target_date, null),
      },
    ],
    kpis: (s4.kpis ?? []).map((k, i) => ({
      id: `kpi-${i + 1}`,
      name: k.name,
      unit: k.unit,
      current_value: null,
      target_value: k.target_value,
      reporting_cadence: k.reporting_cadence,
    })),
    constraints: def(s4.constraints, []),
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };
}

function buildAutonomyPolicy(answers: InterviewAnswers, orgId: string) {
  const s5 = answers.S5 ?? {};
  return {
    org_id: orgId,
    autonomy_mode: def(s5.autonomy_mode, "advisor" as const),
    execution_mode: def(s5.execution_mode, "sim" as const),
    approval_thresholds: {
      financial_spend_auto_limit: 0,
      outreach_auto_limit: 0,
      content_publish_requires_approval: true,
      external_write_requires_approval: true,
    },
    disabled_capabilities: [],
    hr_agent_enabled: false,
    per_person_analytics_enabled: false,
    slack_dm_enabled: false,
    slack_channel_whitelist: def(s5.slack_channel_whitelist, []),
    risk_escalation_threshold: riskThreshold(s5.risk_appetite),
    blast_radius_escalation_threshold: "medium",
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };
}

function buildCadenceProtocol(answers: InterviewAnswers, orgId: string) {
  const s6 = answers.S6 ?? {};
  const tz = def(s6.timezone, "America/Chicago");
  return {
    org_id: orgId,
    daily: {
      enabled: true,
      run_at: def(s6.daily_run_at, "08:00"),
      timezone: tz,
      delivery: def(s6.daily_delivery, ["crew-bridge"] as const),
      output: "pulse" as const,
    },
    weekly: {
      enabled: true,
      run_on: def(s6.weekly_run_on, "monday" as const),
      run_at: def(s6.weekly_run_at, "08:00"),
      timezone: tz,
      delivery: def(s6.weekly_delivery, ["crew-bridge"] as const),
      output: "brief" as const,
      chairs_included: ["all"],
    },
    monthly: {
      enabled: true,
      run_on_day: def(s6.monthly_run_on_day, 1),
      output: "review" as const,
      delivery: def(s6.monthly_delivery, ["crew-bridge"] as const),
    },
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };
}

function buildCollectiveConfig(answers: InterviewAnswers, orgId: string) {
  const s8 = answers.S8 ?? {};
  const voteMethod = def(s8.vote_method, "simple_majority" as const);
  return {
    org_id: orgId,
    membership: {
      member_roles: def(s8.member_roles, ["member", "steward"] as MemberRole[]),
      quorum_threshold: def(s8.quorum_threshold, 0.5),
      active_member_count: def(s8.active_member_count, 0),
    },
    voting: {
      standard_vote_duration_hours: def(s8.standard_vote_duration_hours, 72),
      urgent_vote_duration_hours: def(s8.urgent_vote_duration_hours, 24),
      vote_method: voteMethod,
      supermajority_threshold: voteMethod === "supermajority" ? 0.67 : null,
      decisions_requiring_vote: def(s8.decisions_requiring_vote, [
        "budget_above_threshold",
        "new_member_admission",
        "policy_change",
      ]),
      decisions_requiring_consensus: def(s8.decisions_requiring_consensus, []),
    },
    contribution_tracking: {
      enabled: true,
      tracked_actions: ["vote", "approval", "meeting_attendance", "task_completion"] as const,
    },
    amendment_protocol: {
      proposal_requires: "steward" as const,
      notice_period_hours: 48,
      amendment_vote_method: "supermajority" as const,
    },
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateArtifacts(
  answers: InterviewAnswers,
  orgId: string
): Promise<InterviewArtifacts> {
  const mode = (answers.S0?.governance_mode ?? "business") as GovernanceModeValue;

  const { chairs } = await buildAgentBlueprint(answers, orgId);

  const agentBlueprint = {
    org_id: orgId,
    chairs,
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION,
  };

  const artifacts: InterviewArtifacts = {
    business_profile: buildBusinessProfile(answers, orgId),
    objective_config: buildObjectiveConfig(answers, orgId),
    autonomy_policy: buildAutonomyPolicy(answers, orgId),
    cadence_protocol: buildCadenceProtocol(answers, orgId),
    agent_blueprint: agentBlueprint,
  };

  if (mode === "collective") {
    artifacts.collective_config = buildCollectiveConfig(answers, orgId);
  }

  return artifacts;
}
