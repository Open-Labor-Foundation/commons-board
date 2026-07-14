# commons-board

A governed AI orchestration engine: it runs a business or a worker
collective end to end, from board-level strategy down to worker-agent task
execution, staffed by specialists defined in
[labor-commons](https://github.com/Open-Labor-Foundation/labor-commons).

> **Status: in development.** Full design and phased implementation plan in
> [planning/](planning/) — start with
> [planning/concept.md](planning/concept.md) and
> [planning/execution-plan.md](planning/execution-plan.md).

> **Known shortcomings:** see [open-labor-foundation/ARCHITECTURE.md](https://github.com/Open-Labor-Foundation/open-labor-foundation/blob/main/ARCHITECTURE.md)
> for the full ecosystem picture. commons-board is meant to be governance
> wrapped around a collection of commons-crew instances — every chair should
> be a top-level commons-crew instance, not separately staffed. That's now
> true at the identity level: every chair is registered as a real
> commons-crew run at onboarding (`pa.createChairRun` via commons-crew's
> `POST /api/chairs`), giving it an audit trail, autonomy tiers, and
> `delegate_to_child` capability from the moment it's created. Specialist
> *preview* — which specialist gets pinned to a chair for a human to review
> — still runs through commons-board's own labor-commons search, now
> correctly covering both catalog axes (`naics-overlays` and
> `function-overlays`, migrated).
>
> A chair's registered run can now actually be used, not just held:
> `POST /api/v1/board/requests/:id/dispatch-to-commons-crew` proposes a
> `delegate_to_child` dispatch of a board request to its target chair's
> commons-crew run (safe to call automatically — it only creates a proposal,
> no real-world effect), and a **separate**, explicitly admin/operator-gated
> `POST .../dispatch-to-commons-crew/decision` is the only thing that can
> actually approve and execute it — `decision` is a required input with no
> default, so nothing auto-approves a real-world-impact action on a human's
> behalf. Verified end to end against real running servers: propose →
> explicit approve → real delegated child run, and propose → explicit deny
> → no execution. The deciding admin is a real commons-crew identity, not a
> shared placeholder: `ensureBoardMemberIdentity` bridges a commons-board
> admin into commons-crew's own user/membership system on first use (one
> real user + a "supporting" membership with the `approval_decision`
> permission, namespaced by org so two orgs' same user id can't collide),
> reusing commons-crew's existing `POST /api/users` /
> `POST /api/workspaces/:id/memberships` — no new commons-crew capability
> needed. Falls back to commons-crew's seeded `user_primary` only if the
> bridge itself can't run, never blocking the decision on identity-bridging
> trouble. Live-verified: the bridged identity actually deciding a real
> approval, not just existing as a record. The dispatch UI itself — propose,
> approve, deny, per request — lives in the board request's expanded row in
> `apps/web`, not just the raw API.
>
> A request can also opt in (a checkbox in that same expanded row,
> `auto_dispatch_to_commons_crew: true`) to propose that dispatch
> automatically the moment its status transitions to `"approved"` —
> proposing is still the only automatic part, the decision stays a separate
> explicit step either way. Requests that don't opt in are unaffected;
> whether every approved request should go through commons-crew instead of
> (or alongside) the existing direct-LLM `chair-reasoning.ts` path is a real
> product decision this doesn't make unilaterally.
>
> commons-board also now reads its addin catalog from
> [artifact-commons](https://github.com/Open-Labor-Foundation/artifact-commons)
> by default, and commons-crew can search it as a governed
> `search_artifacts` tool — including on its own initiative now, mid-task,
> via commons-crew's autonomous tool-selection loop (see commons-crew's own
> `docs/architecture.md` for what that does and doesn't cover yet).
>
> labor-commons also has a real practitioner-correction path now, with a
> real UI: the org roster page has a form, populated from each chair's
> actual assigned specialists, that submits to
> `POST /api/v1/org/specialist-corrections` — a field-level correction
> (which spec, which field, the proposed value, and why) that opens a real
> PR against labor-commons. It never merges anything itself; the PR goes
> through the same certification gate and independent review as any other
> catalog change (see `GOVERNANCE.md` — the gate itself isn't built yet).
> Uses an isolated `git worktree` per correction rather than the shared
> checkout every read in this service uses, specifically so a correction in
> flight can never make a concurrent read see the wrong content, and
> validates `section_slug`/`agent_slug` against the real catalog-slug shape
> before they reach any path construction — an independent review caught
> that neither was validated at all in an earlier version of this change,
> a real path-traversal issue, not a theoretical one.

## The governed hierarchy

Every action moves through a chain of authority, not a flat pool of agents:

- **Board** — strategy, policy, cross-function coordination
- **Executive chairs** — functional ownership (finance, legal, HR, marketing, operations, product)
- **Orchestrating agents** — coordinate multi-step workflows across chairs
- **Worker agents** — execute a single task inside a defined scope

Three autonomy levels control how much of that chain runs without a human:

| Mode | Behavior |
|---|---|
| Advisor | every proposed action surfaces for approval before it executes |
| Orchestrator | routine actions execute automatically; novel or high-risk actions surface for approval |
| Autopilot | actions execute within policy thresholds; low-confidence decisions escalate |

New deployments start in Advisor.

## Two modes, one engine

| Mode | Authority | Economics |
|---|---|---|
| Business | owner / founding team | bill your own customers — subscriptions, per-seat, invoicing |
| Collective | membership, by vote/consensus | pooled treasury, governed distribution |

The mode changes who approves what. Everything else — the hierarchy, the
catalog, the autonomy controls — is shared.

## Addins

Addins are both developed and installed here. A business running its own
board eventually builds something specific to its operation; that becomes
an addin others can install from
[commons-artifacts](https://github.com/Open-Labor-Foundation/commons-artifacts).
Publishing one back to commons-artifacts from inside a running board — no
git required — is a planned feature, not built yet; today that step is
manual.

## Quickstart

```bash
cp .env.example .env
docker compose up
```

- API: http://127.0.0.1:4000 (health check at `/health`)
- Web UI: http://127.0.0.1:3100

Ships bound to localhost with header-based auth for a single trusted
operator by default. Read `.env.example` before exposing it beyond your own
machine.

## Roadmap: who this is for today

Inference access is solved — configure your own provider and API key
through the Settings UI; no docker-level secrets required. What's left is
packaging: Docker and a terminal are still the deployment path, a real
barrier for the small business owners and worker collectives this is
ultimately built for, most of whom won't run a container by hand. A
no-terminal deployment (desktop and mobile apps) is a near-term commitment,
not built yet.

## Repo layout

| Path | What's there |
|---|---|
| `apps/web` | Next.js UI |
| `services/api` | orchestration engine, REST API |
| `services/testing-agent` | — |
| `packages/shared`, `packages/connectors` | shared types, inference-provider connectors |

`npm run dev` / `build` / `test` / `lint` / `migrate` run across all
workspaces.

## Part of the Open Labor Foundation

[labor-commons](https://github.com/Open-Labor-Foundation/labor-commons) —
the catalog this draws from · [commons-keeper](https://github.com/Open-Labor-Foundation/commons-keeper)
— keeps it current · [commons-crew](https://github.com/Open-Labor-Foundation/commons-crew)
— personal-assistant alternative front end · [commons-idea](https://github.com/Open-Labor-Foundation/commons-idea)
— build something, then bring it here to govern at org scale.

## License

AGPL-3.0.
