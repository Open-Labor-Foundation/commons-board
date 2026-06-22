/**
 * Execution engine — instantiates agents, governs actions, and produces
 * a governed execution run result with an immutable execution log.
 *
 * Ported from mother-board agent-runtime/execution/engine.ts.
 * Sanitized:
 *   - Removed launch_architect agent type and launchExperimentBacklog (Phase 8)
 *   - AgentDefinition uses domain (not type) per OLF schema
 *   - org_blueprint uses chair_id/domain (OLF schema) instead of id/agent_type
 *   - Removed launch_outputs from return value (Phase 8)
 *
 * Governance invariant: every action decision is recorded BEFORE the action executes.
 * SIM mode produces an identical governance trail to LIVE with no external writes.
 */
import { randomUUID } from "node:crypto";
import type {
  ActionObject,
  AgentDefinition,
  ArtifactsForExecution,
  ExecutionLogRecord,
  ExecutionRunResult,
  FinancialPolicy,
  GovernedAction
} from "./types.js";

export class ExecutionLogBook {
  private readonly records: ExecutionLogRecord[] = [];

  append(record: Omit<ExecutionLogRecord, "id" | "created_at">): ExecutionLogRecord {
    const persisted: ExecutionLogRecord = Object.freeze({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      ...record
    });
    this.records.push(persisted);
    return persisted;
  }

  list(): ExecutionLogRecord[] {
    return this.records.map((r) => ({ ...r }));
  }
}

function mergePolicy(
  base: ArtifactsForExecution["autonomy_policy"],
  scoped:
    | {
        mode_default?: "advisor" | "orchestrator" | "autopilot";
        forbidden_actions?: string[];
        action_overrides?: Array<{
          category: string;
          allowed_in_modes?: Array<"advisor" | "orchestrator" | "autopilot">;
          approvals_required?: number;
          forbidden?: boolean;
        }>;
      }
    | undefined
): ArtifactsForExecution["autonomy_policy"] {
  if (!scoped) return base;
  const overrides = scoped.action_overrides ?? [];
  const categories = [...base.action_categories];
  for (const override of overrides) {
    const idx = categories.findIndex((c) => c.category === override.category);
    if (idx >= 0) {
      categories[idx] = {
        ...categories[idx],
        allowed_in_modes: override.allowed_in_modes ?? categories[idx].allowed_in_modes,
        approvals_required: override.approvals_required ?? categories[idx].approvals_required,
        forbidden: override.forbidden ?? categories[idx].forbidden
      };
    } else {
      categories.push({
        category: override.category,
        risk_level_default: "medium",
        allowed_in_modes: override.allowed_in_modes ?? ["advisor", "orchestrator", "autopilot"],
        approvals_required: override.approvals_required ?? 1,
        forbidden: override.forbidden ?? false
      });
    }
  }
  return {
    ...base,
    mode_default: scoped.mode_default ?? base.mode_default,
    forbidden_actions: Array.from(new Set([...(base.forbidden_actions ?? []), ...(scoped.forbidden_actions ?? [])])),
    action_categories: categories
  };
}

function resolvePolicyForAgent(
  agent: AgentDefinition,
  artifacts: ArtifactsForExecution
): ArtifactsForExecution["autonomy_policy"] {
  let policy = artifacts.autonomy_policy;
  const bp = artifacts.agent_blueprint;
  policy = mergePolicy(policy, bp.policy_scopes?.global);
  if (agent.org?.domain) {
    policy = mergePolicy(policy, bp.policy_scopes?.domains?.[agent.org.domain]);
  }
  if (agent.org?.team_id) {
    policy = mergePolicy(policy, bp.policy_scopes?.teams?.[agent.org.team_id]);
  }
  return policy;
}

