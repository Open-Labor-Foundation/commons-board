/**
 * Org routes — specialist resolution, chair staffing, and catalog gap management.
 *
 * Routes:
 *   POST /api/v1/org/resolve-specialists         — resolve all chairs in agent_blueprint
 *   GET  /api/v1/org/specialist-matches          — get pending resolutions
 *   POST /api/v1/org/confirm-specialists         — confirm and write to agent_blueprint
 *   PUT  /api/v1/org/chairs/:chair_id/specialists — override a chair's specialists
 *   POST /api/v1/org/gaps/:gap_id/submit         — mark gap submitted to labor-commons
 *   GET  /api/v1/org/gaps                        — list catalog gaps
 *   GET  /api/v1/org/catalog-sync               — run catalog sync check
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ArtifactType, GovernanceEvent } from "@commons-board/shared";
import { getArtifact, writeArtifact, ArtifactValidationError } from "../lib/artifact-store.js";
import { requireContext, requireRole } from "../lib/auth.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { resolveAllChairs, applyResolutionsToBlueprint, type BlueprintResolution } from "../services/specialist-resolver.js";
import { loadGaps, updateGap, reportGap } from "../lib/labor-commons-client.js";
import { runCatalogSync } from "../workers/catalog-sync.js";

export const orgRouter = Router();

orgRouter.use(requireContext);

/** POST /api/v1/org/resolve-specialists */
orgRouter.post("/resolve-specialists", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  const profileRecord = getArtifact(orgId, "business_profile");

  if (!blueprintRecord) {
    res.status(422).json({ error: "agent_blueprint artifact is required before resolving specialists" });
    return;
  }
  if (!profileRecord) {
    res.status(422).json({ error: "business_profile artifact is required before resolving specialists" });
    return;
  }

  const blueprint = blueprintRecord.payload as Record<string, unknown>;
  const profile = profileRecord.payload as Record<string, unknown>;

  try {
    const resolutions = await resolveAllChairs(orgId, blueprint, profile);
    writeJsonAtomic(`specialist-matches/${orgId}`, resolutions);

    res.status(200).json({
      resolved: resolutions.length,
      gaps: resolutions.filter((r) => r.resolution.catalog_gap).length,
      matches: resolutions
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "resolution failed" });
  }
});

/** GET /api/v1/org/specialist-matches */
orgRouter.get("/specialist-matches", (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const matches = readJson<BlueprintResolution[]>(`specialist-matches/${orgId}`, []);
  res.status(200).json({ matches });
});

/** POST /api/v1/org/confirm-specialists */
orgRouter.post("/confirm-specialists", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  if (!blueprintRecord) {
    res.status(422).json({ error: "agent_blueprint artifact not found" });
    return;
  }

  const pending = readJson<BlueprintResolution[]>(`specialist-matches/${orgId}`, []);
  if (pending.length === 0) {
    res.status(422).json({ error: "no pending specialist matches; run resolve-specialists first" });
    return;
  }

  const updated = applyResolutionsToBlueprint(
    blueprintRecord.payload as Record<string, unknown>,
    pending
  );

  try {
    const record = writeArtifact(orgId, "agent_blueprint" as ArtifactType, updated, actor);
    writeJsonAtomic(`specialist-matches/${orgId}`, []);
    res.status(200).json({ artifact_id: record.artifact_id, version: record.version });
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "blueprint validation failed after specialist application", details: err.errors });
      return;
    }
    throw err;
  }
});

/** PUT /api/v1/org/chairs/:chair_id/specialists */
orgRouter.put("/chairs/:chair_id/specialists", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const actor = req.ctx!.userId;
  const { chair_id } = req.params;

  const blueprintRecord = getArtifact(orgId, "agent_blueprint");
  if (!blueprintRecord) {
    res.status(404).json({ error: "agent_blueprint not found" });
    return;
  }

  const blueprint = blueprintRecord.payload as Record<string, unknown>;
  const chairs = [...((blueprint.chairs as Array<Record<string, unknown>>) ?? [])];
  const idx = chairs.findIndex((c) => c.chair_id === chair_id);
  if (idx < 0) {
    res.status(404).json({ error: `chair ${chair_id} not found in blueprint` });
    return;
  }

  const body = req.body as { labor_commons_refs?: unknown[] };
  if (!Array.isArray(body.labor_commons_refs)) {
    res.status(400).json({ error: "labor_commons_refs must be an array" });
    return;
  }

  chairs[idx] = { ...chairs[idx], labor_commons_refs: body.labor_commons_refs };
  const updated = { ...blueprint, chairs };

  try {
    const record = writeArtifact(orgId, "agent_blueprint" as ArtifactType, updated, actor);
    res.status(200).json({ artifact_id: record.artifact_id, version: record.version, chair_id });
  } catch (err) {
    if (err instanceof ArtifactValidationError) {
      res.status(422).json({ error: "blueprint validation failed", details: err.errors });
      return;
    }
    throw err;
  }
});

// ── gap domain detection + chair templates ────────────────────────────────────

const GAP_DOMAIN_KEYWORDS: Record<string, string[]> = {
  security: ["security", "cybersecurity", "infosec", "credential", "key management", "encryption", "vulnerability", "access control", "certificate", "penetration", "phishing", "firewall", "soc", "siem"],
  finance:  ["finance", "financial", "accounting", "budget", "treasury", "revenue", "cash flow", "bookkeeping", "audit", "tax", "payroll"],
  legal:    ["legal", "compliance", "contract", "regulatory", "gdpr", "ccpa", "liability", "attorney", "law", "ip", "intellectual property"],
  hr:       ["hr", "human resources", "recruiting", "hiring", "onboarding", "benefits", "employee relations", "culture", "performance review"],
  product:  ["product", "roadmap", "feature", "ux", "design", "user experience", "prototype", "backlog"],
  strategy: ["strategy", "strategic", "planning", "market", "competitive", "vision", "mission", "business development"],
  rnd:      ["research", "r&d", "innovation", "experiment", "prototype", "technical research"],
  it:       ["it", "infrastructure", "devops", "systems administration", "network", "cloud", "database", "server", "ci/cd"],
  growth:   ["marketing", "growth", "seo", "social media", "advertising", "brand", "content", "demand generation"],
  sales:    ["sales", "revenue", "deals", "prospects", "crm", "pipeline", "account executive"],
  ops:      ["operations", "ops", "process", "workflow", "logistics", "supply chain", "vendor management"],
};

