/**
 * Board orchestration — routes requests to chairs and builds roadmaps.
 *
 * Ported from mother-board lib/board-orchestration.ts.
 * Sanitized: removed "cio" domain; domain capabilities enriched from labor-commons
 * specialist definitions at resolution time (Phase 3). The static domain catalog
 * here provides defaults for orgs that haven't yet resolved specialists.
 */
import type { BoardDomain, BoardRequestPriority, BoardRequestRecord, BoardRoadmapPhase } from "@commons-board/shared";
import { domainRelevanceScores } from "../services/model-native-semantics.js";

type OrgChair = {
  chair_id: string;
  name: string;
  domain: string;
  status?: "active" | "paused" | "retired";
  labor_commons_refs?: Array<{ specialist_slug: string; role: "primary" | "supporting" }>;
};

type OrgBlueprint = {
  chairs?: OrgChair[];
};

export type RoutingInput = {
  title: string;
  request: string;
  targetChairId?: string;
  targetDomain?: BoardDomain;
  inferredDomain?: BoardDomain;
  autoRoute?: boolean;
};

export type RoutingResult = {
  chairId: string;
  domain: BoardDomain;
  routingMode: "explicit" | "auto";
  reason: string;
};

export type DomainCapability = {
  domain: BoardDomain;
  label: string;
  allowed_action_categories: string[];
  required_approvals: string[];
  primary_outcomes: string[];
};

const domainCatalog: Record<BoardDomain, DomainCapability> = {
  it: {
    domain: "it",
    label: "Information Technology",
    allowed_action_categories: ["infrastructure_change", "tooling_rollout", "automation", "service_operations", "architecture_roadmap", "platform_integration"],
    required_approvals: ["production_change_window", "high_risk_change"],
    primary_outcomes: ["uptime", "service quality", "support throughput", "delivery predictability"]
  },
  security: {
    domain: "security",
    label: "Security",
    allowed_action_categories: ["controls_program", "risk_assessment", "incident_response", "compliance_enablement"],
    required_approvals: ["production_access", "regulatory_exception"],
    primary_outcomes: ["risk reduction", "compliance readiness", "incident containment"]
  },
  hr: {
    domain: "hr",
    label: "Human Resources",
    allowed_action_categories: ["workforce_plan", "hiring", "org_design", "policy_rollout"],
    required_approvals: ["headcount_increase", "policy_exception"],
    primary_outcomes: ["staffing readiness", "retention", "org capacity"]
  },
  rnd: {
    domain: "rnd",
    label: "Research and Development",
    allowed_action_categories: ["technical_discovery", "prototype", "research_backlog", "innovation_program"],
    required_approvals: ["new_vendor_spend", "production_experiment"],
    primary_outcomes: ["validated learning", "technical feasibility", "future roadmap options"]
  },
  finance: {
    domain: "finance",
    label: "Finance",
    allowed_action_categories: ["budget_plan", "forecasting", "spend_controls", "unit_economics"],
    required_approvals: ["capex_commitment", "policy_override"],
    primary_outcomes: ["cash efficiency", "forecast accuracy", "governance"]
  },
  ops: {
    domain: "ops",
    label: "Operations",
    allowed_action_categories: ["process_improvement", "execution_rhythm", "capacity_management", "qa_program"],
    required_approvals: ["vendor_change", "sla_exception"],
    primary_outcomes: ["throughput", "defect reduction", "predictable operations"]
  },
  growth: {
    domain: "growth",
    label: "Growth",
    allowed_action_categories: ["market_experiment", "acquisition", "retention_program", "messaging_iteration"],
    required_approvals: ["paid_media_spend"],
    primary_outcomes: ["pipeline growth", "revenue velocity", "conversion lift"]
  },
  sales: {
    domain: "sales",
    label: "Sales",
    allowed_action_categories: ["pipeline_strategy", "account_expansion", "pricing_offer", "deal_enablement"],
    required_approvals: ["discount_exception"],
    primary_outcomes: ["win rate", "deal velocity", "forecast attainment"]
  },
  legal: {
    domain: "legal",
    label: "Legal",
    allowed_action_categories: ["contracting", "policy_review", "risk_mitigation", "regulatory_preparation"],
    required_approvals: ["material_legal_risk"],
    primary_outcomes: ["contract confidence", "reduced liability", "regulatory readiness"]
  },
  product: {
    domain: "product",
    label: "Product",
    allowed_action_categories: ["roadmap", "discovery", "feature_prioritization", "launch_readiness"],
    required_approvals: ["scope_expansion"],
    primary_outcomes: ["customer value", "time to market", "adoption"]
  },
  strategy: {
    domain: "strategy",
    label: "Strategy",
    allowed_action_categories: ["market_analysis", "portfolio_strategy", "partnership_strategy", "operating_model"],
    required_approvals: ["material_strategy_shift"],
    primary_outcomes: ["clarity of bets", "competitive advantage", "capital efficiency"]
  }
};