function blueprintAgents(artifacts: ArtifactsForExecution): AgentDefinition[] {
  const bp = artifacts.agent_blueprint;
  const departmentsById = new Map((bp.departments ?? []).map((d) => [d.id, d]));
  const chairsById = new Map((bp.chairs ?? []).map((c) => [c.chair_id, c]));
  const agents: AgentDefinition[] = [];

  for (const chair of bp.chairs ?? []) {
    if (chair.status !== "active") continue;
    agents.push({
      id: chair.chair_id,
      domain: chair.domain,
      kpis: chair.kpis ?? ["execution_quality"],
      authority: chair.authority ?? {},
      cadence: chair.cadence ?? { daily: true, weekly: true, monthly: false },
      org: {
        chair_id: chair.chair_id,
        domain: chair.domain,
        budget_cap_daily: chair.budget_cap_daily,
        chair_budget_cap_daily: chair.budget_cap_daily,
        risk_ceiling: chair.risk_ceiling
      }
    });
  }

  for (const team of bp.teams ?? []) {
    if (team.status !== "active") continue;
    const dept = departmentsById.get(team.department_id);
    const chair = chairsById.get(team.chair_id);
    agents.push({
      id: team.id,
      domain: team.domain,
      kpis: team.kpis ?? ["throughput"],
      authority: team.authority ?? {},
      cadence: team.cadence ?? { daily: true, weekly: true, monthly: false },
      org: {
        chair_id: team.chair_id,
        department_id: team.department_id,
        team_id: team.id,
        domain: dept?.domain ?? team.domain,
        budget_cap_daily: team.budget_cap_daily ?? dept?.budget_cap_daily,
        department_budget_cap_daily: dept?.budget_cap_daily,
        chair_budget_cap_daily: chair?.budget_cap_daily,
        risk_ceiling: team.risk_ceiling ?? dept?.risk_ceiling
      }
    });
  }

  return agents;
}

function instantiateAgents(artifacts: ArtifactsForExecution): AgentDefinition[] {
  const agents = blueprintAgents(artifacts);

  const governorCount = agents.filter((a) => a.domain === "governor" || a.domain === "strategy").length;
  const domainCount = agents.filter((a) => a.domain !== "governor").length;

  if (governorCount < 1) {
    throw new Error("agent_blueprint must include a strategy or governor chair");
  }
  if (domainCount < 2) {
    throw new Error("agent_blueprint must include at least two domain chairs");
  }

  return agents;
}

function actionTypeForDomain(domain: string): string {
  switch (domain) {
    case "finance": return "create_budget_tasks";
    case "ops": return "create_ops_tasks";
    case "growth": return "run_growth_experiment";
    case "sales": return "create_pipeline_tasks";
    case "legal": return "create_compliance_tasks";
    case "it": return "create_it_tasks";
    case "security": return "create_security_tasks";
    case "hr": return "create_workforce_tasks";
    case "rnd": return "create_research_tasks";
    case "product": return "create_product_tasks";
    default: return "create_tasks";
  }
}

function baseRisk(actionType: string): number {
  switch (actionType) {
    case "run_growth_experiment": return 80;
    case "create_budget_tasks": return 55;
    case "create_compliance_tasks": return 60;
    case "create_security_tasks": return 70;
    default: return 25;
  }
}

function generateDefaultAction(agent: AgentDefinition, artifacts: ArtifactsForExecution): ActionObject {
  const objective = String(artifacts.objective_config.primary_objective ?? "operational_stability");
  const actionType = actionTypeForDomain(agent.domain);
  const risk = baseRisk(actionType);
  return {
    agent_id: agent.id,
    action_type: actionType,
    evidence: [`kpis:${agent.kpis.join(",")}`],
    assumptions: [`objective:${objective}`],
    risk_score: risk,
    impact_range: { p10: 1, p50: 5, p90: 12 },
    blast_radius: {
      level: risk >= 75 ? "high" : risk >= 50 ? "medium" : "low",
      explanation: risk >= 75 ? "High-impact external channel or financial action" : risk >= 50 ? "Internal coordination with moderate external impact" : "Internal process update"
    },
    approvals_required: 0,
    rollback_plan: { type: "reverse_change", owner: "governor" }
  };
}