function detectGapDomain(description: string): string | null {
  const lower = description.toLowerCase();
  for (const [domain, keywords] of Object.entries(GAP_DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return domain;
  }
  return null;
}

const AGENT_CHAIR_TEMPLATES: Record<string, {
  name: string;
  description: string;
  scope: { owns: string[]; refuses: string[]; escalates_to: string[] };
  worker_agents: Array<{ agent_id: string; name: string; labor_commons_ref: string | null; task_scope: string[] }>;
  approval_required_for: string[];
}> = {
  security: {
    name: "Security Chair",
    description: "Oversees cybersecurity posture, organizational key and credential management, access control policies, incident response, and security compliance across all systems and vendors.",
    scope: {
      owns: ["cybersecurity_policy", "credential_management", "key_management", "access_control", "security_audits", "incident_response", "vulnerability_management", "vendor_security_review"],
      refuses: [],
      escalates_to: ["legal", "ops"],
    },
    worker_agents: [
      { agent_id: "security-analyst", name: "Security Analyst", labor_commons_ref: null, task_scope: ["threat_analysis", "vulnerability_scanning", "security_reporting", "log_review"] },
      { agent_id: "credential-manager", name: "Credential Manager", labor_commons_ref: null, task_scope: ["key_rotation", "access_review", "credential_inventory", "secret_management"] },
    ],
    approval_required_for: ["key_rotation", "credential_access", "security_policy_change", "third_party_system_access", "external_security_audit"],
  },
  finance: {
    name: "Finance Chair",
    description: "Manages financial health, budget allocation, cash flow forecasting, accounting, and financial compliance.",
    scope: { owns: ["budget_management", "cash_flow", "financial_reporting", "tax_compliance", "accounts_payable", "accounts_receivable"], refuses: [], escalates_to: ["legal", "strategy"] },
    worker_agents: [
      { agent_id: "financial-analyst", name: "Financial Analyst", labor_commons_ref: null, task_scope: ["forecasting", "variance_analysis", "financial_modeling"] },
    ],
    approval_required_for: ["budget_change", "major_expense", "financial_audit"],
  },
  legal: {
    name: "Legal Chair",
    description: "Manages contracts, regulatory compliance, intellectual property, and legal risk across the organization.",
    scope: { owns: ["contract_review", "regulatory_compliance", "intellectual_property", "legal_risk", "privacy_policy"], refuses: [], escalates_to: ["strategy"] },
    worker_agents: [
      { agent_id: "compliance-analyst", name: "Compliance Analyst", labor_commons_ref: null, task_scope: ["regulatory_monitoring", "policy_drafting", "risk_assessment"] },
    ],
    approval_required_for: ["contract_signing", "regulatory_filing", "legal_action"],
  },
};

function buildAgentChair(domain: string, functionDescription: string, gapId: string) {
  const template = AGENT_CHAIR_TEMPLATES[domain];
  const chairId = `${domain}-chair`;
  const catalogGap = { function_description: functionDescription, gap_id: gapId, submitted_to_labor_commons: false };
  if (template) {
    return {
      chair_id: chairId,
      name: template.name,
      domain,
      description: template.description,
      labor_commons_refs: [],
      scope: template.scope,
      worker_agents: template.worker_agents,
      approval_required_for: template.approval_required_for,
      catalog_gap: catalogGap,
    };
  }
  return {
    chair_id: chairId,
    name: `${domain.slice(0, 1).toUpperCase()}${domain.slice(1)} Chair`,
    domain,
    description: functionDescription,
    labor_commons_refs: [],
    scope: { owns: [domain], refuses: [], escalates_to: [] },
    worker_agents: [],
    approval_required_for: [],
    catalog_gap: catalogGap,
  };
}

/** GET /api/v1/org/gaps */
orgRouter.get("/gaps", (req: Request, res: Response) => {
  const raw = loadGaps(req.ctx!.workspaceId);
  const gaps = raw
    .filter((g) => g.resolved_at == null)
    .map((g) => {
      const extra = g as unknown as Record<string, unknown>;
      return {
        gap_id: g.gap_id,
        description: (extra.description as string | undefined) ?? g.function_description,
        priority: (extra.priority as string | undefined) ?? "medium",
        submitted_at: g.created_at,
        status: g.submitted_to_labor_commons ? "submitted" : "pending",
      };
    });
  res.status(200).json({ gaps });
});

/** POST /api/v1/org/gaps */
orgRouter.post("/gaps", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const description = String(req.body?.description ?? "").trim();
  if (!description) { res.status(400).json({ error: "description is required" }); return; }

  const validPriorities = ["high", "medium", "low"] as const;
  type Priority = typeof validPriorities[number];
  const priority: Priority = validPriorities.includes(req.body?.priority) ? req.body.priority : "medium";
  const domain = detectGapDomain(description);
  const gapId = randomUUID();

  const nowIso = new Date().toISOString();
  // Store CatalogGap-compatible fields plus UI display fields (description, priority)
  await reportGap({
    gap_id: gapId,
    org_id: workspaceId,
    function_description: description,
    domain_hint: domain,
    submitted_to_labor_commons: false,
    created_at: nowIso,
    resolved_at: null,
    description,
    priority,
  } as unknown as Parameters<typeof reportGap>[0]);

  let chairAdded: ReturnType<typeof buildAgentChair> | null = null;
  let alreadyCovered = false;

  if (domain) {
    const blueprintRecord = getArtifact(workspaceId, "agent_blueprint");
    if (blueprintRecord) {
      const bp = blueprintRecord.payload as { org_id: string; chairs?: Array<{ domain: string; name: string }>; schema_version: string };
      const chairs = bp.chairs ?? [];
      const existingChair = chairs.find((c) => c.domain === domain);
      if (existingChair) {
        alreadyCovered = true;
        updateGap(workspaceId, gapId, { resolved_at: nowIso });
      } else {
        const newChair = buildAgentChair(domain, description, gapId);
        const updated = { ...bp, chairs: [...chairs, newChair] };
        try {
          writeArtifact(workspaceId, "agent_blueprint" as ArtifactType, updated, userId);
          chairAdded = newChair;
          updateGap(workspaceId, gapId, { resolved_at: nowIso });
          appendEvent({
            event_id: randomUUID(),
            org_id: workspaceId,
            event_type: "artifact_written",
            actor: userId,
            artifact_type: "agent_blueprint",
            artifact_id: null,
            details: { action: "chair_added_from_gap", domain, chair_name: newChair.name, gap_id: gapId },
            at: nowIso,
          } satisfies GovernanceEvent);
        } catch {
          // schema validation issue — skip chair add but gap is still recorded
        }
      }
    }
  }

  res.status(201).json({
    gap: { gap_id: gapId, description, priority, status: alreadyCovered || chairAdded ? "resolved" : "pending" },
    chair_added: !!chairAdded,
    already_covered: alreadyCovered,
    chair: chairAdded,
  });
});

