/**
 * Org compiler — validates and normalizes the agent_blueprint into
 * an execution-ready structure.
 *
 * Ported from mother-board services/org-compiler.ts.
 * Sanitized: removed "cio" domain; uses OLF blueprint schema (chair_id, domain fields).
 */
import type { BoardDomain } from "@commons-board/shared";

type OrgChair = {
  chair_id: string;
  name: string;
  domain: string;
  status?: "active" | "paused" | "retired";
  kpis?: string[];
};

type OrgBlueprint = {
  schema_version?: string;
  chairs?: OrgChair[];
  departments?: Array<Record<string, unknown>>;
  teams?: Array<Record<string, unknown>>;
  policy_scopes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const KNOWN_DOMAINS: BoardDomain[] = [
  "finance", "ops", "growth", "legal", "hr", "product", "it", "security", "strategy", "rnd", "sales"
];

export function compileOrgBlueprint(input: { blueprint: OrgBlueprint; userId: string; note: string }): OrgBlueprint {
  const now = new Date().toISOString();
  const chairs = (input.blueprint.chairs ?? []).map((chair) => ({
    ...chair,
    status: chair.status ?? "active",
    kpis: Array.isArray(chair.kpis) ? chair.kpis : []
  }));
  return {
    schema_version: input.blueprint.schema_version ?? "1.0",
    chairs,
    departments: Array.isArray(input.blueprint.departments) ? input.blueprint.departments : [],
    teams: Array.isArray(input.blueprint.teams) ? input.blueprint.teams : [],
    policy_scopes: typeof input.blueprint.policy_scopes === "object" && input.blueprint.policy_scopes
      ? input.blueprint.policy_scopes
      : { global: {}, domains: {}, teams: {} },
    metadata: {
      ...(input.blueprint.metadata ?? {}),
      updated_at: now,
      updated_by: input.userId,
      note: input.note
    }
  };
}

export function compilerCoverage(blueprint: OrgBlueprint): Array<{
  domain: BoardDomain;
  covered: boolean;
  missing_chair_types: string[];
}> {
  const activeTypes = new Set(
    (blueprint.chairs ?? [])
      .filter((c) => !c.status || c.status === "active")
      .map((c) => String(c.domain ?? "").trim().toLowerCase())
  );
  return KNOWN_DOMAINS.map((domain) => {
    const covered = activeTypes.has(domain);
    return { domain, covered, missing_chair_types: covered ? [] : [domain] };
  });
}
