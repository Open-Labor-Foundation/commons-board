/**
 * Labor-commons catalog client.
 *
 * Discovery is driven by the SQLite catalog at
 * {CB_LABOR_COMMONS_PATH}/data/catalogs/agent_catalog.sqlite.
 * Spec details (boundary, freshness, knowledge_baseline, supported_tasks)
 * are loaded from {CB_LABOR_COMMONS_PATH}/catalog/naics-overlays/{section_slug}/{agent_slug}/spec.yaml
 * only for the top candidates after SQLite pre-scoring.
 *
 * All credentials are read from env at call time — never stored here.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  SpecialistDefinition,
  SpecialistMatch,
  SpecialistQuery,
  CatalogGap
} from "@commons-board/shared";
import { readJson, writeJsonAtomic } from "./persistence.js";

// ── Raw YAML shape ─────────────────────────────────────────────────────────

interface RawSpec {
  schema_version: string;
  kind: string;
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
  purpose: { summary: string; target_users?: string[] } | string;
  scope: {
    supported_tasks?: string[];
    common_inputs?: string[];
    expected_outputs?: string[];
    out_of_scope_rules?: string[];
    orchestrator_return_rules?: string[];
  };
  adjacent_specialties?: string[];
  knowledge_baseline?:
    | { source_baseline_version?: string; authority_sources?: Array<{ title: string; publisher?: string }>; source_classes?: Array<{ class: string }> }
    | string[];
}

function rawToDefinition(raw: RawSpec): SpecialistDefinition {
  const purpose =
    typeof raw.purpose === "string" ? raw.purpose : (raw.purpose as { summary: string }).summary;
  const kb = raw.knowledge_baseline;
  const knowledge_baseline: string[] = !kb
    ? []
    : Array.isArray(kb)
      ? (kb as string[])
      : (kb as { authority_sources?: Array<{ title: string }> }).authority_sources?.map((s) => s.title) ?? [];
  return {
    schema_version: raw.schema_version,
    kind: "agent_definition",
    freshness: raw.freshness,
    metadata: raw.metadata,
    purpose,
    scope: {
      supported_tasks: raw.scope.supported_tasks ?? [],
      common_inputs: raw.scope.common_inputs ?? [],
      expected_outputs: raw.scope.expected_outputs ?? [],
      out_of_scope_rules: raw.scope.out_of_scope_rules ?? []
    },
    adjacent_specialties: raw.adjacent_specialties ?? [],
    knowledge_baseline
  };
}

// ── Catalog paths ──────────────────────────────────────────────────────────

function lcRoot(): string {
  const p = process.env.CB_LABOR_COMMONS_PATH;
  if (p) return p;
  throw new Error("CB_LABOR_COMMONS_PATH is not set. Point it to the local labor-commons clone directory.");
}

function dbPath(): string {
  return join(lcRoot(), "data", "catalogs", "agent_catalog.sqlite");
}

function specYamlPath(sectionSlug: string, agentSlug: string): string {
  return join(lcRoot(), "catalog", "naics-overlays", sectionSlug, agentSlug, "spec.yaml");
}

// ── SQLite connection (singleton per process) ──────────────────────────────

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!_db) _db = new DatabaseSync(dbPath());
  return _db;
}

// ── Spec cache ─────────────────────────────────────────────────────────────

const specCache = new Map<string, SpecialistDefinition | null>();

function loadSpec(sectionSlug: string, agentSlug: string): SpecialistDefinition | null {
  const key = `${sectionSlug}/${agentSlug}`;
  if (specCache.has(key)) return specCache.get(key)!;
  const path = specYamlPath(sectionSlug, agentSlug);
  if (!existsSync(path)) {
    specCache.set(key, null);
    return null;
  }
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as RawSpec;
    const def = rawToDefinition(raw);
    specCache.set(key, def);
    return def;
  } catch {
    specCache.set(key, null);
    return null;
  }
}

// ── Domain → catalog mappings ──────────────────────────────────────────────

/**
 * Maps chair domain types to section_slug values in the SQLite catalog.
 * section_slug is the directory name under catalog/naics-overlays/ and the
 * primary search scope for that domain.
 */