/** POST /api/v1/org/gaps/:gap_id/submit */
orgRouter.post("/gaps/:gap_id/submit", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  const { gap_id } = req.params;
  updateGap(orgId, gap_id, { submitted_to_labor_commons: true });
  res.status(200).json({ gap_id, submitted_to_labor_commons: true });
});

/** GET /api/v1/org/catalog-sync */
orgRouter.get("/catalog-sync", requireRole(["admin", "operator"]), async (req: Request, res: Response) => {
  const orgId = req.ctx!.workspaceId;
  try {
    const notifications = await runCatalogSync(orgId);
    res.status(200).json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "sync failed" });
  }
});

// ─── org blueprint lifecycle ──────────────────────────────────────────────────
// Ported and sanitized from mother-board routes/org.ts.
// Adaptations: store.* → readJson/writeJsonAtomic; agent_type → domain;
// agent_blueprint.agents[] → agent_blueprint.chairs[]; no MB portfolio link checks.

type OrgStatus = "active" | "paused" | "retired";
type DelegationStatus = "pending" | "approved" | "rejected";
type DelegationTargetType = "department" | "team";

type OrgChair = {
  id: string;
  name: string;
  domain: string;
  status: OrgStatus;
  kpis: string[];
  cadence: Record<string, unknown>;
  authority: Record<string, unknown>;
  budget_cap_daily?: number;
  risk_ceiling?: number;
};

type OrgDepartment = {
  id: string;
  chair_id: string;
  name: string;
  domain: string;
  status: OrgStatus;
  kpis: string[];
  team_ids: string[];
  budget_cap_daily?: number;
  risk_ceiling?: number;
};

type OrgTeam = {
  id: string;
  department_id: string;
  chair_id: string;
  name: string;
  domain: string;
  status: OrgStatus;
  kpis: string[];
  cadence: Record<string, unknown>;
  authority: Record<string, unknown>;
  budget_cap_daily?: number;
  risk_ceiling?: number;
};

type ScopedPolicy = {
  mode_default?: "advisor" | "orchestrator" | "autopilot";
  auto_approve_delegations?: boolean;
  forbidden_actions?: string[];
  action_overrides?: Array<{
    category: string;
    allowed_in_modes?: Array<"advisor" | "orchestrator" | "autopilot">;
    approvals_required?: number;
    forbidden?: boolean;
  }>;
};

type OrgBlueprint = {
  schema_version: "1.0";
  chairs: OrgChair[];
  departments: OrgDepartment[];
  teams: OrgTeam[];
  policy_scopes: {
    global: ScopedPolicy;
    domains: Record<string, ScopedPolicy>;
    teams: Record<string, ScopedPolicy>;
  };
  metadata: { updated_at: string; updated_by: string; note?: string };
};

type DelegationRequest = {
  id: string;
  target_type: DelegationTargetType;
  status: DelegationStatus;
  chair_id: string;
  department_id?: string;
  requested_by: string;
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  reason?: string;
  proposal: Record<string, unknown>;
};

type OrgDelegations = { schema_version: "1.0"; requests: DelegationRequest[] };

// ── helpers ───────────────────────────────────────────────────────────────────

function obNowIso(): string { return new Date().toISOString(); }
function obDefaultCadence(): Record<string, unknown> { return { daily: true, weekly: true, monthly: false }; }
function obDefaultDelegations(): OrgDelegations { return { schema_version: "1.0", requests: [] }; }

function obNormalizeDomain(input: string): string {
  return String(input ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function obTitleCaseWords(input: string): string {
  return input.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}

function obNormalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set((input as unknown[]).map((i) => String(i).trim()).filter((i) => i.length > 0))];
}

function obIsValidOrgStatus(input: unknown): input is OrgStatus {
  return input === "active" || input === "paused" || input === "retired";
}

function obToChairId(domain: string, existingIds: Set<string>): string {
  const base = `${domain}-chair`;
  if (!existingIds.has(base)) { existingIds.add(base); return base; }
  let idx = 2;
  while (existingIds.has(`${base}-${idx}`)) idx += 1;
  const next = `${base}-${idx}`;
  existingIds.add(next);
  return next;
}

