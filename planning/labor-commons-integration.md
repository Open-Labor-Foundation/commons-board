# commons-board — Labor-Commons Integration

## The Core Idea

Every executive chair in commons-board is backed by specialists from the labor-commons catalog. A chair is not a generic AI persona for a domain — it is a composition of specific specialists whose defined tasks, scope boundaries, refusal behaviors, and authority sources shape what the chair can do and what it cannot.

This is what makes commons-board genuinely useful rather than generically intelligent. A healthcare collective's operations chair draws from specialists who understand healthcare scheduling, patient records handling, and regulatory compliance — not generic operations knowledge. A plumbing cooperative's finance chair draws from a contractor bookkeeping specialist who knows job costing and material markup — not generic finance knowledge.

Every specialist contributed to labor-commons by a domain expert compounds into every organization in that field. The catalog is the mechanism by which real-world expertise enters the platform at scale.

---

## What a Specialist Definition Provides

A specialist in labor-commons (`catalog/naics-overlays/<domain>/<slug>/spec.yaml`) defines:

- **Supported tasks**: what this specialist handles, specifically
- **Out-of-scope rules**: what it refuses or escalates
- **Orchestrator return rules**: under what conditions it sends work back to the parent
- **Expected inputs and outputs**: what it receives and what it produces
- **Authority sources**: which external knowledge bases back this domain
- **Evaluation scenarios**: what a correct output looks like
- **Adjacent specialists**: who it hands off to or receives from

When a chair loads a specialist definition, it gains all of this. The chair doesn't need to be told what questions to ask or what boundaries to respect — those are already defined in the catalog.

---

## How Specialist Resolution Works

### At Onboarding

During the interview, the operator or collective describes the functions their organization needs. For each function described, `specialist-resolver.ts` queries labor-commons:

1. **Function description** → tokenized into domain signals (industry, role type, task keywords)
2. **Catalog search** → matches specialists by domain and task coverage
3. **Ranking** → specialists are scored on:
   - Domain alignment (is this specialist's domain the one described?)
   - Task coverage (what percentage of the described function's tasks are covered?)
   - Scope quality (does the specialist have explicit scope boundaries?)
   - Authority quality (are there authoritative sources backing the domain?)
4. **Selection** → top 1–3 specialists are assigned to the chair as `labor_commons_refs`
5. **Confirmation** → the operator/collective reviews the proposed chair staffing before activation

The operator can override any selection: swap a specialist, add a supporting specialist, or flag a function that has no catalog match (which creates a gap record that can be submitted to labor-commons).

### At Runtime

When a chair is activated and assigned work:

1. The chair's specialist definitions are loaded from the labor-commons catalog (or from a local cache if running offline)
2. The specialist's `supported_tasks`, `out_of_scope_rules`, and `expected_outputs` shape the chair's operating context
3. The chair uses the specialist's `authority_sources` as the basis for its knowledge claims
4. If a task falls outside all loaded specialists' `supported_tasks`, the chair escalates rather than guesses

### Catalog Sync

A cadence worker runs periodic catalog sync:

1. For each `labor_commons_ref` in the org's `agent_blueprint.json` that is not pinned, check labor-commons for updates
2. If the specialist definition has changed materially (new tasks, changed scope, updated authority sources), surface a notification to the operator/collective
3. The org can accept the update (reload the definition) or pin the current version
4. Breaking changes to a specialist definition (scope narrowing, task removal) are flagged with higher urgency

---

## `specialist-resolver.ts` — Service Spec

```typescript
interface SpecialistQuery {
  function_description: string;   // plain text from interview
  industry: string;                // from business_profile
  domain_hint?: string;            // chair domain type
  required_tasks?: string[];       // specific tasks that must be covered
  exclude_slugs?: string[];        // specialists to exclude
}

interface SpecialistMatch {
  specialist_slug: string;
  catalog_path: string;            // e.g., "catalog/naics-overlays/healthcare/..."
  display_name: string;
  domain: string;
  match_score: number;             // 0–100
  task_coverage: number;           // 0–1, fraction of required tasks covered
  scope_quality: "strong" | "adequate" | "weak";
  authority_sources: string[];
  gap_tasks: string[];             // required tasks not covered by this specialist
}

interface SpecialistResolution {
  chair_function: string;
  primary: SpecialistMatch;
  supporting: SpecialistMatch[];
  unresolved_tasks: string[];      // tasks not covered by any selected specialist
  catalog_gap: boolean;            // true if core function has no catalog match
}
```

**Input**: function description from interview + industry context
**Output**: ranked specialist selections for operator/collective review
**Side effect**: if `catalog_gap` is true, a gap record is written; the operator can submit it to labor-commons

---

## Labor-Commons Client

`labor-commons-client.ts` abstracts catalog access. Supports two modes:

**Remote mode** (default): reads from the GitHub API against the labor-commons repo. Requires `GH_TOKEN` or public access. Caches responses locally to support offline operation after initial sync.

**Local mode**: reads from a local clone of the labor-commons catalog. Suitable for self-hosted deployments that do not want a GitHub dependency at runtime.

```typescript
interface LaborCommonsClient {
  // Fetch a specific specialist by slug
  getSpecialist(slug: string): Promise<SpecialistDefinition>;

  // Search for specialists matching domain and task signals
  searchSpecialists(query: SpecialistQuery): Promise<SpecialistMatch[]>;

  // List all specialists in a domain
  listByDomain(domain: string): Promise<SpecialistDefinition[]>;

  // Check if a specialist definition has changed since a given ref
  checkForUpdates(slug: string, since_ref: string): Promise<UpdateCheck>;

  // Submit a catalog gap (function with no matching specialist)
  reportGap(gap: CatalogGap): Promise<void>;
}
```

---

## Chair Composition Patterns

A chair can be backed by one specialist (narrow function) or multiple (broad function). Examples:

**Narrow: Construction job costing chair**
```json
"labor_commons_refs": [
  {
    "specialist_slug": "job-cost-accounting-specialist",
    "catalog_path": "catalog/naics-overlays/construction/...",
    "role": "primary"
  }
]
```

**Broad: Small business finance chair**
```json
"labor_commons_refs": [
  {
    "specialist_slug": "small-business-bookkeeping-specialist",
    "catalog_path": "catalog/naics-overlays/accounting-tax-and-audit-services/...",
    "role": "primary"
  },
  {
    "specialist_slug": "payroll-compliance-specialist",
    "catalog_path": "catalog/naics-overlays/administrative-support-and-business-services/...",
    "role": "supporting"
  },
  {
    "specialist_slug": "tax-preparation-specialist",
    "catalog_path": "catalog/naics-overlays/accounting-tax-and-audit-services/...",
    "role": "supporting"
  }
]
```

**Gap recorded: Function with no catalog match**
```json
"labor_commons_refs": [],
"catalog_gap": {
  "function_description": "Specialty trade licensing and permit coordination",
  "gap_id": "gap-20260621-001",
  "submitted_to_labor_commons": false
}
```

A chair with a `catalog_gap` still activates — it operates with reduced domain specificity and surfaces a recommendation to contribute the missing specialist to labor-commons.

---

## The Gap Feedback Loop

Catalog gaps are not failures. They are signals.

When commons-board identifies a function that has no matching specialist in labor-commons, it:

1. Creates a gap record in the org's artifact store
2. Surfaces the gap to the operator/collective with a plain-language explanation: "Your [function] chair is running without a specialist definition for [domain]. This means it's operating from general knowledge rather than domain expertise. You can improve this by contributing a specialist definition."
3. Provides a path to commons-idea: the operator or a collective member can run a commons-idea session to capture the domain expertise, then submit it to labor-commons
4. When a matching specialist lands in labor-commons (contributed by anyone in the community), commons-board's catalog sync can detect it and offer to wire it into the gap chair

This is the compounding flywheel in practice: a plumbing collective identifies a gap, a licensed plumber contributes the specialist, and every other plumbing collective running commons-board gains the benefit automatically.

---

## Offline and Self-Hosted Operation

commons-board is designed to work without a continuous internet connection after initial setup:

1. At onboarding, the full set of relevant specialists is cached locally
2. Catalog sync runs when connectivity is available; gaps in connectivity do not block operations
3. Pinned specialist refs operate entirely from the local cache

Organizations that need air-gapped or fully self-hosted operation can point the labor-commons client at a local clone of the labor-commons repo. Catalog updates are then managed by the operator who pulls and deploys new catalog versions on their own schedule.