const DOMAIN_SECTION_SLUGS: Record<string, string[]> = {
  finance: [
    "accounting-tax-and-audit-services",
    "capital-markets-and-asset-management",
    "financial-services",
    "fintech-and-embedded-finance",
    "housing-real-estate-development-and-community-development"
  ],
  ops: [
    "facilities-services-and-building-operations",
    "administrative-support-and-business-services",
    "commercial-and-industrial-construction",
    "construction-and-field-services",
    "air-transportation-and-airports"
  ],
  legal: [
    "governance-risk-compliance-and-commercial-control",
    "customs-brokerage-and-trade-compliance",
    "public-administration-and-tax-operations"
  ],
  hr: [
    "administrative-support-and-business-services",
    "education",
    "higher-education-and-research-institutions"
  ],
  growth: [
    "advertising-media-buying-and-agency-services",
    "consumer-packaged-goods",
    "grocery-and-food-retail",
    "home-services-and-field-consumer-services",
    "hospitality-and-travel"
  ],
  it: [
    "cloud-platform-and-infrastructure",
    "cybersecurity",
    "identity-endpoint-and-workplace-technology",
    "it-service-management-and-support",
    "networking-and-connectivity",
    "legacy-systems-automation-and-integration",
    "software-engineering-and-application-delivery",
    "business-applications-and-enterprise-platforms"
  ],
  security: [
    "cybersecurity",
    "governance-risk-compliance-and-commercial-control",
    "identity-endpoint-and-workplace-technology"
  ],
  product: [
    "software-engineering-and-application-delivery",
    "business-applications-and-enterprise-platforms",
    "data-analytics-and-ai",
    "information-software-and-digital-media"
  ],
  rnd: [
    "data-analytics-and-ai",
    "aerospace-and-defense",
    "chemicals-plastics-and-materials-manufacturing",
    "software-engineering-and-application-delivery"
  ],
  sales: [
    "advertising-media-buying-and-agency-services",
    "consumer-packaged-goods",
    "grocery-and-food-retail",
    "franchise-systems-and-multi-unit-enterprise-support"
  ],
  strategy: [
    "governance-risk-compliance-and-commercial-control",
    "capital-markets-and-asset-management",
    "business-applications-and-enterprise-platforms",
    "data-analytics-and-ai"
  ]
};

/** Skill slugs that indicate fitness for each chair domain. */
const DOMAIN_SKILLS: Record<string, string[]> = {
  finance: ["financial-controls", "compliance", "reporting", "analytics"],
  ops:     ["operations", "coordination", "administration", "maintenance-and-reliability"],
  legal:   ["compliance", "documentation", "security-and-risk-controls", "reporting"],
  hr:      ["administration", "coordination", "compliance", "documentation"],
  growth:  ["analytics", "planning", "coordination", "reporting"],
  it:      ["security-and-risk-controls", "administration", "analytics", "maintenance-and-reliability"],
  security:["security-and-risk-controls", "compliance", "analytics"],
  product: ["analytics", "planning", "program-management", "coordination"],
  rnd:     ["research-and-lab", "analytics", "documentation", "quality-control"],
  sales:   ["analytics", "coordination", "reporting", "planning"],
  strategy:["planning", "analytics", "program-management", "reporting"]
};

/** Industry-cluster slugs preferred for each chair domain. */
const DOMAIN_CLUSTERS: Record<string, string[]> = {
  finance:  ["finance-and-insurance"],
  ops:      ["property-and-facilities", "industrial-and-manufacturing", "logistics-and-mobility"],
  legal:    ["legal-risk-and-governance"],
  hr:       [],
  growth:   ["consumer-and-retail"],
  it:       ["core-it-and-digital"],
  security: ["core-it-and-digital", "legal-risk-and-governance"],
  product:  ["core-it-and-digital"],
  rnd:      ["science-and-research", "core-it-and-digital"],
  sales:    ["consumer-and-retail"],
  strategy: ["legal-risk-and-governance", "finance-and-insurance"]
};

// ── SQLite candidate query ─────────────────────────────────────────────────