const OB_CHAIR_DEFS: Record<string, { name: string; kpis: string[]; budget: number; risk: number }> = {
  ethics:   { name: "Ethics Chair",    kpis: ["policy_adherence","ethical_risk_exposure"],       budget: 80,  risk: 55 },
  ops:      { name: "Ops Chair",       kpis: ["throughput","quality"],                           budget: 120, risk: 80 },
  cio:      { name: "CIO Chair",       kpis: ["delivery_predictability","platform_reliability"], budget: 150, risk: 80 },
  hr:       { name: "HR Chair",        kpis: ["time_to_fill","retention_90d"],                   budget: 100, risk: 75 },
  security: { name: "Security Chair",  kpis: ["control_coverage","incident_mttd"],               budget: 130, risk: 70 },
  it:       { name: "IT Chair",        kpis: ["service_uptime","support_sla"],                   budget: 120, risk: 75 },
  rnd:      { name: "R&D Chair",       kpis: ["validated_learning","experiment_cycle_time"],     budget: 140, risk: 78 },
  finance:  { name: "Finance Chair",   kpis: ["cash_efficiency","forecast_accuracy"],            budget: 130, risk: 72 },
  legal:    { name: "Legal Chair",     kpis: ["contract_turnaround","risk_mitigation"],          budget: 120, risk: 65 },
  strategy: { name: "Strategy Chair",  kpis: ["portfolio_clarity","strategic_alignment"],        budget: 110, risk: 75 },
};

function obChairDefaults(domain: string): { name: string; kpis: string[]; budget_cap_daily: number; risk_ceiling: number } {
  const d = OB_CHAIR_DEFS[obNormalizeDomain(domain)] ?? OB_CHAIR_DEFS.ops!;
  return { name: d.name, kpis: d.kpis, budget_cap_daily: d.budget, risk_ceiling: d.risk };
}

const OB_REQUIRED_DOMAINS = ["ethics","ops","cio","hr","security","it","rnd","finance","legal","strategy"];

function obBlueprintKey(wsId: string): string { return `org-blueprint/${wsId}`; }
function obDelegationsKey(wsId: string): string { return `org-delegations/${wsId}`; }

function obLatestOrgBlueprint(wsId: string): OrgBlueprint | null {
  const versions = readJson<OrgBlueprint[]>(obBlueprintKey(wsId), []);
  return versions.length > 0 ? versions[versions.length - 1]! : null;
}

function obLatestDelegations(wsId: string): OrgDelegations | null {
  return readJson<OrgDelegations | null>(obDelegationsKey(wsId), null);
}

function obPersistOrgBlueprint(wsId: string, blueprint: OrgBlueprint): OrgBlueprint {
  const versions = readJson<OrgBlueprint[]>(obBlueprintKey(wsId), []);
  writeJsonAtomic(obBlueprintKey(wsId), [...versions, blueprint].slice(-50));
  return blueprint;
}

function obPersistDelegations(wsId: string, payload: OrgDelegations): void {
  writeJsonAtomic(obDelegationsKey(wsId), payload);
}

function obWithMetadata(blueprint: OrgBlueprint, userId: string, note?: string): OrgBlueprint {
  return { ...blueprint, metadata: { updated_at: obNowIso(), updated_by: userId, note } };
}

function obReconcileRequiredChairs(
  blueprint: OrgBlueprint,
  requiredDomains: string[]
): { blueprint: OrgBlueprint; added: string[]; reactivated: string[] } {
  const chairs = [...blueprint.chairs];
  const byDomain = new Map<string, OrgChair[]>();
  const existingIds = new Set<string>(chairs.map((c) => c.id));

  for (const chair of chairs) {
    const key = obNormalizeDomain(chair.domain);
    const bucket = byDomain.get(key) ?? [];
    bucket.push(chair);
    byDomain.set(key, bucket);
  }

  const added: string[] = [];
  const reactivated: string[] = [];
  const unique = [...new Set(requiredDomains.map(obNormalizeDomain).filter(Boolean))];

  for (const domain of unique) {
    const matches = byDomain.get(domain) ?? [];
    if (matches.length === 0) {
      const defs = obChairDefaults(domain);
      const created: OrgChair = {
        id: obToChairId(domain, existingIds),
        name: defs.name,
        domain,
        status: "active",
        kpis: defs.kpis,
        cadence: obDefaultCadence(),
        authority: {},
        budget_cap_daily: defs.budget_cap_daily,
        risk_ceiling: defs.risk_ceiling,
      };
      chairs.push(created);
      byDomain.set(domain, [created]);
      added.push(domain);
      continue;
    }
    for (const chair of matches) {
      if (chair.status !== "active") { chair.status = "active"; reactivated.push(chair.id); }
    }
  }

  return { blueprint: { ...blueprint, chairs }, added, reactivated };
}

