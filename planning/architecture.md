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
| Chat interpreter | Carried as commons-board's own primary human interface; rewired to draw chair capabilities from labor-commons specialists |
| UI | Carried as the primary oversight/audit surface; commons-crew bridge is an optional add-on, not the main interface |
| Provider/inference | New settings subsystem: pluggable inference providers (hosted API, harness/console, local) selectable per deployment; credentials injected at runtime, never in-repo |
| Auth/RBAC | Carried; exposed as operator-controllable settings |

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
│   │   │   │   ├── treasury.ts                  ← new (collective economics)
│   │   │   │   ├── monetization.ts              ← inverted from billing.ts (business)
│   │   │   │   ├── labor-commons-client.ts      ← new
│   │   │   │   └── provider/                    ← new (inference adapters)
│   │   │   │       ├── index.ts                 (provider interface)
│   │   │   │       ├── hosted-api.ts            (hosted API adapter)
│   │   │   │       ├── harness-console.ts       (console/harness adapter)
│   │   │   │       └── local-inference.ts       (local adapter)
│   │   │   ├── routes/
│   │   │   │   ├── interview.ts
│   │   │   │   ├── execution.ts
│   │   │   │   ├── approvals.ts
│   │   │   │   ├── cadence.ts
│   │   │   │   ├── artifacts.ts
│   │   │   │   ├── decision-logs.ts
│   │   │   │   ├── org.ts
│   │   │   │   ├── settings.ts                 ← new (provider + RBAC + prefs)
│   │   │   │   ├── monetization.ts             ← new (business mode)
│   │   │   │   ├── treasury.ts                 ← new (collective mode)
│   │   │   │   ├── federation.ts
│   │   │   │   ├── membership.ts               ← new (collective mode)
│   │   │   │   └── crew-bridge.ts              ← new (optional integration)
│   │   │   └── services/
│   │   │       ├── board-orchestration.ts
│   │   │       ├── org-compiler.ts
│   │   │       ├── chat-interpreter.ts          (primary human interface)
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
┌──────────────────────────┐      ┌──────────────────────────────┐
│  commons-board own UI +   │      │  commons-crew PA (optional)   │
│  chat interpreter (PRIMARY)│      │  via crew-bridge (convenience)│
└─────────────┬─────────────┘      └───────────────┬──────────────┘
             │                                     │ crew-bridge API
┌─────────────▼─────────────────────────────────────▼──────────────┐
│              API Gateway (Express, port 4000)                     │
│  Authentication/RBAC, verification policy, rate limiting          │
└────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────────┘
     │      │      │      │      │      │      │
 Interview  Exec  Aprv  Caden  Org  Settings  Crew-Bridge(opt)
     │      │      │      │      │      │      │
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

## Provider & Settings Subsystem

commons-board's reasoning runs through configurable inference providers. A settings service exposes provider selection and operator-controllable configuration (including RBAC settings).

- **Provider abstraction** (`services/api/src/lib/provider/`) — one interface, multiple adapters: hosted API providers, harness/console-based providers, and local inference. The active provider is chosen in settings, switchable per deployment.
- **Settings service** (`routes/settings.ts`) — provider selection, RBAC configuration, autonomy/cadence preferences surfaced to the operator, feature toggles.
- **Credential boundary** — the repo contains provider *adapters and configuration shape*, never usable secrets. Keys and endpoints for the selected provider are deployment-specific settings injected at runtime (env/secret store), consistent with the OLF rule that no API keys live in any OLF repo.

This subsystem is foundational: the interview (Phase 2) and all chair reasoning (Phase 5) call inference through it.

## Commons-Crew Bridge (Optional)

commons-board is fully usable through its own interface. The crew-bridge is an **optional convenience** for users already working inside the commons-crew personal assistant — it is not the primary surface and is not required.

`POST /api/v1/crew-bridge/intent` — accepts a structured intent from a commons-crew PA, routes it to the appropriate board function (get brief, surface approvals, check status, cast vote, trigger cadence, etc.), and returns a structured result for PA presentation.

The bridge is authenticated per-workspace. commons-board also exposes its own chat interpreter and web UI as the primary human surfaces; the bridge simply offers a second door for people already in commons-crew.

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