function financialSpendProfile(actionType: string): { category: string; amount: number } | null {
  switch (actionType) {
    case "run_growth_experiment": return { category: "advertising spend", amount: 100 };
    case "buy_domain": return { category: "domain purchase", amount: 15 };
    default: return null;
  }
}

function applyFinancialPolicy(
  action: ActionObject,
  financialPolicy: FinancialPolicy,
  currentDecision: GovernedAction
): GovernedAction {
  const spend = financialSpendProfile(action.action_type);
  if (!spend) return currentDecision;

  if (financialPolicy.categories.forbidden.includes(spend.category)) {
    return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: [...currentDecision.governor_reasons, `financial_policy forbidden category: ${spend.category}`] };
  }
  if (spend.amount > financialPolicy.per_transaction_cap) {
    return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: [...currentDecision.governor_reasons, `financial_policy per_transaction_cap exceeded (${spend.amount} > ${financialPolicy.per_transaction_cap})`] };
  }
  if (spend.amount >= financialPolicy.approvals.required_over_amount || financialPolicy.approvals.required_for_categories.includes(spend.category)) {
    return { ...currentDecision, approvals_required: Math.max(currentDecision.approvals_required, 1), governor_decision: currentDecision.governor_decision === "blocked" ? "blocked" : "requires_approval", governor_reasons: [...currentDecision.governor_reasons, `financial approval required for ${spend.category}`] };
  }
  return currentDecision;
}

