# commons-board — Execution Plan

## Source Material

The implementation carries core infrastructure from the mother-board pre-OLF codebase. The source is at `/Users/john/Documents/Projects/Pre-OLF/mother-board`. All source material must be sanitized before landing in this repo — no pre-OLF repo names, no pre-OLF branding, no commercialization scaffolding.

---

## Build Phases

### Phase 1 — Foundation

**Goal:** Establish the repo, monorepo structure, and core infrastructure. Everything that runs before a user has ever touched the system.

**What gets built:**

1. **Monorepo scaffold**
   - `package.json` (workspace root)
   - `tsconfig.base.json`
   - `services/api/`, `services/agent-runtime/`, `services/workers/`, `services/testing-agent/`
   - `apps/web/`
   - `packages/connectors/`, `packages/shared/`
   - `.github/` (workflows, PR template, issue labels)
   - `Dockerfile`, `docker-compose.yml`

2. **Shared types** (`packages/shared/`)
   - Artifact types for all 6 governing artifacts
   - Action object type (agent_id, action_type, evidence, assumptions, risk_score, impact_range, approvals_required, rollback_plan)
   - Governance event type
   - Decision log entry type
   - Specialist resolution types

3. **Artifact store** (`services/api/src/lib/artifact-store.ts`)
   - Versioned artifact records (carried and sanitized from mother-board)
   - JSON schema validation for all 6 artifact types
   - Version history preservation
   - Artifact write = governance event

4. **PostgreSQL schema and migrations**
   - Migration 0001: artifacts (id, org_id, type, payload, version, created_at, governance_event_id)
   - Migration 0002: governance_events (id, org_id, event_type, artifact_id, signed_payload, at)
   - Migration 0003: decision_log (id, org_id, entry, signed_at, chain_hash)
   - Migration 0004: approval_records (id, org_id, action_id, status, required_approvers, responses)
   - Migration 0005: orgs (id, governance_mode, created_at)
   - Migration 0006: members (id, org_id, role, joined_at) — collective mode
   - Migration 0007: votes (id, org_id, decision_id, member_id, choice, cast_at) — collective mode
   - Migration 0008: catalog_gaps (id, org_id, function_description, gap_id, resolved_at)
   - Migration 0009: catalog_refs (id, org_id, chair_id, specialist_slug, catalog_path, pinned_ref)

5. **Governance signing** (`services/api/src/lib/governance-signing.ts`)
   - HMAC-SHA256 payload signing (carried and sanitized)
   - Keyring management with key rotation
   - Per-workspace signing keys

6. **Runtime receipts** (`services/api/src/lib/runtime-receipts.ts`)
   - Hash-chained execution receipts (carried and sanitized)
   - Chain integrity verification

7. **Decision log** (append-only, hash-chained, carried and sanitized)

8. **Basic API gateway** (`services/api/src/index.ts`)
   - Authentication middleware
   - Health endpoint
   - Redacted request logging
   - Correlation IDs
   - Error handling

**Acceptance criteria for Phase 1:**
- Monorepo builds clean with no TypeScript errors
- PostgreSQL migrations run without error
- Artifact store can write, read, and version all 6 artifact types
- Governance signing produces valid signed payloads
- Runtime receipts chain correctly
- Health endpoint returns 200
- Docker container builds and starts

---

### Phase 2 — Onboarding Interview and Artifact Generation

**Goal:** A user can run the interview and have all governing artifacts generated correctly for both governance modes.

**What gets built:**

1. **Interview state machine** (`services/agent-runtime/src/interview.ts`)
   - Carried and sanitized from mother-board, rewritten for governance_mode detection
   - Section sequence:
     - Section 0: Mode detection (business vs. collective — from first exchange, not an explicit question)
     - Section 1: Org identity (name, description, industry)
     - Section 2: Goals and objectives
     - Section 3: Risk appetite and autonomy comfort
     - Section 4: Operating cadence preferences
     - Section 5: Functions and chairs needed
     - Section 6 (collective only): Membership structure and voting preferences
   - At end of each section: state is persisted; interview is resumable
   - After all sections: generates `artifact_draft` for review before finalization

2. **Artifact generation** (`services/agent-runtime/src/artifact-generator.ts`)
   - Takes completed interview state → generates all applicable artifacts
   - Validates each artifact against JSON schema
   - Writes artifacts to store as governance events
   - Returns draft artifacts for confirmation before activation

3. **Confirmation flow** (`services/api/src/routes/interview.ts`)
   - `POST /api/v1/interview/start` — initiates interview
   - `POST /api/v1/interview/:id/respond` — submits a section response
   - `GET /api/v1/interview/:id/state` — returns current interview state
   - `POST /api/v1/interview/:id/confirm` — confirms draft artifacts and activates org

