import type { LaunchAnswers, LaunchArtifacts } from "./types.js";

function withDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

export function generateLaunchArtifacts(answers: LaunchAnswers): LaunchArtifacts {
  const l1 = answers.L1 ?? {};
  const l2 = answers.L2 ?? {};
  const l3 = answers.L3 ?? {};
  const l5 = answers.L5 ?? {};
  const l6 = answers.L6 ?? {};

  const chosenMarketProblem = `${withDefault(l2.industries_of_interest, ["services"])[0]}: ${withDefault(l2.problems_to_solve, ["operational inefficiency"])[0]}`;

  const ventureProfile = {
    chosen_market_problem: chosenMarketProblem,
    target_icp: withDefault(l3.target_icp, "SMB operators"),
    offer_pricing_hypothesis: `${withDefault(l3.offer, "Operational acceleration package")} @ ${withDefault(l3.pricing_hypothesis, "$500-$1500/mo")}`,
    differentiation: withDefault(l2.unfair_advantages, ["execution speed"])[0],
    preferred_sales_motion: withDefault(l1.preferred_sales_motion, "outbound")
  };

  const experimentsBacklog = [
    "Landing page value proposition test",
    "Cold outreach sequence A/B test",
    "ICP message-market fit interviews",
    "Pricing page clarity test",
    "Offer guarantee variant test",
    "Referral ask in onboarding flow",
    "Case study one-pager draft",
    "Pipeline stage conversion audit",
    "Weekly founder time-block optimization",
    "Onboarding checklist reduction test"
  ];

  const launchPlan = {
    milestones_14_30_60_90: {
      day_14: ["Define offer", "Publish landing draft", "First 25 outreach messages"],
      day_30: ["Run 2 experiments", "First 5 qualified conversations"],
      day_60: ["First paying customer", "Document repeatable outreach workflow"],
      day_90: ["Stabilize pipeline", "Reach baseline retention signal"]
    },
    experiments_backlog: experimentsBacklog,
    success_metrics: [
      "qualified_conversations_per_week",
      "proposal_to_close_rate",
      "weekly_revenue",
      "runway_months"
    ]
  };

  const toolingPlan = {
    required_tools: [
      { category: "domain", provider: withDefault(l5.domain_provider, "none") },
      { category: "email", provider: withDefault(l5.email_provider, "none") },
      { category: "landing", provider: withDefault(l5.landing_stack, "none") },
      { category: "crm", provider: withDefault(l5.crm_choice, "none") },
      { category: "billing", provider: withDefault(l5.billing_choice, "none") }
    ],
    connection_status: {
      domain: "pending",
      email: "pending",
      landing: "pending",
      crm: "pending",
      billing: "pending"
    }
  };

  const forbidden = Array.from(
    new Set([
      ...withDefault(l6.forbidden_categories, []),
      "payroll",
      "debt/loans",
      "legal filings",
      "advertising spend",
      "contractor payments",
      "financial account changes"
    ])
  );

  const financialPolicy = {
    currency: withDefault(l6.currency, "USD"),
    daily_spend_cap: withDefault(l6.daily_spend_cap, 0),
    weekly_spend_cap: withDefault(l6.weekly_spend_cap, 0),
    per_transaction_cap: withDefault(l6.per_transaction_cap, 0),
    categories: {
      allowed: ["software_tools", "hosting", "domain"],
      forbidden
    },
    approvals: {
      required_over_amount: withDefault(l6.approval_required_over_amount, 0),
      required_for_categories: withDefault(l6.approval_required_for_categories, ["advertising spend", "domain purchase"]),
      approver_roles: withDefault(l6.approver_roles, ["admin"])
    },
    founder_constraints: {
      time_available_per_week_hours: withDefault(l1.time_available_per_week_hours, 10),
      budget_range: withDefault(l1.budget_range, "$0-$100")
    }
  };

  return {
    venture_profile: ventureProfile,
    launch_plan: launchPlan,
    tooling_plan: toolingPlan,
    financial_policy: financialPolicy
  };
}

type AutonomyMode = "advisor" | "orchestrator" | "autopilot";

export type ExecutionArtifactSet = {
  business_profile: Record<string, unknown>;
  objective_config: Record<string, unknown>;
  autonomy_policy: Record<string, unknown>;
  cadence_protocol: Record<string, unknown>;
};