function applyOrgEnvelope(
  action: ActionObject,
  agent: AgentDefinition,
  currentDecision: GovernedAction,
  budgetState: { byTeam: Map<string, number>; byDepartment: Map<string, number>; byChair: Map<string, number> }
): GovernedAction {
  const reasons = [...currentDecision.governor_reasons];

  if (typeof agent.org?.risk_ceiling === "number" && action.risk_score > agent.org.risk_ceiling) {
    reasons.push(`org risk ceiling exceeded (${action.risk_score} > ${agent.org.risk_ceiling})`);
    return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
  }

  const spend = financialSpendProfile(action.action_type);
  if (spend && typeof agent.org?.budget_cap_daily === "number" && spend.amount > agent.org.budget_cap_daily) {
    reasons.push(`org daily budget cap exceeded (${spend.amount} > ${agent.org.budget_cap_daily})`);
    return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
  }
  if (spend && agent.org?.team_id && typeof agent.org.budget_cap_daily === "number") {
    const current = budgetState.byTeam.get(agent.org.team_id) ?? 0;
    if (current + spend.amount > agent.org.budget_cap_daily) {
      reasons.push(`org team daily budget exceeded (${current + spend.amount} > ${agent.org.budget_cap_daily})`);
      return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
    }
  }
  if (spend && agent.org?.department_id && typeof agent.org.department_budget_cap_daily === "number") {
    const current = budgetState.byDepartment.get(agent.org.department_id) ?? 0;
    if (current + spend.amount > agent.org.department_budget_cap_daily) {
      reasons.push(`org department daily budget exceeded (${current + spend.amount} > ${agent.org.department_budget_cap_daily})`);
      return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
    }
  }
  if (spend && agent.org?.chair_id && typeof agent.org.chair_budget_cap_daily === "number") {
    const current = budgetState.byChair.get(agent.org.chair_id) ?? 0;
    if (current + spend.amount > agent.org.chair_budget_cap_daily) {
      reasons.push(`org chair daily budget exceeded (${current + spend.amount} > ${agent.org.chair_budget_cap_daily})`);
      return { ...currentDecision, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
    }
  }
  return currentDecision;
}

function governAction(action: ActionObject, artifacts: ArtifactsForExecution, agent: AgentDefinition): GovernedAction {
  const policy = resolvePolicyForAgent(agent, artifacts);
  const category = policy.action_categories.find((c) => c.category === action.action_type);
  const reasons: string[] = [];

  if (policy.forbidden_actions.includes(action.action_type)) {
    reasons.push("action is in forbidden_actions");
    return { ...action, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
  }
  if (!category) {
    reasons.push("action category not defined in autonomy_policy");
    return { ...action, approvals_required: 99, governor_decision: "blocked", governor_reasons: reasons };
  }
  if (category.forbidden) {
    reasons.push("action category is forbidden");
    return { ...action, approvals_required: category.approvals_required, governor_decision: "blocked", governor_reasons: reasons };
  }
  if (!category.allowed_in_modes.includes(policy.mode_default)) {
    reasons.push(`mode ${policy.mode_default} is not allowed for action ${action.action_type}`);
    return { ...action, approvals_required: category.approvals_required, governor_decision: "blocked", governor_reasons: reasons };
  }
  if (category.approvals_required > 0) {
    reasons.push(`requires ${category.approvals_required} approval(s)`);
    return { ...action, approvals_required: category.approvals_required, governor_decision: "requires_approval", governor_reasons: reasons };
  }
  reasons.push("eligible for auto approval by policy");
  return { ...action, approvals_required: 0, governor_decision: "auto_approved", governor_reasons: reasons };
}

export function runAgentExecution(
  artifacts: ArtifactsForExecution,
  executionLog = new ExecutionLogBook()
): ExecutionRunResult {
  const instantiatedAgents = instantiateAgents(artifacts);
  const budgetState = {
    byTeam: new Map<string, number>(),
    byDepartment: new Map<string, number>(),
    byChair: new Map<string, number>()
  };
  const agentsById = new Map(instantiatedAgents.map((a) => [a.id, a]));

  const generatedActions = instantiatedAgents
    .filter((a) => a.domain !== "governor")
    .map((agent) => generateDefaultAction(agent, artifacts));

  const governedActions = generatedActions.map((action) => {
    const agent = agentsById.get(action.agent_id) ?? { id: action.agent_id, domain: "ops", kpis: [], authority: {}, cadence: {} };
    const govDecision = governAction(action, artifacts, agent);
    const orgDecision = applyOrgEnvelope(action, agent, govDecision, budgetState);

    if (orgDecision.governor_decision !== "blocked") {
      const spend = financialSpendProfile(action.action_type);
      if (spend) {
        if (agent.org?.team_id) budgetState.byTeam.set(agent.org.team_id, (budgetState.byTeam.get(agent.org.team_id) ?? 0) + spend.amount);
        if (agent.org?.department_id) budgetState.byDepartment.set(agent.org.department_id, (budgetState.byDepartment.get(agent.org.department_id) ?? 0) + spend.amount);
        if (agent.org?.chair_id) budgetState.byChair.set(agent.org.chair_id, (budgetState.byChair.get(agent.org.chair_id) ?? 0) + spend.amount);
      }
    }

    return artifacts.financial_policy ? applyFinancialPolicy(action, artifacts.financial_policy, orgDecision) : orgDecision;
  });

  for (const action of governedActions) {
    executionLog.append({
      summary: `Action ${action.action_type} from ${action.agent_id} is ${action.governor_decision}`,
      evidence: action.evidence,
      assumptions: action.assumptions,
      action,
      created_by: "governor"
    });
  }

  const rollups = new Map<string, { department_id: string; total_actions: number; blocked: number; requires_approval: number; auto_approved: number }>();
  for (const action of governedActions) {
    const agent = agentsById.get(action.agent_id);
    const departmentId = agent?.org?.department_id ?? "board";
    const current = rollups.get(departmentId) ?? { department_id: departmentId, total_actions: 0, blocked: 0, requires_approval: 0, auto_approved: 0 };
    current.total_actions += 1;
    if (action.governor_decision === "blocked") current.blocked += 1;
    if (action.governor_decision === "requires_approval") current.requires_approval += 1;
    if (action.governor_decision === "auto_approved") current.auto_approved += 1;
    rollups.set(departmentId, current);
  }

  return {
    instantiated_agents: instantiatedAgents,
    actions: governedActions,
    execution_log: executionLog.list(),
    department_rollups: Array.from(rollups.values())
  };
}
