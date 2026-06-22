# Phase 1 — Lane Tasks

This session (Opus) built the invariant-critical core of Phase 1 and locked the
contracts. The mechanical, verifiable breadth below is packaged for parallel
Featherless lanes to conserve the directing session's quota. Every lane output
is reviewed and integrated in-session against the invariant checklist.

---

## Recommended lane model

Use the strongest **coding-specialized instruct** model your Featherless plan
exposes, **30B-class or larger**. These tasks are bounded and verifiable, so a
strong open-weight coder is sufficient — but 7B-class is not (it produces
non-mergeable output; the prior Ollama 7B lane experience confirms this).

- **Primary pick:** `Qwen2.5-Coder-32B-Instruct` — best widely-available
  open-weight coder for TypeScript/SQL, and consistent with the Qwen-Coder
  family already used in the stack.
- **Prefer if available:** a newer/larger Qwen3-Coder variant.
- **Acceptable alternatives:** `DeepSeek-V3` / `DeepSeek-Coder-V2`,
  `Llama-3.3-70B-Instruct`.
- **Avoid:** anything under ~30B, and non-code-tuned chat models.

Run all four lanes on the same model for consistency. The directing session
(Opus 4.8) reviews and merges; lanes never merge their own output.

---

## Locked contracts (read before any task)

- Types: `packages/shared/src/types/*.ts` (artifacts, governance, specialist, provider) — **source of truth for all shapes**
- Schema validator (expects schema filenames): `services/api/src/lib/schema-validator.ts`
- Provider registry interface: `services/api/src/lib/provider/index.ts`
- Persistence + decision log + artifact store (do not modify): `services/api/src/lib/{persistence,decision-log,artifact-store,governance-signing}.ts`

## Invariant checklist (applies to every task)

- [ ] No API keys, secrets, or tokens anywhere in output (only env-var *names*)
- [ ] No pre-OLF naming (`MB_`→`CB_`, no `motherboard`/`jkm`/`aieb`/`cb0`)
- [ ] ESM imports use `.js` extensions on relative paths (NodeNext)
- [ ] Output typechecks: `npm run typecheck -w @commons-board/api`
- [ ] Nothing writes an artifact except via `artifact-store.ts`

---

## LANE TASK 1 — Artifact JSON Schemas

**Output:** `packages/shared/src/schemas/<name>.schema.json` for each of:
`business_profile`, `objective_config`, `autonomy_policy`, `cadence_protocol`,
`agent_blueprint`, `collective_config` (exact filenames in `schema-validator.ts`
`SCHEMA_FILES`).

**Spec:** Transcribe each TypeScript interface in
`packages/shared/src/types/artifacts.ts` into a JSON Schema (draft 2020-12).
Required fields = all non-optional properties. Enums must match the TS unions
exactly. `additionalProperties: false` on each object.

**Acceptance:** A valid sample of each artifact passes `validateArtifact`; an
object missing a required field or with a bad enum fails with a clear error.

---

## LANE TASK 2 — Database migrations

**Output:** `services/api/db/migrations/0001_init.sql` … `0014_settings.sql`.

**Spec:** Author idempotent (`CREATE TABLE IF NOT EXISTS`) migrations whose
columns mirror the locked types. Group:
- `0001` orgs (`id`, `governance_mode`, `created_at`)
- `0002` artifacts (`artifact_id`, `org_id`, `type`, `version`, `payload jsonb`, `created_at`)
- `0003` governance_events; `0004` decision_log (`entry_id`, `org_id`, `sequence`, `event jsonb`, `signed jsonb`, `previous_hash`, `entry_hash`, `at`)
- `0005` approval_records; `0006` members; `0007` votes; `0008` amendments; `0009` contributions
- `0010` catalog_refs; `0011` catalog_gaps
- `0012` economics_treasury (accounts, distributions); `0013` economics_monetization (plans, subscriptions, invoices)
- `0014` workspace_settings (`workspace_id`, `active_provider_id`, `providers jsonb`, `rbac jsonb`, `feature_toggles jsonb`, `updated_at`)

**Acceptance:** `npm run migrate -w @commons-board/api` applies all cleanly against the compose Postgres; re-running applies nothing.

---

## LANE TASK 3 — Security libs

**Output:** `services/api/src/lib/{auth,security,http-security,cors,redaction}.ts`.

**Source to port + sanitize:** `Pre-OLF/mother-board/mother-board/services/api/src/lib/` same filenames. Rename `MB_`→`CB_`; drop SaaS/entitlement coupling. `auth.ts` exposes `requireRole(roles)` middleware using the `Role` type from shared.

**Acceptance:** middleware typechecks and mounts in `index.ts`; redaction strips token/secret-like fields from logged objects; no secret defaults.

---

## LANE TASK 4 — Provider adapters

**Output:** `services/api/src/lib/provider/{hosted-api,harness-console,local-inference}.ts`.

**Spec:** Each implements `InferenceProvider` from the registry and calls
`registerProvider(kind, factory)`. Keys come only via `resolveApiKey(config)`
(reads `config.api_key_env`). `hosted-api` = OpenAI-compatible HTTP (works for
Featherless); `harness-console` = console/CLI-bridge style; `local-inference` =
local endpoint, no key.

**Acceptance:** importing each module registers its kind; `createProvider`
returns a working instance; a missing key yields a clear `InferenceResponse`
error, never a throw that leaks the env value.

---

## LANE TASK 5 — Settings route

**Output:** `services/api/src/routes/settings.ts` (Express router) + mount in `index.ts`.

**Spec:** CRUD over `WorkspaceSettings` (shared type): get/update active
provider, list/add/remove provider configs (config only — never a key), read/set
RBAC grants, toggle features. Persist via the file-backed store pattern
(`persistence.ts`) for Phase 1.

**Acceptance:** `GET/PUT /api/v1/settings` round-trips; selecting a provider with
an unregistered kind returns a 400 with a clear message; no endpoint accepts or
returns a credential value.
