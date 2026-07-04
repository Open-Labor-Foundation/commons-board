# Contributing to commons-board

> **A note on contributions:** This repository is public for transparency, but is not yet accepting external issues or pull requests directly. Issues are disabled repo-wide, and pull requests from outside collaborators aren't reviewed at this stage. This is expected to change as the project matures — check back, or watch [openlabor.foundation](https://openlabor.foundation) for updates.

commons-board is the organizational governance platform of the Open Labor Foundation. It runs an organization — a business or a worker collective — through a governed hierarchy of AI chairs and worker agents backed by [labor-commons](https://github.com/Open-Labor-Foundation/labor-commons) specialists.

## Before you start

commons-board is under active development as a full migration and transformation of a prior AI executive-board platform into the OLF stack. The design and the phased implementation plan are in [planning/](planning/):

- [planning/concept.md](planning/concept.md) — what commons-board is, the two governance modes, the labor-commons relationship
- [planning/architecture.md](planning/architecture.md) — monorepo structure, what carries vs. what changes, tech stack
- [planning/artifacts.md](planning/artifacts.md) — the governing artifact schemas
- [planning/labor-commons-integration.md](planning/labor-commons-integration.md) — how specialists staff the board
- [planning/execution-plan.md](planning/execution-plan.md) — the 16-phase build plan with acceptance criteria

Read these before proposing changes. Work should map to a phase in the execution plan.

## Principles that are not up for negotiation

- **Artifacts are authoritative.** Agents read artifacts and act; agents never write artifacts. Connectors provide data views only.
- **Every action is governed and audited before it executes.** Actions are signed, hash-chained, and written to the decision log *before* execution, not after.
- **The LLM is never the source of truth** for permissions, approvals, audit logs, risk classification, or objective scoring.
- **Autonomy is never self-promoted.** Only explicit operator or member action moves an org up the advisor → orchestrator → autopilot ramp.
- **No credentials in the repo.** Provider keys, connector secrets, and tokens are deployment-specific settings injected at runtime. Nothing usable as a secret is ever committed.

## How to contribute

1. Fork the repository
2. Make changes that map to a defined phase and respect its acceptance criteria
3. Include tests at the layer the phase requires (unit / integration / e2e / governance)
4. Open a pull request describing what changed, which phase it belongs to, and how you verified it

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The full OLF code of conduct is in [open-labor-foundation](https://github.com/Open-Labor-Foundation/open-labor-foundation/blob/main/CODE_OF_CONDUCT.md).

## License

This repository is licensed under [AGPL-3.0](LICENSE).
