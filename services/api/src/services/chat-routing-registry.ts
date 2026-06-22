/**
 * Chat routing registry — maps workflow keys to handler metadata.
 *
 * Ported from mother-board services/chat-routing-registry.ts.
 * Sanitized: no org-specific workflow keys (grant-pipeline, loan-packet removed).
 */
import type { BoardDomain, BoardTaskOperationKind } from "@commons-board/shared";

export type WorkflowRoute = {
  key: string;
  label: string;
  operation_kind: BoardTaskOperationKind;
  primary_domains: BoardDomain[];
  description: string;
  requires_chair: boolean;
  requires_committee: boolean;
};

const REGISTRY: WorkflowRoute[] = [
  {
    key: "board:analysis",
    label: "Board Analysis",
    operation_kind: "analysis",
    primary_domains: ["strategy", "finance", "ops"],
    description: "Multi-chair analysis of a strategic or operational question.",
    requires_chair: false,
    requires_committee: false
  },
  {
    key: "board:planning",
    label: "Board Planning",
    operation_kind: "planning",
    primary_domains: ["strategy", "ops"],
    description: "Roadmap or execution planning with phase-by-phase deliverables.",
    requires_chair: false,
    requires_committee: false
  },
  {
    key: "chair:recommendation",
    label: "Chair Recommendation",
    operation_kind: "recommendation",
    primary_domains: ["finance", "legal", "hr", "it", "security", "ops", "product", "growth", "sales", "rnd", "strategy"],
    description: "Single-chair domain recommendation with specialist-backed citations.",
    requires_chair: true,
    requires_committee: false
  },
  {
    key: "chair:review",
    label: "Chair Review",
    operation_kind: "review",
    primary_domains: ["finance", "legal", "hr", "it", "security"],
    description: "Domain chair review of a document, plan, or proposal.",
    requires_chair: true,
    requires_committee: false
  },
  {
    key: "committee:approval_request",
    label: "Committee Approval",
    operation_kind: "approval_request",
    primary_domains: ["strategy", "finance", "legal"],
    description: "Cross-domain committee approval workflow for high-risk decisions.",
    requires_chair: false,
    requires_committee: true
  },
  {
    key: "board:execution",
    label: "Board Execution",
    operation_kind: "execution",
    primary_domains: ["ops", "it", "hr", "security"],
    description: "Orchestrated multi-domain execution of an approved plan.",
    requires_chair: false,
    requires_committee: false
  }
];

export function listWorkflowRoutes(): WorkflowRoute[] {
  return REGISTRY;
}

export function getWorkflowRoute(key: string): WorkflowRoute | null {
  return REGISTRY.find((r) => r.key === key) ?? null;
}

export function matchWorkflowByDomain(domain: BoardDomain, operation_kind: BoardTaskOperationKind): WorkflowRoute | null {
  return REGISTRY.find((r) => r.primary_domains.includes(domain) && r.operation_kind === operation_kind) ?? null;
}
