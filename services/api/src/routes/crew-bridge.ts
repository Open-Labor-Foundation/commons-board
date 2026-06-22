/**
 * Crew Bridge routes — optional interface for commons-crew to consume board
 * governance data and push crew activity back to the board.
 *
 * OLF-original (no Pre-OLF equivalent).
 *
 * commons-board is fully self-contained; commons-crew is optional. This bridge
 * exists as a convenience for users who live in commons-crew — never required,
 * never the primary interface. The board does not depend on crew presence.
 *
 * Authentication: the connection record stores `api_key_env` (the NAME of an
 * env var, not the key itself). When commons-crew requests bridge endpoints it
 * must present `Authorization: Bearer <value>` matching `process.env[api_key_env]`.
 * Secrets are injected at runtime; never stored in this repo.
 *
 * Phase 15 wires push notifications from board → crew. In Phase 12 the bridge
 * is pull-only from crew, push-only for activity to board.
 *
 * Routes:
 *   POST /api/v1/crew-bridge/connect           — register a crew instance (admin)
 *   DELETE /api/v1/crew-bridge/connect         — disconnect the crew instance (admin)
 *   GET  /api/v1/crew-bridge/status            — connection health and metadata
 *   GET  /api/v1/crew-bridge/board-summary     — current board state for crew display
 *   GET  /api/v1/crew-bridge/events            — recent governance events for crew
 *   GET  /api/v1/crew-bridge/actions           — pending actions requiring human attention
 *   GET  /api/v1/crew-bridge/briefs            — latest board briefs
 *   POST /api/v1/crew-bridge/activity          — push crew activity to board
 *   GET  /api/v1/crew-bridge/activity          — list pushed crew activities
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { GovernanceEvent } from "@commons-board/shared";
import { requireContext, requireRole } from "../lib/auth.js";
import { getArtifact } from "../lib/artifact-store.js";
import { appendEvent } from "../lib/decision-log.js";
import { readJson, writeJsonAtomic } from "../lib/persistence.js";

export const crewBridgeRouter = Router();
crewBridgeRouter.use(requireContext);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CrewConnection = {
  workspaceId: string;
  crewInstanceId: string;
  crewInstanceName: string;
  crewEndpoint: string | null;
  api_key_env: string;
  connectedAt: string;
  connectedBy: string;
};

type CrewActivity = {
  id: string;
  workspaceId: string;
  crewInstanceId: string;
  activityType: string;
  memberId: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
};

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const connectionKey = (w: string) => `crew-bridge-connection/${w}`;
const activityKey = (w: string) => `crew-bridge-activity/${w}`;

// ---------------------------------------------------------------------------
// Crew authentication middleware
// For bridge-specific endpoints that commons-crew calls (not board admins)
// ---------------------------------------------------------------------------

function requireCrewAuth(req: Request, res: Response, next: NextFunction): void {
  const { workspaceId } = req.ctx!;
  const connection = readJson<CrewConnection | null>(connectionKey(workspaceId), null);
  if (!connection) {
    res.status(401).json({ error: "crew bridge not connected" });
    return;
  }

  const envKey = connection.api_key_env;
  const configuredKey = envKey ? process.env[envKey] : undefined;
  if (!configuredKey) {
    res.status(503).json({ error: `crew api key env var ${envKey} is not set` });
    return;
  }

  const authHeader = req.header("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || token !== configuredKey) {
    res.status(401).json({ error: "invalid crew bridge token" });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/v1/crew-bridge/connect */
