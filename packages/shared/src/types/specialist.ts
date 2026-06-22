/**
 * labor-commons specialist resolution types.
 *
 * Built against the REAL labor-commons spec.yaml schema:
 *   schema_version, kind: agent_definition, freshness, metadata, purpose,
 *   scope{supported_tasks, common_inputs, expected_outputs, out_of_scope_rules},
 *   adjacent_specialties, knowledge_baseline
 *
 * See planning/labor-commons-integration.md.
 */

/** The shape of a specialist definition as stored in labor-commons. */
export interface SpecialistDefinition {
  schema_version: string;
  kind: "agent_definition";
  freshness: {
    last_reviewed: string;
    review_interval_days: number;
    stale_after: string;
    status: "current" | "stale";
  };
  metadata: {
    agent_id: string;
    slug: string;
    name: string;
    domain_family: string;
    specialty_boundary: string;
    status: string;
    created_at: string;
    last_updated_at: string;
  };
  purpose: string;
  scope: {
    supported_tasks: string[];
    common_inputs: string[];
    expected_outputs: string[];
    out_of_scope_rules: string[];
  };
  adjacent_specialties: string[];
  knowledge_baseline: string[];
}

/** A query for specialists matching an organizational function. */
export interface SpecialistQuery {
  function_description: string;
  industry: string;
  domain_hint?: string;
  required_tasks?: string[];
  exclude_slugs?: string[];
}

/** A scored specialist match returned by the resolver. */
export interface SpecialistMatch {
  specialist_slug: string; // metadata.slug
  catalog_path: string;
  display_name: string; // metadata.name
  domain_family: string; // metadata.domain_family
  match_score: number; // 0-100
  task_coverage: number; // 0-1
  boundary_quality: "strong" | "adequate" | "weak";
  knowledge_baseline: string[];
  freshness_status: "current" | "stale";
  gap_tasks: string[];
}

/** The full resolution for one chair function. */
export interface SpecialistResolution {
  chair_function: string;
  primary: SpecialistMatch | null;
  supporting: SpecialistMatch[];
  unresolved_tasks: string[];
  catalog_gap: boolean;
}

/** A recorded catalog gap — a function with no adequate specialist match. */
export interface CatalogGap {
  gap_id: string;
  org_id: string;
  function_description: string;
  domain_hint: string | null;
  submitted_to_labor_commons: boolean;
  created_at: string;
  resolved_at: string | null;
}
