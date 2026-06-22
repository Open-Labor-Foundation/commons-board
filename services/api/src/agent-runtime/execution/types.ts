/**
 * Execution engine types — Action objects, governor decisions, and agent definitions.
 *
 * Ported from mother-board agent-runtime/execution/types.ts.
 * Sanitized:
 *   - Removed venture_profile, launch_plan, tooling_plan from ArtifactsForExecution (Phase 8)
 *   - Removed LaunchArtifacts type (Phase 8)
 *   - org_blueprint uses chair_id/domain (OLF schema) instead of id/agent_type
 *   - Removed launch_outputs from ExecutionRunResult
 */

export type ExecutionMode = "advisor" | "orchestrator" | "autopilot";

export type ImpactRange = {
  p10: number;
  p50: number;
  p90: number;
};

export type BlastRadius = {
  level: "low" | "medium" | "high";
  explanation: string;
};

export type ActionObject = {
  agent_id: string;
  action_type: string;
  evidence: string[];
  assumptions: string[];
  risk_score: number;
  impact_range: ImpactRange;
  blast_radius: BlastRadius;
  approvals_required: number;
  rollback_plan: Record<string, unknown>;
};

export type GovernorDecision = "blocked" | "requires_approval" | "auto_approved";

export type GovernedAction = ActionObject & {
  governor_decision: GovernorDecision;
  governor_reasons: string[];
};

export type AgentDefinition = {
  id: string;
  domain: string;
  kpis: string[];
  authority: Record<string, unknown>;
  cadence: Record<string, unknown>;
  org?: {
    chair_id?: string;
    department_id?: string;
    team_id?: string;
    domain?: string;
    budget_cap_daily?: number;
    department_budget_cap_daily?: number;
    chair_budget_cap_daily?: number;
    risk_ceiling?: number;
  };
};

export type FinancialPolicy = {
  currency: string;
  daily_spend_cap: number;
  weekly_spend_cap: number;
  per_transaction_cap: number;
  categories: {
    allowed: string[];
    forbidden: string[];
  };
  approvals: {
    required_over_amount: number;
    required_for_categories: string[];
    approver_roles: string[];
  };
};

export type ArtifactsForExecution = {
  business_profile: Record<string, unknown>;
  objective_config: Record<string, unknown>;
  autonomy_policy: {
    mode_default: ExecutionMode;
    action_categories: Array<{
      category: string;
      risk_level_default?: string;
      allowed_in_modes: ExecutionMode[];
      approvals_required: number;
      forbidden: boolean;
    }>;
    forbidden_actions: string[];
    channel_policy?: Record<string, unknown>;
  };
  cadence_protocol: Record<string, unknown>;
  agent_blueprint: {
    chairs?: Array<{
      chair_id: string;
      name: string;
      domain: string;
      status: "active" | "paused" | "retired";
      kpis?: string[];
      authority?: Record<string, unknown>;
      cadence?: Record<string, unknown>;
      budget_cap_daily?: number;
      risk_ceiling?: number;
    }>;
    departments?: Array<{
      id: string;
      chair_id: string;
      name: string;
      domain: string;
      status: "active" | "paused" | "retired";
      team_ids?: string[];
      budget_cap_daily?: number;
      risk_ceiling?: number;
    }>;
    teams?: Array<{
      id: string;
      department_id: string;
      chair_id: string;
      name: string;
      domain: string;
      status: "active" | "paused" | "retired";
      kpis?: string[];
      authority?: Record<string, unknown>;
      cadence?: Record<string, unknown>;
      budget_cap_daily?: number;
      risk_ceiling?: number;
    }>;
    policy_scopes?: {
      global?: {
        mode_default?: ExecutionMode;
        forbidden_actions?: string[];
        action_overrides?: Array<{
          category: string;
          allowed_in_modes?: ExecutionMode[];
          approvals_required?: number;
          forbidden?: boolean;
        }>;
      };
      domains?: Record<
        string,
        {
          mode_default?: ExecutionMode;
          forbidden_actions?: string[];
          action_overrides?: Array<{
            category: string;
            allowed_in_modes?: ExecutionMode[];
            approvals_required?: number;
            forbidden?: boolean;
          }>;
        }
      >;
      teams?: Record<
        string,
        {
          mode_default?: ExecutionMode;
          forbidden_actions?: string[];
          action_overrides?: Array<{
            category: string;
            allowed_in_modes?: ExecutionMode[];
            approvals_required?: number;
            forbidden?: boolean;
          }>;
        }
      >;
    };
  };
  financial_policy?: FinancialPolicy;
};

export type ExecutionLogRecord = {
  id: string;
  summary: string;
  evidence: string[];
  assumptions: string[];
  action: GovernedAction;
  created_by: string;
  created_at: string;
};

export type ExecutionRunResult = {
  instantiated_agents: AgentDefinition[];
  actions: GovernedAction[];
  execution_log: ExecutionLogRecord[];
  department_rollups?: Array<{
    department_id: string;
    total_actions: number;
    blocked: number;
    requires_approval: number;
    auto_approved: number;
  }>;
};
