/**
 * Governing artifacts of commons-board.
 *
 * Artifacts are authoritative configuration. Agents read artifacts and act on
 * them; agents never write artifacts. Every artifact is versioned, validated
 * against a JSON schema on write, and hash-chained into the governance record.
 *
 * See planning/artifacts.md for the full contract.
 *
 * ADVISORY: All artifacts are advisory outputs produced by AI workers and
 * require review and sign-off by qualified professionals before operational
 * use. See professional_review_manifest for the required review checklist.
 */

export type GovernanceMode = "business" | "collective";
export type AutonomyMode = "advisor" | "orchestrator" | "autopilot";
export type ExecutionMode = "sim" | "live";

export type ArtifactType =
  | "business_profile"
  | "objective_config"
  | "autonomy_policy"
  | "cadence_protocol"
  | "agent_blueprint"
  | "collective_config"
  | "venture_profile"
  | "launch_plan"
  | "tooling_plan"
  | "financial_policy"
  | "service_catalog"
  | "member_interaction_protocol"
  | "earnings_distribution_model"
  | "dispute_resolution_protocol"
  | "onboarding_track"
  | "professional_review_manifest";

/** 1. business_profile.json — who the organization is. */
export interface BusinessProfile {
  org_id: string;
  org_name: string;
  governance_mode: GovernanceMode;
  description: string;
  industry: string;
  primary_domain: string;
  operating_since: string | null;
  location: {
    primary: string;
    regions: string[];
  };
  size: {
    headcount: number;
    member_count: number | null;
  };
  external_systems: string[];
  created_at: string;
  schema_version: string;
}

/** 2. objective_config.json — what the organization is trying to accomplish. */
export interface ObjectiveConfig {
  org_id: string;
  primary_objectives: Array<{
    id: string;
    description: string;
    type: "revenue" | "mission" | "growth" | "sustainability" | "service" | "other";
    priority: number;
    success_criteria: string[];
    target_date: string | null;
  }>;
  kpis: Array<{
    id: string;
    name: string;
    unit: string;
    current_value: number | null;
    target_value: number | null;
    reporting_cadence: "daily" | "weekly" | "monthly";
  }>;
  constraints: string[];
  schema_version: string;
}

/** 3. autonomy_policy.json — how much the platform can do without asking. */
export interface AutonomyPolicy {
  org_id: string;
  autonomy_mode: AutonomyMode;
  execution_mode: ExecutionMode;
  approval_thresholds: {
    financial_spend_auto_limit: number;
    outreach_auto_limit: number;
    content_publish_requires_approval: boolean;
    external_write_requires_approval: boolean;
  };
  disabled_capabilities: string[];
  hr_agent_enabled: boolean;
  per_person_analytics_enabled: boolean;
  slack_dm_enabled: boolean;
  slack_channel_whitelist: string[];
  risk_escalation_threshold: number;
  blast_radius_escalation_threshold: string;
  schema_version: string;
}

/** 4. cadence_protocol.json — when things run. */
export interface CadenceProtocol {
  org_id: string;
  daily: CadenceWindow & { output: "pulse" | "silent" };
  weekly: CadenceWindow & {
    run_on: Weekday;
    output: "brief" | "silent";
    chairs_included: string[]; // ["all"] or explicit chair ids
  };
  monthly: {
    enabled: boolean;
    run_on_day: number;
    output: "review" | "silent";
    delivery: DeliveryTarget[];
  };
  schema_version: string;
}

export interface CadenceWindow {
  enabled: boolean;
  run_at: string; // HH:MM
  timezone: string;
  delivery: DeliveryTarget[];
}

export type DeliveryTarget = "slack" | "crew-bridge" | "email";
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ChairDomain =
  | "finance"
  | "ops"
  | "growth"
  | "legal"
  | "hr"
  | "product"
  | "it"
  | "security"
  | "strategy"
  | "rnd"
  | "sales"
  | "custom";

