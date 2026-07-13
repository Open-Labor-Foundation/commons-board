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
> `function-overlays`, migrated). What's still open: a chair's registered
> commons-crew run isn't wired to anything yet — actually routing day-to-day
> task execution through it, so `delegate_to_child` chains reach the
> line-level catalog (director → department → worker), is a distinct,
> larger integration not started. commons-board can currently determine
> what should happen about a gap but has no way to close one that doesn't
> already exist as a capability — that depends on the forthcoming
> `artifact-commons` repo, not built yet.

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