interface DbCandidate {
  agent_slug: string;
  section_slug: string;
  agent_name: string;
  what_it_does: string;
  specialization_score: number;
  skill_match: number;
  cluster_match: number;
}

function queryCandidates(
  sectionSlugs: string[],
  skillSlugs: string[],
  clusterSlugs: string[]
): DbCandidate[] {
  if (sectionSlugs.length === 0) return [];
  const ps = sectionSlugs.map(() => "?").join(",");
  const psk = skillSlugs.length > 0 ? skillSlugs.map(() => "?").join(",") : "'__none__'";
  const pcl = clusterSlugs.length > 0 ? clusterSlugs.map(() => "?").join(",") : "'__none__'";

  const sql = `
    SELECT
      a.agent_slug, a.section_slug, a.agent_name, a.what_it_does, a.specialization_score,
      COUNT(DISTINCT CASE WHEN c.capability_slug IN (${psk}) THEN c.id END) AS skill_match,
      COUNT(DISTINCT CASE WHEN d.dimension_slug IN (${pcl}) THEN d.id END) AS cluster_match
    FROM agents a
    LEFT JOIN agent_capabilities ac ON ac.agent_id = a.id
    LEFT JOIN capabilities c ON c.id = ac.capability_id AND c.capability_type = 'skill'
    LEFT JOIN agent_dimensions ad ON ad.agent_id = a.id
    LEFT JOIN dimensions d ON d.id = ad.dimension_id AND d.dimension_type = 'industry-cluster'
    WHERE a.materialized = 1 AND a.section_slug IN (${ps})
    GROUP BY a.id
    ORDER BY skill_match DESC, cluster_match DESC, a.specialization_score DESC
    LIMIT 30
  `;

  const params: (string | number)[] = [
    ...(skillSlugs.length > 0 ? skillSlugs : []),
    ...(clusterSlugs.length > 0 ? clusterSlugs : []),
    ...sectionSlugs
  ];

  return db().prepare(sql).all(...params) as unknown as DbCandidate[];
}

// ── Scoring ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","and","for","that","this","are","with","from","not","has","may","must",
  "will","can","all","any","their","when","its","have","work","works","ensure",
  "provide","provides","support","supports","review","reviews","request","use",
  "used","using","apply","include","includes","manage","managers","managing",
  "management","operations","operational","process","processing","service",
  "services","report","reporting","reports","information","data","level","required",
  "approach","type","plan","planning","system","systems","analysis","analyze",
  "prepare","create","coordinate","implement","develop","maintain","identify",
  "assessment","evaluate","monitor","issue","issues","action","actions","task","tasks"
]);

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[\s\-_,.()\/]+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((t) => { if (tb.has(t)) overlap++; });
  return overlap / Math.max(ta.size, tb.size);
}