function obBuildDefaultOrgBlueprint(wsId: string, userId: string): OrgBlueprint {
  const abRecord = getArtifact(wsId, "agent_blueprint");
  const storedChairs = (abRecord?.payload as { chairs?: Array<Record<string, unknown>> } | undefined)?.chairs ?? [];

  const chairs: OrgChair[] = [];
  const departments: OrgDepartment[] = [];
  const teams: OrgTeam[] = [];

  for (const raw of storedChairs) {
    const domain = obNormalizeDomain(String(raw.domain ?? "ops")) || "ops";
    const chairId = `${domain}-chair`;

    if (!chairs.find((c) => c.id === chairId)) {
      const kpis = Array.isArray(raw.kpis) ? raw.kpis.map(String) : ["execution_quality"];
      chairs.push({ id: chairId, name: String(raw.name ?? `${domain.toUpperCase()} Chair`), domain, status: "active", kpis, cadence: obDefaultCadence(), authority: {}, budget_cap_daily: 100, risk_ceiling: 80 });
    }

    const deptId = `${domain}-dept`;
    const teamId = String(raw.chair_id ?? randomUUID());

    if (!departments.find((d) => d.id === deptId)) {
      departments.push({ id: deptId, chair_id: chairId, name: `${domain.toUpperCase()} Department`, domain, status: "active", kpis: ["throughput"], team_ids: [teamId], budget_cap_daily: 100, risk_ceiling: 80 });
    } else {
      const dept = departments.find((d) => d.id === deptId)!;
      if (!dept.team_ids.includes(teamId)) dept.team_ids.push(teamId);
    }

    teams.push({ id: teamId, department_id: deptId, chair_id: chairId, name: `${domain.toUpperCase()} Team`, domain, status: "active", kpis: ["throughput"], cadence: obDefaultCadence(), authority: {}, budget_cap_daily: 50, risk_ceiling: 75 });
  }

  if (chairs.length === 0) {
    chairs.push({ id: "ops-chair", name: "OPS Chair", domain: "ops", status: "active", kpis: ["process_friction"], cadence: obDefaultCadence(), authority: {}, budget_cap_daily: 100, risk_ceiling: 80 });
  }

  return {
    schema_version: "1.0",
    chairs,
    departments,
    teams,
    policy_scopes: { global: {}, domains: {}, teams: {} },
    metadata: { updated_at: obNowIso(), updated_by: userId, note: "bootstrapped_from_agent_blueprint" },
  };
}

function obApplyApprovedDelegation(
  blueprint: OrgBlueprint,
  request: DelegationRequest,
  userId: string
): { blueprint: OrgBlueprint } | { error: string; status: number } {
  if (request.target_type === "department") {
    const p = request.proposal as Partial<OrgDepartment>;
    const dept: OrgDepartment = {
      id: String(p.id ?? randomUUID()),
      chair_id: request.chair_id,
      name: String(p.name ?? "New Department"),
      domain: String(p.domain ?? "ops"),
      status: "active",
      kpis: Array.isArray(p.kpis) ? p.kpis : ["throughput"],
      team_ids: [],
      budget_cap_daily: typeof p.budget_cap_daily === "number" ? p.budget_cap_daily : 100,
      risk_ceiling: typeof p.risk_ceiling === "number" ? p.risk_ceiling : 80,
    };
    return { blueprint: obWithMetadata({ ...blueprint, departments: [...blueprint.departments, dept] }, userId, "delegation_department_approved") };
  }

  const p = request.proposal as Partial<OrgTeam>;
  const deptId = String(p.department_id ?? request.department_id ?? "");
  if (!deptId) return { error: "department_id is required for team delegations", status: 400 };

  const team: OrgTeam = {
    id: String(p.id ?? randomUUID()),
    chair_id: request.chair_id,
    department_id: deptId,
    name: String(p.name ?? "New Team"),
    domain: String(p.domain ?? "ops"),
    status: "active",
    kpis: Array.isArray(p.kpis) ? p.kpis : ["throughput"],
    cadence: typeof p.cadence === "object" && p.cadence ? p.cadence : obDefaultCadence(),
    authority: typeof p.authority === "object" && p.authority ? p.authority : {},
    budget_cap_daily: typeof p.budget_cap_daily === "number" ? p.budget_cap_daily : 50,
    risk_ceiling: typeof p.risk_ceiling === "number" ? p.risk_ceiling : 75,
  };

  const nextDepts = blueprint.departments.map((d) =>
    d.id === deptId ? { ...d, team_ids: [...d.team_ids, team.id] } : d
  );
  return { blueprint: obWithMetadata({ ...blueprint, teams: [...blueprint.teams, team], departments: nextDepts }, userId, "delegation_team_approved") };
}

function obDelegationAutoApproveEnabled(blueprint: OrgBlueprint): boolean {
  return blueprint.policy_scopes.global.auto_approve_delegations === true;
}

// ── routes ────────────────────────────────────────────────────────────────────

/** POST /api/v1/org/bootstrap */
orgRouter.post("/bootstrap", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const existing = obLatestOrgBlueprint(workspaceId);
  const requiredDomains: string[] = Array.isArray(req.body?.required_domains) ? req.body.required_domains : OB_REQUIRED_DOMAINS;

  let blueprint: OrgBlueprint;
  let added: string[] = [];
  let reactivated: string[] = [];

  if (!existing) {
    const base = obBuildDefaultOrgBlueprint(workspaceId, userId);
    const reconciled = obReconcileRequiredChairs(base, requiredDomains);
    blueprint = obWithMetadata(reconciled.blueprint, userId, "bootstrap");
    added = reconciled.added;
    reactivated = reconciled.reactivated;
  } else {
    const reconciled = obReconcileRequiredChairs(existing, requiredDomains);
    blueprint = obWithMetadata(reconciled.blueprint, userId, "bootstrap_reconcile");
    added = reconciled.added;
    reactivated = reconciled.reactivated;
  }

  obPersistOrgBlueprint(workspaceId, blueprint);
  if (!obLatestDelegations(workspaceId)) obPersistDelegations(workspaceId, obDefaultDelegations());

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "org_activated",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { source: "org_bootstrap", chairs_count: blueprint.chairs.length, added, reactivated },
    at: obNowIso(),
  } satisfies GovernanceEvent);

  res.status(existing ? 200 : 201).json({ blueprint, added, reactivated });
});

/** GET /api/v1/org/blueprint/latest */
orgRouter.get("/blueprint/latest", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const versions = readJson<OrgBlueprint[]>(obBlueprintKey(workspaceId), []);
  if (versions.length === 0) {
    res.status(404).json({ error: "org blueprint not initialized; call POST /org/bootstrap" });
    return;
  }
  res.status(200).json({ version: versions.length, blueprint: versions[versions.length - 1]! });
});

