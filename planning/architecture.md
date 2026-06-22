# commons-board — Architecture

## What Carries from Mother-Board

Mother-board is a working implementation with sound core infrastructure. The following carries directly:

| Component | What It Does | Status |
|---|---|---|
| Verification policy engine | Maps action types to approval requirements (single/dual admin, risk-based escalation) | Carry |
| Operational loop state machine | Tracks stage transitions with checkpoint artifacts | Carry |
| Governance signing | HMAC-SHA256 payload signing, keyring management, key rotation | Carry |
| Runtime receipts | Hash-chained execution receipts for immutable audit | Carry |
| Decision log | Append-only ledger, written before execution | Carry |
| Artifact store | Versioned JSON artifact records with schema validation | Carry |
| Cadence workers | Daily, weekly, monthly triggers and brief generation | Carry |
| Approval workflow | Pending/approved/rejected with multi-party thresholds | Carry |
| Agent runtime | Interview state machine, execution engine | Carry (rewrite interview flow) |
| PostgreSQL persistence | Schema + migrations | Carry (add new tables) |
| Docker containerization | Alpine image, non-root, mounted storage | Carry |
| Connector abstraction | Slack, Jira, Calendar, credential vault | Carry |
| Testing agent | Repository validator, integration simulator, governance validator | Carry |

## What Changes

| Component | What Changes |
|---|---|
| Onboarding interview | Rewritten for governance_mode branching (business vs. collective); adds labor-commons specialist discovery |
| Artifact schemas | Add `governance_mode` field; add `collective_config.json` for collective mode; labor-commons specialist references in `agent_blueprint.json` |
| Agent instantiation | Consults labor-commons API to staff chairs with catalog specialists instead of hardcoded domain types |
| Approval routing | In collective mode, routes decisions above threshold to membership vote rather than single operator |
| Collective governance layer | New: member voting, consensus protocols, amendment workflows, contribution tracking |
| Board orchestration | Chair routing uses labor-commons specialist capabilities instead of hardcoded domain capability lists |
| Chat interpreter | Reoriented to commons-crew integration rather than standalone board chat |
| UI | Simplified; commons-crew is the primary human interface; board UI is secondary (admin/audit view) |

## What Is Reframed (Not Removed)

Every mother-board capability migrates. Nothing is dropped from scope. A small number of components are *reframed* because the OLF context differs — the capability survives, only its framing or destination changes.

| Component | Reframing |
|---|---|
| `billing.ts` subscription / plan-tier / entitlement engine | **Inverted, not removed.** In mother-board it billed the workspace to use the platform; in commons-board it becomes a business-mode capability for an org to bill *its own customers* — subscriptions, per-seat, tiers, entitlements, recurring billing, invoicing (Phase 11a Business Monetization). The complete commercial revenue stack migrates. |
| OLF-as-vendor metering of commons-board | **The one true deletion.** Plan tiers that gate platform features (`briefsPerMonth` / `agentRunsPerDay` / `connectorsEnabled`) are removed: OLF is AGPL and self-hosted and does not charge, meter, or gate use of the platform. This is the only capability that disappears, and it is not a business-owner capability. |
| Level 4 autonomous company launch | Fully migrated (Phase 9), real connectors included (Cloudflare, Vercel, SendGrid, Stripe, HubSpot, PostHog) with idempotency and rollback. |
| Market feedback / experiment evolution / capital allocation | Fully migrated (Phase 10). |
| Outbound sales engine | Fully migrated as the Level 4 Acquire loop (Phase 9). |
| HR agent / per-person analytics | Fully migrated as governed capabilities, disabled by default, opt-in via `autonomy_policy.json`. |

See [execution-plan.md](execution-plan.md) for the complete component → phase map.

---

## Monorepo Structure

```
commons-board/
├── services/
│   ├── api/                      Core platform API (Express.js)
│   │   ├── src/
│   │   │   ├── lib/              Core business logic
│   │   │   │   ├── artifact-store.ts
│   │   │   │   ├── verification-policy.ts
│   │   │   │   ├── operational-loop.ts
│   │   │   │   ├── governance-signing.ts
│   │   │   │   ├── runtime-receipts.ts
│   │   │   │   ├── collective-governance.ts    ← new
│   │   │   │   └── labor-commons-client.ts     ← new
│   │   │   ├── routes/
│   │   │   │   ├── interview.ts
│   │   │   │   ├── execution.ts
│   │   │   │   ├── approvals.ts
│   │   │   │   ├── cadence.ts
│   │   │   │   ├── artifacts.ts
│   │   │   │   ├── decision-logs.ts
│   │   │   │   ├── org.ts
│   │   │   │   ├── federation.ts
│   │   │   │   ├── crew-bridge.ts              ← new
│   │   │   │   └── membership.ts               ← new (collective mode)
│   │   │   └── services/
│   │   │       ├── board-orchestration.ts
│   │   │       ├── org-compiler.ts
│   │   │       ├── chat-interpreter.ts
│   │   │       ├── reasoning-loop.ts
│   │   │       └── specialist-resolver.ts      ← new
│   ├── agent-runtime/            Interview, launch, execution engine
│   ├── workers/                  Cadence, ingestion workers
│   └── testing-agent/            Validation CLI
├── apps/
│   └── web/                      Admin/audit UI (Next.js)
├── packages/
│   ├── connectors/               Slack, Jira, Calendar, vault
│   └── shared/                   Shared types
├── planning/                     This directory
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│              commons-crew (human entry point)            │
│         PA routes organizational requests here           │
└──────────────────────┬──────────────────────────────────┘
                       │ crew-bridge API
┌──────────────────────▼──────────────────────────────────┐
│              API Gateway (Express, port 4000)            │
│  Authentication, verification policy, rate limiting      │
└────┬──────┬──────┬──────┬──────┬──────┬─────────────────┘
     │      │      │      │      │      │
 Interview  Exec  Aprv  Caden  Org  Crew-Bridge
     │      │      │      │      │      │
     └──────┴──────┴──────┴──────┴──────┘
                       │
          ┌────────────▼────────────┐
          │      Agent Runtime       │
          │  Interview state machine │
          │  Execution engine        │
          │  Decision log book       │
          └────────────┬────────────┘
                       │
     ┌─────────────────▼─────────────────┐
     │         Governance Layer           │
     │  Verification policy              │
     │  Governance signing               │
     │  Runtime receipts                 │
     │  Collective governance (new)      │
     └─────────────────┬─────────────────┘
                       │
     ┌─────────────────▼─────────────────┐
     │          Persistence               │
     │  PostgreSQL (artifacts, logs,      │
     │  approvals, votes, members)       │
     └─────────────────┬─────────────────┘
                       │
          ┌────────────▼────────────┐
          │   External Integrations  │
          │  labor-commons API      │  ← new
          │  Slack connector        │
          │  Calendar connector     │
          │  Jira connector         │
          └─────────────────────────┘
```