4. **Model integration** (`services/api/src/lib/model-client.ts`)
   - Thin abstraction over the LLM provider
   - Used for: interview conversation, artifact draft generation, brief writing
   - NOT used for: approval decisions, audit log, risk classification, permission checks

**Acceptance criteria for Phase 2:**
- Interview runs to completion for business mode — all 5 core artifacts generated correctly
- Interview runs to completion for collective mode — all 6 artifacts generated correctly
- Draft artifacts are presented for review before activation
- Confirmation activates the org
- Interview is resumable after interruption
- Artifacts fail to write if JSON schema validation fails

---

### Phase 3 — Specialist Resolution and Chair Staffing

**Goal:** After artifact generation, each chair in `agent_blueprint.json` is staffed with appropriate labor-commons specialists. This is the integration point that distinguishes commons-board from mother-board.

**What gets built:**

1. **Labor-commons client** (`services/api/src/lib/labor-commons-client.ts`)
   - Remote mode: reads from GitHub API against labor-commons repo, caches locally
   - Local mode: reads from local clone, configurable path
   - Methods: `getSpecialist`, `searchSpecialists`, `listByDomain`, `checkForUpdates`, `reportGap`
   - Cache: file-based, keyed by specialist slug + catalog ref

2. **Specialist resolver** (`services/api/src/services/specialist-resolver.ts`)
   - Takes function description + industry context from interview
   - Queries labor-commons for matching specialists
   - Scores and ranks matches (domain alignment, task coverage, scope quality, authority quality)
   - Returns ranked resolution for operator/collective review
   - Writes gap records when no match found

3. **Chair staffing route** (`services/api/src/routes/org.ts`)
   - `POST /api/v1/org/resolve-specialists` — triggers specialist resolution for all chairs
   - `GET /api/v1/org/specialist-matches` — returns proposed matches for review
   - `POST /api/v1/org/confirm-specialists` — accepts selections, updates `agent_blueprint.json`
   - `PUT /api/v1/org/chairs/:chair_id/specialists` — operator overrides a chair's specialists

4. **Gap reporting**
   - Gaps written to `catalog_gaps` table
   - Gap notification surfaced via crew-bridge and cadence
   - `POST /api/v1/org/gaps/:gap_id/submit` — operator submits gap to labor-commons (opens GitHub issue)

5. **Catalog sync worker** (`services/workers/src/catalog-sync.ts`)
   - Runs weekly (configurable)
   - For each unpinned specialist ref, checks for catalog updates
   - Surfaces update notifications to operator/collective
   - Applies accepted updates; rejects or ignores declined updates

**Acceptance criteria for Phase 3:**
- Specialist resolver returns ranked matches for any function description in labor-commons scope
- Gaps are recorded when no match is found
- Operator can override any specialist selection
- Confirmed selections are persisted in `agent_blueprint.json` via artifact versioning
- Catalog sync runs without error; surfaces real updates
- Labor-commons client falls back to local cache when remote is unavailable

---

### Phase 4 — Governance Engine and Approval Workflow

**Goal:** Actions generated by the board route correctly through the governance layer. Business mode routes to the operator. Collective mode routes to the membership when threshold is crossed.

**What gets built:**

1. **Verification policy** (`services/api/src/lib/verification-policy.ts`)
   - Carried and sanitized from mother-board
   - Action types → approval requirements mapping
   - Risk-based escalation (score 85+ → dual approval)
   - Blast radius escalation

2. **Approval workflow** (`services/api/src/routes/approvals.ts`)
   - `GET /api/v1/approvals` — list pending approvals
   - `POST /api/v1/approvals/:id/approve` — operator approval
   - `POST /api/v1/approvals/:id/reject` — operator rejection
   - Approvals include: evidence, assumptions, impact range, risk score, rollback plan

3. **Collective governance layer** (`services/api/src/lib/collective-governance.ts`) — new
   - Decision routing: for decisions above threshold, creates a member vote instead of operator approval
   - Vote management: open vote, collect responses, resolve at deadline or quorum
   - `POST /api/v1/votes` — collective-mode only; creates a vote for a pending decision
   - `POST /api/v1/votes/:id/cast` — cast a vote
   - `GET /api/v1/votes` — list open votes
   - `GET /api/v1/votes/:id` — vote detail and current tally
   - Amendment workflow: proposal → notice period → vote → artifact update
   - Contribution tracking: member actions recorded per `collective_config.json` settings

