# Plan: Wire `services/testing-agent` as a commons-board workspace

## Status: PLAN (investigation + proposed files only — no code changes made)

This document records the current state of `services/testing-agent`, the
dependency analysis, and the exact `package.json` / `tsconfig.json` content
needed to bring it into the `npm run typecheck` / `npm run build` loop. Per the
task scope, **no `package.json` or `tsconfig.json` files were created or
modified** — only this planning document.

---

## 1. Current state

### What the testing-agent is

`services/testing-agent/` is a "Phase 16 validation CLI" — a self-contained
system-validation harness that exercises the commons-board API surface end to
end and emits a JSON pass/fail report. It is intended to be run as
`node services/testing-agent/src/cli.js` (referenced in
[`doctor.ts`](../services/testing-agent/src/doctor.ts:70) hints).

### File inventory (9 .ts files, no config)

| File | Role |
|------|------|
| [`cli.ts`](../services/testing-agent/src/cli.ts:1) | Entry point. Calls `runTestingAgent()`, prints JSON report, sets exit code. |
| [`orchestrator.ts`](../services/testing-agent/src/orchestrator.ts:1) | Runs repo validation → integration simulation → governance validation, then builds the report. |
| [`repo-validator.ts`](../services/testing-agent/src/repo-validator.ts:1) | Spawns `npm run typecheck`, `npm run test`, and shell checks against the repo root. |
| [`command.ts`](../services/testing-agent/src/command.ts:1) | `spawn()` wrapper with retries; returns `ValidationCheck`. |
| [`integration-simulator.ts`](../services/testing-agent/src/integration-simulator.ts:1) | Drives the API via `supertest`: interview, execution, cadence, decision-log, launch, level4, autonomy flows. |
| [`governance-validator.ts`](../services/testing-agent/src/governance-validator.ts:1) | `supertest` checks for authz: unauthorized write blocked, cross-tenant read blocked, unsigned webhook delivery blocked. |
| [`reporter.ts`](../services/testing-agent/src/reporter.ts:1) | Aggregates `ValidationCheck[]` into a `TestingAgentReport`. |
| [`doctor.ts`](../services/testing-agent/src/doctor.ts:1) | Standalone env/file/API diagnostics script (top-level `await main()`). |
| [`types.ts`](../services/testing-agent/src/types.ts:1) | `ValidationCheck` and `TestingAgentReport` types. |

### Why it is dead code today

The directory has **no `package.json`** and **no `tsconfig.json`**. The root
[`package.json`](../package.json:6) workspaces glob is `services/*`, which *would*
match `services/testing-agent` — but npm only treats a directory as a workspace
if it contains a `package.json`. With none present, `npm run typecheck
--workspaces --if-present` and `npm run build --workspaces --if-present` silently
skip it. The 9 `.ts` files are therefore never compiled or type-checked by any
root script.

---

## 2. Dependency analysis

### Import graph (per file)

| File | Imports |
|------|---------|
| `cli.ts` | `./orchestrator.js` (internal) |
| `orchestrator.ts` | `./governance-validator.js`, `./integration-simulator.js`, `./reporter.js`, `./repo-validator.js`, `./types.js` (all internal) |
| `repo-validator.ts` | `node:path`, `node:url`, `./command.js`, `./types.js` |
| `command.ts` | `node:child_process`, `./types.js` |
| `integration-simulator.ts` | **`supertest`** (external), **`../../api/src/index.js`** (cross-service source import), `./types.js` |
| `governance-validator.ts` | **`supertest`** (external), **`../../api/src/index.js`** (cross-service source import), `./types.js` |
| `reporter.ts` | `./types.js` |
| `doctor.ts` | `node:path`, `node:url`, `node:fs` |
| `types.ts` | (none) |

### External dependencies required

| Package | Used by | Present in repo? |
|---------|---------|-------------------|
| `supertest` | `integration-simulator.ts`, `governance-validator.ts` | **No** — not in any `package.json` and not in `package-lock.json` (confirmed via search). |
| `@types/supertest` | (types for supertest) | **No** — needed for `tsc` to resolve the `request` import. |
| `tsx` | (dev runner, matching api pattern) | Yes — in `services/api` devDependencies (`^4.19.0`). |
| `typescript` | (dev, for `tsc`) | Yes — root devDependencies (`^5.9.2`). |
| `@types/node` | (dev, Node APIs) | Yes — root devDependencies (`^22.7.0`). |

### Internal dependency graph

The testing-agent does **not** import `@commons-board/shared` or
`@commons-board/connectors` directly. Its only internal cross-workspace
dependency is a **direct source import** of the api service:

```ts
import app from "../../api/src/index.js";
```

This is used in [`integration-simulator.ts`](../services/testing-agent/src/integration-simulator.ts:2)
and [`governance-validator.ts`](../services/testing-agent/src/governance-validator.ts:2).

