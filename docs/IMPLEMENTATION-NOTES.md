# Implementation notes

Running detail on how specific pieces of commons-board are wired, kept out
of the README so a first-time reader isn't three screens deep in
implementation before finding the quickstart. See
[open-labor-foundation/ARCHITECTURE.md](https://github.com/Open-Labor-Foundation/open-labor-foundation/blob/main/ARCHITECTURE.md)
for the full ecosystem picture.

## Every chair is a real commons-crew instance

commons-board is governance wrapped around a collection of commons-crew
instances — every chair should be a top-level commons-crew instance, not
separately staffed. That's true at the identity level: every chair is
registered as a real commons-crew run at onboarding (`pa.createChairRun` via
commons-crew's `POST /api/chairs`), giving it an audit trail, autonomy
tiers, and `delegate_to_child` capability from the moment it's created.
Specialist *preview* — which specialist gets pinned to a chair for a human
to review — still runs through commons-board's own labor-commons search,
covering both catalog axes (`naics-overlays` and `function-overlays`).

## Dispatching a board request to its chair

A chair's registered run can actually be used, not just held:
`POST /api/v1/board/requests/:id/dispatch-to-commons-crew` proposes a
`delegate_to_child` dispatch of a board request to its target chair's
commons-crew run (safe to call automatically — it only creates a proposal,
no real-world effect), and a **separate**, explicitly admin/operator-gated
`POST .../dispatch-to-commons-crew/decision` is the only thing that can
actually approve and execute it — `decision` is a required input with no
default, so nothing auto-approves a real-world-impact action on a human's
behalf. Verified end to end against real running servers: propose →
explicit approve → real delegated child run, and propose → explicit deny →
no execution.

The deciding admin is a real commons-crew identity, not a shared
placeholder: `ensureBoardMemberIdentity` bridges a commons-board admin into
commons-crew's own user/membership system on first use (one real user + a
"supporting" membership with the `approval_decision` permission, namespaced
by org so two orgs' same user id can't collide), reusing commons-crew's
existing `POST /api/users` / `POST /api/workspaces/:id/memberships` — no new
commons-crew capability needed. Falls back to commons-crew's seeded
`user_primary` only if the bridge itself can't run, never blocking the
decision on identity-bridging trouble. Live-verified: the bridged identity
actually deciding a real approval, not just existing as a record.

The dispatch UI itself — propose, approve, deny, per request — lives in the
board request's expanded row in `apps/web`, not just the raw API.

A request can also opt in (a checkbox in that same expanded row,
`auto_dispatch_to_commons_crew: true`) to propose that dispatch
automatically the moment its status transitions to `"approved"` — proposing
is still the only automatic part, the decision stays a separate explicit
step either way. Requests that don't opt in are unaffected; whether every
approved request should go through commons-crew instead of (or alongside)
the existing direct-LLM `chair-reasoning.ts` path is a real product
decision this doesn't make unilaterally.

## Addin discovery

commons-board reads its addin catalog from
[artifact-commons](https://github.com/Open-Labor-Foundation/artifact-commons)
by default, and commons-crew can search it as a governed `search_artifacts`
tool — including on its own initiative, mid-task, via commons-crew's
autonomous tool-selection loop (see commons-crew's own `docs/architecture.md`
for what that does and doesn't cover yet).

## Practitioner correction path

labor-commons has a real practitioner-correction path, with a real UI: the
org roster page has a form, populated from each chair's actual assigned
specialists, that submits to `POST /api/v1/org/specialist-corrections` — a
field-level correction (which spec, which field, the proposed value, and
why) that opens a real PR against labor-commons. It never merges anything
itself; the PR goes through the same certification gate and independent
review as any other catalog change (see labor-commons's `GOVERNANCE.md` —
the gate itself isn't built yet). Uses an isolated `git worktree` per
correction rather than the shared checkout every read in this service uses,
specifically so a correction in flight can never make a concurrent read see
the wrong content, and validates `section_slug`/`agent_slug` against the
real catalog-slug shape before they reach any path construction — an
independent review caught that neither was validated at all in an earlier
version of this change, a real path-traversal issue, not a theoretical one.