/** GET /api/v1/org/domain-capabilities */
orgRouter.get("/domain-capabilities", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  const capabilities = (blueprint?.chairs ?? [])
    .filter((c) => c.status === "active")
    .map((c) => {
      const defs = OB_CHAIR_DEFS[c.domain];
      return {
        domain: c.domain,
        chair_id: c.id,
        chair_name: c.name,
        kpis: c.kpis,
        capabilities: defs ? defs.kpis : ["execution_quality"],
      };
    });
  res.status(200).json({ capabilities });
});

/** GET /api/v1/org/delegations */
orgRouter.get("/delegations", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const delegations = obLatestDelegations(workspaceId) ?? obDefaultDelegations();
  const status = String(req.query.status ?? "");
  const requests = status
    ? delegations.requests.filter((r) => r.status === status)
    : delegations.requests;
  res.status(200).json({ requests, total: requests.length });
});

/** POST /api/v1/org/chairs */
orgRouter.post("/chairs", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found; call POST /org/bootstrap" }); return; }

  const input = req.body as Partial<OrgChair>;
  if (!input.name || !input.domain) { res.status(400).json({ error: "name and domain are required" }); return; }

  const chair: OrgChair = {
    id: input.id ?? randomUUID(),
    name: input.name,
    domain: obNormalizeDomain(input.domain),
    status: obIsValidOrgStatus(input.status) ? input.status : "active",
    kpis: Array.isArray(input.kpis) ? input.kpis : ["execution_quality"],
    cadence: typeof input.cadence === "object" && input.cadence ? input.cadence : obDefaultCadence(),
    authority: typeof input.authority === "object" && input.authority ? input.authority : {},
    budget_cap_daily: typeof input.budget_cap_daily === "number" ? input.budget_cap_daily : 100,
    risk_ceiling: typeof input.risk_ceiling === "number" ? input.risk_ceiling : 80,
  };

  const next = obWithMetadata({ ...blueprint, chairs: [...blueprint.chairs, chair] }, userId, "chair_added");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(201).json({ chair, blueprint: next });
});

/** PATCH /api/v1/org/chairs/:chairId/status */
orgRouter.patch("/chairs/:chairId/status", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const status = String(req.body?.status ?? "");
  if (!obIsValidOrgStatus(status)) { res.status(400).json({ error: "status must be active|paused|retired" }); return; }

  const nextChairs = blueprint.chairs.map((c) =>
    c.id === req.params.chairId ? { ...c, status: status as OrgStatus } : c
  );
  const next = obWithMetadata({ ...blueprint, chairs: nextChairs }, userId, "chair_status_updated");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(200).json({ blueprint: next });
});

/** PATCH /api/v1/org/chairs/:chairId */
orgRouter.patch("/chairs/:chairId", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const existing = blueprint.chairs.find((c) => c.id === req.params.chairId);
  if (!existing) { res.status(404).json({ error: "chair not found" }); return; }

  const input = req.body as Partial<OrgChair>;
  const patch: Partial<OrgChair> = {};

  if (typeof input.name === "string") {
    const v = input.name.trim();
    if (!v) { res.status(400).json({ error: "name cannot be empty" }); return; }
    patch.name = v;
  }
  if (typeof input.domain === "string") {
    const v = obNormalizeDomain(input.domain);
    if (!v) { res.status(400).json({ error: "domain cannot be empty" }); return; }
    patch.domain = v;
  }
  if (input.status !== undefined) {
    if (!obIsValidOrgStatus(input.status)) { res.status(400).json({ error: "status must be active|paused|retired" }); return; }
    patch.status = input.status;
  }
  if (input.kpis !== undefined) {
    const kpis = obNormalizeStringArray(input.kpis);
    if (kpis.length === 0) { res.status(400).json({ error: "kpis must include at least one value" }); return; }
    patch.kpis = kpis;
  }
  if (input.budget_cap_daily !== undefined) {
    if (typeof input.budget_cap_daily !== "number" || !Number.isFinite(input.budget_cap_daily) || input.budget_cap_daily < 0) {
      res.status(400).json({ error: "budget_cap_daily must be a non-negative number" }); return;
    }
    patch.budget_cap_daily = input.budget_cap_daily;
  }
  if (input.risk_ceiling !== undefined) {
    if (typeof input.risk_ceiling !== "number" || !Number.isFinite(input.risk_ceiling) || input.risk_ceiling < 0 || input.risk_ceiling > 100) {
      res.status(400).json({ error: "risk_ceiling must be a number between 0 and 100" }); return;
    }
    patch.risk_ceiling = input.risk_ceiling;
  }
  if (input.cadence !== undefined) {
    if (typeof input.cadence !== "object" || !input.cadence) { res.status(400).json({ error: "cadence must be an object" }); return; }
    patch.cadence = input.cadence as Record<string, unknown>;
  }
  if (input.authority !== undefined) {
    if (typeof input.authority !== "object" || !input.authority) { res.status(400).json({ error: "authority must be an object" }); return; }
    patch.authority = input.authority as Record<string, unknown>;
  }
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "at least one editable field is required" }); return; }

  const nextChairs = blueprint.chairs.map((c) => c.id === req.params.chairId ? { ...c, ...patch } : c);
  const next = obWithMetadata({ ...blueprint, chairs: nextChairs }, userId, "chair_updated");
  obPersistOrgBlueprint(workspaceId, next);
  const updated = next.chairs.find((c) => c.id === req.params.chairId)!;
  res.status(200).json({ chair: updated, blueprint: next });
});