### ⚠️ Blocker: missing default export in the API

The testing-agent imports `app` as a **default** import, but
[`services/api/src/index.ts`](../services/api/src/index.ts:1) has **no
`export default`** (confirmed by search — 0 results). It exports only:

- `createApp()` — named, returns an `express.Express`
- `start()` — named, listens + starts job runner + cadence scheduler

So even after wiring the workspace, `tsc` will fail on
`integration-simulator.ts` and `governance-validator.ts` with
`TS2613: Module has no default export` (or `TS1192` under
`esModuleInterop`). This is a **pre-existing code defect**, not a wiring
problem — but wiring the workspace is what will surface it.

**Resolution options (out of scope for this plan, but required for green typecheck):**
1. Add `export default createApp();` to `services/api/src/index.ts` (matches the
   testing-agent's expectation, but instantiates an app at module load).
2. Change the testing-agent imports to `import { createApp } from "../../api/src/index.js"`
   and call `createApp()` locally (cleaner — no module-load side effects).

Option 2 is recommended. Either way, this is a code change that must accompany
the workspace wiring for `npm run typecheck` to pass.

### ⚠️ Blocker: `supertest` not installed

`supertest` and `@types/supertest` are not present anywhere in the repo. Adding
them to the testing-agent's `package.json` and running `npm install` from the
commons-board root will install them into the workspace `node_modules`.

---

## 3. Proposed `package.json`

> **Not created.** This is the proposed content for
> `commons-board/services/testing-agent/package.json`, to be created during
> implementation.

```json
{
  "name": "@commons-board/testing-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --import tsx --test 'src/__tests__/**/*.test.ts'",
    "validate": "node --import tsx src/cli.ts",
    "doctor": "node --import tsx src/doctor.ts"
  },
  "dependencies": {
    "@commons-board/api": "*",
    "supertest": "^7.0.0"
  },
  "devDependencies": {
    "@types/supertest": "^6.0.0",
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.9.2"
  }
}
```

### Notes on this proposal

- **`@commons-board/api` dependency** — declared as `"*"` to match the
  workspace-link convention used by `services/api` for `@commons-board/shared`
  and `@commons-board/connectors`. This makes the api resolvable as a workspace
  package. **However**, the testing-agent currently imports the api via a relative
  source path (`../../api/src/index.js`), not via the package name. See §6
  (Concerns) for the two viable approaches.
- **`supertest` / `@types/supertest`** — added because they are genuinely
  imported and absent from the repo. Version pins (`^7.0.0` / `^6.0.0`) reflect
  current major lines; the implementer should confirm against the latest
  compatible release at install time.
- **`validate` and `doctor` scripts** — convenience runners matching the
  agent's purpose; not required for typecheck/build inclusion but useful for
  operators.
- **No `main`/`exports`** — this is a CLI tool, not an importable library,
  matching the pattern that `services/api` exposes `main` only because it is
  server-launched.

---

## 4. Proposed `tsconfig.json`

> **Not created.** This is the proposed content for
> `commons-board/services/testing-agent/tsconfig.json`, to be created during
> implementation.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../api" }],
  "include": ["src/**/*"]
}
```

### Notes on this proposal

- **`extends`** — matches [`services/api/tsconfig.json`](../services/api/tsconfig.json:2)
  and [`packages/shared/tsconfig.json`](../packages/shared/tsconfig.json:2),
  both of which extend `../../tsconfig.base.json`.
- **`references`** — points at `../api` (the api workspace) because the
  testing-agent imports api source. This mirrors how
  [`services/api/tsconfig.json`](../services/api/tsconfig.json:7) references
  `../../packages/shared` and `../../packages/connectors`. For `references` to
  work, the api workspace must have `composite: true` in its tsconfig — which it
  inherits from [`tsconfig.base.json`](../tsconfig.base.json:14).
- **`rootDir`/`outDir`** — matches the api pattern.

---

## 5. Root `package.json` changes

**No change required.** The root
[`package.json`](../package.json:6) workspaces array is:

```json
"workspaces": [
  "packages/*",
  "services/*",
  "apps/*"
]
```

The `services/*` glob already covers `services/testing-agent`. The only reason
it is skipped today is the **absence of a `package.json`** inside the directory.
Once `services/testing-agent/package.json` exists, npm will automatically
include it in `--workspaces` iterations, and the root scripts
(`npm run build`, `npm run typecheck`, `npm run test`, `npm run lint`) will
pick it up via their `--if-present` flags.

The only follow-up is running `npm install` from the `commons-board/` root after
creating the package.json, so that `supertest`/`@types/supertest` are installed
and the `@commons-board/testing-agent` workspace is registered in
`node_modules`/`package-lock.json`.

---

## 6. Concerns and blockers

### 6.1 Missing default export in the API (blocks green typecheck)

As detailed in §2, the testing-agent does `import app from "../../api/src/index.js"`
but [`services/api/src/index.ts`](../services/api/src/index.ts:1) has no default
export. Wiring the workspace will make `tsc` surface this as a hard error.

**Recommended fix (code change, not part of this plan):** change the two
testing-agent imports to a named import and call `createApp()`:

```ts
import { createApp } from "../../api/src/index.js";
// ...
const app = createApp();
```

This avoids module-load side effects (the api's `index.ts` starts a cadence
scheduler and job runner only when run as `process.argv[1]`, but importing
`createApp` still pulls in a large module graph — acceptable for a test harness).

### 6.2 `supertest` is not in the repo

Must be added to the testing-agent's `dependencies` and installed via
`npm install` from the commons-board root. No other workspace needs it.

### 6.3 Cross-service source import vs. package import

The testing-agent imports the api via a relative path (`../../api/src/index.js`)
rather than via the `@commons-board/api` package name. This works for
typechecking (TypeScript resolves the relative path) but bypasses the workspace
package boundary. Two options:

- **Keep the relative import** (simplest, matches current code). The
  `@commons-board/api` entry in `dependencies` is then only needed if the
  implementer later switches to a package-name import. The `references` entry in
  `tsconfig.json` is still needed for project-reference builds.
- **Switch to `import { createApp } from "@commons-board/api"`** (cleaner
  boundary). Requires the api to export `createApp` from its package entry
  (`main: dist/index.js`) and the testing-agent to depend on the built api dist,
  not its source. This adds a build-order coupling: api must be built before
  testing-agent can typecheck against the package.

**Recommendation:** keep the relative source import for now (option 1) to
minimize scope, and resolve the default-export issue per §6.1. The
`@commons-board/api` dependency line in the proposed package.json can be
dropped if option 1 is chosen; it is included above to document the
relationship.

### 6.4 `doctor.ts` is a top-level-await script

[`doctor.ts`](../services/testing-agent/src/doctor.ts:79) uses top-level
`await main()`. Under `tsc` with `target: ES2022` and `module: NodeNext`
(from [`tsconfig.base.json`](../tsconfig.base.json:3)), top-level await is
allowed only in modules. Since the file has no imports/exports, TypeScript may
treat it as a script unless `module` is set. With `type: "module"` in
package.json and `module: NodeNext`, it should be treated as an ES module —
but the implementer should verify `tsc` does not emit
`TS1378: Top-level 'await' is not permitted` for this file.

### 6.5 No circular dependency risk

The testing-agent depends on the api; the api does not import the testing-agent.
The dependency graph is one-directional. No circular workspace reference.

---

## 7. Verification plan

After the `package.json` and `tsconfig.json` are created (implementation phase,
not this plan), run from `commons-board/`:

1. **Workspace registration**
   ```bash
   npm install
   ```
   Confirm `@commons-board/testing-agent` appears in `node_modules/@commons-board/`
   and `package-lock.json`.

2. **Workspace discovery**
   ```bash
   npm ls --workspaces
   ```
   Confirm `@commons-board/testing-agent` is listed.

3. **Typecheck inclusion**
   ```bash
   npm run typecheck
   ```
   Confirm the output includes a `> @commons-board/testing-agent` line. Expect
   failures from §6.1 (missing default export) until the code fix is applied.

4. **Build inclusion**
   ```bash
   npm run build
   ```
   Confirm `services/testing-agent/dist/` is produced (after §6.1/§6.2 are
   resolved).

5. **Reachability check (per OLF verification rules)**
   The stated user of this workspace is an **operator running the validation
   CLI**. Verify the surface they actually use:
   ```bash
   npm run validate -w @commons-board/testing-agent
   # or: node --import tsx services/testing-agent/src/cli.ts
   ```
   Confirm it emits a JSON report with `status: "pass" | "fail"` and a
   `metrics` block. This is the real reachability gate — a green `tsc` alone
   does not prove the agent runs.

6. **Doctor script**
   ```bash
   npm run doctor -w @commons-board/testing-agent
   ```
   Confirm it emits the env/file/api diagnostics JSON.

---

## 8. Scope summary

- **In scope for this plan:** investigation, dependency analysis, proposed
  `package.json` / `tsconfig.json` content, root-config assessment,
  verification plan, blocker identification.
- **Out of scope (deferred to implementation):** creating
  `services/testing-agent/package.json`, creating
  `services/testing-agent/tsconfig.json`, running `npm install`, fixing the
  api default-export defect (§6.1), adding `supertest` to the lockfile.
- **Honest disclosure of narrowed scope:** This plan does *not* result in a
  green typecheck on its own. Two code-level fixes (§6.1 default export,
  §6.2 supertest install) are prerequisites for `npm run typecheck` to pass
  once the workspace is wired. The plan intentionally stops at the wiring
  boundary; the code fixes are flagged for the implementer rather than
  silently assumed away.