---

## Data Flow: Onboarding to Operations

```
User via commons-crew
    │
    ▼
Interview (governance_mode detected in first exchange)
    │
    ├── Business mode: owner-centric questions
    └── Collective mode: membership-structure questions
    │
    ▼
Artifact generation
    │
    ├── business_profile.json
    ├── objective_config.json
    ├── autonomy_policy.json
    ├── cadence_protocol.json
    ├── agent_blueprint.json
    └── [collective_config.json]    ← collective mode only
    │
    ▼
Specialist resolution (labor-commons lookup)
    │
    For each chair in agent_blueprint:
    ├── Query labor-commons for specialists matching the function
    ├── Score by fit (domain alignment, capability coverage)
    └── Assign top specialists to the chair
    │
    ▼
Org compilation (chairs + worker agents instantiated)
    │
    ▼
Cadence begins
    │
    ├── Daily: pulse generation → approval or auto-post
    ├── Weekly: executive brief from all chairs → surfaced to owner/collective
    └── Monthly: strategic review → governance decisions if needed
    │
    ▼
Ongoing operation
    │
    ├── Actions within policy → execute → receipt + decision log
    ├── Actions above threshold → approval queue → owner (business) or member vote (collective)
    └── Governance changes → amendment workflow (collective) or operator override (business)
```

---

## Governance Mode Differences

| Behavior | Business Mode | Collective Mode |
|---|---|---|
| Authority at top | Owner/operator | Collective membership |
| Approval routing | Owner | Owner OR member vote (threshold-dependent) |
| Policy changes | Operator updates artifacts | Amendment workflow, member consensus |
| Governance audit | Who approved what | Who voted, how, when |
| Member records | N/A | Contribution tracking, participation history |
| Chair staffing | Owner-defined functions | Functions + collective role roster |
| New chair addition | Operator request | Collective proposal + vote |

---

## Tech Stack

Carried from mother-board, no changes to the core stack:

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 22 (Alpine) |
| API framework | Express.js 4.x |
| Language | TypeScript 5.x |
| Primary database | PostgreSQL 16 |
| Artifact validation | AJV (JSON schema) |
| Governance signing | jose (JOSE/HMAC) |
| Frontend | Next.js 16 / React 19 |
| Containerization | Docker (Alpine, non-root) |
| Orchestration | Docker Compose |
| Testing | Vitest |

New dependency: labor-commons client (HTTP client for the labor-commons catalog API, or local catalog clone for offline/self-hosted deployments).

---

## Labor-Commons Integration Points

See [labor-commons-integration.md](labor-commons-integration.md) for full spec. Summary:

1. **`specialist-resolver.ts`** — new service; queries labor-commons for specialists matching a function description; ranks by domain fit and capability coverage; returns an ordered list of specialist definitions.

2. **`agent_blueprint.json`** — extended to include `labor_commons_refs` per chair: an array of specialist slugs from the catalog that back this chair's function.

3. **Chair instantiation** — when the org compiler builds a chair, it loads the specialist definitions from labor-commons and incorporates their supported tasks, scope boundaries, and authority sources into the chair's operating context.

4. **Catalog sync** — a cadence worker periodically checks labor-commons for updates to referenced specialists and surfaces changes that affect the org's active chairs.

---

## Commons-Crew Bridge

Commons-crew (the personal assistant runtime) integrates with commons-board through a dedicated bridge endpoint:

`POST /api/v1/crew-bridge/intent` — accepts a structured intent from commons-crew PA, routes it to the appropriate board function (get weekly brief, surface approvals, check org status, trigger cadence, etc.), returns structured result back to PA for presentation to the user.

The bridge is authenticated per-workspace. Commons-board does not expose a general-purpose chat interface — that is commons-crew's job. Commons-board exposes structured organizational operations.

---

## Deployment

commons-board deploys as a Docker container alongside the user's other OLF services. For collectives and small businesses self-hosting:

```bash
docker compose up commons-board
```

Environment configuration covers:
- Database connection (PostgreSQL)
- labor-commons endpoint (default: github.com/Open-Labor-Foundation/labor-commons, configurable for self-hosted)
- Connector credentials (Slack, etc.)
- Governance signing keys
- commons-crew bridge token
