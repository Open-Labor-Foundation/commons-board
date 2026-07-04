/**
 * Actions API — SIM/LIVE mode toggle and action lifecycle management.
 *
 * Routes (mounted at /api/v1):
 *   GET  /mode                   — read current mode for workspace
 *   POST /mode                   — set mode (SIM|LIVE) for scope
 *   POST /actions                — submit an action
 *   GET  /actions                — list actions with filters
 *   GET  /actions/:id            — get a single action
 *   POST /actions/:id/approve    — approve a REQUESTED action
 *   POST /actions/:id/deny       — deny a REQUESTED action
 *   POST /actions/:id/rerun      — rerun an action (creates new)
 *   GET  /ledger                 — list ledger entries
 *   GET  /ledger/:entryId        — get single ledger entry
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";
import { appendEvent } from "../lib/decision-log.js";

export const actionsRouter = Router();
actionsRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionMode = "SIM" | "LIVE";
type ActionStatus = "REQUESTED" | "SIMULATED" | "APPROVED" | "DENIED" | "EXECUTED" | "RERUN";

type Action = {
  id: string;
  workspace_id: string;
  project_id?: string;
  type: string;
  payload: Record<string, unknown>;
  mode: ActionMode;
  status: ActionStatus;
  initiator: string;
  policy_tags: string[];
  requires_approval: "auto" | "required";
  linked_action_request_id?: string;
  created_at: string;
  updated_at: string;
  decided_at?: string;
  decided_by?: string;
  deny_reason?: string;
};

type LedgerEntry = {
  id: string;
  workspace_id: string;
  action_id: string;
  event: ActionStatus;
  actor: string;
  note?: string;
  created_at: string;
};

type ModeRecord = {
  mode: ActionMode;
  scope: "workspace" | "project";
  scope_id: string;
  updated_at: string;
  set_by: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionsKey(workspaceId: string): string {
  return `actions/${workspaceId}`;
}

function ledgerKey(workspaceId: string): string {
  return `ledger/${workspaceId}`;
}

function modeKey(scopeId: string): string {
  return `sim-mode/${scopeId}`;
}

function loadActions(workspaceId: string): Action[] {
  return readJson<Action[]>(actionsKey(workspaceId), []);
}

function saveActions(workspaceId: string, actions: Action[]): void {
  writeJsonAtomic(actionsKey(workspaceId), actions);
}

function loadLedger(workspaceId: string): LedgerEntry[] {
  return readJson<LedgerEntry[]>(ledgerKey(workspaceId), []);
}

function appendLedgerEntry(
  workspaceId: string,
  actionId: string,
  event: ActionStatus,
  actor: string,
  note?: string
): LedgerEntry {
  const entries = loadLedger(workspaceId);
  const entry: LedgerEntry = {
    id: randomUUID(),
    workspace_id: workspaceId,
    action_id: actionId,
    event,
    actor,
    note,
    created_at: new Date().toISOString()
  };
  entries.push(entry);
  writeJsonAtomic(ledgerKey(workspaceId), entries);
  return entry;
}

/**
 * Read the current mode for a given scope (workspace or project).
 * Falls back to LIVE if not set. The persistence key uses lowercase
 * (matching simulation-board.ts's "sim"|"live" convention) so we
 * normalise on read.
 */
function readMode(scopeId: string): ActionMode {
  const raw = readJson<{ mode?: string }>(modeKey(scopeId), {});
  const m = (raw.mode ?? "live").toLowerCase();
  return m === "sim" ? "SIM" : "LIVE";
}

// ---------------------------------------------------------------------------
// Mode routes
// ---------------------------------------------------------------------------

/** GET /mode — read current SIM/LIVE mode for the workspace */
actionsRouter.get("/mode", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const raw = readJson<{ mode?: string; updated_at?: string }>(modeKey(workspaceId), {});
  const mode: ActionMode = (raw.mode ?? "live").toLowerCase() === "sim" ? "SIM" : "LIVE";
  res.status(200).json({
    mode,
    scope: "workspace",
    scope_id: workspaceId,
    updated_at: raw.updated_at ?? null
  });
});

