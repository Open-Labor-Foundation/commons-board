/**
 * Reasoning loop — planner/critic/executor/memory scaffold for chair reasoning.
 *
 * Ported from mother-board services/reasoning-loop.ts. No sanitization needed —
 * this file had no AEB/mother-board specific content.
 */
import type { BoardDomain } from "@commons-board/shared";

export type PlannerStep = {
  thought: string;
  next_action: string;
  constraints: string[];
};

export type CriticStep = {
  pass: boolean;
  score: number;
  issues: string[];
  policy: "planner_critic_executor_memory_v1";
};

export type ExecutorStep = {
  action: string;
  result: "ready" | "blocked";
};

export type MemoryStep = {
  key: string;
  summary: string;
};

export type ReasoningLoopResult = {
  planner: PlannerStep;
  critic: CriticStep;
  executor: ExecutorStep;
  memory: MemoryStep;
  sequence: Array<"thought" | "action" | "result" | "reflection" | "next_action">;
};

function normalizeScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function plannerAgent(input: { prompt: string; domain: BoardDomain; intent: string }): PlannerStep {
  return {
    thought: `Plan response for ${input.domain} domain with intent=${input.intent}.`,
    next_action: "validate_constraints_then_execute",
    constraints: ["domain alignment", "deliverable contract", "operational loop policy"]
  };
}

function criticAgent(input: { intentConfidence: number; intentConfidenceFloor: number; domainPass: boolean; deliverablePass?: boolean }): CriticStep {
  const issues: string[] = [];
  if (input.intentConfidence < input.intentConfidenceFloor) issues.push("intent_confidence_below_floor");
  if (!input.domainPass) issues.push("domain_validation_failed");
  if (input.deliverablePass === false) issues.push("deliverable_contract_failed");
  return {
    pass: issues.length === 0,
    score: normalizeScore(0.95 - Math.min(0.7, issues.length * 0.18)),
    issues,
    policy: "planner_critic_executor_memory_v1"
  };
}

function executorAgent(input: { critic: CriticStep }): ExecutorStep {
  return {
    action: input.critic.pass ? "execute_planned_response" : "block_and_request_remediation",
    result: input.critic.pass ? "ready" : "blocked"
  };
}

function memoryAgent(input: { domain: BoardDomain; intent: string; critic: CriticStep }): MemoryStep {
  return {
    key: `reasoning:${input.domain}:${input.intent}`,
    summary: input.critic.pass ? "validated execution path" : `blocked: ${input.critic.issues.join(",") || "unknown"}`
  };
}

export function runReasoningLoop(input: {
  prompt: string;
  domain: BoardDomain;
  intent: string;
  intentConfidence: number;
  intentConfidenceFloor?: number;
  domainPass: boolean;
  deliverablePass?: boolean;
}): ReasoningLoopResult {
  const planner = plannerAgent({ prompt: input.prompt, domain: input.domain, intent: input.intent });
  const critic = criticAgent({ intentConfidence: input.intentConfidence, intentConfidenceFloor: input.intentConfidenceFloor ?? 0.45, domainPass: input.domainPass, deliverablePass: input.deliverablePass });
  const executor = executorAgent({ critic });
  const memory = memoryAgent({ domain: input.domain, intent: input.intent, critic });
  return { planner, critic, executor, memory, sequence: ["thought", "action", "result", "reflection", "next_action"] };
}
