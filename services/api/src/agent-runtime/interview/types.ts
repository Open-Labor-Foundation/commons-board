import type { GovernanceMode } from "@commons-board/shared";

export type GovernanceModeValue = GovernanceMode;

export const INTERVIEW_SECTIONS = [
  "S0", // governance mode detection
  "S1", // org identity
  "S2", // org structure + pains
  "S3", // external systems
  "S4", // objectives + kpis
  "S5", // autonomy policy
  "S6", // cadence schedule
  "S7", // hard constraints
  "S8", // collective structure (auto-skipped for business mode)
  "S9"  // review + confirmation
] as const;

export type InterviewSection = (typeof INTERVIEW_SECTIONS)[number];

export type ChairDomain =
  | "finance" | "ops" | "growth" | "legal" | "hr"
  | "product" | "it" | "security" | "strategy" | "rnd" | "sales" | "custom";

export type DeliveryTarget = "slack" | "crew-bridge" | "email";

export type VoteMethod = "simple_majority" | "supermajority" | "consensus" | "ranked_choice";

export type MemberRole = "member" | "steward" | "coordinator" | "observer";

export type InterviewAnswers = {
  S0?: {
    governance_mode?: GovernanceModeValue;
  };
  S1?: {
    org_name?: string;
    description?: string;
    industry?: string;
    primary_domain?: ChairDomain;
    stage?: string;
    operating_since?: string | null;
    location?: { primary?: string; regions?: string[] };
    size?: { headcount?: number; member_count?: number | null };
  };
  S2?: {
    teams?: Array<{ name: string; function: string; headcount?: number }>;
    key_roles?: Array<{ role: string; owner?: string }>;
    top_pains?: string[];
    top_initiatives?: string[];
  };
  S3?: {
    systems?: string[];
  };
  S4?: {
    primary_objective?: string;
    objective_type?: "revenue" | "mission" | "growth" | "sustainability" | "service" | "other";
    success_criteria?: string[];
    target_date?: string | null;
    kpis?: Array<{
      name: string;
      unit: string;
      target_value: number | null;
      reporting_cadence: "daily" | "weekly" | "monthly";
    }>;
    constraints?: string[];
  };
  S5?: {
    autonomy_mode?: "advisor" | "orchestrator" | "autopilot";
    execution_mode?: "sim" | "live";
    risk_appetite?: "low" | "med" | "high";
    slack_channel_whitelist?: string[];
    approvers?: string[];
  };
  S6?: {
    timezone?: string;
    daily_run_at?: string;
    daily_delivery?: DeliveryTarget[];
    weekly_run_on?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
    weekly_run_at?: string;
    weekly_delivery?: DeliveryTarget[];
    monthly_run_on_day?: number;
    monthly_delivery?: DeliveryTarget[];
  };
  S7?: {
    never_do?: string[];
  };
  S8?: {
    active_member_count?: number;
    member_roles?: MemberRole[];
    quorum_threshold?: number;
    vote_method?: VoteMethod;
    standard_vote_duration_hours?: number;
    urgent_vote_duration_hours?: number;
    decisions_requiring_vote?: string[];
    decisions_requiring_consensus?: string[];
  };
  S9?: {
    confirmed?: boolean;
    corrections?: Partial<InterviewAnswers>;
  };
};

export type InterviewArtifacts = {
  business_profile: Record<string, unknown>;
  objective_config: Record<string, unknown>;
  autonomy_policy: Record<string, unknown>;
  cadence_protocol: Record<string, unknown>;
  agent_blueprint: Record<string, unknown>;
  collective_config?: Record<string, unknown>;
};

export type InterviewSessionState = {
  session_id: string;
  org_id: string;
  current_section: InterviewSection;
  completed_sections: InterviewSection[];
  governance_mode: GovernanceModeValue | null;
  answers: InterviewAnswers;
  ready_to_finalize: boolean;
};