function scoreCandidate(
  cand: DbCandidate,
  skillTotal: number,
  clusterTotal: number,
  query: SpecialistQuery,
  spec: SpecialistDefinition | null
): number {
  // Section match (0-40): being in the right domain family is the primary signal
  const sectionScore = 40;

  // Skill match (0-30): proportion of domain skills this specialist has
  const skillScore = skillTotal > 0 ? Math.round((cand.skill_match / skillTotal) * 30) : 0;

  // Cluster match (0-10): industry cluster alignment
  const clusterScore = clusterTotal > 0 ? Math.round((cand.cluster_match / clusterTotal) * 10) : 0;

  // Catalog specialization score (0-10): from labor-commons quality signal (range 1-5)
  const catalogScore = Math.round((cand.specialization_score / 5) * 10);

  // Freshness (0-10): from spec.yaml when loaded
  const freshScore = spec ? (spec.freshness.status === "current" ? 10 : 0) : 0;

  return sectionScore + skillScore + clusterScore + catalogScore + freshScore;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getSpecialist(slug: string): Promise<SpecialistDefinition | null> {
  const row = db().prepare(
    "SELECT section_slug FROM agents WHERE agent_slug = ? AND materialized = 1 LIMIT 1"
  ).get(slug) as { section_slug: string } | undefined;
  if (!row) return null;
  return loadSpec(row.section_slug, slug);
}

export async function listByDomain(domain: string): Promise<SpecialistDefinition[]> {
  const rows = db().prepare(
    "SELECT section_slug, agent_slug FROM agents WHERE section_slug = ? AND materialized = 1"
  ).all(domain) as Array<{ section_slug: string; agent_slug: string }>;
  const results: SpecialistDefinition[] = [];
  for (const r of rows) {
    const def = loadSpec(r.section_slug, r.agent_slug);
    if (def) results.push(def);
  }
  return results;
}

export async function searchSpecialists(query: SpecialistQuery): Promise<SpecialistMatch[]> {
  const domainKey = (query.domain_hint ?? "").toLowerCase();
  const sectionSlugs = DOMAIN_SECTION_SLUGS[domainKey] ?? [];
  const skillSlugs = DOMAIN_SKILLS[domainKey] ?? [];
  const clusterSlugs = DOMAIN_CLUSTERS[domainKey] ?? [];

  let candidates = queryCandidates(sectionSlugs, skillSlugs, clusterSlugs);

  // Filter excluded slugs early
  if (query.exclude_slugs?.length) {
    candidates = candidates.filter((c) => !query.exclude_slugs!.includes(c.agent_slug));
  }

  // Pre-sort by SQLite signals, load spec.yaml for top candidates only
  const TOP_SPEC_LOAD = 15;
  const results: SpecialistMatch[] = [];

  for (const cand of candidates.slice(0, TOP_SPEC_LOAD)) {
    const spec = loadSpec(cand.section_slug, cand.agent_slug);
    const matchScore = scoreCandidate(cand, skillSlugs.length, clusterSlugs.length, query, spec);

    const hasBoundary = (spec?.metadata.specialty_boundary ?? "").length > 50;
    const hasOosRules = (spec?.scope.out_of_scope_rules ?? []).length >= 2;
    const boundaryQuality: "strong" | "adequate" | "weak" =
      hasBoundary && hasOosRules ? "strong" : hasBoundary || hasOosRules ? "adequate" : "weak";

    const tasks = spec?.scope.supported_tasks ?? [];
    const requiredTasks = query.required_tasks ?? [];
    const descTokens = tokens(`${query.function_description} ${query.industry}`);
    const matchedTasks = tasks.filter((t) => {
      const tt = tokens(t);
      return [...tt].some((tok) => descTokens.has(tok));
    });
    const taskCoverage = tasks.length === 0 ? 0 : Math.round((matchedTasks.length / tasks.length) * 100) / 100;

    const gapTasks = requiredTasks.filter((rt) => {
      const rtToks = tokens(rt);
      return !tasks.some((t) => [...rtToks].some((tok) => tokens(t).has(tok)));
    });

    const domainFamily = spec?.metadata.domain_family ?? cand.section_slug;

    results.push({
      specialist_slug: cand.agent_slug,
      catalog_path: `catalog/naics-overlays/${cand.section_slug}/${cand.agent_slug}/spec.yaml`,
      display_name: spec?.metadata.name ?? cand.agent_name,
      domain_family: domainFamily,
      match_score: matchScore,
      task_coverage: taskCoverage,
      boundary_quality: boundaryQuality,
      knowledge_baseline: spec?.knowledge_baseline ?? [],
      freshness_status: spec?.freshness.status ?? "stale",
      gap_tasks: gapTasks
    });
  }

  return results.sort((a, b) => b.match_score - a.match_score);
}

// ── Section listing and free-text section search ───────────────────────────

/** Returns all materialized sections with their specialist counts. Synchronous. */
export function listAllSections(): Array<{ slug: string; count: number }> {
  const rows = db().prepare(
    "SELECT section_slug AS slug, COUNT(*) AS count FROM agents WHERE materialized=1 GROUP BY section_slug ORDER BY count DESC"
  ).all();
  return rows as Array<{ slug: string; count: number }>;
}

/**
 * Search within explicit section slugs using free-text similarity against a description.
 * Unlike searchSpecialists (which is domain-keyed), this accepts any sections the caller
 * provides — intended for use when an AI has selected the relevant sections.
 */
export async function searchBySections(
  sectionSlugs: string[],
  description: string,
  industry: string,
  excludeSlugs: string[] = []
): Promise<SpecialistMatch[]> {
  if (sectionSlugs.length === 0) return [];

  const ps = sectionSlugs.map(() => "?").join(",");
  const rows = db().prepare(
    `SELECT agent_slug, section_slug, agent_name, what_it_does, specialization_score
     FROM agents
     WHERE materialized = 1 AND section_slug IN (${ps})
     ORDER BY specialization_score DESC
     LIMIT 50`
  ).all(...sectionSlugs) as Array<{
    agent_slug: string; section_slug: string; agent_name: string;
    what_it_does: string; specialization_score: number;
  }>;

  const candidates = excludeSlugs.length
    ? rows.filter(r => !excludeSlugs.includes(r.agent_slug))
    : rows;

  const descText = `${description} ${industry}`;
  const descToks = tokens(descText);

  const scored = candidates
    .map(r => ({ r, sim: textSimilarity(r.what_it_does, descText) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 35);

  const results: SpecialistMatch[] = [];
  for (const { r, sim } of scored) {
    const spec = loadSpec(r.section_slug, r.agent_slug);

    const hasBoundary = (spec?.metadata.specialty_boundary ?? "").length > 50;
    const hasOosRules = (spec?.scope.out_of_scope_rules ?? []).length >= 2;
    const boundaryQuality: "strong" | "adequate" | "weak" =
      hasBoundary && hasOosRules ? "strong" : hasBoundary || hasOosRules ? "adequate" : "weak";

    const tasks = spec?.scope.supported_tasks ?? [];
    const matchedTasks = tasks.filter(t =>
      [...tokens(t)].some(tok => descToks.has(tok))
    );
    const taskCoverage = tasks.length === 0 ? 0 : Math.round((matchedTasks.length / tasks.length) * 100) / 100;

    const matchScore =
      Math.round(sim * 70) +
      (spec?.freshness.status === "current" ? 15 : 0) +
      Math.round((r.specialization_score / 5) * 15);

    results.push({
      specialist_slug: r.agent_slug,
      catalog_path: `catalog/naics-overlays/${r.section_slug}/${r.agent_slug}/spec.yaml`,
      display_name: spec?.metadata.name ?? r.agent_name,
      domain_family: spec?.metadata.domain_family ?? r.section_slug,
      match_score: matchScore,
      task_coverage: taskCoverage,
      boundary_quality: boundaryQuality,
      knowledge_baseline: spec?.knowledge_baseline ?? [],
      freshness_status: spec?.freshness.status ?? "stale",
      gap_tasks: []
    });
  }

  return results.sort((a, b) => b.match_score - a.match_score);
}

export interface UpdateCheck {
  slug: string;
  changed: boolean;
  current_updated_at: string | null;
  known_updated_at: string;
}

export async function checkForUpdates(slug: string, knownUpdatedAt: string): Promise<UpdateCheck> {
  const def = await getSpecialist(slug);
  if (!def) return { slug, changed: false, current_updated_at: null, known_updated_at: knownUpdatedAt };
  const changed = def.metadata.last_updated_at > knownUpdatedAt;
  return { slug, changed, current_updated_at: def.metadata.last_updated_at, known_updated_at: knownUpdatedAt };
}

export async function reportGap(gap: CatalogGap): Promise<void> {
  const gaps = readJson<CatalogGap[]>(`gaps/${gap.org_id}`, []);
  const existing = gaps.find((g) => g.gap_id === gap.gap_id);
  if (!existing) {
    gaps.push(gap);
    writeJsonAtomic(`gaps/${gap.org_id}`, gaps);
  }
}

export function loadGaps(orgId: string): CatalogGap[] {
  return readJson<CatalogGap[]>(`gaps/${orgId}`, []);
}

export function updateGap(orgId: string, gapId: string, patch: Partial<CatalogGap>): void {
  const gaps = loadGaps(orgId);
  const idx = gaps.findIndex((g) => g.gap_id === gapId);
  if (idx >= 0) {
    gaps[idx] = { ...gaps[idx], ...patch };
    writeJsonAtomic(`gaps/${orgId}`, gaps);
  }
}