/** DELETE /api/v1/org/chairs/:chairId */
orgRouter.delete("/chairs/:chairId", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const chair = blueprint.chairs.find((c) => c.id === req.params.chairId);
  if (!chair) { res.status(404).json({ error: "chair not found" }); return; }

  const confirmationText = String(req.body?.confirmation_text ?? "").trim();
  if (confirmationText !== `DELETE ${chair.id}`) {
    res.status(400).json({ error: "confirmation_text mismatch", expected_confirmation: `DELETE ${chair.id}` }); return;
  }
  if (blueprint.chairs.length <= 1) { res.status(409).json({ error: "cannot delete the final chair" }); return; }

  const cascade = req.body?.cascade === true;
  const linkedDepts = blueprint.departments.filter((d) => d.chair_id === chair.id);
  const linkedDeptIds = new Set(linkedDepts.map((d) => d.id));
  const linkedTeams = blueprint.teams.filter((t) => t.chair_id === chair.id || linkedDeptIds.has(t.department_id));

  if (!cascade && (linkedDepts.length > 0 || linkedTeams.length > 0)) {
    res.status(409).json({
      error: "chair has linked departments or teams; set cascade=true or reassign first",
      linked_departments: linkedDepts.map((d) => d.id),
      linked_teams: linkedTeams.map((t) => t.id),
    });
    return;
  }

  let nextDepts = blueprint.departments;
  let nextTeams = blueprint.teams;
  if (cascade) {
    nextTeams = blueprint.teams.filter((t) => t.chair_id !== chair.id && !linkedDeptIds.has(t.department_id));
    nextDepts = blueprint.departments.filter((d) => d.chair_id !== chair.id);
  }

  const next = obWithMetadata({
    ...blueprint,
    chairs: blueprint.chairs.filter((c) => c.id !== chair.id),
    departments: nextDepts,
    teams: nextTeams,
  }, userId, "chair_deleted");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(200).json({ deleted: chair.id, cascade, blueprint: next });
});

/** POST /api/v1/org/departments */
orgRouter.post("/departments", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const input = req.body as Partial<OrgDepartment>;
  if (!input.name || !input.chair_id) { res.status(400).json({ error: "name and chair_id are required" }); return; }
  if (!blueprint.chairs.find((c) => c.id === input.chair_id)) { res.status(404).json({ error: "chair not found" }); return; }

  const dept: OrgDepartment = {
    id: input.id ?? randomUUID(),
    chair_id: input.chair_id,
    name: input.name,
    domain: obNormalizeDomain(String(input.domain ?? "ops")) || "ops",
    status: "active",
    kpis: Array.isArray(input.kpis) ? input.kpis : ["throughput"],
    team_ids: [],
    budget_cap_daily: typeof input.budget_cap_daily === "number" ? input.budget_cap_daily : 100,
    risk_ceiling: typeof input.risk_ceiling === "number" ? input.risk_ceiling : 80,
  };

  const next = obWithMetadata({ ...blueprint, departments: [...blueprint.departments, dept] }, userId, "department_added");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(201).json({ department: dept, blueprint: next });
});

/** PATCH /api/v1/org/departments/:departmentId/status */
orgRouter.patch("/departments/:departmentId/status", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const status = String(req.body?.status ?? "");
  if (!obIsValidOrgStatus(status)) { res.status(400).json({ error: "status must be active|paused|retired" }); return; }

  const dept = blueprint.departments.find((d) => d.id === req.params.departmentId);
  if (!dept) { res.status(404).json({ error: "department not found" }); return; }

  const next = obWithMetadata({
    ...blueprint,
    departments: blueprint.departments.map((d) =>
      d.id === req.params.departmentId ? { ...d, status: status as OrgStatus } : d
    ),
  }, userId, "department_status_updated");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(200).json({ blueprint: next });
});

/** POST /api/v1/org/teams */
orgRouter.post("/teams", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const input = req.body as Partial<OrgTeam>;
  if (!input.name || !input.chair_id || !input.department_id) {
    res.status(400).json({ error: "name, chair_id, and department_id are required" }); return;
  }
  if (!blueprint.chairs.find((c) => c.id === input.chair_id)) { res.status(404).json({ error: "chair not found" }); return; }
  const dept = blueprint.departments.find((d) => d.id === input.department_id);
  if (!dept) { res.status(404).json({ error: "department not found" }); return; }

  const team: OrgTeam = {
    id: input.id ?? randomUUID(),
    department_id: input.department_id,
    chair_id: input.chair_id,
    name: input.name,
    domain: obNormalizeDomain(String(input.domain ?? "ops")) || "ops",
    status: "active",
    kpis: Array.isArray(input.kpis) ? input.kpis : ["throughput"],
    cadence: typeof input.cadence === "object" && input.cadence ? input.cadence : obDefaultCadence(),
    authority: typeof input.authority === "object" && input.authority ? input.authority : {},
    budget_cap_daily: typeof input.budget_cap_daily === "number" ? input.budget_cap_daily : 50,
    risk_ceiling: typeof input.risk_ceiling === "number" ? input.risk_ceiling : 75,
  };

  const nextDepts = blueprint.departments.map((d) =>
    d.id === input.department_id ? { ...d, team_ids: [...d.team_ids, team.id] } : d
  );
  const next = obWithMetadata({ ...blueprint, teams: [...blueprint.teams, team], departments: nextDepts }, userId, "team_added");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(201).json({ team, blueprint: next });
});

/** PATCH /api/v1/org/teams/:teamId/status */
orgRouter.patch("/teams/:teamId/status", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const status = String(req.body?.status ?? "");
  if (!obIsValidOrgStatus(status)) { res.status(400).json({ error: "status must be active|paused|retired" }); return; }
  if (!blueprint.teams.find((t) => t.id === req.params.teamId)) { res.status(404).json({ error: "team not found" }); return; }

  const next = obWithMetadata({
    ...blueprint,
    teams: blueprint.teams.map((t) => t.id === req.params.teamId ? { ...t, status: status as OrgStatus } : t),
  }, userId, "team_status_updated");
  obPersistOrgBlueprint(workspaceId, next);
  res.status(200).json({ blueprint: next });
});