4. **Execution engine** (`services/agent-runtime/src/execution.ts`)
   - Carried and sanitized from mother-board
   - Produces Action objects with governor decision (auto_approved / requires_approval / blocked)
   - Writes to decision log before execution
   - SIM mode: logs side effects but does not execute
   - LIVE mode: executes within policy; routes to approval if required

**Acceptance criteria for Phase 4:**
- Business mode: actions above threshold route to operator approval queue
- Collective mode: actions above threshold route to member vote
- Votes resolve correctly at quorum or deadline
- SIM mode produces identical governance trail as LIVE mode but no external side effects
- Decision log entries are append-only and hash-chained
- Autonomy mode transitions require explicit operator/member action (system never self-promotes)

---

### Phase 5 — Cadence Operations

**Goal:** The board operates on schedule. Daily pulses, weekly briefs, monthly reviews.

**What gets built:**

1. **Cadence workers** (`services/workers/src/`)
   - Daily worker: triggers daily pulse generation; routes to delivery targets in `cadence_protocol.json`
   - Weekly worker: triggers executive brief from all chairs; aggregates KPI status, risks, recommendations; routes to delivery
   - Monthly worker: triggers strategic review; surfaces objective progress, governance health, gap status

2. **Brief generation** (`services/api/src/services/board-synthesizer.ts`)
   - Carried and sanitized from mother-board
   - Compiles chair inputs into unified executive brief
   - Incorporates KPI status from `objective_config.json`
   - Flags items requiring operator or member attention

3. **Connector routing** (`packages/connectors/`)
   - Slack connector: post to whitelisted channels (carried from mother-board)
   - Crew-bridge delivery: push to commons-crew PA for presentation to user
   - Email delivery: stub in Phase 5, full implementation in Phase 7

4. **Cadence schedule** (`services/workers/src/scheduler.ts`)
   - Reads `cadence_protocol.json` per org
   - Schedules workers against configured times and days
   - Handles timezone conversion
   - Recovers gracefully if a run is missed

**Acceptance criteria for Phase 5:**
- Daily pulse generates and delivers on schedule
- Weekly brief aggregates all chair inputs and delivers on schedule
- Monthly review generates on schedule
- Delivery respects `cadence_protocol.json` settings (channel whitelist, delivery targets)
- Missed runs do not cause cascading failures

---

### Phase 6 — Commons-Crew Bridge

**Goal:** commons-crew can invoke commons-board operations on behalf of the user. The user never directly interacts with commons-board's API.

**What gets built:**

1. **Crew-bridge endpoint** (`services/api/src/routes/crew-bridge.ts`)
   - `POST /api/v1/crew-bridge/intent` — accepts structured intent from commons-crew PA; routes to board function; returns structured result
   - Intent types:
     - `get_status` — org health, active approvals, open votes
     - `get_brief` — latest weekly brief or on-demand brief
     - `list_approvals` — pending approvals for this operator/collective
     - `submit_approval` — operator approves or rejects a pending action
     - `cast_vote` — collective member casts a vote
     - `trigger_cadence` — manual trigger of a cadence run
     - `get_decision_log` — recent decision log entries
     - `get_gaps` — current catalog gaps

2. **Authentication** — crew-bridge uses a workspace-scoped bearer token; commons-crew is issued a token during org setup; token is stored in commons-crew's secure config, not in the commons-board database directly

3. **Result packaging** — bridge responses are structured for PA presentation (summary + detail + action items); PA voice handles rendering, not the bridge response

**Acceptance criteria for Phase 6:**
- All intent types route correctly and return expected response shapes
- Authentication blocks unauthenticated requests
- Bridge handles commons-board being unavailable gracefully (returns degraded status, not error)
- PA can surface all pending human actions (approvals, votes) in a single `get_status` call

---

### Phase 7 — Admin UI and Audit View

**Goal:** A secondary human interface for review, administration, and audit. Not the primary interaction surface — that is commons-crew — but needed for governance oversight and administration.

**What gets built:**

1. **Next.js web application** (`apps/web/`)
   - Carried and substantially simplified from mother-board
   - Pages:
     - Dashboard: org status, active approvals/votes, recent decisions, gap notifications
     - Artifact viewer: read-only view of current governing artifacts with version history
     - Decision log: full audit trail, filterable
     - Chairs: chair list, specialist assignments, scope summaries
     - Approvals: pending approval queue with action
     - Votes (collective only): open votes, vote history, contribution records
     - Gaps: catalog gap list with submit-to-labor-commons action