function domainFromChairType(type: string): BoardDomain {
  const normalized = type.trim().toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, BoardDomain> = {
    it: "it",
    security: "security",
    hr: "hr",
    rnd: "rnd",
    research: "rnd",
    researchdevelopment: "rnd",
    finance: "finance",
    financeguard: "finance",
    ops: "ops",
    operations: "ops",
    growth: "growth",
    sales: "sales",
    legal: "legal",
    product: "product",
    strategy: "strategy",
    governor: "strategy",
    cio: "it"
  };
  return map[normalized] ?? "ops";
}

function inferDomain(text: string): BoardDomain {
  const ranked = domainRelevanceScores(text);
  return ranked[0]?.score && ranked[0].score >= 0.2 ? ranked[0].domain : "ops";
}

function pickChairForDomain(blueprint: OrgBlueprint, domain: BoardDomain, allowFallback = true): OrgChair | null {
  const chairs = (blueprint.chairs ?? []).filter((c) => !c.status || c.status === "active");
  const exact = chairs.find((c) => domainFromChairType(c.domain) === domain);
  if (exact) return exact;
  if (!allowFallback) return null;
  const fallback = chairs.find((c) => domainFromChairType(c.domain) === "ops");
  return fallback ?? chairs[0] ?? null;
}

export function routeBoardRequest(blueprint: OrgBlueprint, input: RoutingInput): RoutingResult | null {
  const chairs = blueprint.chairs ?? [];
  if (chairs.length === 0) return null;

  if (input.targetChairId) {
    const chair = chairs.find((c) => c.chair_id === input.targetChairId && (!c.status || c.status === "active"));
    if (chair) {
      return { chairId: chair.chair_id, domain: input.targetDomain ?? domainFromChairType(chair.domain), routingMode: "explicit", reason: "target chair specified" };
    }
  }

  if (input.targetDomain) {
    const chair = pickChairForDomain(blueprint, input.targetDomain, false);
    if (chair) {
      return { chairId: chair.chair_id, domain: input.targetDomain, routingMode: "explicit", reason: "target domain specified" };
    }
    return null;
  }

  const inferred = input.inferredDomain ?? inferDomain(`${input.title} ${input.request}`);
  const inferredChair = pickChairForDomain(blueprint, inferred, true);
  if (!inferredChair) return null;
  return {
    chairId: inferredChair.chair_id,
    domain: inferred,
    routingMode: "auto",
    reason: input.autoRoute === false ? "fallback routing" : input.inferredDomain ? "auto-routed by model-native domain inference" : "auto-routed by request intent"
  };
}

export function getDomainCapabilities(): DomainCapability[] {
  return Object.values(domainCatalog);
}

const statusTransitions: Record<string, string[]> = {
  submitted: ["triaged", "rejected"],
  triaged:   ["planned", "rejected", "blocked"],
  planned:   ["approved", "blocked", "rejected"],
  approved:  ["executing", "blocked"],
  executing: ["completed", "blocked"],
  blocked:   ["triaged", "planned", "approved", "executing", "rejected"],
  completed: [],
  rejected:  []
};

export function isValidStatusTransition(from: string, to: string): boolean {
  return (statusTransitions[from] ?? []).includes(to);
}

function daysByPriority(priority: BoardRequestPriority): number {
  if (priority === "critical") return 30;
  if (priority === "high") return 45;
  if (priority === "low") return 90;
  return 60;
}

export function buildRoadmapPhases(request: BoardRequestRecord): BoardRoadmapPhase[] {
  const totalDays = daysByPriority(request.priority);
  const phase1 = Math.max(10, Math.round(totalDays * 0.25));
  const phase2 = Math.max(15, Math.round(totalDays * 0.35));
  const phase3 = Math.max(15, totalDays - phase1 - phase2);
  const owner = request.target_chair_id;

  const shared = { dependencies: request.dependency_ids, owners: [owner] };
  return [
    {
      name: "Discovery and Alignment",
      duration_days: phase1,
      objective: `Establish scope, constraints, and operating model for ${request.target_domain.toUpperCase()} execution.`,
      milestones: ["Stakeholder intake completed", "Baseline KPIs and risk envelope agreed", "Execution backlog drafted"],
      ...shared
    },
    {
      name: "Implementation",
      duration_days: phase2,
      objective: "Execute the highest-leverage initiatives with governance checkpoints.",
      milestones: ["Core workstreams activated", "Cross-domain dependencies assigned", "Midpoint health review completed"],
      ...shared
    },
    {
      name: "Scale and Stabilize",
      duration_days: phase3,
      objective: "Operationalize repeatable cadence, reporting, and ownership transfer.",
      milestones: ["Runbooks and controls published", "Outcome metrics validated", "Next-quarter roadmap proposed"],
      ...shared
    }
  ];
}

export function buildRoadmapSummary(request: BoardRequestRecord): string {
  const domainLabel = domainCatalog[request.target_domain]?.label ?? request.target_domain.toUpperCase();
  return `${domainLabel} roadmap for "${request.title}" with phased execution, dependency governance, and measurable outcomes.`;
}
