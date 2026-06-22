# commons-board — Execution Plan

This is the full implementation plan for migrating mother-board into commons-board. Every capability in the mother-board codebase migrates. Nothing is deferred. On top of the migration, commons-board adds the OLF layer: a configurable provider/settings subsystem, labor-commons integration, collective governance, org economics (business monetization + collective treasury), and an optional commons-crew bridge.

This plan is ready to execute directly after approval. Each phase lists the exact source files to carry, the new files to author, the routes, the database changes, and the acceptance criteria.

---

## Source Material

Source: `/Users/john/Documents/Projects/Pre-OLF/mother-board/mother-board/`

All source must be sanitized before it lands in this repo. See [Sanitization Rules](#sanitization-rules) at the end. Sanitization is a transformation, not a removal of capability — every behavior migrates; only pre-OLF naming, branding, and the platform-subscription billing concept (which does not exist in OLF) are rewritten.

---

## Component Inventory → Phase Map

Every mother-board source component and its destination phase:

| Mother-board source | Phase |
|---|---|
| `lib/db.ts`, `lib/db-migrate.ts`, `db/migrations/0001–0009` | Phase 1 |
| `lib/store.ts`, `lib/artifacts.ts` | Phase 1 |
| `lib/motherboard-signing.ts`, `lib/runtime-receipts.ts` | Phase 1 |
| `lib/auth.ts`, `lib/security.ts`, `lib/http-security.ts`, `lib/cors.ts`, `lib/redaction.ts`, `lib/request-context.ts`, `lib/container-policy.ts`, `lib/alerts.ts` | Phase 1 |
| `agent-runtime/interview/*`, `routes/interview.ts`, `routes/onboarding.ts` | Phase 2 |
| `agent-runtime/launch/*`, `routes/launch.ts` | Phase 8 |
| `routes/artifacts.ts`, `routes/workspace.ts` | Phase 2 |
| labor-commons client + specialist resolver (new) | Phase 3 |
| `lib/verification-policy.ts`, `routes/approvals.ts`, `routes/decision-log.ts` | Phase 4 |
| collective-governance (new) | Phase 4 |
| `lib/board-orchestration.ts`, `services/org-compiler.ts`, `services/board-synthesizer.ts` | Phase 5 |
| `services/chair-reasoning.ts`, `services/reasoning-loop.ts`, `services/rd-orchestrator.ts` | Phase 5 |
| `services/chat-interpreter.ts`, `services/chat-routing-registry.ts`, `services/board-interpretation-schema.ts`, `services/board-session-state.ts` | Phase 5 |
| `services/model-native-*` (all 10), `services/domain-validation.ts` | Phase 5 |
| `services/exception-triage.ts`, `services/compensation-analysis.ts` | Phase 5 |
| `routes/motherboard.ts`, `routes/motherboard-chat.ts`, `routes/simulation-board.ts` | Phase 5 |
| `lib/operational-loop.ts`, `agent-runtime/execution/*`, `routes/execution.ts` | Phase 6 |
| `services/runtime-adapter.ts`, `services/child-runtime-client.ts` | Phase 6 |
| `workers/cadence.ts`, `routes/cadence.ts`, `routes/brief-templates.ts` | Phase 7 |
| `services/business-intelligence*.ts`, `routes/business-intelligence.ts`, `routes/observability.ts`, `routes/events.ts` | Phase 7 |
| `services/devloop/*`, `routes/devloop.ts`, `services/cli-task-spec.ts` | Phase 8 |
| `agent-runtime/launch/*`, company creation artifacts (migration 0003) | Phase 8 |
| `routes/level4.ts`, `services/model-native-level4.ts` | Phase 9 |
| `packages/connectors/real-connectors.ts`, monetization connectors | Phase 9 |
| `routes/autonomous-company.ts` (migration 0005) | Phase 10 |
| market feedback, experiment evolution, capital allocation engines | Phase 10 |
| `routes/billing.ts` (inverted: the subscription/plan/entitlement engine becomes a business-mode capability to bill the org's *own* customers) | Phase 11 |
| business monetization (inverted billing engine) + collective treasury (new) | Phase 11 |
| provider/inference adapters + `routes/settings.ts` (new; RBAC exposed as settings) | Phase 1 |
| crew-bridge (new; optional integration, not primary interface) | Phase 12 |
| `routes/feedback.ts`, `routes/evals.ts`, `routes/demo.ts` | Phase 12 |
| `apps/web/*` | Phase 13 |
| federation / portfolio (extends `child-runtime-client.ts`) | Phase 14 |
| `routes/webhooks.ts`, `packages/connectors/*`, `lib/` connector vault | Phase 15 |
| `services/testing-agent/*` | Phase 16 (and incrementally per phase) |
| HR agent + per-person analytics (gated, disabled by default) | Phase 5 (capability) / governed throughout |

---

## Build Phases

### Phase 1 — Foundation

**Goal:** Repo, monorepo, persistence, and the immutable governance substrate. Everything that exists before a user touches the system.

**Carry + sanitize from mother-board:**
- `lib/db.ts`, `lib/db-migrate.ts` — PostgreSQL driver and migration runner
- `db/migrations/0001_init.sql` through `0009_runtime_ops.sql` — all 9 migrations
- `lib/store.ts` — versioned artifact records, decision log entries, approval records, execution modes, meetings, action ledger
- `lib/artifacts.ts` — artifact type definitions and validators
- `lib/motherboard-signing.ts` → `lib/governance-signing.ts` — HMAC-SHA256 signing, keyring, key rotation (renamed)
- `lib/runtime-receipts.ts` — hash-chained execution receipts and chain verification
- `lib/auth.ts`, `lib/security.ts`, `lib/http-security.ts`, `lib/cors.ts` — auth, RBAC, security headers, CORS
- `lib/redaction.ts` — token/secret redaction in logs
- `lib/request-context.ts` — correlation IDs
- `lib/container-policy.ts`, `lib/alerts.ts` — runtime policy and alerting

**Author new:**
- `packages/shared/src/types/` — all artifact types (6 governing artifacts), Action object, GovernanceEvent, DecisionLogEntry, SpecialistResolution types
- Monorepo scaffold: workspace `package.json`, `tsconfig.base.json`, service skeletons, `Dockerfile`, `docker-compose.yml`, `.github/`
- `services/api/src/index.ts` — gateway: auth middleware, health endpoint, redacted logging, correlation IDs, error handling
- **Provider & settings subsystem** (foundational — the interview and all reasoning depend on it):
  - `lib/provider/index.ts` — single inference-provider interface
  - `lib/provider/hosted-api.ts`, `harness-console.ts`, `local-inference.ts` — pluggable adapters for hosted API providers, harness/console providers, and local inference
  - `routes/settings.ts` — provider selection, RBAC configuration (carried `auth.ts` exposed as operator-controllable settings), autonomy/cadence preferences, feature toggles
  - **Credential boundary:** adapters and config shape live in-repo; provider keys/endpoints are deployment-specific settings read from env/secret store at runtime. No usable secret ever enters the repo.
- JSON Schema files for all 6 governing artifacts (AJV), validated on every artifact write

**Database:** migrations 0001–0009 carried; add `0010_governance_mode.sql` (orgs.governance_mode), `0011_collective.sql` (members, votes, amendments, contributions), `0012_catalog.sql` (catalog_refs, catalog_gaps), `0013_economics.sql` (treasury accounts + distributions for collective; plans + subscriptions + invoices for business), `0014_settings.sql` (provider selection, RBAC, preferences per workspace).

**Acceptance:**
- Monorepo builds clean, zero TS errors
- All migrations apply without error
- Artifact store writes/reads/versions all 6 artifact types with JSON Schema validation
- Governance signing produces valid signed payloads; receipts chain correctly
- Settings service selects a provider; at least two adapters (one hosted, one local) resolve and respond through the common interface; no credential is present in the repo
- Health endpoint returns 200; Docker container builds and starts

---

### Phase 2 — Onboarding Interview & Artifact Generation

**Goal:** A user completes the interview and all governing artifacts are generated for both governance modes.

**Carry + sanitize:**
- `agent-runtime/interview/state-machine.ts`, `interview/types.ts`, `interview/generate-artifacts.ts` — the 8-section discovery interview
- `routes/interview.ts`, `routes/onboarding.ts` — interview lifecycle endpoints
- `routes/artifacts.ts`, `routes/workspace.ts` — artifact CRUD and workspace management

**Author new / modify:**
- Add **Section 0: governance_mode detection** (business vs. collective) inferred from first exchange, not asked outright
- Add **collective structure section** (collective mode only) → `collective_config.json`
- Extend artifact generation to emit `governance_mode` in `business_profile.json`
- `lib/model-client.ts` — thin LLM abstraction for interview conversation, artifact draft generation, brief writing. **Never** used for approvals, audit, risk classification, or permission checks (hard boundary from `decisions.md`)

**Routes:**
- `POST /api/v1/interview/start`
- `POST /api/v1/interview/:id/respond`
- `GET /api/v1/interview/:id/state`
- `POST /api/v1/interview/:id/confirm` — confirms draft artifacts, activates org

**Acceptance:**
- Business mode produces all 5 core artifacts; collective mode produces all 6
- Draft artifacts shown for review before activation; confirmation activates org
- Interview is resumable after interruption
- Artifact write fails on schema validation failure

---

### Phase 3 — Specialist Resolution & Chair Staffing

**Goal:** Every chair in `agent_blueprint.json` is staffed with labor-commons specialists. This is the defining commons-board capability. Full spec in [labor-commons-integration.md](labor-commons-integration.md).

**Catalog readiness:** labor-commons is ready to be used and its `spec.yaml` schema is stable (`metadata`, `scope.{supported_tasks,common_inputs,expected_outputs,out_of_scope_rules}`, `adjacent_specialties`, `knowledge_baseline`, `freshness`). The full specialist catalog is built autonomously once all repos are ready and infrastructure is deployed. The client and resolver are built against the schema now; they operate against whatever is populated and degrade to gap records for anything not yet present — no need to wait for the catalog build to start this phase.

**Author new:**
- `lib/labor-commons-client.ts` — remote (GitHub API) and local (clone) modes; `getSpecialist`, `searchSpecialists`, `listByDomain`, `checkForUpdates`, `reportGap`; file-based cache. Reads the real `spec.yaml` shape.
- `services/specialist-resolver.ts` — function description → ranked specialist matches scored on `domain_family` alignment, `supported_tasks` coverage, `specialty_boundary`/`out_of_scope_rules` quality, and `knowledge_baseline`/`freshness`; writes gap records
- `workers/catalog-sync.ts` — weekly check of unpinned refs for catalog updates; surfaces notifications

**Routes:**
- `POST /api/v1/org/resolve-specialists`
- `GET /api/v1/org/specialist-matches`
- `POST /api/v1/org/confirm-specialists`
- `PUT /api/v1/org/chairs/:chair_id/specialists`
- `POST /api/v1/org/gaps/:gap_id/submit` — opens a labor-commons GitHub issue

**Database:** `catalog_refs`, `catalog_gaps` (from migration 0012).

**Acceptance:**
- Resolver returns ranked matches for any in-catalog function; records gaps when none found
- Operator can override any selection; confirmed selections persist in `agent_blueprint.json` via versioning
- Catalog sync surfaces real updates; client falls back to local cache when remote unavailable

---

### Phase 4 — Governance Engine & Approval Workflow

**Goal:** Board-generated actions route correctly through governance. Business mode → operator. Collective mode → membership vote above threshold.

**Carry + sanitize:**
- `lib/verification-policy.ts` — action type → approval requirement matrix; risk-based escalation (score 85+ → dual); blast-radius escalation
- `routes/approvals.ts` — approval queue and decisions
- `routes/decision-log.ts` — append-only, hash-chained audit ledger

**Author new:**
- `lib/collective-governance.ts` — decision routing to member vote above threshold; vote open/collect/resolve at quorum or deadline; amendment workflow (proposal → notice → vote → artifact update); contribution tracking per `collective_config.json`

**Routes:**
- `GET /api/v1/approvals`, `POST /api/v1/approvals/:id/approve`, `POST /api/v1/approvals/:id/reject`
- `POST /api/v1/votes`, `POST /api/v1/votes/:id/cast`, `GET /api/v1/votes`, `GET /api/v1/votes/:id`
- `POST /api/v1/amendments`, `GET /api/v1/amendments/:id`

**Database:** `votes`, `amendments`, `contributions` (from migration 0011).

**Acceptance:**
- Business mode routes above-threshold actions to operator; collective mode routes to member vote
- Votes resolve correctly at quorum or deadline; amendments update artifacts only after passing
- Decision log entries are append-only and hash-chained
- Autonomy mode is never self-promoted by the system

---

### Phase 5 — Board Orchestration & Reasoning

**Goal:** The full chair model: chairs reason in their domains, route work, synthesize board-level output, and interpret human intent. This is the largest carry — the cognitive core of mother-board.

**Carry + sanitize:**
- `lib/board-orchestration.ts` — domain→chair mapping, routing, relevance scoring (rewired to draw capabilities from labor-commons specialists rather than hardcoded domain lists)
- `services/org-compiler.ts` — compiles org blueprint into chair/department/team structure
- `services/board-synthesizer.ts` — synthesizes chair inputs into board recommendations
- `services/chair-reasoning.ts` — per-chair domain reasoning
- `services/reasoning-loop.ts` — planner/critic/executor/memory scaffolding
- `services/rd-orchestrator.ts` — R&D / cross-domain orchestration
- `services/chat-interpreter.ts`, `services/chat-routing-registry.ts`, `services/board-interpretation-schema.ts`, `services/board-session-state.ts` — human language → structured board intent → routed task specs (per `motherboard-chat-interpreter-implementation-plan.md`)
- `services/model-native-*` — all 10: router, semantic-judge, semantics, split-domains, chair-targeting, exception-triage, org-action, response-verification, business-insights, level4
- `services/domain-validation.ts` — domain boundary validation
- `services/exception-triage.ts` — triages and remediates execution exceptions
- `services/compensation-analysis.ts` — compensation modeling (HR capability; gated by `hr_agent_enabled`)
- `routes/motherboard.ts`, `routes/motherboard-chat.ts`, `routes/simulation-board.ts` — board chat ingress and SIM board

**Author new / modify:**
- Rewire `board-orchestration.ts` and `chair-reasoning.ts` to load chair operating context from labor-commons specialist definitions (supported_tasks, out_of_scope_rules, authority_sources)
- HR agent + per-person analytics migrate as **gated capabilities**, disabled by default per `autonomy_policy.json` (`hr_agent_enabled: false`, `per_person_analytics_enabled: false`)

**Acceptance:**
- Chairs route work by relevance using specialist-derived capabilities
- Chat interpreter converts human input to structured intent and routes to the correct chair/flow
- Board synthesizer produces a unified board view from multi-chair input
- SIM board runs a full board cycle with no external side effects
- HR/per-person analytics remain disabled unless explicitly enabled in policy

---

### Phase 6 — Execution & Runtime

**Goal:** Actions execute through the governed runtime with SIM/LIVE modes, the operational loop state machine, and child-runtime linkage.

**Carry + sanitize:**
- `lib/operational-loop.ts` — stage machine (operation → verification → rnd/governance → governance → deployment); bottleneck tracking; checkpoint artifacts with hash-chaining
- `agent-runtime/execution/engine.ts`, `execution/types.ts` — execution engine producing Action objects with governor decision (auto_approved / requires_approval / blocked); decision log book; SIM (log only) and LIVE (policy-gated) modes
- `routes/execution.ts` — execution trigger and status
- `services/runtime-adapter.ts` — Docker / noop / local runtime abstraction
- `services/child-runtime-client.ts` — child runtime lifecycle (start/stop/status), hash-chained transfer manifest signing

**Acceptance:**
- Actions produce governor decisions and write to decision log **before** execution
- SIM mode yields an identical governance trail to LIVE with no external writes
- Operational loop transitions stages correctly and records checkpoints
- Runtime adapter executes against Docker and noop targets

---

### Phase 7 — Cadence Operations & Business Intelligence

**Goal:** The board operates on schedule and reports. Daily pulse, weekly brief, monthly review, plus BI, observability, and event streams.

**Carry + sanitize:**
- `workers/cadence.ts` — daily/weekly/monthly triggers; brief building; Slack posting with backoff/retry
- `routes/cadence.ts`, `routes/brief-templates.ts` — cadence control and brief templating
- `services/business-intelligence.ts`, `services/business-intelligence-catalog.ts`, `routes/business-intelligence.ts` — BI synthesis and catalog
- `routes/observability.ts`, `routes/events.ts` — observability and event streams

**Author new:**
- `workers/scheduler.ts` — reads `cadence_protocol.json` per org; timezone handling; missed-run recovery
- Crew-bridge delivery target (full implementation in Phase 12; stub here)

**Acceptance:**
- Daily/weekly/monthly runs generate and deliver on schedule per `cadence_protocol.json`
- Delivery respects channel whitelist and delivery targets
- BI surfaces KPI status from `objective_config.json`; missed runs don't cascade

---

### Phase 8 — Company Creation & Devloop

**Goal:** Levels 1–3 of company creation (Design → Provision+Assist → Operate-with-caps) and the devloop product/project build engine. Full migration of `launch/*` and `devloop/*`.

**Carry + sanitize:**
- `agent-runtime/launch/state-machine.ts`, `launch/types.ts`, `launch/generate-artifacts.ts` — launch interview producing `venture_profile.json`, `launch_plan.json`, `tooling_plan.json`, `financial_policy.json` (migration 0003)
- `routes/launch.ts` — launch lifecycle
- `services/devloop/*` — full devloop: `task-orchestrator.ts`, `planner-agent.ts`, `coding-agent.ts`, `reviewer-agent.ts`, `workspace-manager.ts`, `state-store.ts`, `artifact-store.ts`, `contracts.ts`, `specs.ts`, and all adapters (`github-api.ts`, `github-issue-provider.ts`, `linked-provider-api.ts`, `local-backlog-provider.ts`, `finalizers.ts`)
- `routes/devloop.ts`, `services/cli-task-spec.ts` — devloop control and CLI task specs

**Author new:**
- Launch Architect, Provisioning Agent, Growth Agent, Finance Guard as labor-commons-backed agents (per `company_creation_spec.md`)
- Idempotent connector writes with rollback (provisioning) per company creation spec

**Acceptance:**
- Launch interview produces all 4 company-creation artifacts
- Devloop runs product mode (local backlog → execution → artifacts) and project mode (issue provider → execution → PR artifacts) across GitHub/GitLab/Bitbucket/Azure DevOps/Gitea/local
- Provisioning writes are idempotent with working rollback

---

### Phase 9 — Level 4 Autonomous Launcher

**Goal:** Single prompt → launched, operating company. The four loops (Go Live, Acquire, Monetize, Operate) with real connectors. Full migration of `level4.ts` and real-connector hardening.

**Carry + sanitize:**
- `routes/level4.ts`, `services/model-native-level4.ts` — Level 4 orchestration
- `packages/connectors/real-connectors.ts` — real connector implementations

**Author new (per `level4_spec.md`):**
- **Go Live loop:** domain (Cloudflare), landing page (Vercel), email (SendGrid), CRM, analytics (PostHog)
- **Acquire loop:** ICP definition, prospect sourcing, outreach engine, meeting scheduling
- **Monetize loop:** Stripe setup, checkout deployment, and the full commercial billing stack for the org's own customers — subscriptions, per-seat pricing, tiered plans, entitlements, recurring billing, and invoicing (the inverted `billing.ts` engine; see Phase 11 Business Monetization). This is the org's own revenue from its own customers, not any OLF platform charge.
- **Operate loop:** weekly briefs, support triage, adaptive evolution
- Idempotency + rollback for every external write; `financial_policy.json` caps enforced on all spend
- Explicit non-goals enforced as hard blocks: no legal-entity automation, no bank account movement, no hiring/firing without approval, no paid ads without caps

**Acceptance:**
- A single prompt drives all four loops to a live, operating company in SIM and LIVE
- Every external write is idempotent and reversible; spend caps enforced
- Hard-blocked non-goals cannot execute even in autopilot

---

### Phase 10 — Autonomous Company Evolution

**Goal:** The company adapts. Market feedback, experiment evolution, capital allocation. Full migration of `autonomous-company.ts` (migration 0005) and `autonomous_company_master_spec.md`.

**Carry + sanitize:**
- `routes/autonomous-company.ts` — autonomous company lifecycle and state

**Author new (per `autonomous_company_master_spec.md`):**
- **Market feedback engine** — signal ingestion, `market_health_score`
- **Experiment evolution engine** — auto-kill, auto-scale, pivot protocol
- **Capital allocation engine** — budget allocation across experiments within `financial_policy.json` caps
- Real-execution connectors (Cloudflare, Vercel, SendGrid, Stripe, HubSpot, PostHog) wired to evolution loops

**Acceptance:**
- Market signals ingest and compute `market_health_score`
- Experiments auto-kill/auto-scale/pivot per defined thresholds
- Capital allocation respects financial caps; all moves logged to decision log
- Evolution decisions above threshold route through governance (operator or member vote)

---

### Phase 11 — Org Economics

**Goal:** The economic layer, with two symmetric, first-class halves. A business owner needs to run a real commercial venture exactly as much as a collective needs to run a cooperative. Both fully migrate; both are governed through the same approval and audit layer.

The single deletion in the whole migration lives here and is *not* a business capability: OLF-as-vendor metering of commons-board itself (plan tiers gating `briefsPerMonth` / `agentRunsPerDay` / `connectorsEnabled`). OLF does not charge for the platform. Everything else in `billing.ts` is inverted and kept.

#### 11a — Business Monetization (business mode)

The full commercial billing engine, **inverted** from `billing.ts`: in mother-board it pointed inward (the workspace pays the vendor); here it points outward (the org's customers pay the org).

**Carry + invert from mother-board:**
- `routes/billing.ts` — subscription lifecycle, plan tiers, trials, upgrades, usage/entitlement metering. Inverted so the org defines and operates plans for *its own product*, and `limitsForPlan` (starter/pro/enterprise) becomes an owner-customizable plan template rather than an OLF-imposed plan.

**Author new / modify:**
- `lib/monetization.ts` — the org's commercial revenue engine: subscriptions, per-seat pricing, tiered plans, entitlement gating, recurring billing, one-time checkout, invoicing — all for the org's customers
- Wire Stripe (and other processors) from Phase 9 Monetize / Phase 15 connectors
- Entitlement enforcement gates the org's *product* features for the org's customers — never gates commons-board itself

**Routes:**
- `GET/POST /api/v1/monetization/plans` — define the org's product plans
- `GET /api/v1/monetization/subscriptions`, `POST /api/v1/monetization/subscriptions` — the org's customer subscriptions
- `GET /api/v1/monetization/usage` — the org's customer usage/entitlement state
- `POST /api/v1/monetization/checkout`, `POST /api/v1/monetization/invoices`

#### 11b — Collective Treasury (collective mode)

The cooperative counterpart: pooled revenue and governed distribution.

**Author new:**
- `lib/treasury.ts` — pooled treasury accounts; inflow recording (from Monetize loop / external); distribution policy execution
- `collective_economics.json` artifact (or extension of `financial_policy.json` for collective mode) — distribution model (equal-share / contribution-weighted / hybrid), reserve floors, payout cadence
- Distribution engine — computes member payouts from contribution records (Phase 4) and treasury balance; routes distribution approval through collective governance

**Routes:**
- `GET /api/v1/treasury`, `POST /api/v1/treasury/distribute`, `GET /api/v1/treasury/distributions`

**Database:** monetization (plans, subscriptions, invoices) and treasury (accounts, distributions) — from migration 0013.

**Acceptance:**
- **Business:** the org defines its own plans; customer subscriptions, per-seat, entitlements, recurring billing, and invoicing all operate; entitlement gating affects only the org's product, never commons-board
- **Collective:** treasury records inflows; distribution computes correctly under equal-share and contribution-weighted models; every distribution routes through member vote and is logged immutably; reserve floors enforced
- OLF never charges, meters, or gates the org's use of commons-board

---

### Phase 12 — Commons-Crew Bridge (Optional Integration)

**Goal:** Offer a second door for users already working inside the commons-crew personal assistant. commons-board is fully usable through its own chat interpreter (Phase 5) and web UI (Phase 13); this bridge is a convenience, not the primary surface and not a dependency.

**Carry + sanitize:**
- `routes/feedback.ts`, `routes/evals.ts`, `routes/demo.ts` — feedback capture, evaluation, and demo flows (reused by the bridge for status/quality signals)

**Author new:**
- `routes/crew-bridge.ts` — `POST /api/v1/crew-bridge/intent` with intent types: `get_status`, `get_brief`, `list_approvals`, `submit_approval`, `cast_vote`, `trigger_cadence`, `get_decision_log`, `get_gaps`, `get_treasury`
- Workspace-scoped bearer token auth issued at org setup
- Result packaging structured for PA presentation (summary + detail + action items)

**Acceptance:**
- All intent types route correctly with expected response shapes
- Auth blocks unauthenticated requests; bridge degrades gracefully when board is unavailable
- A single `get_status` surfaces all pending human actions (approvals + votes + gaps + distributions)

---

### Phase 13 — Admin & Audit UI

**Goal:** The secondary human surface for oversight, administration, and audit. Full migration of `apps/web`, simplified around the crew-first model.

**Carry + sanitize:**
- `apps/web/*` — Next.js app; `app/chairs/[chairId]`, `app/dashboards/[dashboardKey]`, `app/api/session`

**Author new / modify:**
- Pages: Dashboard (org status, approvals/votes, recent decisions, gaps, treasury), Artifact viewer (read-only + version history), Decision log (filterable audit), Chairs (assignments, specialist refs, scope), Approvals queue, Votes (collective), Gaps (with submit-to-labor-commons), Treasury (collective)
- Workspace-scoped session token; multi-user collective access wired in Phase 14

**Acceptance:**
- Dashboard reflects live org state; artifact viewer shows current + prior versions
- Decision log browsable/filterable; approval and vote actions work with confirmation
- No credentials, keys, or tokens exposed in any UI response

---

### Phase 14 — Federation & Multi-Org

**Goal:** Parent-child organizational relationships. Sector cooperative → local collectives; multi-location business → branches. Extends child-runtime linkage into full federation.

**Carry + sanitize:**
- Extend `services/child-runtime-client.ts` and portfolio logic into federation

**Author new:**
- `routes/federation.ts` — `POST /api/v1/federation/link`, `GET /api/v1/federation/children`, `GET /api/v1/federation/parent`
- Policy floors: parent sets minimums in child `autonomy_policy.json` that child cannot override
- Governance handoff: hash-chained signed manifest on policy change
- Multi-user collective access: member accounts, roles (member/steward/coordinator), vote from web UI

**Acceptance:**
- Parent-child established; policy floors enforced and unoverridable by child
- Parent policy changes propagate to children with hash-chained governance record
- Collective members log in and cast votes from the UI

---

### Phase 15 — Connectors & Integration Hardening

**Goal:** All real connectors production-hardened with the credential vault. Webhooks, retries, idempotency across every external integration.

**Carry + sanitize:**
- `packages/connectors/real-connectors.ts`, `mock-connectors.ts`, `types.ts`, `vault.ts` — full connector suite + credential vault
- `routes/webhooks.ts` — inbound webhook handling

**Author new / modify:**
- Harden every connector (Slack, Jira, Calendar, Cloudflare, Vercel, SendGrid, Stripe, HubSpot, PostHog, git providers): idempotency keys, retry with backoff, rollback
- Vault: encrypted credential storage, per-workspace isolation, rotation

**Acceptance:**
- Every connector has a mock and a real implementation behind one interface
- Credentials stored encrypted, never logged, isolated per workspace
- Webhooks verified, idempotent, and replay-safe

---

### Phase 16 — Testing Agent & Full Validation

**Goal:** The testing agent validates the whole system. Built incrementally per phase, completed and expanded here for OLF-specific coverage.

**Carry + sanitize:**
- `services/testing-agent/*` — `cli.ts`, `command.ts`, `orchestrator.ts`, `repo-validator.ts`, `integration-simulator.ts`, `governance-validator.ts`, `doctor.ts`, `reporter.ts`, `types.ts`

**Author new:**
- Test scenarios for labor-commons integration (resolver scoring, gap handling, catalog sync)
- Test scenarios for collective governance (voting, quorum, amendments, contribution tracking)
- Test scenarios for collective economics (distribution models, reserve floors)
- Test scenarios for crew-bridge (all intent types)

**Acceptance:**
- `doctor` validates environment and config end to end
- Repo validator, integration simulator, and governance validator pass on a clean build
- Governance validator confirms artifact integrity, signing chain validity, decision-log immutability
- Full onboarding → staffing → cadence → approval → execution cycle passes in SIM for both governance modes

---

## Testing Requirements (Every Phase)

Tests land with each phase, not after.

| Layer | Framework | Scope |
|---|---|---|
| Unit | Vitest | artifact store, verification policy, governance signing, resolver scoring, treasury math, vote tallies |
| Integration | Vitest + test PostgreSQL | artifact write → governance event → decision-log chain; interview → artifact generation; specialist resolution → blueprint update |
| End-to-end | testing-agent CLI | full onboarding, full cadence cycle, approval routing both modes, Level 4 loops in SIM |
| Governance | testing-agent governance-validator | artifact integrity, signing chain, decision-log immutability, autonomy never self-promoted |

---

## Build Order & Parallelism

```
Phase 1  Foundation
Phase 2  Onboarding interview & artifact generation
Phase 3  Specialist resolution & chair staffing
Phase 4  Governance engine & approval workflow
Phase 5  Board orchestration & reasoning
Phase 6  Execution & runtime
Phase 7  Cadence operations & BI            ─┐ parallel after 6
Phase 8  Company creation & devloop          ─┘
Phase 9  Level 4 autonomous launcher          (after 8)
Phase 10 Autonomous company evolution         (after 9)
Phase 11 Org economics (business monetization + collective treasury)  (after 4; pairs with 9/10)
Phase 12 Commons-crew bridge (optional)       (after 7)
Phase 13 Admin & audit UI                     (after 12)
Phase 14 Federation & multi-org               (after 13)
Phase 15 Connectors & integration hardening   (continuous; gate before 9 LIVE)
Phase 16 Testing agent & full validation      (incremental; completed last)
```

- Phases 1–6 are a strict sequence; each depends on the prior.
- Phases 7 and 8 run in parallel after Phase 6.
- Phases 9 and 10 are sequential and depend on 8.
- Phase 11 depends only on Phase 4. Its business-monetization half (11a) pairs with Phase 9; its collective-treasury half (11b) pairs with Phase 10.
- Phase 15 runs continuously but must gate before any LIVE-mode execution in Phase 9.
- Phase 16 is built incrementally with every phase and finalized at the end.

---

## Sanitization Rules

Applied to all carried source before commit. Sanitization rewrites; it does not remove capability.

- Rename all pre-OLF identifiers: `motherboard*` → `commons-board`/`governance`; remove `jkm-*`, `aieb`, `cb0` references and branding
- Update all stack references to OLF repos: labor-commons, commons-crew, commons-board, commons-idea, commons-specs, commons-artifacts
- **The only deletion is OLF-as-vendor metering of commons-board itself** — the plan tiers that gate platform features (`briefsPerMonth` / `agentRunsPerDay` / `connectorsEnabled`) are removed because OLF does not charge for the platform. The rest of `routes/billing.ts` — the full subscription/plan/entitlement/recurring-billing engine — is **inverted**, not discarded: it becomes the business-mode capability for an org to bill its *own* customers (Phase 11a Business Monetization). A business owner gets the complete commercial revenue stack.
- Replace hardcoded domain-type capability lists with labor-commons specialist lookups (Phase 3/5)
- HR agent and per-person analytics migrate as capabilities but remain governed: disabled by default, opt-in via `autonomy_policy.json`
- No credentials, keys, or tokens from any pre-OLF source
- Per [sanitize-on-import]: sanitize at the moment of import, no deferred cleanup

---

## Definition of Done

commons-board v1 is complete when:

- All 16 phases pass their acceptance criteria
- Both governance modes (business, collective) run a full lifecycle in SIM and LIVE
- Every chair is staffable from labor-commons; gaps route to commons-idea/labor-commons
- Level 4 launches a real operating company within policy caps with full reversibility
- Business mode runs a full commercial venture — its own subscriptions, per-seat billing, entitlements, and invoicing for its own customers
- Collective mode distributes treasury under governed vote
- OLF never charges, meters, or gates an org's use of commons-board
- commons-board is fully operable through its own chat interpreter and web UI; the commons-crew bridge works as an optional second door
- inference runs through the configurable provider subsystem; no credential exists anywhere in the repo
- The testing agent's full suite passes on a clean build
- Every action across every capability is signed, hash-chained, and written to the decision log before execution