/** A labor-commons specialist reference backing a chair or worker agent. */
export interface LaborCommonsRef {
  specialist_slug: string;
  catalog_path: string;
  role: "primary" | "supporting";
  pinned_ref: string | null;
}

/** 5. agent_blueprint.json — which agents exist and which specialists back them. */
export interface AgentBlueprint {
  org_id: string;
  chairs: Array<{
    chair_id: string;
    name: string;
    domain: ChairDomain;
    description: string;
    labor_commons_refs: LaborCommonsRef[];
    scope: {
      owns: string[];
      refuses: string[];
      escalates_to: string[];
    };
    worker_agents: Array<{
      agent_id: string;
      name: string;
      labor_commons_ref: string | null;
      task_scope: string[];
    }>;
    approval_required_for: string[];
    catalog_gap?: {
      function_description: string;
      gap_id: string;
      submitted_to_labor_commons: boolean;
    };
  }>;
  schema_version: string;
}

/** 6. collective_config.json — how a collective governs itself (collective mode only). */
export interface CollectiveConfig {
  org_id: string;
  membership: {
    member_roles: Array<"member" | "steward" | "coordinator" | "observer">;
    quorum_threshold: number;
    active_member_count: number;
  };
  voting: {
    standard_vote_duration_hours: number;
    urgent_vote_duration_hours: number;
    vote_method: "simple_majority" | "supermajority" | "consensus" | "ranked_choice";
    supermajority_threshold: number | null;
    decisions_requiring_vote: string[];
    decisions_requiring_consensus: string[];
  };
  contribution_tracking: {
    enabled: boolean;
    tracked_actions: Array<"vote" | "approval" | "meeting_attendance" | "task_completion">;
  };
  amendment_protocol: {
    proposal_requires: "any_member" | "steward" | "coordinator";
    notice_period_hours: number;
    amendment_vote_method: "supermajority" | "consensus";
  };
  schema_version: string;
}

/** 7. service_catalog.json — what the org offers, at what terms, and to whom. */
export interface ServiceCatalog {
  org_id: string;
  schema_version: string;
  service_verticals: Array<{
    id: string;
    name: string;
    description: string;
    status: "active" | "planned" | "suspended";
    launch_date: string | null;
  }>;
  delivery_terms: {
    service_radius_miles: number;
    delivery_windows: string[];
    excluded_zones: string[];
    minimum_order_value: number | null;
    average_delivery_time_minutes: number | null;
  };
  fee_structure: {
    delivery_member_rate_pct: number;
    business_member_rate_pct: number;
    consumer_delivery_fee_range: { min: number; max: number };
    surge_multiplier_max: number;
    fee_change_requires: "member_vote" | "board_approval" | "coordinator";
  };
  advisory_notice: string;
}

/** 8. member_interaction_protocol.json — how member classes interact operationally. */
export interface MemberInteractionProtocol {
  org_id: string;
  schema_version: string;
  delivery_member_capabilities: string[];
  business_member_capabilities: string[];
  shared_visibility: string[];
  order_flow_stages: Array<{
    stage_id: string;
    name: string;
    actor: "consumer" | "business_member" | "platform" | "delivery_member";
    action: string;
    timeout_minutes: number | null;
    on_timeout: string | null;
  }>;
  handoff_protocol: {
    pickup_confirmation_required: boolean;
    proof_of_delivery_required: boolean;
    photo_required: boolean;
    contactless_default: boolean;
    id_verification_categories: string[];
  };
  communication_channels: Array<{
    channel: string;
    parties: string[];
    purpose: string;
  }>;
  advisory_notice: string;
}