/** POST /mode — set SIM/LIVE mode */
actionsRouter.post(
  "/mode",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const body = req.body as {
      mode: ActionMode;
      scope?: "workspace" | "project";
      scope_id?: string;
    };

    const mode: ActionMode = body.mode === "SIM" ? "SIM" : "LIVE";
    const scope = body.scope ?? "workspace";
    const scopeId = body.scope_id ?? ctx.workspaceId;
    const now = new Date().toISOString();

    const record: ModeRecord = {
      mode,
      scope,
      scope_id: scopeId,
      updated_at: now,
      set_by: ctx.userId
    };

    // Persist using lowercase to stay consistent with simulation-board.ts
    writeJsonAtomic(modeKey(scopeId), {
      mode: mode === "SIM" ? "sim" : "live",
      activated_by: ctx.userId,
      activated_at: now,
      updated_at: now
    });

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "autonomy_mode_changed",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: null,
      details: { mode: mode.toLowerCase(), scope, scope_id: scopeId },
      at: now
    } satisfies GovernanceEvent);

    res.status(200).json(record);
  }
);

// ---------------------------------------------------------------------------
// Action routes
// ---------------------------------------------------------------------------

/** POST /actions — submit an action */
actionsRouter.post(
  "/actions",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const body = req.body as {
      type: string;
      payload: Record<string, unknown>;
      mode?: ActionMode;
      policy_tags?: string[];
      requires_approval?: "auto" | "required";
      project_id?: string;
      linked_action_request_id?: string;
    };

    if (!body.type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    // 1. Determine mode
    let mode: ActionMode;
    if (body.mode === "SIM" || body.mode === "LIVE") {
      mode = body.mode;
    } else {
      mode = readMode(ctx.workspaceId);
    }

    const requires_approval = body.requires_approval ?? "auto";

    // 2. Determine initial status
    let status: ActionStatus;
    if (mode === "SIM") {
      status = "SIMULATED";
    } else if (requires_approval === "required") {
      status = "REQUESTED";
    } else {
      status = "EXECUTED";
    }

    const now = new Date().toISOString();
    const action: Action = {
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      project_id: body.project_id,
      type: body.type,
      payload: body.payload ?? {},
      mode,
      status,
      initiator: ctx.userId,
      policy_tags: body.policy_tags ?? [],
      requires_approval,
      linked_action_request_id: body.linked_action_request_id,
      created_at: now,
      updated_at: now
    };

    const actions = loadActions(ctx.workspaceId);
    actions.push(action);
    saveActions(ctx.workspaceId, actions);

    // 3. Write ledger entry
    appendLedgerEntry(ctx.workspaceId, action.id, status, ctx.userId);

    // 4. Write governance event
    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "action_proposed",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: action.id, type: action.type, mode, status },
      at: now
    } satisfies GovernanceEvent);

    res.status(201).json(action);
  }
);

/** GET /actions — list actions */
actionsRouter.get("/actions", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { mode, type, status } = req.query as Record<string, string | undefined>;

  let actions = loadActions(workspaceId);

  if (mode === "SIM" || mode === "LIVE") {
    actions = actions.filter((a) => a.mode === mode);
  }
  if (type) {
    actions = actions.filter((a) => a.type === type);
  }
  if (status) {
    actions = actions.filter((a) => a.status === status);
  }

  res.status(200).json({ actions, total: actions.length });
});

/** GET /actions/:id — get single action */
actionsRouter.get("/actions/:id", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { id } = req.params;

  const actions = loadActions(workspaceId);
  const action = actions.find((a) => a.id === id);
  if (!action) {
    res.status(404).json({ error: "action not found" });
    return;
  }
  res.status(200).json(action);
});