crewBridgeRouter.post("/connect", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const body = req.body as {
    crew_instance_id?: string;
    crew_instance_name?: string;
    crew_endpoint?: string;
    api_key_env?: string;
  };

  if (!body.crew_instance_id || !body.crew_instance_name || !body.api_key_env) {
    res.status(400).json({ error: "crew_instance_id, crew_instance_name, and api_key_env are required" });
    return;
  }

  const connection: CrewConnection = {
    workspaceId,
    crewInstanceId: String(body.crew_instance_id),
    crewInstanceName: String(body.crew_instance_name),
    crewEndpoint: body.crew_endpoint ? String(body.crew_endpoint) : null,
    api_key_env: String(body.api_key_env),
    connectedAt: new Date().toISOString(),
    connectedBy: userId
  };
  writeJsonAtomic(connectionKey(workspaceId), connection);

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "federation_linked",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: {
      crew_instance_id: connection.crewInstanceId,
      crew_instance_name: connection.crewInstanceName,
      api_key_env: connection.api_key_env,
      source: "crew_bridge"
    },
    at: connection.connectedAt
  } satisfies GovernanceEvent);

  res.status(201).json({
    connected: true,
    crew_instance_id: connection.crewInstanceId,
    crew_instance_name: connection.crewInstanceName,
    connected_at: connection.connectedAt
  });
});

/** DELETE /api/v1/crew-bridge/connect */
crewBridgeRouter.delete("/connect", requireRole(["admin"]), (req: Request, res: Response) => {
  const { workspaceId, userId } = req.ctx!;
  const existing = readJson<CrewConnection | null>(connectionKey(workspaceId), null);
  if (!existing) {
    res.status(404).json({ error: "crew bridge not connected" });
    return;
  }
  writeJsonAtomic(connectionKey(workspaceId), null);

  appendEvent({
    event_id: randomUUID(),
    org_id: workspaceId,
    event_type: "board_request_updated",
    actor: userId,
    artifact_type: null,
    artifact_id: null,
    details: { action: "crew_bridge_disconnected", crew_instance_id: existing.crewInstanceId },
    at: new Date().toISOString()
  } satisfies GovernanceEvent);

  res.status(200).json({ disconnected: true, crew_instance_id: existing.crewInstanceId });
});

/** GET /api/v1/crew-bridge/status */
crewBridgeRouter.get("/status", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const connection = readJson<CrewConnection | null>(connectionKey(workspaceId), null);
  if (!connection) {
    res.status(200).json({ connected: false });
    return;
  }
  const keyConfigured = Boolean(connection.api_key_env && process.env[connection.api_key_env]);
  res.status(200).json({
    connected: true,
    crew_instance_id: connection.crewInstanceId,
    crew_instance_name: connection.crewInstanceName,
    crew_endpoint: connection.crewEndpoint,
    api_key_env: connection.api_key_env,
    key_configured: keyConfigured,
    connected_at: connection.connectedAt,
    connected_by: connection.connectedBy
  });
});

/** GET /api/v1/crew-bridge/board-summary
 *  Accessible to both board users (via requireContext) and crew (via requireCrewAuth).
 *  Crew calls this with their own bearer token; board admins call it normally.
 */
crewBridgeRouter.get("/board-summary", requireCrewAuth, (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;

  const businessProfile = getArtifact(workspaceId, "business_profile")?.payload ?? null;
  const objectiveConfig = getArtifact(workspaceId, "objective_config")?.payload ?? null;
  const agentBlueprint = getArtifact(workspaceId, "agent_blueprint")?.payload ?? null;
  const autonomyPolicy = getArtifact(workspaceId, "autonomy_policy")?.payload ?? null;

  type BoardRequest = { status: string };
  const boardRequests = readJson<BoardRequest[]>(`board-requests/${workspaceId}`, []);
  const pendingRequests = boardRequests.filter((r) => ["submitted", "triaged", "planned"].includes(r.status)).length;
  const activeRequests = boardRequests.filter((r) => ["approved", "executing"].includes(r.status)).length;

  type Level4Action = { status: string };
  const level4Actions = readJson<Level4Action[]>(`level4-actions/${workspaceId}`, []);
  const pendingActions = level4Actions.filter((a) => a.status === "pending").length;

  res.status(200).json({
    org: businessProfile,
    objectives: objectiveConfig,
    blueprint_summary: agentBlueprint
      ? {
          chair_count: Array.isArray((agentBlueprint as { chairs?: unknown[] }).chairs)
            ? (agentBlueprint as { chairs: unknown[] }).chairs.length
            : 0
        }
      : null,
    autonomy_mode: (autonomyPolicy as { autonomy_mode?: string } | null)?.autonomy_mode ?? null,
    board_requests: { pending: pendingRequests, active: activeRequests, total: boardRequests.length },
    pending_level4_actions: pendingActions,
    as_of: new Date().toISOString()
  });
});