/** 9. earnings_distribution_model.json — how platform revenue flows to members. */
export interface EarningsDistributionModel {
  org_id: string;
  schema_version: string;
  gross_revenue_sources: string[];
  distribution_waterfall: Array<{
    step: number;
    name: string;
    recipient: string;
    rate_pct: number | null;
    fixed_amount: number | null;
    description: string;
  }>;
  earnings_floor: {
    enabled: boolean;
    floor_per_hour_usd: number;
    basis: "active_time" | "on_shift_time" | "total_time";
    enforcement: string;
  };
  income_smoothing: {
    enabled: boolean;
    fund_name: string;
    max_weekly_per_member_usd: number | null;
    max_weeks_per_year: number | null;
    fund_target_balance_usd: number | null;
    approval_required_above_usd: number | null;
  };
  settlement_cadence: "daily" | "weekly" | "biweekly";
  surplus_distribution: {
    method: "equal_per_member" | "proportional_to_hours" | "proportional_to_deliveries" | "mixed";
    frequency: "quarterly" | "semi_annual" | "annual";
    reserve_rate_pct: number;
    requires_member_vote: boolean;
  };
  advisory_notice: string;
}

/** 10. dispute_resolution_protocol.json — escalation paths for conflicts between member classes. */
export interface DisputeResolutionProtocol {
  org_id: string;
  schema_version: string;
  dispute_categories: Array<{
    id: string;
    name: string;
    parties: string[];
    initial_handler: string;
    escalation_path: string[];
    resolution_sla_hours: number;
    examples: string[];
  }>;
  adjudication_authority: {
    first_level: string;
    appeal_level: string;
    final_authority: string;
  };
  evidence_requirements: string[];
  bias_monitoring: {
    enabled: boolean;
    review_cadence: string;
    reviewer: string;
  };
  advisory_notice: string;
}

/** 11. onboarding_track.json — member onboarding tracks per class. */
export interface OnboardingTrack {
  org_id: string;
  schema_version: string;
  tracks: Array<{
    track_id: string;
    member_class: "delivery_member" | "business_member";
    track_name: string;
    stages: Array<{
      stage_id: string;
      name: string;
      required: boolean;
      steps: Array<{
        step_id: string;
        name: string;
        type: "document" | "certification" | "payment" | "training" | "verification" | "agreement" | "setup";
        description: string;
        blocking: boolean;
      }>;
      completion_criteria: string;
    }>;
    obligations_on_completion: string[];
    advisory_notice: string;
  }>;
}

/** 12. professional_review_manifest.json — required professional sign-offs before go-live. */
export interface ProfessionalReviewManifest {
  org_id: string;
  schema_version: string;
  advisory_statement: string;
  review_items: Array<{
    id: string;
    category: "legal" | "financial" | "insurance" | "regulatory" | "food_safety" | "labor" | "technology" | "governance";
    discipline: string;
    reviewer_type: string;
    scope: string;
    artifacts_covered: string[];
    status: "required" | "under_review" | "approved";
    reviewer_name: string | null;
    review_date: string | null;
    notes: string | null;
  }>;
  go_live_gate: {
    requires_all_approved: boolean;
    minimum_required_categories: string[];
  };
}

/** Discriminated mapping from artifact type to its payload shape. */
export interface ArtifactPayloadMap {
  business_profile: BusinessProfile;
  objective_config: ObjectiveConfig;
  autonomy_policy: AutonomyPolicy;
  cadence_protocol: CadenceProtocol;
  agent_blueprint: AgentBlueprint;
  collective_config: CollectiveConfig;
  venture_profile: Record<string, unknown>;
  launch_plan: Record<string, unknown>;
  tooling_plan: Record<string, unknown>;
  financial_policy: Record<string, unknown>;
  service_catalog: ServiceCatalog;
  member_interaction_protocol: MemberInteractionProtocol;
  earnings_distribution_model: EarningsDistributionModel;
  dispute_resolution_protocol: DisputeResolutionProtocol;
  onboarding_track: OnboardingTrack;
  professional_review_manifest: ProfessionalReviewManifest;
}

export type ArtifactPayload = ArtifactPayloadMap[ArtifactType];

export const CURRENT_ARTIFACT_SCHEMA_VERSION = "1.0" as const;