export function mapLaunchToExecutionArtifacts(
  orgId: string,
  artifacts: LaunchArtifacts,
  answers: LaunchAnswers
): ExecutionArtifactSet {
  const l1 = answers.L1 ?? {};
  const l2 = answers.L2 ?? {};
  const l5 = answers.L5 ?? {};
  const l6 = answers.L6 ?? {};
  const vp = artifacts.venture_profile as {
    chosen_market_problem?: string;
    target_icp?: string;
    offer_pricing_hypothesis?: string;
    differentiation?: string;
    preferred_sales_motion?: string;
  };
  const lp = artifacts.launch_plan as {
    success_metrics?: string[];
    milestones_14_30_60_90?: Record<string, string[]>;
    experiments_backlog?: string[];
  };
  const fp = artifacts.financial_policy as {
    categories?: { forbidden?: string[] };
    approvals?: { required_over_amount?: number };
  };

  const riskToMode: Record<string, AutonomyMode> = {
    low: "advisor",
    med: "orchestrator",
    high: "autopilot",
  };
  const autonomyMode: AutonomyMode = riskToMode[l1.risk_appetite ?? "low"] ?? "advisor";

  const industries = l2.industries_of_interest ?? ["services"];
  const industry = industries[0] ?? "services";

  const externalSystems = [
    l5.email_provider,
    l5.crm_choice,
    l5.billing_choice,
    l5.landing_stack,
    l5.domain_provider,
  ].filter((s): s is string => typeof s === "string" && s !== "none" && s.length > 0);

  const business_profile: Record<string, unknown> = {
    org_id: orgId,
    org_name: vp.target_icp ? `${industry} Venture` : "New Venture",
    governance_mode: "business",
    description: [vp.chosen_market_problem, vp.offer_pricing_hypothesis]
      .filter(Boolean)
      .join(" — ") || "Early-stage venture configured via board setup",
    industry,
    primary_domain: vp.preferred_sales_motion ?? "services",
    operating_since: null,
    location: { primary: "Remote", regions: [] },
    size: { headcount: 1, member_count: null },
    external_systems: externalSystems,
    created_at: new Date().toISOString(),
    schema_version: "1.0",
  };

  type ObjType = "revenue" | "mission" | "growth" | "sustainability" | "service" | "other";
  type Objective = { id: string; description: string; type: ObjType; priority: number; success_criteria: string[]; target_date: string | null };
  const milestones = (lp.milestones_14_30_60_90 ?? {}) as Record<string, string[]>;
  const objectives: Objective[] = Object.entries(milestones).map(([period, items], i) => ({
    id: `obj-${period}`,
    description: `${period.replace("_", " ")} milestone: ${(items as string[])[0] ?? ""}`,
    type: "growth",
    priority: i + 1,
    success_criteria: items as string[],
    target_date: null,
  }));
  if (objectives.length === 0) {
    objectives.push({
      id: "obj-default",
      description: "Validate product-market fit and achieve first paying customer",
      type: "revenue",
      priority: 1,
      success_criteria: ["First qualified conversation", "First paying customer"],
      target_date: null,
    });
  }

  const metrics = (lp.success_metrics ?? ["qualified_conversations_per_week", "weekly_revenue"]) as string[];
  const kpis = metrics.map((name, i) => ({
    id: `kpi-${i + 1}`,
    name: name.replace(/_/g, " "),
    unit: name.includes("revenue") || name.includes("spend") ? "USD" : "count",
    current_value: null,
    target_value: null,
    reporting_cadence: "weekly" as const,
  }));

  const objective_config: Record<string, unknown> = {
    org_id: orgId,
    primary_objectives: objectives,
    kpis,
    constraints: fp.categories?.forbidden ?? [],
    schema_version: "1.0",
  };

  const spendLimit = autonomyMode === "advisor" ? 0 : autonomyMode === "orchestrator" ? 50 : 200;

  const autonomy_policy: Record<string, unknown> = {
    org_id: orgId,
    autonomy_mode: autonomyMode,
    execution_mode: "sim",
    approval_thresholds: {
      financial_spend_auto_limit: spendLimit,
      outreach_auto_limit: autonomyMode === "autopilot" ? 50 : 10,
      content_publish_requires_approval: autonomyMode !== "autopilot",
      external_write_requires_approval: autonomyMode === "advisor",
    },
    disabled_capabilities: fp.categories?.forbidden ?? [],
    hr_agent_enabled: false,
    per_person_analytics_enabled: false,
    slack_dm_enabled: false,
    slack_channel_whitelist: [],
    risk_escalation_threshold: autonomyMode === "advisor" ? 30 : autonomyMode === "orchestrator" ? 60 : 80,
    blast_radius_escalation_threshold: autonomyMode === "advisor" ? "low" : "medium",
    schema_version: "1.0",
  };

  const cadence_protocol: Record<string, unknown> = {
    org_id: orgId,
    daily: {
      enabled: true,
      run_at: "07:00",
      timezone: "UTC",
      delivery: ["crew-bridge"],
      output: "pulse",
    },
    weekly: {
      enabled: true,
      run_at: "09:00",
      timezone: "UTC",
      delivery: ["crew-bridge"],
      run_on: "monday",
      output: "brief",
      chairs_included: ["all"],
    },
    monthly: {
      enabled: false,
      run_on_day: 1,
      output: "review",
      delivery: [],
    },
    schema_version: "1.0",
  };

  return { business_profile, objective_config, autonomy_policy, cadence_protocol };
}

export function validateLaunchArtifacts(artifacts: LaunchArtifacts): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const venture = artifacts.venture_profile;
  if (!venture.chosen_market_problem) errors.push("venture_profile.chosen_market_problem is required");
  if (!venture.target_icp) errors.push("venture_profile.target_icp is required");
  if (!venture.offer_pricing_hypothesis) errors.push("venture_profile.offer_pricing_hypothesis is required");
  if (!venture.differentiation) errors.push("venture_profile.differentiation is required");

  const launch = artifacts.launch_plan;
  if (!launch.milestones_14_30_60_90) errors.push("launch_plan.milestones_14_30_60_90 is required");
  if (!Array.isArray(launch.experiments_backlog)) errors.push("launch_plan.experiments_backlog must be an array");
  if (!Array.isArray(launch.success_metrics)) errors.push("launch_plan.success_metrics must be an array");

  const tooling = artifacts.tooling_plan;
  if (!Array.isArray(tooling.required_tools)) errors.push("tooling_plan.required_tools must be an array");
  if (!tooling.connection_status) errors.push("tooling_plan.connection_status is required");

  const financial = artifacts.financial_policy;
  if (typeof financial.currency !== "string") errors.push("financial_policy.currency is required");
  if (typeof financial.daily_spend_cap !== "number") errors.push("financial_policy.daily_spend_cap is required");
  if (typeof financial.weekly_spend_cap !== "number") errors.push("financial_policy.weekly_spend_cap is required");
  if (typeof financial.per_transaction_cap !== "number") errors.push("financial_policy.per_transaction_cap is required");

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