/** GET /api/v1/crew-bridge/events */
crewBridgeRouter.get("/events", requireCrewAuth, (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const limitParam = Number(req.query.limit ?? 50);
  const limit = Math.min(Math.max(1, limitParam), 200);
  const sinceParam = req.query.since ? String(req.query.since) : null;

  type DecisionLogEntry = { event: { event_type: string; at: string } };
  const allEntries = readJson<DecisionLogEntry[]>(`decision-log/${workspaceId}`, []);
  const filtered = sinceParam
    ? allEntries.filter((e) => e.event.at > sinceParam)
    : allEntries;
  const recent = filtered.slice(-limit).map((e) => e.event);

  res.status(200).json({ events: recent, total: recent.length, limit });
});

/** GET /api/v1/crew-bridge/actions */
crewBridgeRouter.get("/actions", requireCrewAuth, (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;

  type Approval = { status: string; action_id: string; created_at: string };
  const approvals = readJson<Approval[]>(`approvals/${workspaceId}`, []).filter(
    (a) => a.status === "pending"
  );

  type Level4Action = { status: string; type: string; id: string; createdAt: string };
  const level4Actions = readJson<Level4Action[]>(`level4-actions/${workspaceId}`, []).filter(
    (a) => a.status === "pending"
  );

  type BoardRequest = { status: string; title: string; id: string; priority: string; created_at: string };
  const boardRequests = readJson<BoardRequest[]>(`board-requests/${workspaceId}`, []).filter(
    (r) => ["submitted", "triaged"].includes(r.status)
  );

  res.status(200).json({
    pending_approvals: approvals,
    pending_level4_actions: level4Actions,
    pending_board_requests: boardRequests,
    total: approvals.length + level4Actions.length + boardRequests.length
  });
});

/** GET /api/v1/crew-bridge/briefs */
crewBridgeRouter.get("/briefs", requireCrewAuth, (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const limitParam = Number(req.query.limit ?? 10);
  const limit = Math.min(Math.max(1, limitParam), 50);

  type Brief = { id: string; created_at: string };
  const briefs = readJson<Brief[]>(`cadence-briefs/${workspaceId}`, []).slice(-limit);

  res.status(200).json({ briefs, total: briefs.length });
});

/** POST /api/v1/crew-bridge/activity */
crewBridgeRouter.post("/activity", requireCrewAuth, (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const connection = readJson<CrewConnection | null>(connectionKey(workspaceId), null);
  const body = req.body as {
    activity_type?: string;
    member_id?: string;
    payload?: Record<string, unknown>;
  };

  if (!body.activity_type) {
    res.status(400).json({ error: "activity_type is required" });
    return;
  }

  const activity: CrewActivity = {
    id: randomUUID(),
    workspaceId,
    crewInstanceId: connection?.crewInstanceId ?? "unknown",
    activityType: String(body.activity_type),
    memberId: body.member_id ? String(body.member_id) : null,
    payload: body.payload ?? {},
    receivedAt: new Date().toISOString()
  };

  const all = readJson<CrewActivity[]>(activityKey(workspaceId), []);
  writeJsonAtomic(activityKey(workspaceId), [...all, activity]);

  res.status(201).json({ id: activity.id, received_at: activity.receivedAt });
});

/** GET /api/v1/crew-bridge/activity */
crewBridgeRouter.get("/activity", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const activities = readJson<CrewActivity[]>(activityKey(workspaceId), []).slice().reverse();
  res.status(200).json({ activity: activities, total: activities.length });
});
