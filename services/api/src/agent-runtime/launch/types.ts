export const LAUNCH_SECTIONS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"] as const;

export type LaunchSection = (typeof LAUNCH_SECTIONS)[number];

export type LaunchAnswers = {
  L0?: {
    consent?: boolean;
    no_money_without_approval?: boolean;
    no_customer_contact_without_opt_in?: boolean;
  };
  L1?: {
    time_available_per_week_hours?: number;
    budget_range?: string;
    risk_appetite?: "low" | "med" | "high";
    preferred_sales_motion?: "inbound" | "outbound" | "plg";
  };
  L2?: {
    industries_of_interest?: string[];
    problems_to_solve?: string[];
    unfair_advantages?: string[];
  };
  L3?: {
    target_icp?: string;
    offer?: string;
    urgency?: string;
    delivery_model?: "service" | "software" | "hybrid";
    pricing_hypothesis?: string;
  };
  L4?: {
    primary_channel?: string;
    list_sources?: string[];
    compliance_constraints?: string[];
  };
  L5?: {
    domain_provider?: string;
    email_provider?: string;
    landing_stack?: string;
    crm_choice?: string;
    billing_choice?: string;
  };
  L6?: {
    currency?: string;
    daily_spend_cap?: number;
    weekly_spend_cap?: number;
    per_transaction_cap?: number;
    forbidden_categories?: string[];
    approval_required_over_amount?: number;
    approval_required_for_categories?: string[];
    approver_roles?: string[];
  };
  L7?: {
    confirmed?: boolean;
    corrections?: Partial<LaunchAnswers>;
  };
};

export type LaunchArtifacts = {
  venture_profile: Record<string, unknown>;
  launch_plan: Record<string, unknown>;
  tooling_plan: Record<string, unknown>;
  financial_policy: Record<string, unknown>;
};

export type LaunchSessionState = {
  currentSection: LaunchSection;
  completedSections: LaunchSection[];
  answers: LaunchAnswers;
  readyToFinalize: boolean;
};