/** POST /actions/:id/approve */
actionsRouter.post(
  "/actions/:id/approve",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;

    const actions = loadActions(ctx.workspaceId);
    const idx = actions.findIndex((a) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: "action not found" });
      return;
    }

    const action = actions[idx];
    if (action.status !== "REQUESTED") {
      res.status(409).json({ error: "action is not in REQUESTED status", current_status: action.status });
      return;
    }

    const now = new Date().toISOString();
    const updated: Action = {
      ...action,
      status: "APPROVED",
      decided_at: now,
      decided_by: ctx.userId,
      updated_at: now
    };

    actions[idx] = updated;
    saveActions(ctx.workspaceId, actions);

    appendLedgerEntry(ctx.workspaceId, id, "APPROVED", ctx.userId);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "approval_recorded",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: id, decision: "approved" },
      at: now
    } satisfies GovernanceEvent);

    res.status(200).json(updated);
  }
);

/** POST /actions/:id/deny */
actionsRouter.post(
  "/actions/:id/deny",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    const actions = loadActions(ctx.workspaceId);
    const idx = actions.findIndex((a) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: "action not found" });
      return;
    }

    const action = actions[idx];
    const now = new Date().toISOString();
    const updated: Action = {
      ...action,
      status: "DENIED",
      decided_at: now,
      decided_by: ctx.userId,
      deny_reason: reason,
      updated_at: now
    };

    actions[idx] = updated;
    saveActions(ctx.workspaceId, actions);

    appendLedgerEntry(ctx.workspaceId, id, "DENIED", ctx.userId, reason);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "approval_recorded",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: id, decision: "denied", reason: reason ?? "" },
      at: now
    } satisfies GovernanceEvent);

    res.status(200).json(updated);
  }
);

/** POST /actions/:id/rerun */
actionsRouter.post(
  "/actions/:id/rerun",
  requireRole(["admin", "operator"]),
  (req: Request, res: Response) => {
    const ctx = req.ctx!;
    const { id } = req.params;
    const body = req.body as { mode?: ActionMode };

    const actions = loadActions(ctx.workspaceId);
    const original = actions.find((a) => a.id === id);
    if (!original) {
      res.status(404).json({ error: "action not found" });
      return;
    }

    let mode: ActionMode;
    if (body.mode === "SIM" || body.mode === "LIVE") {
      mode = body.mode;
    } else {
      mode = original.mode;
    }

    let status: ActionStatus;
    if (mode === "SIM") {
      status = "SIMULATED";
    } else if (original.requires_approval === "required") {
      status = "REQUESTED";
    } else {
      status = "EXECUTED";
    }

    const now = new Date().toISOString();
    const rerun: Action = {
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      project_id: original.project_id,
      type: original.type,
      payload: original.payload,
      mode,
      status,
      initiator: ctx.userId,
      policy_tags: original.policy_tags,
      requires_approval: original.requires_approval,
      linked_action_request_id: original.id,
      created_at: now,
      updated_at: now
    };

    actions.push(rerun);
    saveActions(ctx.workspaceId, actions);

    appendLedgerEntry(ctx.workspaceId, rerun.id, "RERUN", ctx.userId);

    appendEvent({
      event_id: randomUUID(),
      org_id: ctx.workspaceId,
      event_type: "action_proposed",
      actor: ctx.userId,
      artifact_type: null,
      artifact_id: null,
      details: { action_id: rerun.id, linked_action_request_id: original.id, type: rerun.type, mode, status },
      at: now
    } satisfies GovernanceEvent);

    res.status(201).json(rerun);
  }
);

// ---------------------------------------------------------------------------
// Ledger routes
// ---------------------------------------------------------------------------

/** GET /ledger — list ledger entries */
actionsRouter.get("/ledger", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const entries = loadLedger(workspaceId);
  res.status(200).json({ entries, total: entries.length });
});

/** GET /ledger/:entryId — get single ledger entry */
actionsRouter.get("/ledger/:entryId", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const { entryId } = req.params;

  const entries = loadLedger(workspaceId);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) {
    res.status(404).json({ error: "ledger entry not found" });
    return;
  }
  res.status(200).json(entry);
});