/** POST /api/v1/org/policies/scopes */
orgRouter.post("/policies/scopes", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const scopeType = String(req.body?.scope_type ?? "");
  const scopeId = String(req.body?.scope_id ?? "");
  const policy = (req.body?.policy ?? {}) as ScopedPolicy;

  let next: OrgBlueprint;
  if (scopeType === "global") {
    next = obWithMetadata({ ...blueprint, policy_scopes: { ...blueprint.policy_scopes, global: policy } }, userId, "global_policy_updated");
  } else if (scopeType === "domain") {
    next = obWithMetadata({ ...blueprint, policy_scopes: { ...blueprint.policy_scopes, domains: { ...blueprint.policy_scopes.domains, [scopeId]: policy } } }, userId, "domain_policy_updated");
  } else if (scopeType === "team") {
    next = obWithMetadata({ ...blueprint, policy_scopes: { ...blueprint.policy_scopes, teams: { ...blueprint.policy_scopes.teams, [scopeId]: policy } } }, userId, "team_policy_updated");
  } else {
    res.status(400).json({ error: "scope_type must be global|domain|team" }); return;
  }

  obPersistOrgBlueprint(workspaceId, next);
  res.status(200).json({ blueprint: next });
});

/** POST /api/v1/org/delegations */
orgRouter.post("/delegations", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId, userId, role } = req.ctx!;
  const existing = obLatestDelegations(workspaceId) ?? obDefaultDelegations();
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!blueprint) { res.status(404).json({ error: "org blueprint not found" }); return; }

  const targetType = String(req.body?.target_type ?? "");
  if (targetType !== "department" && targetType !== "team") {
    res.status(400).json({ error: "target_type must be department|team" }); return;
  }

  const chairId = String(req.body?.chair_id ?? "");
  if (!chairId) { res.status(400).json({ error: "chair_id is required" }); return; }
  if (!blueprint.chairs.find((c) => c.id === chairId)) { res.status(404).json({ error: "chair not found" }); return; }

  const request: DelegationRequest = {
    id: randomUUID(),
    target_type: targetType as DelegationTargetType,
    status: "pending",
    chair_id: chairId,
    department_id: req.body?.department_id ? String(req.body.department_id) : undefined,
    requested_by: userId,
    created_at: obNowIso(),
    proposal: (req.body?.proposal ?? {}) as Record<string, unknown>,
  };

  const manualOnly = req.body?.manual_approval_only === true;
  const canAutoApprove = obDelegationAutoApproveEnabled(blueprint) && !manualOnly && (role === "admin" || role === "operator");

  if (canAutoApprove) {
    const approved: DelegationRequest = { ...request, status: "approved", decided_at: obNowIso(), decided_by: userId, reason: "auto_approved_by_org_policy" };
    const applied = obApplyApprovedDelegation(blueprint, approved, userId);
    if ("error" in applied) { res.status(applied.status).json({ error: applied.error }); return; }
    obPersistOrgBlueprint(workspaceId, applied.blueprint);
    obPersistDelegations(workspaceId, { ...existing, requests: [approved, ...existing.requests] });
    res.status(201).json({ request: approved, autoApproved: true, blueprint: applied.blueprint });
    return;
  }

  obPersistDelegations(workspaceId, { ...existing, requests: [request, ...existing.requests] });
  res.status(201).json({ request, autoApproved: false });
});

/** POST /api/v1/org/delegations/:id/approve */
orgRouter.post("/delegations/:id/approve", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const delegations = obLatestDelegations(workspaceId);
  const blueprint = obLatestOrgBlueprint(workspaceId);
  if (!delegations || !blueprint) { res.status(404).json({ error: "org state not initialized" }); return; }

  const request = delegations.requests.find((r) => r.id === req.params.id);
  if (!request || request.status !== "pending") { res.status(404).json({ error: "pending delegation not found" }); return; }

  const applied = obApplyApprovedDelegation(blueprint, request, userId);
  if ("error" in applied) { res.status(applied.status).json({ error: applied.error }); return; }

  const nextDelegations: OrgDelegations = {
    ...delegations,
    requests: delegations.requests.map((r) =>
      r.id === req.params.id ? { ...r, status: "approved" as DelegationStatus, decided_at: obNowIso(), decided_by: userId } : r
    ),
  };
  obPersistOrgBlueprint(workspaceId, applied.blueprint);
  obPersistDelegations(workspaceId, nextDelegations);
  res.status(200).json({ blueprint: applied.blueprint, delegations: nextDelegations });
});

/** POST /api/v1/org/delegations/:id/reject */
orgRouter.post("/delegations/:id/reject", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const delegations = obLatestDelegations(workspaceId);
  if (!delegations) { res.status(404).json({ error: "delegation queue not initialized" }); return; }

  const nextDelegations: OrgDelegations = {
    ...delegations,
    requests: delegations.requests.map((r) =>
      r.id === req.params.id
        ? { ...r, status: "rejected" as DelegationStatus, reason: req.body?.reason ? String(req.body.reason) : "rejected", decided_at: obNowIso(), decided_by: userId }
        : r
    ),
  };
  obPersistDelegations(workspaceId, nextDelegations);
  res.status(200).json(nextDelegations);
});

/** POST /api/v1/org/blueprint/rollback */
orgRouter.post("/blueprint/rollback", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const version = Number(req.body?.version);
  if (!Number.isInteger(version) || version < 1) { res.status(400).json({ error: "version must be a positive integer" }); return; }

  const versions = readJson<OrgBlueprint[]>(obBlueprintKey(workspaceId), []);
  if (version > versions.length) { res.status(404).json({ error: "org blueprint version not found" }); return; }

  const restored = versions[version - 1]!;
  const next = obWithMetadata(restored, userId, `rollback_from_v${version}`);
  obPersistOrgBlueprint(workspaceId, next);
  res.status(201).json({ rolled_back_from: version, new_version: versions.length + 1, blueprint: next });
});