2. **Session management** — workspace-scoped session token; secure httpOnly cookie; no persistent user accounts in Phase 7 (single-operator business mode); multi-user access for collective mode added in Phase 8

**Acceptance criteria for Phase 7:**
- Dashboard loads and reflects current org state
- Artifact viewer shows current and previous artifact versions
- Decision log is browsable and filterable
- Approval queue allows approve/reject with confirmation
- Vote queue (collective mode) allows vote casting
- No sensitive data (credentials, signing keys, tokens) exposed in UI responses

---

### Phase 8 — Federation and Multi-Org

**Goal:** Parent-child organizational relationships. A sector cooperative governs local collectives. A multi-location business governs branches.

**What gets built:**

1. **Federation model** (`services/api/src/routes/federation.ts`)
   - `POST /api/v1/federation/link` — establish parent-child relationship
   - `GET /api/v1/federation/children` — list child orgs
   - `GET /api/v1/federation/parent` — get parent org and inherited policies
   - Policy floors: parent can set minimum values in child's `autonomy_policy.json` that cannot be overridden
   - Governance handoff: hash-chained signed manifest on policy change

2. **Multi-user access for collective mode**
   - Member accounts (simple, workspace-scoped)
   - Role-based access: member, steward, coordinator
   - Members can view decisions, cast votes, and see contribution records
   - Stewards/coordinators can trigger cadence, submit approvals on behalf of the collective

**Acceptance criteria for Phase 8:**
- Parent-child relationship established and policy floors enforced
- Child cannot override a policy floor set by parent
- Policy changes at parent propagate to children with hash-chained governance record
- Collective members can log in and cast votes from the web UI

---

## What Is Out of Scope for v1

These capabilities are designed in the mother-board spec but deferred from commons-board v1:

| Capability | Why Deferred |
|---|---|
| Level 4 autonomous company launch (real Stripe, Vercel, Cloudflare integration) | Requires production-hardened connector idempotency and rollback; significant scope |
| Outbound sales / email campaign engine | Out of scope for collectives; business mode addition in v2 |
| Market feedback and experiment evolution engine | Requires meaningful operational history; add after orgs have been running |
| HR agent and per-person analytics | Disabled by default; opt-in activation in v2 |
| Mobile interface | Desktop-first; mobile in v2 once patterns are established |
| Public SaaS hosting | All deployment is self-hosted; hosted offering is a separate product decision |

---

## Build Order Summary

```
Phase 1:  Foundation (monorepo, types, artifact store, DB, signing, receipts, gateway)
Phase 2:  Onboarding interview and artifact generation (both governance modes)
Phase 3:  Specialist resolution and chair staffing (labor-commons integration)
Phase 4:  Governance engine and approval workflow (verification policy, collective voting)
Phase 5:  Cadence operations (daily, weekly, monthly; connector routing)
Phase 6:  Commons-crew bridge (intent routing, crew authentication)
Phase 7:  Admin UI and audit view (Next.js, dashboard, artifact viewer, decision log)
Phase 8:  Federation and multi-org (parent-child, policy floors, multi-user collective)
```

Phases 1–4 are prerequisites for each other and must be built in sequence.
Phases 5 and 6 can proceed in parallel after Phase 4 is complete.
Phase 7 can start after Phase 6 (requires bridge for real data).
Phase 8 follows Phase 7.

---

## Source Sanitization Rules

All code carried from mother-board must be sanitized before commit:

- Remove all pre-OLF repo references (jkm-agents, jkm-agent-pa, mother-board branding)
- Remove SaaS billing, subscription, and commercialization scaffolding
- Remove Level 4 autonomous company launch connectors and routes (stub endpoints are acceptable)
- Remove per-seat licensing and entitlement checks
- Remove HR agent and per-person analytics (replace with disabled stubs that respect the `hr_agent_enabled` flag)
- Replace all hardcoded domain type lists with labor-commons lookup
- Update all documentation references to OLF stack (labor-commons, commons-crew, commons-board)
- No credentials, keys, or tokens from pre-OLF sources

---

## Testing Requirements

Each phase must include tests before the next phase begins.

| Layer | Framework | Scope |
|---|---|---|
| Unit | Vitest | Artifact store, verification policy, governance signing, specialist resolver scoring |
| Integration | Vitest + test PostgreSQL | Artifact write → governance event → decision log chain; interview → artifact generation |
| End-to-end | Testing agent CLI | Full onboarding flow; full cadence cycle; approval routing for both modes |
| Governance | Testing agent governance validator | Artifact integrity, signing chain validity, decision log immutability |

The testing agent service from mother-board is carried directly. Expand its test scenarios to cover labor-commons integration and collective governance.
