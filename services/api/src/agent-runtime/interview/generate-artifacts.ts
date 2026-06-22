import { CURRENT_ARTIFACT_SCHEMA_VERSION } from "@commons-board/shared";
import type { ChairDomain, GovernanceModeValue, InterviewAnswers, InterviewArtifacts, MemberRole } from "./types.js";

function def<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

const VALID_DOMAINS: ChairDomain[] = [
  "finance", "ops", "growth", "legal", "hr",
  "product", "it", "security", "strategy", "rnd", "sales"
];

function toChairDomain(s: string | undefined): ChairDomain {
  return VALID_DOMAINS.includes(s as ChairDomain) ? (s as ChairDomain) : "custom";
}

function riskThreshold(appetite: "low" | "med" | "high" | undefined): number {
  if (appetite === "low") return 40;
  if (appetite === "high") return 80;
  return 60;
}

function chairName(domain: ChairDomain): string {
  return `${domain.charAt(0).toUpperCase()}${domain.slice(1)} Chair`;
}

export function generateArtifacts(
  answers: InterviewAnswers,
  orgId: string
): InterviewArtifacts {
  const s0 = answers.S0 ?? {};
  const s1 = answers.S1 ?? {};
  const s3 = answers.S3 ?? {};
  const s4 = answers.S4 ?? {};
  const s5 = answers.S5 ?? {};
  const s6 = answers.S6 ?? {};
  const s7 = answers.S7 ?? {};
  const s8 = answers.S8 ?? {};

  const mode: GovernanceModeValue = def(s0.governance_mode, "business");
  const now = new Date().toISOString();

  // ── business_profile ──────────────────────────────────────────────────────
  const businessProfile = {
    org_id: orgId,
    org_name: def(s1.org_name, "Unnamed Organization"),
    governance_mode: mode,
    description: def(s1.description, ""),
    industry: def(s1.industry, "general"),
    primary_domain: def(s1.primary_domain, "ops"),
    operating_since: def(s1.operating_since, null),
    location: {
      primary: def(s1.location?.primary, ""),
      regions: def(s1.location?.regions, [])
    },
    size: {
      headcount: def(s1.size?.headcount, 0),
      member_count: def(s1.size?.member_count, null)
    },
    external_systems: def(s3.systems, []),
    created_at: now,
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
  };

  // ── objective_config ──────────────────────────────────────────────────────
  const objType = def(s4.objective_type, mode === "collective" ? "mission" : "revenue");
  const kpiDefaults = [{
    id: "kpi-1",
    name: "Weekly throughput",
    unit: "tasks",
    current_value: null,
    target_value: 10,
    reporting_cadence: "weekly" as const
  }];
  const kpis = s4.kpis && s4.kpis.length > 0
    ? s4.kpis.map((k, i) => ({
        id: `kpi-${i + 1}`,
        name: k.name,
        unit: k.unit,
        current_value: null,
        target_value: k.target_value,
        reporting_cadence: k.reporting_cadence
      }))
    : kpiDefaults;

  const constraints = [...def(s4.constraints, []), ...def(s7.never_do, [])].filter(
    (c, i, arr) => arr.indexOf(c) === i
  );

  const objectiveConfig = {
    org_id: orgId,
    primary_objectives: [
      {
        id: "obj-1",
        description: def(s4.primary_objective, "Achieve operational stability"),
        type: objType,
        priority: 1,
        success_criteria: def(s4.success_criteria, ["Stable operations", "Team alignment"]),
        target_date: def(s4.target_date, null)
      }
    ],
    kpis,
    constraints,
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
  };

  // ── autonomy_policy ───────────────────────────────────────────────────────
  const autonomyPolicy = {
    org_id: orgId,
    autonomy_mode: def(s5.autonomy_mode, "advisor"),
    execution_mode: def(s5.execution_mode, "sim"),
    approval_thresholds: {
      financial_spend_auto_limit: 0,
      outreach_auto_limit: 0,
      content_publish_requires_approval: true,
      external_write_requires_approval: true
    },
    disabled_capabilities: def(s7.never_do, []),
    hr_agent_enabled: false,
    per_person_analytics_enabled: false,
    slack_dm_enabled: false,
    slack_channel_whitelist: def(s5.slack_channel_whitelist, []),
    risk_escalation_threshold: riskThreshold(s5.risk_appetite),
    blast_radius_escalation_threshold: "medium",
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
  };

  // ── cadence_protocol ──────────────────────────────────────────────────────
  const tz = def(s6.timezone, "America/Chicago");
  const cadenceProtocol = {
    org_id: orgId,
    daily: {
      enabled: true,
      run_at: def(s6.daily_run_at, "08:30"),
      timezone: tz,
      delivery: def(s6.daily_delivery, ["slack"]),
      output: "pulse" as const
    },
    weekly: {
      enabled: true,
      run_at: def(s6.weekly_run_at, "09:00"),
      timezone: tz,
      delivery: def(s6.weekly_delivery, ["slack"]),
      run_on: def(s6.weekly_run_on, "monday"),
      output: "brief" as const,
      chairs_included: []
    },
    monthly: {
      enabled: true,
      run_on_day: def(s6.monthly_run_on_day, 1),
      output: "review" as const,
      delivery: def(s6.monthly_delivery, ["slack"])
    },
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
  };

  // ── agent_blueprint ───────────────────────────────────────────────────────
  const primaryDomain = toChairDomain(s1.primary_domain);
  type ChairEntry = {
    chair_id: string; name: string; domain: ChairDomain; description: string;
    labor_commons_refs: unknown[];
    scope: { owns: string[]; refuses: string[]; escalates_to: string[] };
    worker_agents: Array<{ agent_id: string; name: string; labor_commons_ref: null; task_scope: string[] }>;
    approval_required_for: string[];
  };
  const chairs: ChairEntry[] = [
    {
      chair_id: "finance-1",
      name: "Finance Chair",
      domain: "finance" as ChairDomain,
      description: "Oversees financial health, budgeting, and treasury.",
      labor_commons_refs: [],
      scope: {
        owns: ["budget_approval", "financial_reporting", "expense_policy"],
        refuses: ["hiring_decisions", "product_roadmap"],
        escalates_to: []
      },
      worker_agents: [
        {
          agent_id: "finance-worker-1",
          name: "Finance Analyst",
          labor_commons_ref: null,
          task_scope: ["expense_review", "runway_calculation"]
        }
      ],
      approval_required_for: ["financial_spend_above_threshold"]
    }
  ];

  if (primaryDomain !== "finance") {
    chairs.push({
      chair_id: `${primaryDomain}-1`,
      name: chairName(primaryDomain),
      domain: primaryDomain,
      description: `Manages ${primaryDomain} operations and delivery.`,
      labor_commons_refs: [],
      scope: {
        owns: [`${primaryDomain}_planning`, `${primaryDomain}_reporting`],
        refuses: ["financial_commitments"],
        escalates_to: ["finance-1"]
      },
      worker_agents: [
        {
          agent_id: `${primaryDomain}-worker-1`,
          name: `${chairName(primaryDomain).replace(" Chair", "")} Analyst`,
          labor_commons_ref: null,
          task_scope: [`${primaryDomain}_review`, `${primaryDomain}_metrics`]
        }
      ],
      approval_required_for: ["external_write", "budget_request"]
    });
  }

  const agentBlueprint = {
    org_id: orgId,
    chairs,
    schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
  };

  const artifacts: InterviewArtifacts = {
    business_profile: businessProfile,
    objective_config: objectiveConfig,
    autonomy_policy: autonomyPolicy,
    cadence_protocol: cadenceProtocol,
    agent_blueprint: agentBlueprint
  };

  // ── collective_config (collective mode only) ──────────────────────────────
  if (mode === "collective") {
    const memberRoles: MemberRole[] = def(s8.member_roles, ["member", "steward"]);
    const voteMethod = def(s8.vote_method, "simple_majority");
    artifacts.collective_config = {
      org_id: orgId,
      membership: {
        member_roles: memberRoles,
        quorum_threshold: def(s8.quorum_threshold, 0.5),
        active_member_count: def(s8.active_member_count, 0)
      },
      voting: {
        standard_vote_duration_hours: def(s8.standard_vote_duration_hours, 72),
        urgent_vote_duration_hours: def(s8.urgent_vote_duration_hours, 24),
        vote_method: voteMethod,
        supermajority_threshold: voteMethod === "supermajority" ? 0.67 : null,
        decisions_requiring_vote: def(s8.decisions_requiring_vote, [
          "budget_above_threshold",
          "new_member_admission",
          "artifact_amendment"
        ]),
        decisions_requiring_consensus: def(s8.decisions_requiring_consensus, [
          "dissolution",
          "mission_change"
        ])
      },
      contribution_tracking: {
        enabled: true,
        tracked_actions: ["vote", "approval", "meeting_attendance", "task_completion"]
      },
      amendment_protocol: {
        proposal_requires: "any_member",
        notice_period_hours: 168,
        amendment_vote_method: "supermajority"
      },
      schema_version: CURRENT_ARTIFACT_SCHEMA_VERSION
    };
  }

  return artifacts;
}
