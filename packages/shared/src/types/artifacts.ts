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
  | "collective_config";

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

// UI rendering hint only — no governance logic derives from this value.
// Governance (owns, refuses, escalates_to) comes from labor-commons spec fields.
// Known values: finance, ops, growth, legal, hr, product, it, security, strategy, rnd, sales, custom
// Any string is valid; UI falls back to slate-gray for unknown values.
export type ChairDomain = string;

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
      /** Per-agent model override for inference calls (e.g. "Qwen/Qwen2.5-7B-Instruct"). Falls back to chair model then provider default. */
      model?: string;
    }>;
    approval_required_for: string[];
    catalog_gap?: {
      function_description: string;
      gap_id: string;
      submitted_to_labor_commons: boolean;
    };
    /** Per-chair model override for reasoning calls. Falls back to provider default. */
    model?: string;
  }>;
  /** Model used for board synthesis (merging chair results). Falls back to provider default. */
  synthesis_model?: string;
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

/** Discriminated mapping from artifact type to its payload shape. */
export interface ArtifactPayloadMap {
  business_profile: BusinessProfile;
  objective_config: ObjectiveConfig;
  autonomy_policy: AutonomyPolicy;
  cadence_protocol: CadenceProtocol;
  agent_blueprint: AgentBlueprint;
  collective_config: CollectiveConfig;
}

export type ArtifactPayload = ArtifactPayloadMap[ArtifactType];

export const CURRENT_ARTIFACT_SCHEMA_VERSION = "1.0" as const;
